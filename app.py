#!/usr/bin/env python3
"""frp-manager-lite: separated backend API + static frontend.

No Docker. No third-party Python dependencies. Intended for direct VPS deployment
behind Nginx/Caddy HTTPS in production.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import urllib.error
import urllib.request
import mimetypes
import os
import secrets
import sqlite3
import sys
import time
import zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
import urllib.parse

APP_NAME = "frp-manager-lite"
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = Path(os.getenv("FML_DB", BASE_DIR / "data.sqlite3"))
HOST = os.getenv("FML_HOST", "127.0.0.1")
PORT = int(os.getenv("FML_PORT", "8080"))
PORT_START = int(os.getenv("FML_PORT_START", "20000"))
PORT_END = int(os.getenv("FML_PORT_END", "20199"))
DEFAULT_MAX_PORTS = int(os.getenv("FML_DEFAULT_MAX_PORTS", "5"))
ADMIN_USER = os.getenv("FML_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("FML_ADMIN_PASSWORD", "admin123")
FRP_SERVER_ADDR = os.getenv("FRP_SERVER_ADDR", "YOUR_FRPS_IP_OR_DOMAIN")
FRP_SERVER_PORT = int(os.getenv("FRP_SERVER_PORT", "7000"))
FRP_AUTH_TOKEN = os.getenv("FRP_AUTH_TOKEN", "CHANGE_ME_SHARED_FRPS_TOKEN")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
R2_PREFIX = os.getenv("R2_PREFIX", "frp-manager-lite/backups")
SESSION_TTL = 7 * 24 * 3600
MAX_BODY = 128 * 1024
ALLOWED_PROXY_TYPES = {"tcp", "udp", "http", "https", "stcp", "xtcp", "tcpmux"}
REMOTE_PORT_PROXY_TYPES = {"tcp", "udp"}
DOMAIN_PROXY_TYPES = {"http", "https", "tcpmux"}
SECRET_KEY_PROXY_TYPES = {"stcp", "xtcp"}
PROXY_TYPE_ORDER = ["tcp", "udp", "http", "https", "stcp", "xtcp", "tcpmux"]
SOFTWARE_LICENSE_SECRET = os.getenv("FML_SOFTWARE_LICENSE_SECRET", "")
SOFTWARE_LICENSE_SERVER_URL = os.getenv("FML_LICENSE_SERVER_URL", "").rstrip("/")
SOFTWARE_LICENSE_AUTHORITY = os.getenv("FML_LICENSE_AUTHORITY", "0").lower() in {"1", "true", "yes", "on"}
SOFTWARE_LICENSE_REQUIRED = True  # always enforced — no env-var off switch
RATE_WINDOW = 15 * 60
LOGIN_RATE_LIMIT = 8
REGISTER_RATE_LIMIT = 5
CSRF_TTL = 2 * 3600


def now() -> int:
    return int(time.time())


def fmt_time(ts: int | None) -> str:
    if not ts:
        return "永不过期"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ts)))


def row_val(row: sqlite3.Row, key: str, default: Any = "") -> Any:
    """Safe Row access — sqlite3.Row lacks .get() on some Python builds."""
    return row[key] if key in row.keys() else default


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    rounds = 180_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)
    return "pbkdf2_sha256${}${}${}".format(
        rounds,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds_s, salt_s, digest_s = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_s)
        expected = base64.b64decode(digest_s)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(rounds_s))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def is_expired(user: sqlite3.Row | dict[str, Any]) -> bool:
    expires_at = int(user["expires_at"] or 0)
    return bool(expires_at and expires_at <= now())


def make_license_key() -> str:
    return "LIC-" + secrets.token_urlsafe(24).replace("-", "").replace("_", "")[:32].upper()


def make_machine_id() -> str:
    return "MID-" + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24].upper()


def normalize_machine_id(machine_id: str) -> str:
    return " ".join(machine_id.strip().split())[:128]


def software_machine_fingerprint() -> str:
    parts: list[str] = []
    # Prefer host machine-id mounted from /host/machine-id (stable across containers)
    host_machine_id_paths = ("/host/machine-id", "/etc/machine-id", "/var/lib/dbus/machine-id")
    for p in host_machine_id_paths:
        try:
            value = Path(p).read_text().strip()
            if value and len(value) > 8:
                parts.append(value)
                break
        except Exception:
            pass
    # Fallback: use DB path as secondary anchor
    parts.append(str(DB_PATH.resolve()))
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def software_license_signature(license_key: str, machine_id: str, plan: str, expires_at: int) -> str:
    if not SOFTWARE_LICENSE_SECRET:
        return ""
    msg = f"{license_key}|{machine_id}|{plan}|{int(expires_at)}"
    return hmac.new(SOFTWARE_LICENSE_SECRET.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def signed_license_payload(license_key: str, machine_id: str, plan: str, expires_at: int) -> dict[str, Any]:
    return {
        "license_key": license_key,
        "machine_id": machine_id,
        "plan": plan,
        "expires_at": int(expires_at),
        "signature": software_license_signature(license_key, machine_id, plan, int(expires_at)),
    }


def verify_signed_license(payload: dict[str, Any]) -> bool:
    if not SOFTWARE_LICENSE_SECRET:
        return True
    return hmac.compare_digest(
        str(payload.get("signature") or ""),
        software_license_signature(str(payload.get("license_key") or ""), str(payload.get("machine_id") or ""), str(payload.get("plan") or "deploy"), int(payload.get("expires_at") or 0)),
    )


def public_software_license(row: sqlite3.Row | None) -> dict[str, Any]:
    fingerprint = software_machine_fingerprint()
    configured = bool(SOFTWARE_LICENSE_SERVER_URL or SOFTWARE_LICENSE_SECRET or SOFTWARE_LICENSE_AUTHORITY)
    if not row:
        return {"configured": configured, "required": SOFTWARE_LICENSE_REQUIRED, "active": not SOFTWARE_LICENSE_REQUIRED, "licensed": False, "machine_id": fingerprint, "message": "未激活软件授权" if SOFTWARE_LICENSE_REQUIRED else "未启用软件授权"}
    expires_at = int(row["expires_at"] or 0)
    valid_sig = verify_signed_license({"license_key": row["license_key"], "machine_id": row["machine_id"], "plan": row["plan"], "expires_at": expires_at, "signature": row["signature"]})
    bound_ok = row["machine_id"] == fingerprint
    active = bool(row["active"]) and valid_sig and bound_ok and not (expires_at and expires_at <= now())
    return {
        "configured": configured,
        "required": SOFTWARE_LICENSE_REQUIRED,
        "active": active or not SOFTWARE_LICENSE_REQUIRED,
        "licensed": active,
        "license_key": row["license_key"],
        "machine_id": fingerprint,
        "bound_machine_id": row["machine_id"],
        "server_url": row["server_url"] if "server_url" in row.keys() else "",
        "plan": row["plan"],
        "expires_at": expires_at,
        "expires_text": fmt_time(expires_at),
        "valid_signature": valid_sig,
        "bound_ok": bound_ok,
        "message": "软件授权有效" if active else ("软件授权签名无效" if not valid_sig else "软件授权机器不匹配" if not bound_ok else "软件授权已停用或过期"),
    }


def current_software_license(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM software_license ORDER BY id DESC LIMIT 1").fetchone()
    return public_software_license(row)


def software_license_ok() -> bool:
    if not SOFTWARE_LICENSE_REQUIRED:
        return True
    try:
        with db() as conn:
            return bool(current_software_license(conn).get("active"))
    except Exception:
        return False


def public_user(user: sqlite3.Row) -> dict[str, Any]:
    license_key = row_val(user, "license_key")
    machine_id = row_val(user, "machine_id")
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "token": user["token"],
        "license_key": license_key,
        "machine_id": machine_id,
        "licensed": bool(license_key),
        "license_bound": bool(machine_id),
        "max_ports": user["max_ports"],
        "active": bool(user["active"]),
        "expires_at": user["expires_at"],
        "expires_text": fmt_time(user["expires_at"]),
        "expired": is_expired(user),
        "created_at": user["created_at"],
        "node_id": user["node_id"] if "node_id" in user.keys() else None,
    }


def node_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "region": row["region"],
        "name": row["name"],
        "server_addr": row["server_addr"],
        "server_port": row["server_port"],
        "auth_token": row["auth_token"],
        "port_start": row["port_start"],
        "port_end": row["port_end"],
        "active": bool(row["active"]),
        "note": row["note"],
        "created_at": row["created_at"],
    }


def ensure_default_node(conn: sqlite3.Connection) -> int:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region TEXT NOT NULL DEFAULT '默认地区',
            name TEXT NOT NULL UNIQUE,
            server_addr TEXT NOT NULL,
            server_port INTEGER NOT NULL DEFAULT 7000,
            auth_token TEXT NOT NULL,
            port_start INTEGER NOT NULL,
            port_end INTEGER NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            note TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );
        """
    )
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(nodes)").fetchall()}
    if "region" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN region TEXT NOT NULL DEFAULT '默认地区'")
    row = conn.execute("SELECT id FROM nodes ORDER BY id LIMIT 1").fetchone()
    if row:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO nodes(region, name, server_addr, server_port, auth_token, port_start, port_end, active, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("默认地区", "default", FRP_SERVER_ADDR, FRP_SERVER_PORT, FRP_AUTH_TOKEN, PORT_START, PORT_END, 1, "自动创建的默认节点", now()),
    )
    return int(cur.lastrowid)


def migrate_region_nodes(conn: sqlite3.Connection, default_node_id: int) -> None:
    user_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "node_id" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL")
        conn.execute("UPDATE users SET node_id=? WHERE node_id IS NULL", (default_node_id,))
    if "license_key" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN license_key TEXT NOT NULL DEFAULT ''")
        for r in conn.execute("SELECT id FROM users WHERE license_key='' OR license_key IS NULL").fetchall():
            conn.execute("UPDATE users SET license_key=? WHERE id=?", (make_license_key(), r["id"]))
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_license_key ON users(license_key)")
    if "machine_id" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN machine_id TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_license_key ON users(license_key)")

    port_cols = [r["name"] for r in conn.execute("PRAGMA table_info(ports)").fetchall()]
    if "node_id" not in port_cols or "id" not in port_cols:
        conn.execute("ALTER TABLE ports RENAME TO ports_old")
        conn.execute(
            """
            CREATE TABLE ports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                port INTEGER NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(node_id, port)
            );
            """
        )
        conn.execute("INSERT OR IGNORE INTO ports(node_id, port, user_id, created_at) SELECT ?, port, user_id, created_at FROM ports_old", (default_node_id,))
        conn.execute("DROP TABLE ports_old")
    else:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_ports_node_port ON ports(node_id, port)")

    tunnel_cols = [r["name"] for r in conn.execute("PRAGMA table_info(tunnels)").fetchall()]
    if "node_id" not in tunnel_cols:
        conn.execute("ALTER TABLE tunnels RENAME TO tunnels_old")
        conn.execute(
            """
            CREATE TABLE tunnels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                proxy_type TEXT NOT NULL DEFAULT 'tcp',
                local_ip TEXT NOT NULL DEFAULT '127.0.0.1',
                local_port INTEGER NOT NULL,
                remote_port INTEGER NOT NULL,
                custom_domains TEXT NOT NULL DEFAULT '',
                secret_key TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                UNIQUE(user_id, name)
            );
            """
        )
        conn.execute("INSERT OR IGNORE INTO tunnels(node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at) SELECT ?, user_id, name, proxy_type, local_ip, local_port, remote_port, '', '', enabled, created_at FROM tunnels_old", (default_node_id,))
        conn.execute("DROP TABLE tunnels_old")
    else:
        if "custom_domains" not in tunnel_cols:
            conn.execute("ALTER TABLE tunnels ADD COLUMN custom_domains TEXT NOT NULL DEFAULT ''")
        if "secret_key" not in tunnel_cols:
            conn.execute("ALTER TABLE tunnels ADD COLUMN secret_key TEXT NOT NULL DEFAULT ''")
        schema = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='tunnels'").fetchone()["sql"] or ""
        if "UNIQUE(node_id, remote_port)" in schema:
            conn.execute("ALTER TABLE tunnels RENAME TO tunnels_old")
            conn.execute(
                """
                CREATE TABLE tunnels (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    proxy_type TEXT NOT NULL DEFAULT 'tcp',
                    local_ip TEXT NOT NULL DEFAULT '127.0.0.1',
                    local_port INTEGER NOT NULL,
                    remote_port INTEGER NOT NULL,
                    custom_domains TEXT NOT NULL DEFAULT '',
                    secret_key TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    UNIQUE(user_id, name)
                );
                """
            )
            conn.execute("INSERT OR IGNORE INTO tunnels(id, node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at) SELECT id, node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at FROM tunnels_old")
            conn.execute("DROP TABLE tunnels_old")
    conn.execute("DROP INDEX IF EXISTS idx_tunnels_node_port")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tunnels_node_port_remote ON tunnels(node_id, remote_port) WHERE remote_port > 0")


def list_public_nodes(conn: sqlite3.Connection, active_only: bool = True) -> list[dict[str, Any]]:
    where = "WHERE n.active=1" if active_only else ""
    rows = conn.execute(
        f"""
        SELECT n.*, COUNT(p.id) AS port_count,
               SUM(CASE WHEN p.user_id IS NULL THEN 1 ELSE 0 END) AS free_count
        FROM nodes n LEFT JOIN ports p ON p.node_id=n.id
        {where}
        GROUP BY n.id ORDER BY n.active DESC, free_count DESC, n.region, n.id
        """
    ).fetchall()
    result = []
    for r in rows:
        item = node_public(r)
        item["port_count"] = int(r["port_count"] or 0)
        item["free_count"] = int(r["free_count"] or 0)
        result.append(item)
    return result


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                region TEXT NOT NULL DEFAULT '默认地区',
                name TEXT NOT NULL UNIQUE,
                server_addr TEXT NOT NULL,
                server_port INTEGER NOT NULL DEFAULT 7000,
                auth_token TEXT NOT NULL,
                port_start INTEGER NOT NULL,
                port_end INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                note TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                token TEXT NOT NULL UNIQUE,
                license_key TEXT NOT NULL UNIQUE,
                machine_id TEXT NOT NULL DEFAULT '',
                max_ports INTEGER NOT NULL DEFAULT 5,
                active INTEGER NOT NULL DEFAULT 1,
                expires_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ports (
                port INTEGER PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tunnels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                proxy_type TEXT NOT NULL DEFAULT 'tcp',
                local_ip TEXT NOT NULL DEFAULT '127.0.0.1',
                local_port INTEGER NOT NULL,
                remote_port INTEGER NOT NULL,
                custom_domains TEXT NOT NULL DEFAULT '',
                secret_key TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                UNIQUE(user_id, name)
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS csrf_tokens (
                token TEXT PRIMARY KEY,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rate_limits (
                key TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                reset_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event TEXT NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                username TEXT NOT NULL DEFAULT '',
                node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
                remote_port INTEGER,
                proxy_type TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_bans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                username TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                banned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invite_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                note TEXT NOT NULL DEFAULT '',
                max_uses INTEGER NOT NULL DEFAULT 1,
                used_count INTEGER NOT NULL DEFAULT 0,
                max_ports INTEGER NOT NULL DEFAULT 5,
                user_expires_days INTEGER NOT NULL DEFAULT 30,
                active INTEGER NOT NULL DEFAULT 1,
                expires_at INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS software_license (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                license_key TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                server_url TEXT NOT NULL DEFAULT '',
                plan TEXT NOT NULL DEFAULT 'deploy',
                expires_at INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                signature TEXT NOT NULL DEFAULT '',
                activated_at INTEGER NOT NULL,
                last_check_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS software_license_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                license_key TEXT NOT NULL UNIQUE,
                note TEXT NOT NULL DEFAULT '',
                plan TEXT NOT NULL DEFAULT 'deploy',
                machine_id TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                expires_at INTEGER NOT NULL DEFAULT 0,
                activated_at INTEGER NOT NULL DEFAULT 0,
                last_check_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            """
        )
        default_node_id = ensure_default_node(conn)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "expires_at" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0")
        # software_license.server_url migration
        sw_cols = {r["name"] for r in conn.execute("PRAGMA table_info(software_license)").fetchall()}
        if "server_url" not in sw_cols:
            conn.execute("ALTER TABLE software_license ADD COLUMN server_url TEXT NOT NULL DEFAULT ''")
        migrate_region_nodes(conn, default_node_id)
        conn.executemany(
            "INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?, ?, ?)",
            [(default_node_id, p, now()) for p in range(PORT_START, PORT_END + 1)],
        )
        admin = conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1").fetchone()
        if not admin:
            conn.execute(
                "INSERT INTO users(username, password_hash, role, token, license_key, machine_id, max_ports, expires_at, node_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (ADMIN_USER, password_hash(ADMIN_PASSWORD), "admin", secrets.token_urlsafe(24), make_license_key(), make_machine_id(), DEFAULT_MAX_PORTS, 0, default_node_id, now()),
            )
        else:
            conn.execute("UPDATE users SET node_id=? WHERE role='admin' AND node_id IS NULL", (default_node_id,))


def create_user(username: str, password: str, max_ports: int, expires_days: int, node_id: int) -> tuple[bool, str]:
    username = username.strip()
    if not username or len(username) > 32 or not username.replace("_", "").replace("-", "").isalnum():
        return False, "用户名只能包含字母、数字、下划线、短横线，长度 1-32"
    if len(password) < 6:
        return False, "密码至少 6 位"
    if max_ports < 1 or max_ports > 100:
        return False, "端口数量必须在 1-100 之间"
    if expires_days < 0 or expires_days > 3650:
        return False, "有效期天数必须在 0-3650 之间"
    expires_at = 0 if expires_days == 0 else now() + expires_days * 86400
    with db() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=? AND active=1", (node_id,)).fetchone()
        if not node:
            return False, "地区节点不存在或已停用"
        free_ports = conn.execute("SELECT port FROM ports WHERE node_id=? AND user_id IS NULL ORDER BY port LIMIT ?", (node_id, max_ports)).fetchall()
        if len(free_ports) < max_ports:
            return False, f"端口池不足，只剩 {len(free_ports)} 个可用端口"
        try:
            cur = conn.execute(
                "INSERT INTO users(username, password_hash, role, token, license_key, machine_id, max_ports, expires_at, node_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (username, password_hash(password), "user", secrets.token_urlsafe(24), make_license_key(), make_machine_id(), max_ports, expires_at, node_id, now()),
            )
        except sqlite3.IntegrityError:
            return False, "用户名已存在"
        user_id = cur.lastrowid
        conn.executemany("UPDATE ports SET user_id=? WHERE node_id=? AND port=?", [(user_id, node_id, r["port"]) for r in free_ports])
    return True, f"已创建用户 {username}，地区节点：{node['region']} / {node['name']}，分配 {max_ports} 个端口，到期时间：{fmt_time(expires_at)}"


def local_license_authority_activate(license_key: str, machine_id: str) -> tuple[bool, str, dict[str, Any] | None]:
    with db() as conn:
        row = conn.execute("SELECT * FROM software_license_keys WHERE license_key=?", (license_key,)).fetchone()
        if not row:
            return False, "授权码不存在", None
        if not row["active"]:
            return False, "授权码已停用", None
        if row["expires_at"] and row["expires_at"] <= now():
            return False, "授权码已过期", None
        if row["machine_id"] and row["machine_id"] != machine_id:
            return False, "授权码已绑定其他机器", None
        if not row["machine_id"]:
            conn.execute("UPDATE software_license_keys SET machine_id=?, activated_at=?, last_check_at=? WHERE id=?", (machine_id, now(), now(), row["id"]))
        else:
            conn.execute("UPDATE software_license_keys SET last_check_at=? WHERE id=?", (now(), row["id"]))
        payload = signed_license_payload(license_key, machine_id, row["plan"], int(row["expires_at"] or 0))
    return True, "授权成功", payload


def call_license_server(license_key: str, machine_id: str, override_url: str = "") -> tuple[bool, str, dict[str, Any] | None]:
    server_url = (override_url or SOFTWARE_LICENSE_SERVER_URL).rstrip("/")
    if not server_url:
        return local_license_authority_activate(license_key, machine_id)
    body = json.dumps({"license_key": license_key, "machine_id": machine_id, "app": APP_NAME}).encode("utf-8")
    req = urllib.request.Request(f"{server_url}/api/license/activate", data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode("utf-8"))
        except Exception:
            data = {"error": f"授权服务器 HTTP {e.code}"}
    except Exception as e:
        return False, f"连接授权服务器失败：{e}", None
    if not data.get("ok"):
        return False, str(data.get("error") or data.get("message") or "授权失败"), None
    payload = data.get("license") or data
    if not isinstance(payload, dict) or not verify_signed_license(payload):
        return False, "授权服务器返回签名无效", None
    if payload.get("machine_id") != machine_id:
        return False, "授权服务器返回机器绑定不匹配", None
    return True, str(data.get("message") or "授权成功"), payload


def activate_software_license(license_key: str, server_url: str = "") -> tuple[bool, str]:
    license_key = license_key.strip().upper()
    if not license_key:
        return False, "请输入软件授权码"
    server_url = server_url.strip()
    machine_id = software_machine_fingerprint()
    ok, msg, payload = call_license_server(license_key, machine_id, server_url)
    if not ok or not payload:
        return False, msg
    with db() as conn:
        conn.execute("UPDATE software_license SET active=0")
        conn.execute(
            "INSERT INTO software_license(license_key, machine_id, server_url, plan, expires_at, active, signature, activated_at, last_check_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (payload["license_key"], payload["machine_id"], server_url, payload.get("plan", "deploy"), int(payload.get("expires_at") or 0), 1, payload.get("signature", ""), now(), now(), now()),
        )
    return True, "软件授权已激活并绑定当前服务器"


def create_software_license_keys_batch(note: str, plan: str, expires_days: int, count: int) -> tuple[bool, str, list[str]]:
    if count < 1 or count > 500:
        return False, "单次生成数量必须在 1-500 之间", []
    if expires_days < 0 or expires_days > 3650:
        return False, "有效期必须在 0-3650 天之间", []
    plan = (plan.strip() or "deploy")[:40]
    note = note.strip()[:120]
    expires_at = 0 if expires_days == 0 else now() + expires_days * 86400
    keys: list[str] = []
    with db() as conn:
        for _ in range(count):
            key = "FMLD-" + secrets.token_urlsafe(20).replace("-", "").replace("_", "")[:28].upper()
            conn.execute(
                "INSERT INTO software_license_keys(license_key, note, plan, active, expires_at, created_at) VALUES(?,?,?,?,?,?)",
                (key, note, plan, 1, expires_at, now()),
            )
            keys.append(key)
    return True, f"已生成 {len(keys)} 个软件授权码", keys


def create_invite_key(note: str, max_uses: int, max_ports: int, user_expires_days: int, key_expires_days: int, created_by: int) -> tuple[bool, str, str | None]:
    note = note.strip()[:120]
    if max_uses < 1 or max_uses > 10000:
        return False, "可用次数必须在 1-10000 之间", None
    if max_ports < 1 or max_ports > 100:
        return False, "端口数量必须在 1-100 之间", None
    if user_expires_days < 0 or user_expires_days > 3650:
        return False, "用户有效期必须在 0-3650 天之间", None
    if key_expires_days < 0 or key_expires_days > 3650:
        return False, "密钥有效期必须在 0-3650 天之间", None
    key = "FML-" + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24].upper()
    key_expires_at = 0 if key_expires_days == 0 else now() + key_expires_days * 86400
    with db() as conn:
        conn.execute(
            "INSERT INTO invite_keys(key, note, max_uses, max_ports, user_expires_days, expires_at, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
            (key, note, max_uses, max_ports, user_expires_days, key_expires_at, created_by, now()),
        )
    return True, "密钥已生成", key


def create_invite_keys_batch(note: str, max_uses: int, max_ports: int, user_expires_days: int, key_expires_days: int, created_by: int, count: int) -> tuple[bool, str, list[str]]:
    note = note.strip()[:120]
    if count < 1 or count > 500:
        return False, "单次生成数量必须在 1-500 之间", []
    if max_uses < 1 or max_uses > 10000:
        return False, "可用次数必须在 1-10000 之间", []
    if max_ports < 1 or max_ports > 100:
        return False, "端口数量必须在 1-100 之间", []
    if user_expires_days < 0 or user_expires_days > 3650:
        return False, "用户有效期必须在 0-3650 天之间", []
    if key_expires_days < 0 or key_expires_days > 3650:
        return False, "密钥有效期必须在 0-3650 天之间", []
    keys: list[str] = []
    key_expires_at = 0 if key_expires_days == 0 else now() + key_expires_days * 86400
    with db() as conn:
        for _ in range(count):
            key = "FML-" + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24].upper()
            conn.execute(
                "INSERT INTO invite_keys(key, note, max_uses, max_ports, user_expires_days, expires_at, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (key, note, max_uses, max_ports, user_expires_days, key_expires_at, created_by, now()),
            )
            keys.append(key)
    return True, f"已生成 {len(keys)} 枚密钥", keys


def register_with_invite(username: str, password: str, invite_key: str, node_id: int) -> tuple[bool, str]:
    username = username.strip()
    invite_key = invite_key.strip().upper()
    if not username or len(username) > 32 or not username.replace("_", "").replace("-", "").isalnum():
        return False, "用户名只能包含字母、数字、下划线、短横线，长度 1-32"
    if len(password) < 6:
        return False, "密码至少 6 位"
    if not invite_key:
        return False, "请输入注册密钥"
    with db() as conn:
        key_row = conn.execute("SELECT * FROM invite_keys WHERE key=?", (invite_key,)).fetchone()
        if not key_row:
            return False, "注册密钥无效"
        if not key_row["active"]:
            return False, "注册密钥已停用"
        if key_row["expires_at"] and key_row["expires_at"] <= now():
            return False, "注册密钥已过期"
        if key_row["used_count"] >= key_row["max_uses"]:
            return False, "注册密钥使用次数已耗尽"
        node = conn.execute("SELECT * FROM nodes WHERE id=? AND active=1", (node_id,)).fetchone()
        if not node:
            return False, "请选择有效的地区节点"
        max_ports = int(key_row["max_ports"])
        free_ports = conn.execute("SELECT port FROM ports WHERE node_id=? AND user_id IS NULL ORDER BY port LIMIT ?", (node_id, max_ports)).fetchall()
        if len(free_ports) < max_ports:
            return False, f"端口池不足，只剩 {len(free_ports)} 个可用端口"
        expires_days = int(key_row["user_expires_days"])
        user_expires_at = 0 if expires_days == 0 else now() + expires_days * 86400
        try:
            cur = conn.execute(
                "INSERT INTO users(username, password_hash, role, token, license_key, machine_id, max_ports, expires_at, node_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (username, password_hash(password), "user", secrets.token_urlsafe(24), make_license_key(), make_machine_id(), max_ports, user_expires_at, node_id, now()),
            )
        except sqlite3.IntegrityError:
            return False, "用户名已存在"
        user_id = cur.lastrowid
        conn.executemany("UPDATE ports SET user_id=? WHERE node_id=? AND port=?", [(user_id, node_id, r["port"]) for r in free_ports])
        conn.execute("UPDATE invite_keys SET used_count=used_count+1 WHERE id=?", (key_row["id"],))
    return True, f"注册成功，地区节点：{node['region']} / {node['name']}，已分配 {max_ports} 个端口，到期时间：{fmt_time(user_expires_at)}"


def audit(event: str, user: sqlite3.Row | None = None, node_id: int | None = None, remote_port: int | None = None, proxy_type: str = "", detail: str = "") -> None:
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO audit_logs(event, user_id, username, node_id, remote_port, proxy_type, detail, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (event, user["id"] if user else None, user["username"] if user else "", node_id, remote_port, proxy_type, detail[:1000], now()),
            )
    except Exception:
        pass


def make_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))
        conn.execute("INSERT INTO sessions(token, user_id, expires_at, created_at) VALUES(?,?,?,?)", (token, user_id, now() + SESSION_TTL, now()))
    return token


def session_user(cookie_header: str | None) -> sqlite3.Row | None:
    if not cookie_header:
        return None
    cookie = SimpleCookie(cookie_header)
    morsel = cookie.get("fml_session")
    if not morsel:
        return None
    with db() as conn:
        return conn.execute(
            """
            SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token=? AND s.expires_at>? AND u.active=1 AND (u.expires_at=0 OR u.expires_at>?)
            """,
            (morsel.value, now(), now()),
        ).fetchone()


def clear_session(cookie_header: str | None) -> None:
    cookie = SimpleCookie(cookie_header)
    morsel = cookie.get("fml_session")
    if morsel:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (morsel.value,))


def make_csrf_token() -> str:
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("DELETE FROM csrf_tokens WHERE expires_at <= ?", (now(),))
        conn.execute("INSERT INTO csrf_tokens(token, expires_at, created_at) VALUES(?,?,?)", (token, now() + CSRF_TTL, now()))
    return token


def validate_csrf(token: str | None) -> bool:
    if not token:
        return False
    with db() as conn:
        row = conn.execute("SELECT token FROM csrf_tokens WHERE token=? AND expires_at>?", (token, now())).fetchone()
    return bool(row)


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    # If behind a trusted reverse proxy, let Nginx/Caddy pass the real client IP.
    # Do not use arbitrary X-Forwarded-For here unless the proxy sanitizes it.
    return handler.headers.get("X-Real-IP") or handler.client_address[0]


def rate_limit_check(key: str, limit: int, window: int = RATE_WINDOW) -> tuple[bool, int]:
    ts = now()
    with db() as conn:
        row = conn.execute("SELECT count, reset_at FROM rate_limits WHERE key=?", (key,)).fetchone()
        if not row or int(row["reset_at"]) <= ts:
            conn.execute("INSERT OR REPLACE INTO rate_limits(key, count, reset_at) VALUES(?,?,?)", (key, 1, ts + window))
            return True, 0
        count = int(row["count"])
        reset_at = int(row["reset_at"])
        if count >= limit:
            return False, max(1, reset_at - ts)
        conn.execute("UPDATE rate_limits SET count=count+1 WHERE key=?", (key,))
        return True, 0


def tunnel_config(user: sqlite3.Row, node: sqlite3.Row, tunnels: list[sqlite3.Row]) -> str:
    mid = row_val(user, "machine_id")
    if not mid:
        mid = make_machine_id()
        with db() as conn:
            conn.execute("UPDATE users SET machine_id=? WHERE id=?", (mid, user["id"]))
    lines = [
        f'serverAddr = "{node["server_addr"]}"',
        f"serverPort = {node['server_port']}",
        "",
        "# frps 原生 token 通常是全局共享；生产环境建议配合本面板的 /frp-plugin 做二次鉴权。",
        f'auth.token = "{node["auth_token"]}"',
        f'user = "{user["username"]}"',
        f'metadatas.panelToken = "{user["token"]}"',
        f'metadatas.licenseKey = "{row_val(user, "license_key")}"',
        f'metadatas.machineId = "{mid}"',
        "",
    ]
    for t in tunnels:
        if not t["enabled"]:
            lines.append(f"# disabled: {t['name']}")
            continue
        proxy_type = t["proxy_type"]
        lines.extend(
            [
                "[[proxies]]",
                f'name = "{user["username"]}_{t["name"]}"',
                f'type = "{proxy_type}"',
                f'localIP = "{t["local_ip"]}"',
                f'localPort = {t["local_port"]}',
            ]
        )
        if proxy_type in REMOTE_PORT_PROXY_TYPES:
            lines.append(f'remotePort = {t["remote_port"]}')
        if proxy_type in DOMAIN_PROXY_TYPES and t["custom_domains"]:
            domains = [d.strip() for d in str(t["custom_domains"]).split(",") if d.strip()]
            lines.append("customDomains = [" + ", ".join(json.dumps(d, ensure_ascii=False) for d in domains) + "]")
        if proxy_type in SECRET_KEY_PROXY_TYPES and t["secret_key"]:
            lines.append(f'secretKey = {json.dumps(t["secret_key"], ensure_ascii=False)}')
        lines.append("")
    return "\n".join(lines)


def frps_example_config(node: sqlite3.Row) -> str:
    return f'''# frps.example.toml for {node["region"]} / {node["name"]}
bindPort = {node["server_port"]}
auth.method = "token"
auth.token = "{node["auth_token"]}"

allowPorts = [
  {{ start = {node["port_start"]}, end = {node["port_end"]} }}
]

webServer.addr = "127.0.0.1"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "CHANGE_ME"

# 可选：frps HTTP 插件鉴权，字段需按你的 frp 版本文档校准。
# 面板会校验账号状态、授权码、机器绑定和端口归属。
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "127.0.0.1:{PORT}"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]
'''


def make_full_backup_zip(admin_username: str) -> tuple[str, bytes]:
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now()))
    mem = sqlite3.connect(":memory:")
    try:
        with sqlite3.connect(DB_PATH) as src:
            src.backup(mem)
        dump_sql = "\n".join(mem.iterdump()) + "\n"
        db_bytes = mem.serialize()
        meta = {
            "app": APP_NAME,
            "created_at": now(),
            "created_at_text": fmt_time(now()),
            "created_by": admin_username,
            "db_path": str(DB_PATH),
            "files": ["data.sqlite3", "dump.sql", "metadata.json", "RESTORE.md"],
            "note": "Full backup contains users, nodes, ports, tunnels, sessions, invite keys, bans, and audit logs. Keep it private.",
        }
        restore = f"""# frp-manager-lite 恢复说明

备份时间：{meta['created_at_text']}

## 内容

- `data.sqlite3`：SQLite 完整数据库快照，优先用于恢复
- `dump.sql`：SQL 文本转储，备用
- `metadata.json`：备份元信息

## 恢复步骤

1. 停止服务：

```bash
sudo systemctl stop frp-manager-lite
```

2. 备份当前数据库：

```bash
cp /var/lib/frp-manager-lite/data.sqlite3 /var/lib/frp-manager-lite/data.sqlite3.bak.$(date +%F-%H%M%S)
```

3. 解压本 ZIP，把 `data.sqlite3` 复制到你的 `FML_DB` 路径，例如：

```bash
cp data.sqlite3 /var/lib/frp-manager-lite/data.sqlite3
chown www-data:www-data /var/lib/frp-manager-lite/data.sqlite3
```

4. 启动服务：

```bash
sudo systemctl start frp-manager-lite
```

## 注意

- 这个备份包含用户 token、注册密钥、会话、审计日志等敏感数据，请勿公开。
- 恢复后，用户、端口、节点、密钥都会回到备份时状态。
- 如果新服务器路径不同，只要 `FML_DB` 指向恢复后的数据库即可。
"""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("data.sqlite3", db_bytes)
            z.writestr("dump.sql", dump_sql)
            z.writestr("metadata.json", json.dumps(meta, ensure_ascii=False, indent=2))
            z.writestr("RESTORE.md", restore)
        return stamp, buf.getvalue()
    finally:
        mem.close()


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def r2_configured() -> bool:
    return bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET)


def upload_to_r2(object_key: str, body: bytes, content_type: str = "application/zip") -> str:
    if not r2_configured():
        raise RuntimeError("R2 未配置，请设置 R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET")
    host = f"{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    region = "auto"
    service = "s3"
    method = "PUT"
    encoded_key = "/" + "/".join(urllib.parse.quote(part, safe="") for part in object_key.split("/"))
    url = f"https://{host}/{R2_BUCKET}{encoded_key}"
    t = time.gmtime()
    amz_date = time.strftime("%Y%m%dT%H%M%SZ", t)
    date_stamp = time.strftime("%Y%m%d", t)
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_uri = f"/{R2_BUCKET}{encoded_key}"
    canonical_headers = f"content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([method, canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, credential_scope, hashlib.sha256(canonical_request.encode()).hexdigest()])
    signing_key = _sign(_sign(_sign(_sign(("AWS4" + R2_SECRET_ACCESS_KEY).encode("utf-8"), date_stamp), region), service), "aws4_request")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={R2_ACCESS_KEY_ID}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Content-Type": content_type,
        "Host": host,
        "X-Amz-Date": amz_date,
        "X-Amz-Content-Sha256": payload_hash,
        "Authorization": auth,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status not in (200, 201, 204):
                raise RuntimeError(f"R2 上传失败：HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:500]
        raise RuntimeError(f"R2 上传失败：HTTP {e.code} {detail}") from e
    return object_key


class Handler(BaseHTTPRequestHandler):
    server_version = "frp-manager-lite-api/0.2"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), fmt % args))

    @property
    def current_user(self) -> sqlite3.Row | None:
        return session_user(self.headers.get("Cookie"))

    def send_body(self, body: bytes, status: int = 200, content_type: str = "application/octet-stream", headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data: Any, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self.send_body(json.dumps(data, ensure_ascii=False).encode(), status, "application/json; charset=utf-8", headers)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > MAX_BODY:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def require_user(self) -> sqlite3.Row | None:
        user = self.current_user
        if not user:
            self.send_json({"ok": False, "error": "unauthorized"}, 401)
            return None
        return user

    def require_admin(self) -> sqlite3.Row | None:
        user = self.require_user()
        if not user:
            return None
        if user["role"] != "admin":
            self.send_json({"ok": False, "error": "forbidden"}, 403)
            return None
        return user

    def require_software_license(self) -> bool:
        if not SOFTWARE_LICENSE_REQUIRED:
            return True
        with db() as conn:
            sw_license = current_software_license(conn)
        if sw_license.get("licensed"):
            return True
        self.send_json({"ok": False, "error": "software_license_required", "license": sw_license}, 402)
        return False

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.api_get(path)
        elif path == "/config/frpc.toml":
            self.download_frpc()
        elif path == "/config/frps.example.toml":
            self.download_frps_example()
        elif path == "/admin/export/invite-keys.csv":
            self.export_invite_keys_csv()
        elif path == "/admin/backup/full.zip":
            self.download_full_backup()
        else:
            self.serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._do_POST()
        except Exception as e:
            self.send_json({"ok": False, "error": f"服务器错误：{e}"}, 500)

    def _do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/frp-plugin":
            self.frp_plugin()
        elif path == "/api/license/activate" and SOFTWARE_LICENSE_AUTHORITY:
            self.license_authority_activate()
        elif path == "/api/license/activate" and SOFTWARE_LICENSE_REQUIRED and not software_license_ok():
            self.api_license_activate_public()
        elif path.startswith("/api/"):
            self.api_post(path)
        else:
            self.send_json({"ok": False, "error": "not found"}, 404)

    def license_authority_activate(self) -> None:
        try:
            data = self.read_json()
            ok, msg, payload = local_license_authority_activate(str(data.get("license_key", "")).strip().upper(), normalize_machine_id(str(data.get("machine_id", ""))))
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "license": payload}, 200 if ok else 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def api_license_activate_public(self) -> None:
        try:
            data = self.read_json()
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
            return
        csrf = self.headers.get("X-CSRF-Token")
        if not validate_csrf(csrf):
            self.send_json({"ok": False, "error": "CSRF token 无效，请刷新页面"}, 403)
            return
        try:
            ok, msg = activate_software_license(str(data.get("license_key", "")), str(data.get("server_url", "")))
            with db() as conn:
                sw_license = current_software_license(conn)
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "license": sw_license}, 200 if ok else 400)
        except Exception as e:
            self.send_json({"ok": False, "error": f"激活处理失败：{e}"}, 500)

    def download_full_backup(self) -> None:
        admin = self.require_admin()
        if not admin or not self.require_software_license():
            return
        stamp, payload = make_full_backup_zip(admin["username"])
        audit("backup_download", admin, None, None, "", f"full backup {stamp}")
        self.send_body(payload, 200, "application/zip", {"Content-Disposition": f'attachment; filename="frp-manager-lite-backup-{stamp}.zip"'})

    def admin_backup_r2(self, admin: sqlite3.Row) -> None:
        if not self.require_admin():
            return
        try:
            stamp, payload = make_full_backup_zip(admin["username"])
            prefix = R2_PREFIX.strip("/")
            object_key = f"{prefix}/frp-manager-lite-backup-{stamp}.zip" if prefix else f"frp-manager-lite-backup-{stamp}.zip"
            upload_to_r2(object_key, payload)
            audit("backup_r2_upload", admin, None, None, "", object_key)
            self.send_json({"ok": True, "message": "已上传全量备份到 R2", "object_key": object_key, "size": len(payload)})
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def export_invite_keys_csv(self) -> None:
        if not self.require_admin() or not self.require_software_license():
            return
        import csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["key", "note", "used_count", "max_uses", "max_ports", "user_expires_days", "active", "expires_at", "created_at"])
        with db() as conn:
            for k in conn.execute("SELECT * FROM invite_keys WHERE active=1 AND used_count=0 AND used_count < max_uses AND (expires_at=0 OR expires_at>?) ORDER BY id DESC", (now(),)):
                w.writerow([
                    k["key"], k["note"], k["used_count"], k["max_uses"], k["max_ports"], k["user_expires_days"],
                    "yes" if k["active"] else "no", fmt_time(k["expires_at"]), fmt_time(k["created_at"]),
                ])
        self.send_body(buf.getvalue().encode("utf-8-sig"), 200, "text/csv; charset=utf-8", {"Content-Disposition": 'attachment; filename="invite-keys.csv"'})

    def serve_static(self, path: str) -> None:
        if path in {"", "/"}:
            path = "/index.html"
        rel = Path(unquote(path).lstrip("/"))
        frontend_root = FRONTEND_DIR.resolve()
        target = (frontend_root / rel).resolve()
        if not str(target).startswith(str(frontend_root)) or not target.is_file():
            target = frontend_root / "index.html"
        ctype = mimetypes.guess_type(str(target))[0] or "text/html; charset=utf-8"
        self.send_body(target.read_bytes(), 200, ctype)

    def api_get(self, path: str) -> None:
        if path == "/api/csrf":
            token = make_csrf_token()
            self.send_json({"ok": True, "csrf_token": token}, headers={"Set-Cookie": f"fml_csrf={token}; SameSite=Lax; Path=/; Max-Age={CSRF_TTL}"})
            return
        if path == "/api/nodes":
            with db() as conn:
                self.send_json({"ok": True, "nodes": list_public_nodes(conn, active_only=True)})
            return
        if path == "/api/license/status":
            with db() as conn:
                self.send_json({"ok": True, "license": current_software_license(conn)})
            return
        if path == "/api/me":
            user = self.current_user
            with db() as conn:
                sw_license = current_software_license(conn)
            self.send_json({"ok": True, "user": public_user(user) if user else None, "software_license": sw_license})
            return
        user = self.require_user()
        if not user:
            return
        if path == "/api/dashboard":
            with db() as conn:
                sw_license = current_software_license(conn)
                if SOFTWARE_LICENSE_REQUIRED and not sw_license.get("licensed"):
                    self.send_json({"ok": False, "error": "software_license_required", "license": sw_license}, 402)
                    return
                node = conn.execute("SELECT * FROM nodes WHERE id=?", (user["node_id"],)).fetchone()
                ports = [r["port"] for r in conn.execute("SELECT port FROM ports WHERE node_id=? AND user_id=? ORDER BY port", (user["node_id"], user["id"]))]
                tunnels = [row_dict(r) for r in conn.execute("SELECT * FROM tunnels WHERE user_id=? ORDER BY id DESC", (user["id"],))]
            self.send_json({"ok": True, "user": public_user(user), "software_license": sw_license, "node": node_public(node) if node else None, "ports": ports, "tunnels": tunnels, "allowed_proxy_types": PROXY_TYPE_ORDER, "frps": {"addr": node["server_addr"] if node else FRP_SERVER_ADDR, "port": node["server_port"] if node else FRP_SERVER_PORT}})
            return
        if path == "/api/admin/overview":
            if not self.require_admin():
                return
            with db() as conn:
                users = []
                for r in conn.execute(
                    """
                    SELECT u.*, n.name AS node_name, n.region AS node_region, COUNT(DISTINCT p.id) AS port_count, COUNT(DISTINCT t.id) AS tunnel_count
                    FROM users u
                    LEFT JOIN nodes n ON n.id=u.node_id
                    LEFT JOIN ports p ON p.user_id=u.id AND p.node_id=u.node_id
                    LEFT JOIN tunnels t ON t.user_id=u.id
                    GROUP BY u.id ORDER BY u.id
                    """
                ):
                    item = public_user(r)
                    item["port_count"] = r["port_count"]
                    item["tunnel_count"] = r["tunnel_count"]
                    item["node_name"] = r["node_name"]
                    item["node_region"] = r["node_region"]
                    users.append(item)
                nodes = list_public_nodes(conn, active_only=False)
                invite_keys = []
                for k in conn.execute("SELECT * FROM invite_keys ORDER BY id DESC LIMIT 200"):
                    invite_keys.append({
                        "id": k["id"],
                        "key": k["key"],
                        "note": k["note"],
                        "max_uses": k["max_uses"],
                        "used_count": k["used_count"],
                        "remaining": max(0, k["max_uses"] - k["used_count"]),
                        "max_ports": k["max_ports"],
                        "user_expires_days": k["user_expires_days"],
                        "active": bool(k["active"]),
                        "expires_at": k["expires_at"],
                        "expires_text": fmt_time(k["expires_at"]),
                        "expired": bool(k["expires_at"] and k["expires_at"] <= now()),
                        "created_at": k["created_at"],
                    })
                logs = [row_dict(r) for r in conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 80")]
                stats = {
                    "port_start": PORT_START,
                    "port_end": PORT_END,
                    "total_ports": conn.execute("SELECT COUNT(*) c FROM ports").fetchone()["c"],
                    "free_ports": conn.execute("SELECT COUNT(*) c FROM ports WHERE user_id IS NULL").fetchone()["c"],
                    "tunnel_count": conn.execute("SELECT COUNT(*) c FROM tunnels").fetchone()["c"],
                    "invite_key_count": conn.execute("SELECT COUNT(*) c FROM invite_keys").fetchone()["c"],
                    "ban_count": conn.execute("SELECT COUNT(*) c FROM user_bans").fetchone()["c"],
                }
                sw_license = current_software_license(conn)
                software_keys = []
                if SOFTWARE_LICENSE_AUTHORITY:
                    for k in conn.execute("SELECT * FROM software_license_keys ORDER BY id DESC LIMIT 200"):
                        software_keys.append({
                            "id": k["id"], "license_key": k["license_key"], "note": k["note"], "plan": k["plan"], "machine_id": k["machine_id"],
                            "active": bool(k["active"]), "expires_at": k["expires_at"], "expires_text": fmt_time(k["expires_at"]),
                            "expired": bool(k["expires_at"] and k["expires_at"] <= now()), "activated_at": k["activated_at"], "last_check_at": k["last_check_at"], "created_at": k["created_at"],
                        })
            self.send_json({"ok": True, "stats": stats, "users": users, "nodes": nodes, "invite_keys": invite_keys, "logs": logs, "allowed_proxy_types": PROXY_TYPE_ORDER, "software_license": sw_license, "software_license_authority": SOFTWARE_LICENSE_AUTHORITY, "software_license_keys": software_keys})
            return
        self.send_json({"ok": False, "error": "not found"}, 404)

    def api_post(self, path: str) -> None:
        try:
            data = self.read_json()
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
            return

        csrf = self.headers.get("X-CSRF-Token")
        if not validate_csrf(csrf):
            self.send_json({"ok": False, "error": "CSRF token 无效或已过期，请刷新页面重试"}, 403)
            return

        if path in {"/api/login", "/api/register"}:
            try:
                license_ok = software_license_ok()
            except Exception:
                license_ok = False
            if not license_ok:
                try:
                    with db() as conn:
                        sw_license = current_software_license(conn)
                except Exception:
                    sw_license = {"licensed": False, "required": True, "message": "未激活软件授权"}
                self.send_json({"ok": False, "error": "software_license_required", "license": sw_license, "message": "请先激活软件授权码"}, 402)
                return

        if path == "/api/login":
            ok_rate, retry_after = rate_limit_check(f"login:{client_ip(self)}", LOGIN_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"登录尝试过多，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            with db() as conn:
                user = conn.execute("SELECT * FROM users WHERE username=?", (str(data.get("username", "")),)).fetchone()
            if not user or not verify_password(str(data.get("password", "")), user["password_hash"]):
                self.send_json({"ok": False, "error": "用户名或密码错误"}, 401)
                return
            if not user["active"]:
                self.send_json({"ok": False, "error": "账号已停用"}, 403)
                return
            if is_expired(user):
                self.send_json({"ok": False, "error": "账号已到期"}, 403)
                return
            token = make_session(user["id"])
            self.send_json({"ok": True, "user": public_user(user)}, headers={"Set-Cookie": f"fml_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL}"})
            return

        if path == "/api/register":
            ok_rate, retry_after = rate_limit_check(f"register:{client_ip(self)}", REGISTER_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"注册尝试过多，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            ok, msg = register_with_invite(str(data.get("username", "")), str(data.get("password", "")), str(data.get("invite_key", "")), int(data.get("node_id", 0)))
            self.send_json({"ok": ok, "message": msg, "error": None if ok else msg}, 200 if ok else 400)
            return

        if path == "/api/logout":
            clear_session(self.headers.get("Cookie"))
            self.send_json({"ok": True}, headers={"Set-Cookie": "fml_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
            return

        user = self.require_user()
        if not user:
            return

        if path == "/api/license/activate":
            if user["role"] != "admin":
                self.send_json({"ok": False, "error": "forbidden"}, 403)
                return
            try:
                ok, msg = activate_software_license(str(data.get("license_key", "")), str(data.get("server_url", "")))
            except Exception as e:
                self.send_json({"ok": False, "error": f"激活处理失败：{e}"}, 500)
                return
            with db() as conn:
                sw_license = current_software_license(conn)
            audit("software_license_activate", user, None, None, "", msg)
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "license": sw_license}, 200 if ok else 400)
            return

        if SOFTWARE_LICENSE_REQUIRED and not software_license_ok():
            with db() as conn:
                sw_license = current_software_license(conn)
            self.send_json({"ok": False, "error": "software_license_required", "license": sw_license}, 402)
            return

        if path == "/api/tunnels/create":
            self.tunnel_create(user, data)
        elif path == "/api/tunnels/toggle":
            tid = int(data.get("id", 0))
            with db() as conn:
                t = conn.execute("SELECT * FROM tunnels WHERE id=? AND user_id=?", (tid, user["id"])).fetchone()
                conn.execute("UPDATE tunnels SET enabled=CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id=? AND user_id=?", (tid, user["id"]))
            if t: audit("tunnel_toggle", user, t["node_id"], t["remote_port"], t["proxy_type"], t["name"])
            self.send_json({"ok": True})
        elif path == "/api/tunnels/delete":
            tid = int(data.get("id", 0))
            with db() as conn:
                t = conn.execute("SELECT * FROM tunnels WHERE id=? AND user_id=?", (tid, user["id"])).fetchone()
                conn.execute("DELETE FROM tunnels WHERE id=? AND user_id=?", (tid, user["id"]))
            if t: audit("tunnel_delete", user, t["node_id"], t["remote_port"], t["proxy_type"], t["name"])
            self.send_json({"ok": True})
        elif path == "/api/admin/users/create":
            self.admin_create_user(data)
        elif path == "/api/admin/users/toggle":
            self.admin_toggle_user(user, data)
        elif path == "/api/admin/users/extend":
            self.admin_extend_user(data)
        elif path == "/api/admin/users/reset-password":
            self.admin_reset_password(data)
        elif path == "/api/admin/users/reset-license":
            self.admin_reset_license(data)
        elif path == "/api/admin/users/unbind-machine":
            self.admin_unbind_machine(data)
        elif path == "/api/admin/users/delete":
            self.admin_delete_user(user, data)
        elif path == "/api/admin/users/ban":
            self.admin_ban_user(user, data)
        elif path == "/api/admin/risk/lookup-port":
            self.admin_lookup_port(data)
        elif path == "/api/admin/backup/r2":
            self.admin_backup_r2(user)
        elif path == "/api/admin/software-licenses/create":
            self.admin_software_license_create(data)
        elif path == "/api/admin/software-licenses/toggle":
            self.admin_software_license_toggle(data)
        elif path == "/api/admin/software-licenses/unbind":
            self.admin_software_license_unbind(data)
        elif path == "/api/admin/invite-keys/create":
            self.admin_invite_create(user, data)
        elif path == "/api/admin/invite-keys/toggle":
            self.admin_invite_toggle(data)
        elif path == "/api/admin/invite-keys/delete":
            self.admin_invite_delete(data)
        elif path == "/api/admin/nodes/create":
            self.admin_node_create(data)
        elif path == "/api/admin/nodes/update":
            self.admin_node_update(data)
        elif path == "/api/admin/nodes/toggle":
            self.admin_node_toggle(data)
        elif path == "/api/admin/nodes/delete":
            self.admin_node_delete(data)
        else:
            self.send_json({"ok": False, "error": "not found"}, 404)

    def tunnel_create(self, user: sqlite3.Row, data: dict[str, Any]) -> None:
        try:
            name = str(data.get("name", "")).strip()
            proxy_type = str(data.get("proxy_type", "tcp")).lower()
            local_ip = str(data.get("local_ip", "127.0.0.1")).strip()
            local_port = int(data.get("local_port", 0))
            remote_port = int(data.get("remote_port", 0) or 0)
            custom_domains = ",".join([d.strip().lower() for d in str(data.get("custom_domains", "")).replace("\n", ",").split(",") if d.strip()])[:500]
            secret_key = str(data.get("secret_key", "")).strip()[:120]
            if not name or len(name) > 40 or not name.replace("_", "").replace("-", "").isalnum():
                raise ValueError("隧道名称只能包含字母、数字、下划线、短横线，长度 1-40")
            if proxy_type not in ALLOWED_PROXY_TYPES:
                audit("tunnel_rejected_protocol", user, user["node_id"], remote_port, proxy_type, "协议不在白名单")
                raise ValueError("协议不支持")
            if not (1 <= local_port <= 65535):
                raise ValueError("本地端口不合法")
            if proxy_type in REMOTE_PORT_PROXY_TYPES:
                if not (1 <= remote_port <= 65535):
                    raise ValueError("TCP/UDP 必须选择公网端口")
            else:
                remote_port = 0
            if proxy_type in DOMAIN_PROXY_TYPES and not custom_domains:
                raise ValueError("HTTP/HTTPS/TCPMUX 必须填写自定义域名")
            if proxy_type in SECRET_KEY_PROXY_TYPES and not secret_key:
                secret_key = secrets.token_urlsafe(16)
            with db() as conn:
                if proxy_type in REMOTE_PORT_PROXY_TYPES:
                    owned = conn.execute("SELECT 1 FROM ports WHERE node_id=? AND user_id=? AND port=?", (user["node_id"], user["id"], remote_port)).fetchone()
                    if not owned:
                        raise ValueError("这个公网端口不属于当前账号")
                conn.execute(
                    "INSERT INTO tunnels(node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (user["node_id"], user["id"], name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, now()),
                )
            detail = f"{name} -> {local_ip}:{local_port}"
            if custom_domains:
                detail += f" domains={custom_domains}"
            audit("tunnel_create", user, user["node_id"], remote_port or None, proxy_type, detail)
            self.send_json({"ok": True})
        except sqlite3.IntegrityError:
            self.send_json({"ok": False, "error": "隧道名称或公网端口已被使用"}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def admin_create_user(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        ok, msg = create_user(str(data.get("username", "")), str(data.get("password", "")), int(data.get("max_ports", DEFAULT_MAX_PORTS)), int(data.get("expires_days", 30)), int(data.get("node_id", 0)))
        self.send_json({"ok": ok, "message": msg, "error": None if ok else msg}, 200 if ok else 400)

    def admin_toggle_user(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        if user_id == admin["id"]:
            self.send_json({"ok": False, "error": "不能停用当前管理员账号"}, 400)
            return
        with db() as conn:
            conn.execute("UPDATE users SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=? AND role!='admin'", (user_id,))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        self.send_json({"ok": True})

    def admin_extend_user(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        days = int(data.get("days", 30))
        if days < 1 or days > 3650:
            self.send_json({"ok": False, "error": "续期天数必须在 1-3650 之间"}, 400)
            return
        with db() as conn:
            row = conn.execute("SELECT username, expires_at FROM users WHERE id=?", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在"}, 404)
                return
            new_expires_at = max(now(), int(row["expires_at"] or 0)) + days * 86400
            conn.execute("UPDATE users SET expires_at=?, active=1 WHERE id=?", (new_expires_at, user_id))
        self.send_json({"ok": True, "message": f"已续期到 {fmt_time(new_expires_at)}"})

    def admin_reset_password(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        new_password = secrets.token_urlsafe(8)
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许重置管理员"}, 404)
                return
            conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(new_password), user_id))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        self.send_json({"ok": True, "message": f"用户 {row['username']} 新密码：{new_password}", "password": new_password})

    def admin_reset_license(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许重置管理员授权"}, 404)
                return
            license_key = make_license_key()
            conn.execute("UPDATE users SET license_key=?, machine_id='' WHERE id=?", (license_key, user_id))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        self.send_json({"ok": True, "message": f"用户 {row['username']} 新授权码：{license_key}", "license_key": license_key})

    def admin_unbind_machine(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在"}, 404)
                return
            conn.execute("UPDATE users SET machine_id='' WHERE id=?", (user_id,))
        self.send_json({"ok": True, "message": f"已解绑用户 {row['username']} 的机器"})

    def admin_delete_user(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        if user_id == admin["id"]:
            self.send_json({"ok": False, "error": "不能删除当前管理员账号"}, 400)
            return
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许删除管理员"}, 404)
                return
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            conn.execute("DELETE FROM tunnels WHERE user_id=?", (user_id,))
            conn.execute("UPDATE ports SET user_id=NULL WHERE user_id=?", (user_id,))
            conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        self.send_json({"ok": True})

    def admin_ban_user(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        reason = str(data.get("reason", "")).strip()[:500] or "违规封禁"
        with db() as conn:
            target = conn.execute("SELECT * FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not target:
                self.send_json({"ok": False, "error": "用户不存在或不允许封禁管理员"}, 404)
                return
            conn.execute("UPDATE users SET active=0 WHERE id=?", (user_id,))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            conn.execute("UPDATE tunnels SET enabled=0 WHERE user_id=?", (user_id,))
            conn.execute("INSERT INTO user_bans(user_id, username, reason, banned_by, created_at) VALUES(?,?,?,?,?)", (user_id, target["username"], reason, admin["id"], now()))
        audit("user_ban", target, target["node_id"], None, "", reason)
        self.send_json({"ok": True, "message": f"已封禁用户 {target['username']}"})

    def admin_lookup_port(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        remote_port = int(data.get("remote_port", 0))
        node_id = int(data.get("node_id", 0) or 0)
        with db() as conn:
            params: list[Any] = [remote_port]
            node_filter = ""
            if node_id:
                node_filter = "AND p.node_id=?"
                params.append(node_id)
            row = conn.execute(
                f"""
                SELECT p.port, p.user_id, p.node_id, n.region, n.name AS node_name, n.server_addr,
                       u.username, u.role, u.active, u.expires_at, u.token,
                       t.id AS tunnel_id, t.name AS tunnel_name, t.proxy_type, t.local_ip, t.local_port, t.enabled AS tunnel_enabled
                FROM ports p
                LEFT JOIN nodes n ON n.id=p.node_id
                LEFT JOIN users u ON u.id=p.user_id
                LEFT JOIN tunnels t ON t.node_id=p.node_id AND t.remote_port=p.port
                WHERE p.port=? {node_filter}
                ORDER BY p.node_id LIMIT 20
                """,
                params,
            ).fetchall()
            logs = [row_dict(r) for r in conn.execute("SELECT * FROM audit_logs WHERE remote_port=? ORDER BY id DESC LIMIT 30", (remote_port,))]
        self.send_json({"ok": True, "matches": [row_dict(r) for r in row], "logs": logs})

    def admin_software_license_create(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        if not SOFTWARE_LICENSE_AUTHORITY:
            self.send_json({"ok": False, "error": "当前实例不是授权服务器，请设置 FML_LICENSE_AUTHORITY=1"}, 400)
            return
        ok, msg, keys = create_software_license_keys_batch(
            str(data.get("note", "")),
            str(data.get("plan", "deploy")),
            int(data.get("expires_days", 0)),
            int(data.get("count", 1)),
        )
        self.send_json({"ok": ok, "message": msg if ok else None, "keys": keys, "key": keys[0] if keys else None, "error": None if ok else msg}, 200 if ok else 400)

    def admin_software_license_toggle(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        if not SOFTWARE_LICENSE_AUTHORITY:
            self.send_json({"ok": False, "error": "当前实例不是授权服务器"}, 400)
            return
        key_id = int(data.get("id", 0))
        with db() as conn:
            conn.execute("UPDATE software_license_keys SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?", (key_id,))
        self.send_json({"ok": True})

    def admin_software_license_unbind(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        if not SOFTWARE_LICENSE_AUTHORITY:
            self.send_json({"ok": False, "error": "当前实例不是授权服务器"}, 400)
            return
        key_id = int(data.get("id", 0))
        with db() as conn:
            conn.execute("UPDATE software_license_keys SET machine_id='', activated_at=0, last_check_at=0 WHERE id=?", (key_id,))
        self.send_json({"ok": True, "message": "已解绑软件授权"})

    def admin_invite_create(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        ok, msg, keys = create_invite_keys_batch(
            str(data.get("note", "")),
            int(data.get("max_uses", 1)),
            int(data.get("max_ports", DEFAULT_MAX_PORTS)),
            int(data.get("user_expires_days", 30)),
            int(data.get("key_expires_days", 30)),
            admin["id"],
            int(data.get("count", 1)),
        )
        self.send_json({"ok": ok, "message": msg if ok else None, "key": keys[0] if keys else None, "keys": keys, "error": None if ok else msg}, 200 if ok else 400)

    def admin_invite_toggle(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        key_id = int(data.get("id", 0))
        with db() as conn:
            conn.execute("UPDATE invite_keys SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?", (key_id,))
        self.send_json({"ok": True})

    def admin_invite_delete(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        key_id = int(data.get("id", 0))
        with db() as conn:
            conn.execute("DELETE FROM invite_keys WHERE id=?", (key_id,))
        self.send_json({"ok": True})

    def admin_node_create(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        try:
            region = str(data.get("region", "")).strip() or "默认地区"
            name = str(data.get("name", "")).strip()
            server_addr = str(data.get("server_addr", "")).strip()
            server_port = int(data.get("server_port", 7000))
            auth_token = str(data.get("auth_token", "")).strip()
            port_start = int(data.get("port_start", 20000))
            port_end = int(data.get("port_end", 20199))
            note = str(data.get("note", "")).strip()[:120]
            if len(region) > 40:
                raise ValueError("地区名称太长")
            if not name or len(name) > 40 or not name.replace("_", "").replace("-", "").isalnum():
                raise ValueError("节点名称只能包含字母、数字、下划线、短横线，长度 1-40")
            if not server_addr:
                raise ValueError("frps 地址不能为空")
            if not (1 <= server_port <= 65535):
                raise ValueError("frps bindPort 不合法")
            if len(auth_token) < 6:
                raise ValueError("frps token 至少 6 位")
            if not (1 <= port_start <= port_end <= 65535):
                raise ValueError("端口池范围不合法")
            if port_end - port_start > 20000:
                raise ValueError("单节点端口池不要超过 20000 个")
            with db() as conn:
                cur = conn.execute(
                    "INSERT INTO nodes(region, name, server_addr, server_port, auth_token, port_start, port_end, active, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (region, name, server_addr, server_port, auth_token, port_start, port_end, 1, note, now()),
                )
                node_id = int(cur.lastrowid)
                conn.executemany("INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?,?,?)", [(node_id, p, now()) for p in range(port_start, port_end + 1)])
            self.send_json({"ok": True, "message": f"节点 {region} / {name} 已创建"})
        except sqlite3.IntegrityError:
            self.send_json({"ok": False, "error": "节点名称已存在"}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def admin_node_update(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        try:
            node_id = int(data.get("id", 0))
            region = str(data.get("region", "")).strip() or "默认地区"
            name = str(data.get("name", "")).strip()
            server_addr = str(data.get("server_addr", "")).strip()
            server_port = int(data.get("server_port", 7000))
            auth_token = str(data.get("auth_token", "")).strip()
            note = str(data.get("note", "")).strip()[:120]
            active = 1 if str(data.get("active", "1")) in ("1", "true", "True", "on", "yes") else 0
            if len(region) > 40:
                raise ValueError("地区名称太长")
            if not name or len(name) > 40 or not name.replace("_", "").replace("-", "").isalnum():
                raise ValueError("节点名称只能包含字母、数字、下划线、短横线，长度 1-40")
            if not server_addr:
                raise ValueError("frps 域名/地址不能为空")
            if not (1 <= server_port <= 65535):
                raise ValueError("frps bindPort 不合法")
            if len(auth_token) < 6:
                raise ValueError("frps token 至少 6 位")
            with db() as conn:
                row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "节点不存在"}, 404)
                    return
                conn.execute(
                    "UPDATE nodes SET region=?, name=?, server_addr=?, server_port=?, auth_token=?, active=?, note=? WHERE id=?",
                    (region, name, server_addr, server_port, auth_token, active, note, node_id),
                )
            self.send_json({"ok": True, "message": f"节点 {region} / {name} 已更新"})
        except sqlite3.IntegrityError:
            self.send_json({"ok": False, "error": "节点名称已存在"}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def admin_node_toggle(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        node_id = int(data.get("id", 0))
        with db() as conn:
            conn.execute("UPDATE nodes SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?", (node_id,))
        self.send_json({"ok": True})

    def admin_node_delete(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        node_id = int(data.get("id", 0))
        with db() as conn:
            users = conn.execute("SELECT COUNT(*) c FROM users WHERE node_id=?", (node_id,)).fetchone()["c"]
            tunnels = conn.execute("SELECT COUNT(*) c FROM tunnels WHERE node_id=?", (node_id,)).fetchone()["c"]
            if users or tunnels:
                self.send_json({"ok": False, "error": "节点下仍有用户或隧道，不能删除；可先停用节点"}, 400)
                return
            conn.execute("DELETE FROM ports WHERE node_id=?", (node_id,))
            conn.execute("DELETE FROM nodes WHERE id=?", (node_id,))
        self.send_json({"ok": True})

    def download_frpc(self) -> None:
        user = self.require_user()
        if not user or not self.require_software_license():
            return
        with db() as conn:
            node = conn.execute("SELECT * FROM nodes WHERE id=?", (user["node_id"],)).fetchone()
            tunnels = conn.execute("SELECT * FROM tunnels WHERE user_id=? ORDER BY id", (user["id"],)).fetchall()
        if not node:
            self.send_json({"ok": False, "error": "用户所属节点不存在"}, 400)
            return
        self.send_body(tunnel_config(user, node, tunnels).encode(), 200, "application/toml; charset=utf-8", {"Content-Disposition": 'attachment; filename="frpc.toml"'})

    def download_frps_example(self) -> None:
        if not self.require_admin() or not self.require_software_license():
            return
        query = urlparse(self.path).query
        node_id = 0
        for part in query.split('&'):
            if part.startswith('node_id='):
                try:
                    node_id = int(part.split('=', 1)[1])
                except ValueError:
                    node_id = 0
        with db() as conn:
            node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone() if node_id else conn.execute("SELECT * FROM nodes ORDER BY id LIMIT 1").fetchone()
        if not node:
            self.send_json({"ok": False, "error": "节点不存在"}, 404)
            return
        self.send_body(frps_example_config(node).encode(), 200, "application/toml; charset=utf-8", {"Content-Disposition": f'attachment; filename="frps.{node["name"]}.toml"'})

    def frp_plugin(self) -> None:
        try:
            payload = self.read_json()
            op = payload.get("op") or payload.get("Op") or ""
            content = payload.get("content") or payload.get("Content") or payload
            user_name = content.get("user") or content.get("User") or content.get("clientUser") or ""
            metas = content.get("metas") or content.get("metadatas") or content.get("Metas") or {}
            panel_token = metas.get("panelToken") or metas.get("panel_token") or content.get("panelToken") or ""
            reject = False
            reason = ""
            license_key = metas.get("licenseKey") or metas.get("license_key") or content.get("licenseKey") or ""
            machine_id = normalize_machine_id(metas.get("machineId") or metas.get("machine_id") or content.get("machineId") or "")
            with db() as conn:
                user = conn.execute("SELECT * FROM users WHERE username=? AND active=1 AND (expires_at=0 OR expires_at>?)", (user_name, now())).fetchone()
                if not user:
                    reject, reason = True, "unknown, disabled or expired user"
                elif panel_token and not hmac.compare_digest(panel_token, user["token"]):
                    reject, reason = True, "invalid panel token"
                elif not license_key or not hmac.compare_digest(str(license_key), user["license_key"]):
                    reject, reason = True, "invalid license key"
                elif not machine_id or machine_id == "CHANGE_ME_DEVICE_ID":
                    # Legacy placeholder — auto-bind if not already bound
                    if not user["machine_id"]:
                        machine_id = make_machine_id()
                        conn.execute("UPDATE users SET machine_id=? WHERE id=?", (machine_id, user["id"]))
                    else:
                        reject, reason = True, "missing machine id"
                elif user["machine_id"] and user["machine_id"] != machine_id:
                    reject, reason = True, "license already bound to another machine"
                else:
                    if not user["machine_id"]:
                        conn.execute("UPDATE users SET machine_id=? WHERE id=?", (machine_id, user["id"]))
                    if op.lower() == "newproxy":
                        remote_port = content.get("remote_port") or content.get("remotePort") or content.get("RemotePort")
                        proxy_type = str(content.get("type") or content.get("proxy_type") or content.get("ProxyType") or "").lower()
                        if remote_port is not None and proxy_type in ("", "tcp", "udp"):
                            owned = conn.execute("SELECT 1 FROM ports WHERE node_id=? AND user_id=? AND port=?", (user["node_id"], user["id"], int(remote_port))).fetchone()
                            if not owned:
                                reject, reason = True, "remote port is not assigned to this user"
            self.send_json({"reject": reject, "reject_reason": reason})
        except Exception as e:
            self.send_json({"reject": True, "reject_reason": f"plugin error: {e}"})


def main() -> None:
    init_db()
    print(f"{APP_NAME} separated server listening on http://{HOST}:{PORT}")
    print(f"DB: {DB_PATH}")
    if ADMIN_PASSWORD == "admin123":
        print("WARNING: default admin password is admin123. Set FML_ADMIN_PASSWORD in production.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
