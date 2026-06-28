#!/usr/bin/env python3
"""License Authority — standalone activation/signing server for frp-manager-lite.

Deploy this on a single VPS. Customer panels call /api/license/activate
with their license key + machine fingerprint to activate and bind.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import sys
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

APP_NAME = "license-authority"
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = Path(os.getenv("LCA_DB", str(BASE_DIR / "license.sqlite3")))
HOST = os.getenv("LCA_HOST", "127.0.0.1")
PORT = int(os.getenv("LCA_PORT", "8200"))
LCA_API_KEY = os.getenv("LCA_API_KEY", "")
LCA_LICENSE_SECRET = os.getenv("LCA_LICENSE_SECRET", "")
LCA_ALLOWED_APPS = os.getenv("LCA_ALLOWED_APPS", "frp-manager-lite")
LCA_MAX_KEYS_PER_REQUEST = int(os.getenv("LCA_MAX_KEYS_PER_REQUEST", "100"))

# ── utility ──────────────────────────────────────────────────

def now() -> int:
    return int(time.time())


def fmt_time(ts: int | None) -> str:
    if not ts:
        return "永久有效"
    struct = time.localtime(ts)
    return time.strftime("%Y-%m-%d %H:%M:%S", struct)


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS license_keys (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                license_key   TEXT    NOT NULL UNIQUE,
                note          TEXT    NOT NULL DEFAULT '',
                plan          TEXT    NOT NULL DEFAULT 'deploy',
                machine_id    TEXT    NOT NULL DEFAULT '',
                active        INTEGER NOT NULL DEFAULT 1,
                expires_at    INTEGER NOT NULL DEFAULT 0,
                activated_at  INTEGER NOT NULL DEFAULT 0,
                last_check_at INTEGER NOT NULL DEFAULT 0,
                created_at    INTEGER NOT NULL
            );
        """)

# ── license logic ─────────────────────────────────────────────

def make_license_key() -> str:
    return "FMLD-" + secrets.token_urlsafe(20).replace("-", "").replace("_", "")[:28].upper()


def normalize_machine_id(machine_id: str) -> str:
    return " ".join(machine_id.strip().split())[:128]


def license_signature(license_key: str, machine_id: str, plan: str, expires_at: int) -> str:
    if not LCA_LICENSE_SECRET:
        return ""
    msg = f"{license_key}|{machine_id}|{plan}|{int(expires_at)}"
    return hmac.new(LCA_LICENSE_SECRET.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def signed_license_payload(license_key: str, machine_id: str, plan: str, expires_at: int) -> dict[str, Any]:
    return {
        "license_key": license_key,
        "machine_id": machine_id,
        "plan": plan,
        "expires_at": int(expires_at),
        "signature": license_signature(license_key, machine_id, plan, int(expires_at)),
    }


def verify_signed_license(payload: dict[str, Any]) -> bool:
    if not LCA_LICENSE_SECRET:
        return True
    return hmac.compare_digest(
        str(payload.get("signature") or ""),
        license_signature(
            str(payload.get("license_key") or ""),
            str(payload.get("machine_id") or ""),
            str(payload.get("plan", "deploy") or ""),
            int(payload.get("expires_at") or 0),
        ),
    )


def generate_keys(note: str, plan: str, expires_days: int, count: int) -> tuple[bool, str, list[str]]:
    if count < 1 or count > LCA_MAX_KEYS_PER_REQUEST:
        return False, f"单次生成数量必须在 1-{LCA_MAX_KEYS_PER_REQUEST} 之间", []
    if expires_days < 0 or expires_days > 3650:
        return False, "有效期必须在 0-3650 天之间", []
    plan = (plan.strip() or "deploy")[:40]
    note = note.strip()[:120]
    expires_at = 0 if expires_days == 0 else now() + expires_days * 86400
    keys: list[str] = []
    with db() as conn:
        for _ in range(count):
            key = make_license_key()
            conn.execute(
                "INSERT INTO license_keys(license_key, note, plan, active, expires_at, created_at) VALUES(?,?,?,?,?,?)",
                (key, note, plan, 1, expires_at, now()),
            )
            keys.append(key)
    return True, f"已生成 {len(keys)} 个授权码", keys


def activate_license(license_key: str, machine_id: str, app_name: str) -> tuple[bool, str, dict[str, Any] | None]:
    license_key = license_key.strip().upper()
    if not license_key:
        return False, "授权码为空", None
    if not machine_id:
        return False, "机器指纹为空", None
    allowed = {a.strip() for a in LCA_ALLOWED_APPS.split(",") if a.strip()}
    if allowed and app_name.strip() not in allowed:
        return False, f"应用 {app_name} 不在授权范围内", None
    machine_id = normalize_machine_id(machine_id)
    with db() as conn:
        row = conn.execute("SELECT * FROM license_keys WHERE license_key=?", (license_key,)).fetchone()
        if not row:
            return False, "授权码不存在", None
        if not row["active"]:
            return False, "授权码已停用", None
        if row["expires_at"] and row["expires_at"] <= now():
            return False, "授权码已过期", None
        if row["machine_id"] and row["machine_id"] != machine_id:
            return False, "授权码已绑定其他机器", None
        if not row["machine_id"]:
            conn.execute(
                "UPDATE license_keys SET machine_id=?, activated_at=?, last_check_at=? WHERE id=?",
                (machine_id, now(), now(), row["id"]),
            )
        else:
            conn.execute("UPDATE license_keys SET last_check_at=? WHERE id=?", (now(), row["id"]))
        payload = signed_license_payload(license_key, machine_id, row["plan"], int(row["expires_at"] or 0))
    return True, "授权成功", payload

# ── HTTP handler ───────────────────────────────────────────────

def json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = APP_NAME
    sys_version = ""

    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {self.client_address[0]} {args[0]}" if args else fmt)

    def send_json(self, data, status=200):
        body = json_bytes(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw)

    def check_auth(self) -> bool:
        if not LCA_API_KEY:
            return True
        auth = self.headers.get("Authorization", "")
        # Accept both Bearer <key> and raw <key>
        key = auth.removeprefix("Bearer ").strip()
        return key == LCA_API_KEY

    # ── routes ─────────────────────────────────────────────

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "app": APP_NAME, "time": now()})
        elif path == "/api/admin/stats":
            self.admin_stats()
        elif path == "/api/admin/keys":
            self.admin_list_keys()
        elif path.startswith("/"):
            self.serve_static(path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/license/activate":
            self.handle_activate()
        elif path == "/api/admin/keys/generate":
            self.admin_generate_keys()
        elif path == "/api/admin/keys/toggle":
            self.admin_toggle_key()
        elif path == "/api/admin/keys/unbind":
            self.admin_unbind_key()
        else:
            self.send_json({"ok": False, "error": "not found"}, 404)

    # ── public endpoint ──────────────────────────────────

    def handle_activate(self):
        try:
            data = self.read_json()
        except Exception:
            self.send_json({"ok": False, "error": "请求格式错误"}, 400)
            return
        license_key = str(data.get("license_key", ""))
        machine_id = str(data.get("machine_id", ""))
        app_name = str(data.get("app", "frp-manager-lite"))
        ok, msg, payload = activate_license(license_key, machine_id, app_name)
        print(f"[activate] key={license_key[:12]}*** machine={machine_id[:16]}*** ok={ok} msg={msg}")
        if ok and payload:
            self.send_json({"ok": True, "message": msg, "license": payload})
        else:
            self.send_json({"ok": False, "error": msg}, 400)

    # ── admin endpoints ──────────────────────────────────

    def require_admin(self) -> bool:
        if not self.check_auth():
            self.send_json({"ok": False, "error": "未授权：请设置 LCA_API_KEY 并在请求头中提供 Authorization: Bearer <key>"}, 401)
            return False
        return True

    def admin_stats(self):
        if not self.require_admin():
            return
        with db() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM license_keys").fetchone()["n"]
            active_keys = conn.execute(
                "SELECT COUNT(*) AS n FROM license_keys WHERE active=1 AND (expires_at=0 OR expires_at>?)", (now(),)
            ).fetchone()["n"]
            activated = conn.execute("SELECT COUNT(*) AS n FROM license_keys WHERE machine_id!=''").fetchone()["n"]
            pending = conn.execute("SELECT COUNT(*) AS n FROM license_keys WHERE machine_id='' AND active=1 AND (expires_at=0 OR expires_at>?)", (now(),)).fetchone()["n"]
        self.send_json({"ok": True, "total": total, "active": active_keys, "activated": activated, "pending": pending})

    def admin_list_keys(self):
        if not self.require_admin():
            return
        search = ""
        for k, v in urlparse(self.path).query.split("&"):
            if k == "q":
                search = v
                break
        with db() as conn:
            if search:
                rows = conn.execute(
                    "SELECT * FROM license_keys WHERE license_key LIKE ? OR note LIKE ? ORDER BY id DESC LIMIT 500",
                    (f"%{search}%", f"%{search}%"),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM license_keys ORDER BY id DESC LIMIT 500").fetchall()
        keys = []
        for r in rows:
            keys.append({
                "id": r["id"], "license_key": r["license_key"], "note": r["note"], "plan": r["plan"],
                "machine_id": r["machine_id"], "active": bool(r["active"]),
                "expires_at": r["expires_at"], "expires_text": fmt_time(r["expires_at"]),
                "expired": bool(r["expires_at"] and r["expires_at"] <= now()),
                "activated": bool(r["machine_id"]),
                "activated_at": r["activated_at"], "last_check_at": r["last_check_at"],
                "created_at": r["created_at"],
            })
        self.send_json({"ok": True, "keys": keys})

    def admin_generate_keys(self):
        if not self.require_admin():
            return
        try:
            data = self.read_json()
        except Exception:
            self.send_json({"ok": False, "error": "请求格式错误"}, 400)
            return
        note = str(data.get("note", ""))
        plan = str(data.get("plan", "deploy"))
        expires_days = int(data.get("expires_days", 365))
        count = int(data.get("count", 1))
        ok, msg, keys = generate_keys(note, plan, expires_days, count)
        self.send_json({"ok": ok, "message": msg, "keys": keys} if ok else {"ok": False, "error": msg}, 200 if ok else 400)

    def admin_toggle_key(self):
        if not self.require_admin():
            return
        try:
            data = self.read_json()
        except Exception:
            self.send_json({"ok": False, "error": "请求格式错误"}, 400)
            return
        key_id = int(data.get("id", 0))
        with db() as conn:
            row = conn.execute("SELECT * FROM license_keys WHERE id=?", (key_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "授权码不存在"}, 404)
                return
            new_active = 0 if row["active"] else 1
            conn.execute("UPDATE license_keys SET active=? WHERE id=?", (new_active, key_id))
        self.send_json({"ok": True, "message": "已启用" if new_active else "已停用", "active": bool(new_active)})

    def admin_unbind_key(self):
        if not self.require_admin():
            return
        try:
            data = self.read_json()
        except Exception:
            self.send_json({"ok": False, "error": "请求格式错误"}, 400)
            return
        key_id = int(data.get("id", 0))
        with db() as conn:
            row = conn.execute("SELECT * FROM license_keys WHERE id=?", (key_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "授权码不存在"}, 404)
                return
            conn.execute("UPDATE license_keys SET machine_id='', activated_at=0 WHERE id=?", (key_id,))
        self.send_json({"ok": True, "message": "已解绑机器"})

    # ── static files ─────────────────────────────────────

    def serve_static(self, path: str):
        if path in {"", "/"}:
            path = "/index.html"
        target = (FRONTEND_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(FRONTEND_DIR.resolve())) or not target.is_file():
            target = FRONTEND_DIR / "index.html"
        ctype_map = {".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml"}
        ctype = ctype_map.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


# ── main ─────────────────────────────────────────────────────

def main():
    init_db()
    print(f"License Authority starting on http://{HOST}:{PORT}")
    print(f"DB: {DB_PATH}")
    if LCA_API_KEY:
        print(f"API key: {'*' * 16} ({len(LCA_API_KEY)} chars)")
    else:
        print("WARNING: LCA_API_KEY not set — admin endpoints are open!")
    if not LCA_LICENSE_SECRET:
        print("WARNING: LCA_LICENSE_SECRET not set — signatures will be empty!")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
