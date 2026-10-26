#!/usr/bin/env python3
"""frp-manager-lite: separated backend API + static frontend.

No Docker. No third-party Python dependencies. Intended for direct VPS deployment
behind Nginx/Caddy HTTPS in production.
"""
from __future__ import annotations

import base64
import collections
import hashlib
import gzip
import hmac
import io
import ipaddress
import json
import urllib.error
import urllib.request
import mimetypes
import os
import re
import secrets
import socket
import ssl
import sqlite3
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
import urllib.parse
import threading

APP_NAME = "frp-manager-lite"
APP_VERSION = os.getenv("FML_PANEL_VERSION", "2.0.2")  # 面板版本，不是 frp 版本
SERVER_START_TS = time.time()  # 进程启动时间，用于计算面板运行时间
FRP_CLIENT_VERSION = os.getenv("FRP_CLIENT_VERSION", os.getenv("FRP_VERSION", "0.66.0"))
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = Path(os.getenv("FML_DB", BASE_DIR / "data.sqlite3"))
# SQLite 性能调优：默认值在慢盘上会让每次写事务卡好几秒（见 db() 里的注释）。
SQLITE_JOURNAL_MODES = {"WAL", "DELETE", "TRUNCATE", "PERSIST", "MEMORY", "OFF"}
SQLITE_SYNCHRONOUS_LEVELS = {"OFF", "NORMAL", "FULL", "EXTRA"}
SQLITE_JOURNAL_MODE = (os.getenv("FML_SQLITE_JOURNAL_MODE", "WAL") or "WAL").upper()
SQLITE_SYNCHRONOUS = (os.getenv("FML_SQLITE_SYNCHRONOUS", "NORMAL") or "NORMAL").upper()
SQLITE_BUSY_TIMEOUT = float(os.getenv("FML_SQLITE_BUSY_TIMEOUT", "10") or "10")
HOST = os.getenv("FML_HOST", "127.0.0.1")
PORT = int(os.getenv("FML_PORT", "8080"))
PORT_START = int(os.getenv("FML_PORT_START", "20000"))
PORT_END = int(os.getenv("FML_PORT_END", "20199"))
DEFAULT_MAX_PORTS = int(os.getenv("FML_DEFAULT_MAX_PORTS", "10"))
ADMIN_USER = os.getenv("FML_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("FML_ADMIN_PASSWORD", "admin123")
FRP_SERVER_ADDR = os.getenv("FRP_SERVER_ADDR", "YOUR_FRPS_IP_OR_DOMAIN")
FRP_SERVER_PORT = int(os.getenv("FRP_SERVER_PORT", "7000"))
FRPS_WEB_PORT = int(os.getenv("FRPS_WEB_PORT", os.getenv("FML_FRPS_WEB_PORT", "0")) or 0)
FRP_AUTH_TOKEN = os.getenv("FRP_AUTH_TOKEN", "CHANGE_ME_SHARED_FRPS_TOKEN")
FML_SETUP_KEY = os.getenv("FML_SETUP_KEY", "")  # 用于一键添加 frps 节点的验证密钥
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
R2_PREFIX = os.getenv("R2_PREFIX", "frp-manager-lite/backups")
SESSION_TTL = 7 * 24 * 3600
MAX_BODY = int(os.getenv("FML_MAX_BODY", str(32 * 1024 * 1024)))
ALLOWED_PROXY_TYPES = {"tcp", "udp", "http", "https", "stcp", "xtcp", "tcpmux"}
REMOTE_PORT_PROXY_TYPES = {"tcp", "udp"}
DOMAIN_PROXY_TYPES = {"http", "https", "tcpmux"}
SECRET_KEY_PROXY_TYPES = {"stcp", "xtcp"}
PROXY_TYPE_ORDER = ["tcp", "udp", "http", "https", "stcp", "xtcp", "tcpmux"]
SOFTWARE_LICENSE_SECRET = os.getenv("FML_SOFTWARE_LICENSE_SECRET", "")
SOFTWARE_LICENSE_SERVER_URL = "http://mcp.224130.xyz:9014"
SOFTWARE_LICENSE_FILE = Path(os.getenv("FML_LICENSE_FILE", DB_PATH.parent / "software-license.json"))
# 面板内不再内置「授权服务器」模式（防止拿到源码后自助授权）；授权只由卖家的独立服务签发
SOFTWARE_LICENSE_AUTHORITY = False
SOFTWARE_LICENSE_REQUIRED = True  # always enforced — no env-var off switch
RATE_WINDOW = 15 * 60
LOGIN_RATE_LIMIT = 8
HSTS_MAX_AGE = int(os.getenv("FML_HSTS_MAX_AGE", "0") or "0")
PROVIDER_COMMISSION_PCT = float(os.getenv("FML_PROVIDER_COMMISSION", "10") or "10")
PROVIDER_SETTLE_DAYS = float(os.getenv("FML_PROVIDER_SETTLE_DAYS", "7") or "7")
NODE_OFFLINE_SUSPEND_HOURS = float(os.getenv("FML_NODE_OFFLINE_SUSPEND_HOURS", "6") or "6")
REGISTER_RATE_LIMIT = 5
# 开放注册：不要求邀请码；默认值由环境变量控制，dev 可开，生产保持关闭
OPEN_REGISTRATION = os.getenv("FML_OPEN_REGISTRATION", "0").strip().lower() in ("1", "true", "yes", "on")
OPEN_REGISTRATION_MAX_PORTS = max(0, min(100, int(os.getenv("FML_OPEN_REGISTRATION_MAX_PORTS", "0") or "0")))
OPEN_REGISTRATION_EXPIRES_DAYS = max(0, min(3650, int(os.getenv("FML_OPEN_REGISTRATION_EXPIRES_DAYS", "30") or "30")))
CSRF_TTL = 2 * 3600
NODE_CHECK_TIMEOUT = float(os.getenv("FML_NODE_CHECK_TIMEOUT", "1.5"))
NODE_CHECK_MAX_WORKERS = int(os.getenv("FML_NODE_CHECK_MAX_WORKERS", "16"))
NODE_DASHBOARD_REFRESH_SECONDS = int(os.getenv("FML_NODE_DASHBOARD_REFRESH_SECONDS", "30"))
FRPS_DASHBOARD_URL = os.getenv("FML_FRPS_DASHBOARD_URL", "").rstrip("/")
FRPS_DASHBOARD_USER = os.getenv("FML_FRPS_DASHBOARD_USER", "")
FRPS_DASHBOARD_PASSWORD = os.getenv("FML_FRPS_DASHBOARD_PASSWORD", "")
TUNNEL_STATUS_TTL = int(os.getenv("FML_TUNNEL_STATUS_TTL", "120"))
TUNNEL_CONNECT_TIMEOUT = float(os.getenv("FML_TUNNEL_CONNECT_TIMEOUT", "1.5"))


def now() -> int:
    return int(time.time())


def parse_date_epoch(raw: str) -> int:
    """接受 2026-12-31 或 epoch 秒，返回当天 23:59 的时间戳。"""
    raw = str(raw or "").strip()
    if not raw:
        return 0
    if raw.isdigit():
        return int(raw)
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return int(time.mktime(time.strptime(raw + " 23:59", fmt + " %H:%M")))
        except ValueError:
            continue
    return 0


def fmt_time(ts: int | None) -> str:
    if not ts:
        return "永不过期"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ts)))


def row_val(row: sqlite3.Row, key: str, default: Any = "") -> Any:
    """Safe Row access — sqlite3.Row lacks .get() on some Python builds."""
    return row[key] if key in row.keys() else default


def clamp_int(value: Any, default: int = 0, min_value: int = 0, max_value: int = 10**12) -> int:
    try:
        n = int(float(str(value).strip()))
    except Exception:
        n = default
    return max(min_value, min(max_value, n))


def traffic_gb_to_bytes(value: Any) -> int:
    try:
        gb = float(str(value or "0").strip())
    except Exception:
        gb = 0.0
    gb = max(0.0, min(1_000_000.0, gb))
    return int(gb * 1024 * 1024 * 1024)


def speed_mbs_to_kbps(value: Any) -> int:
    """Convert UI MB/s to KiB/s for frp bandwidthLimit."""
    try:
        mbs = float(str(value or "0").strip())
    except Exception:
        mbs = 0.0
    mbs = max(0.0, min(1024.0, mbs))
    return int(mbs * 1024)


def normalize_bandwidth_to_kbps(value: Any) -> int | None:
    """Best-effort parse frp bandwidthLimit values into KiB/s."""
    if value is None:
        return None
    s = str(value).strip().lower().replace(" ", "")
    if not s:
        return None
    multipliers = {
        "kib": 1, "kb": 1, "k": 1,
        "mib": 1024, "mb": 1024, "m": 1024,
        "gib": 1024 * 1024, "gb": 1024 * 1024, "g": 1024 * 1024,
        "b": 1 / 1024,
    }
    unit = ""
    num = s
    for suffix in sorted(multipliers, key=len, reverse=True):
        if s.endswith(suffix):
            unit = suffix
            num = s[:-len(suffix)]
            break
    try:
        n = float(num)
    except Exception:
        return None
    if unit:
        return int(round(n * multipliers[unit]))
    # frp may report numeric values as bytes/s in some payload variants.
    return int(round(n / 1024)) if n > 1024 * 1024 else int(round(n))


def record_val(record: sqlite3.Row | dict[str, Any], key: str, default: Any = "") -> Any:
    """Read from sqlite rows or JSON-loaded dict records."""
    if isinstance(record, sqlite3.Row):
        return record[key] if key in record.keys() else default
    return record.get(key, default)


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=SQLITE_BUSY_TIMEOUT)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # 有些部署的 /data 存储 fsync 极慢（实测 0.5~1.0s/次）。SQLite 默认的
    # journal_mode=delete + synchronous=FULL 每次写事务要 fsync 多次，导致
    # 登录 / 退出 / 审计这类写操作卡 0.5~4 秒。改成 WAL + NORMAL 后 fsync 接近 0。
    if SQLITE_JOURNAL_MODE in SQLITE_JOURNAL_MODES:
        try:
            conn.execute(f"PRAGMA journal_mode = {SQLITE_JOURNAL_MODE}")
        except Exception:
            pass
    if SQLITE_SYNCHRONOUS in SQLITE_SYNCHRONOUS_LEVELS:
        try:
            conn.execute(f"PRAGMA synchronous = {SQLITE_SYNCHRONOUS}")
        except Exception:
            pass
    try:
        conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT}")
    except Exception:
        pass
    return conn


def effective_setup_key() -> str:
    """一键添加节点密钥：面板自定义优先，其次环境变量 FML_SETUP_KEY；
    都没有时自动随机生成一个并持久化到设置（无需管理员手动配置）。"""
    try:
        with db() as conn:
            v = setting_get(conn, "setup_key", "")
            if v:
                return v
            if FML_SETUP_KEY:
                return FML_SETUP_KEY
            generated = "FMLS-" + secrets.token_urlsafe(24)
            setting_set(conn, "setup_key", generated)
            return generated
    except Exception:
        pass
    return FML_SETUP_KEY


def setup_key_source() -> str:
    try:
        with db() as conn:
            if setting_get(conn, "setup_key", ""):
                return "db"
    except Exception:
        pass
    return "env" if FML_SETUP_KEY else "none"


def smtp_config(conn: sqlite3.Connection) -> dict[str, Any]:
    return {
        "host": setting_get(conn, "smtp_host", ""),
        "port": int(setting_get(conn, "smtp_port", "0") or 0),
        "user": setting_get(conn, "smtp_user", ""),
        "password": setting_get(conn, "smtp_password", ""),
        "from_addr": setting_get(conn, "smtp_from", ""),
        "ssl": setting_get(conn, "smtp_ssl", "1") == "1",
    }


def smtp_configured(conn: sqlite3.Connection) -> bool:
    c = smtp_config(conn)
    return bool(c["host"] and c["user"] and c["password"])


def smtp_public(cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "host": cfg.get("host", ""),
        "port": cfg.get("port", 0),
        "user": cfg.get("user", ""),
        "from_addr": cfg.get("from_addr", ""),
        "ssl": bool(cfg.get("ssl")),
        "password_set": bool(cfg.get("password")),
        "configured": bool(cfg.get("host") and cfg.get("user") and cfg.get("password")),
    }


def mask_email(addr: str) -> str:
    addr = str(addr or "")
    if "@" not in addr:
        return addr
    name, _, dom = addr.partition("@")
    masked = name[:2] + "*" * max(0, len(name) - 2) if len(name) > 2 else name[:1] + "*"
    return f"{masked}@{dom}"


def send_email(to_addr: str, subject: str, body: str) -> tuple[bool, str]:
    try:
        with db() as conn:
            cfg = smtp_config(conn)
    except Exception as e:
        return False, f"读取邮件配置失败：{e}"
    if not (cfg["host"] and cfg["user"] and cfg["password"]):
        return False, "邮件服务未配置"
    import smtplib
    from email.mime.text import MIMEText
    from email.header import Header
    from email.utils import formataddr
    port = cfg["port"] or (465 if cfg["ssl"] else 587)
    sender = cfg["from_addr"] or cfg["user"]
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr(("Frp 管理台", sender))
    msg["To"] = to_addr
    try:
        if cfg["ssl"]:
            server = smtplib.SMTP_SSL(cfg["host"], port, timeout=15)
        else:
            server = smtplib.SMTP(cfg["host"], port, timeout=15)
            server.ehlo()
            try:
                server.starttls()
            except Exception:
                pass
        server.login(cfg["user"], cfg["password"])
        server.sendmail(sender, [to_addr], msg.as_string())
        server.quit()
        return True, "已发送"
    except Exception as e:
        return False, f"发送失败：{e.__class__.__name__}: {e}"


# --- 通知（节点异常等）：渠道实现参考青龙面板（bark/telegram/钉钉/企业微信/Server酱 等）---
NOTIFY_CHANNELS: list[dict[str, Any]] = [
    {"type": "bark", "name": "Bark", "fields": [
        {"key": "barkPush", "label": "barkPush", "hint": "Bark 的信息 IP/设备码，例如 https://api.day.app/XXXXXXXX", "required": True},
        {"key": "barkIcon", "label": "barkIcon", "hint": "推送图标（iOS15+ 才显示）", "placeholder": "https://qn.whyour.cn/logo.png"},
        {"key": "barkSound", "label": "barkSound", "hint": "推送铃声，铃声列表见 App"},
        {"key": "barkGroup", "label": "barkGroup", "hint": "消息分组", "placeholder": "frp"},
        {"key": "barkLevel", "label": "barkLevel", "hint": "时效性：active/timeSensitive/critical/passive", "placeholder": "active"},
        {"key": "barkUrl", "label": "barkUrl", "hint": "点击消息跳转的 URL"},
        {"key": "barkArchive", "label": "barkArchive", "hint": "是否保存推送消息（1/0）"},
    ]},
    {"type": "telegramBot", "name": "Telegram", "fields": [
        {"key": "telegramBotToken", "label": "telegramBotToken", "hint": "机器人 token，例如 1077xxx4424:AAFjv0Fcq...", "required": True},
        {"key": "telegramBotUserId", "label": "telegramBotUserId", "hint": "接收者 chat id，例如 129xxx206", "required": True},
        {"key": "telegramBotApiHost", "label": "telegramBotApiHost", "hint": "自建反代地址，默认 https://api.telegram.org"},
        {"key": "telegramBotProxyHost", "label": "telegramBotProxyHost", "hint": "代理 IP（可选）"},
        {"key": "telegramBotProxyPort", "label": "telegramBotProxyPort", "hint": "代理端口（可选）"},
        {"key": "telegramBotProxyAuth", "label": "telegramBotProxyAuth", "hint": "代理认证 user:password（可选）"},
    ]},
    {"type": "dingtalkBot", "name": "钉钉", "fields": [
        {"key": "dingtalkBotToken", "label": "dingtalkBotToken", "hint": "webhook 的 access_token", "required": True},
        {"key": "dingtalkBotSecret", "label": "dingtalkBotSecret", "hint": "加签密钥（SEC 开头，可选）"},
    ]},
    {"type": "weWorkBot", "name": "企业微信", "fields": [
        {"key": "weWorkBotKey", "label": "weWorkBotKey", "hint": "群机器人 webhook 的 key", "required": True},
        {"key": "weWorkOrigin", "label": "weWorkOrigin", "hint": "企业微信代理地址（可选）", "placeholder": "https://qyapi.weixin.qq.com"},
    ]},
    {"type": "weWorkApp", "name": "企业微信应用", "fields": [
        {"key": "weWorkAppKey", "label": "weWorkAppKey", "hint": "corpid,corpsecret,touser,agentid[,消息类型] 用英文逗号分隔", "required": True},
        {"key": "weWorkOrigin", "label": "weWorkOrigin", "hint": "企业微信代理地址（可选）", "placeholder": "https://qyapi.weixin.qq.com"},
    ]},
    {"type": "serverChan", "name": "Server 酱", "fields": [
        {"key": "serverChanKey", "label": "serverChanKey", "hint": "Server 酱 SENDKEY（sctp 开头自动走新版接口）", "required": True},
    ]},
    {"type": "pushPlus", "name": "PushPlus", "fields": [
        {"key": "pushPlusToken", "label": "pushPlusToken", "hint": "PushPlus token", "required": True},
        {"key": "pushPlusUser", "label": "pushPlusUser", "hint": "群组编码（一对多推送，可选）"},
        {"key": "pushPlusTemplate", "label": "pushPlusTemplate", "hint": "模板，默认 html"},
        {"key": "pushplusChannel", "label": "pushplusChannel", "hint": "渠道，默认 wechat"},
        {"key": "pushplusWebhook", "label": "pushplusWebhook", "hint": "webhook 编码（可选）"},
        {"key": "pushplusCallbackUrl", "label": "pushplusCallbackUrl", "hint": "回调地址（可选）"},
        {"key": "pushplusTo", "label": "pushplusTo", "hint": "好友令牌（可选）"},
    ]},
    {"type": "pushDeer", "name": "PushDeer", "fields": [
        {"key": "pushDeerKey", "label": "pushDeerKey", "hint": "PushDeer 的 Key", "required": True},
        {"key": "pushDeerUrl", "label": "pushDeerUrl", "hint": "自架 API 地址（可选）", "placeholder": "https://api2.pushdeer.com/message/push"},
    ]},
    {"type": "gotify", "name": "Gotify", "fields": [
        {"key": "gotifyUrl", "label": "gotifyUrl", "hint": "Gotify 地址，例如 https://push.example.de:8080", "required": True},
        {"key": "gotifyToken", "label": "gotifyToken", "hint": "应用 token", "required": True},
        {"key": "gotifyPriority", "label": "gotifyPriority", "hint": "优先级（数字）", "placeholder": "0"},
    ]},
    {"type": "ntfy", "name": "Ntfy", "fields": [
        {"key": "ntfyUrl", "label": "ntfyUrl", "hint": "ntfy 地址，默认 https://ntfy.sh"},
        {"key": "ntfyTopic", "label": "ntfyTopic", "hint": "topic", "required": True},
        {"key": "ntfyPriority", "label": "ntfyPriority", "hint": "优先级，默认 3"},
        {"key": "ntfyToken", "label": "ntfyToken", "hint": "token（可选）"},
        {"key": "ntfyUsername", "label": "ntfyUsername", "hint": "用户名（可选）"},
        {"key": "ntfyPassword", "label": "ntfyPassword", "hint": "密码（可选）"},
        {"key": "ntfyActions", "label": "ntfyActions", "hint": "Actions（可选）"},
    ]},
    {"type": "lark", "name": "飞书", "fields": [
        {"key": "larkKey", "label": "larkKey", "hint": "飞书群机器人 webhook 地址或 key", "required": True},
        {"key": "larkSecret", "label": "larkSecret", "hint": "加签密钥（可选）"},
    ]},
    {"type": "iGot", "name": "IGot", "fields": [
        {"key": "iGotPushKey", "label": "iGotPushKey", "hint": "iGot 推送 key", "required": True},
    ]},
    {"type": "pushMe", "name": "PushMe", "fields": [
        {"key": "pushMeKey", "label": "pushMeKey", "hint": "PushMe key", "required": True},
        {"key": "pushMeUrl", "label": "pushMeUrl", "hint": "自架地址（可选）", "placeholder": "https://push.i-i.me/"},
    ]},
    {"type": "chat", "name": "群晖 Chat", "fields": [
        {"key": "synologyChatUrl", "label": "synologyChatUrl", "hint": "Synology Chat 的 incoming webhook 地址", "required": True},
    ]},
    {"type": "wePlusBot", "name": "微加", "fields": [
        {"key": "wePlusBotToken", "label": "wePlusBotToken", "hint": "用户令牌", "required": True},
        {"key": "wePlusBotReceiver", "label": "wePlusBotReceiver", "hint": "消息接收人（可选）"},
        {"key": "wePlusBotVersion", "label": "wePlusBotVersion", "hint": "版本：pro / personal，默认 pro"},
    ]},
    {"type": "wxPusherBot", "name": "WxPusher", "fields": [
        {"key": "wxPusherBotAppToken", "label": "wxPusherBotAppToken", "hint": "appToken", "required": True},
        {"key": "wxPusherBotTopicIds", "label": "wxPusherBotTopicIds", "hint": "topicIds（分号分隔）"},
        {"key": "wxPusherBotUids", "label": "wxPusherBotUids", "hint": "uids（分号分隔）"},
    ]},
    {"type": "wxPusherSpt", "name": "WxPusher（SPT 极简推送）", "fields": [
        {"key": "wxPusherSptList", "label": "wxPusherSptList", "hint": "SPT（逗号分隔，最多 10 个）", "required": True},
    ]},
    {"type": "goCqHttpBot", "name": "GoCqHttpBot", "fields": [
        {"key": "goCqHttpBotUrl", "label": "goCqHttpBotUrl", "hint": "私聊 http://127.0.0.1/send_private_msg，群 http://127.0.0.1/send_group_msg", "required": True},
        {"key": "goCqHttpBotToken", "label": "goCqHttpBotToken", "hint": "访问密钥", "required": True},
        {"key": "goCqHttpBotQq", "label": "goCqHttpBotQq", "hint": "私聊填 user_id=QQ，群填 group_id=群号", "required": True},
    ]},
    {"type": "aibotk", "name": "智能微秘书", "fields": [
        {"key": "aibotkKey", "label": "aibotkKey", "hint": "apikey", "required": True},
        {"key": "aibotkType", "label": "aibotkType", "hint": "发送目标", "type": "select", "default": "room", "options": [{"value": "room", "label": "群聊"}, {"value": "contact", "label": "好友"}]},
        {"key": "aibotkName", "label": "aibotkName", "hint": "群名或好友昵称", "required": True},
    ]},
    {"type": "chronocat", "name": "Chronocat", "fields": [
        {"key": "chronocatURL", "label": "chronocatURL", "hint": "Chronocat 地址", "required": True},
        {"key": "chronocatQQ", "label": "chronocatQQ", "hint": "user_id=xxx 或 group_id=xxx，可多个", "required": True},
        {"key": "chronocatToken", "label": "chronocatToken", "hint": "token", "required": True},
    ]},
    {"type": "openiLink", "name": "OpeniLink", "fields": [
        {"key": "openiLinkAppToken", "label": "openiLinkAppToken", "hint": "app_token", "required": True},
        {"key": "openiLinkHubUrl", "label": "openiLinkHubUrl", "hint": "Hub 地址，默认 https://hub.openilink.com"},
        {"key": "openiLinkContextToken", "label": "openiLinkContextToken", "hint": "context_token（可选）"},
    ]},
]
NOTIFY_CHANNEL_MAP = {c["type"]: c for c in NOTIFY_CHANNELS}


USER_NOTIFY_EVENTS = {
    "plan_expiring": "实例到期提醒",
    "traffic_low": "流量即将用尽",
    "node_status": "节点状态变化",
}


def user_notify_config_get(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM user_notify_config WHERE user_id=?", (int(user_id),)).fetchone()
    if not row:
        return {"enabled": False, "type": "", "params": {}, "events": []}
    try:
        params = json.loads(row["params"] or "{}")
    except Exception:
        params = {}
    events = [e for e in str(row["events"] or "").split(",") if e in USER_NOTIFY_EVENTS]
    return {"enabled": bool(int(row["enabled"] or 0)), "type": str(row["type"] or ""),
            "params": params if isinstance(params, dict) else {}, "events": events}


def user_notify_send(conn: sqlite3.Connection, user_id: int, event: str, title: str, content: str, ref: str = "") -> bool:
    """按用户自己的配置推送；站内通知由调用方负责。同一天同一事件同一 ref 只发一次。"""
    cfg = user_notify_config_get(conn, user_id)
    if not cfg["enabled"] or event not in cfg["events"] or not cfg["type"]:
        return False
    if cfg["type"] not in _NOTIFY_SENDERS:
        return False
    day = local_day_str()
    dup = conn.execute("SELECT 1 FROM user_notify_log WHERE user_id=? AND event=? AND ref=? AND day=?",
                       (int(user_id), event, str(ref)[:64], day)).fetchone()
    if dup:
        return False
    try:
        ok, _msg = _NOTIFY_SENDERS[cfg["type"]](cfg["params"], title, content)
    except Exception:
        ok = False
    if ok:
        conn.execute("INSERT INTO user_notify_log(user_id, event, ref, day, created_at) VALUES(?,?,?,?,?)",
                     (int(user_id), event, str(ref)[:64], day, now()))
    return bool(ok)


def bncr_config(conn: sqlite3.Connection) -> dict[str, Any]:
    return {
        "enabled": setting_get(conn, "bncr_enabled", "0") == "1",
        "url": setting_get(conn, "bncr_url", "").strip(),
        "token": setting_get(conn, "bncr_token", "").strip(),
        "platform": setting_get(conn, "bncr_platform", "wecomLong").strip() or "wecomLong",
        "group_id": setting_get(conn, "bncr_group_id", "").strip(),
    }


def bncr_public(cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "enabled": bool(cfg.get("enabled")),
        "url": cfg.get("url", ""),
        "token": cfg.get("token", ""),
        "platform": cfg.get("platform", "wecomLong"),
        "group_id": cfg.get("group_id", ""),
    }


def bncr_push(msg: str, at_userids: list[str] | None = None) -> bool:
    """推送消息到 Bncr（企微群）。at_userids 为企微 userid 列表，会拼 <@userid>。"""
    try:
        with db() as conn:
            cfg = bncr_config(conn)
        if not cfg["enabled"] or not cfg["url"] or not cfg["group_id"]:
            return False
        at = [str(x).strip() for x in (at_userids or []) if str(x).strip()]
        body = {"token": cfg["token"], "platform": cfg["platform"], "groupId": cfg["group_id"], "msg": msg, "at": at}
        url = cfg["url"].rstrip("/") + "/push"
        req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=8) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def bncr_notify_text(title: str, lines: list[str], at_userids: list[str] | None = None) -> bool:
    at = [str(x).strip() for x in (at_userids or []) if str(x).strip()]
    parts = ["## " + title, ""] + [str(x) for x in lines]
    if at:
        parts.append("")
        parts.append(" ".join("<@" + u + ">" for u in at))
    msg = chr(10).join(parts)
    return bncr_push(msg, at)


def notify_config(conn: sqlite3.Connection) -> dict[str, Any]:
    raw = setting_get(conn, "notify_params", "")
    try:
        params = json.loads(raw) if raw else {}
    except Exception:
        params = {}
    if not isinstance(params, dict):
        params = {}
    return {
        "enabled": setting_get(conn, "notify_enabled", "0") == "1",
        "on_down": setting_get(conn, "notify_on_down", "1") == "1",
        "on_up": setting_get(conn, "notify_on_up", "1") == "1",
        "type": setting_get(conn, "notify_type", ""),
        "params": params,
        "cooldown_minutes": max(0, int(setting_get(conn, "notify_cooldown_minutes", "30") or "30")),
    }


def notify_public(cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "enabled": bool(cfg.get("enabled")),
        "on_down": bool(cfg.get("on_down")),
        "on_up": bool(cfg.get("on_up")),
        "type": cfg.get("type", ""),
        "params": cfg.get("params", {}),
        "cooldown_minutes": int(cfg.get("cooldown_minutes", 30)),
        "channels": NOTIFY_CHANNELS,
    }


def _beijing_now_text(epoch: float | None = None) -> str:
    """通知里的时间统一用北京时间（UTC+8），避免容器时区不同造成歧义。"""
    ts = time.time() if epoch is None else epoch
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts + 8 * 3600)) + "（北京时间）"


def _notify_request(url: str, method: str = "POST", data: bytes | None = None,
                    headers: dict[str, str] | None = None, timeout: int = 10,
                    proxy: str | None = None) -> tuple[int, str, Exception | None]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy})) if proxy else urllib.request.build_opener()
    try:
        with opener.open(req, timeout=timeout) as resp:
            return int(getattr(resp, "status", 200)), resp.read().decode("utf-8", "replace"), None
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        return int(e.code), raw, e
    except Exception as e:
        return 0, "", e


def _err_text(err: Exception) -> str:
    return f"{err.__class__.__name__}: {err}"


def _json_or_empty(raw: str) -> Any:
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _post_json(url: str, payload: Any, headers: dict[str, str] | None = None, proxy: str | None = None):
    h = {"Content-Type": "application/json", **(headers or {})}
    return _notify_request(url, "POST", json.dumps(payload, ensure_ascii=False).encode("utf-8"), h, proxy=proxy)


def _post_form(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, proxy: str | None = None):
    h = {"Content-Type": "application/x-www-form-urlencoded", **(headers or {})}
    return _notify_request(url, "POST", urllib.parse.urlencode(payload).encode("utf-8"), h, proxy=proxy)


def _send_bark(p, title, content):
    push = str(p.get("barkPush", "")).strip()
    if not push:
        return False, "缺少 barkPush"
    if not push.startswith("http"):
        push = f"https://api.day.app/{push}"
    body = {
        "title": title, "body": content,
        "icon": p.get("barkIcon", "") or "", "sound": p.get("barkSound", "") or "",
        "group": p.get("barkGroup", "") or "", "isArchive": p.get("barkArchive", "") or "",
        "level": p.get("barkLevel", "") or "", "url": p.get("barkUrl", "") or "",
    }
    status, raw, err = _post_json(push, body)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("code") == 200:
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_telegram(p, title, content):
    token = str(p.get("telegramBotToken", "")).strip()
    chat_id = str(p.get("telegramBotUserId", "")).strip()
    if not token or not chat_id:
        return False, "缺少 telegramBotToken 或 telegramBotUserId"
    host = str(p.get("telegramBotApiHost", "")).strip() or "https://api.telegram.org"
    url = f"{host.rstrip('/')}/bot{token}/sendMessage"
    proxy = None
    ph = str(p.get("telegramBotProxyHost", "")).strip()
    pp = str(p.get("telegramBotProxyPort", "")).strip()
    if ph and pp:
        auth = str(p.get("telegramBotProxyAuth", "")).strip()
        proxy = f"http://{auth + '@' if auth else ''}{ph}:{pp}"
    status, raw, err = _post_form(url, {"chat_id": chat_id, "text": f"{title}\n\n{content}", "disable_web_page_preview": "true"}, proxy=proxy)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("ok"):
        return True, "已发送"
    return False, (data.get("description") or raw[:200] or f"HTTP {status}")


def _send_dingtalk(p, title, content):
    token = str(p.get("dingtalkBotToken", "")).strip()
    if not token:
        return False, "缺少 dingtalkBotToken"
    secret = str(p.get("dingtalkBotSecret", "")).strip()
    qs = f"access_token={token}"
    if secret:
        ts = str(int(time.time() * 1000))
        digest = hmac.new(secret.encode("utf-8"), f"{ts}\n{secret}".encode("utf-8"), hashlib.sha256).digest()
        sign = urllib.parse.quote(base64.b64encode(digest).decode("utf-8"), safe="")
        qs += f"&timestamp={ts}&sign={sign}"
    url = f"https://oapi.dingtalk.com/robot/send?{qs}"
    status, raw, err = _post_json(url, {"msgtype": "text", "text": {"content": f" {title}\n\n{content}"}})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("errcode") == 0:
        return True, "已发送"
    return False, (data.get("errmsg") or raw[:200] or f"HTTP {status}")


def _send_weWorkBot(p, title, content):
    key = str(p.get("weWorkBotKey", "")).strip()
    if not key:
        return False, "缺少 weWorkBotKey"
    origin = str(p.get("weWorkOrigin", "")).strip() or "https://qyapi.weixin.qq.com"
    url = f"{origin.rstrip('/')}/cgi-bin/webhook/send?key={key}"
    status, raw, err = _post_json(url, {"msgtype": "text", "text": {"content": f" {title}\n\n{content}"}})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("errcode") == 0:
        return True, "已发送"
    return False, (data.get("errmsg") or raw[:200] or f"HTTP {status}")


def _send_weWorkApp(p, title, content):
    raw_key = str(p.get("weWorkAppKey", "")).strip()
    if not raw_key:
        return False, "缺少 weWorkAppKey"
    origin = str(p.get("weWorkOrigin", "")).strip() or "https://qyapi.weixin.qq.com"
    parts = [x.strip() for x in raw_key.split(",")]
    if len(parts) < 4:
        return False, "weWorkAppKey 至少需要 corpid,corpsecret,touser,agentid"
    corpid, corpsecret, touser, agentid = parts[0], parts[1], parts[2], parts[3]
    thumb = parts[4] if len(parts) > 4 and parts[4] else "1"
    status, raw, err = _post_json(f"{origin.rstrip('/')}/cgi-bin/gettoken", {"corpid": corpid, "corpsecret": corpsecret})
    if err and status == 0:
        return False, _err_text(err)
    tok = _json_or_empty(raw).get("access_token")
    if not tok:
        return False, f"获取 access_token 失败：{raw[:200]}"
    if thumb == "0":
        msg = {"msgtype": "textcard", "textcard": {"title": title, "description": content, "url": "https://github.com/whyour/qinglong", "btntxt": "更多"}}
    elif thumb == "1":
        msg = {"msgtype": "text", "text": {"content": f"{title}\n\n{content}"}}
    else:
        msg = {"msgtype": "mpnews", "mpnews": {"articles": [{"title": title, "thumb_media_id": thumb, "author": "智能助手", "content_source_url": "", "content": content.replace("\n", "<br/>"), "digest": content}]}}
    payload = {"touser": touser, "agentid": agentid, "safe": "0", **msg}
    status, raw, err = _post_json(f"{origin.rstrip('/')}/cgi-bin/message/send?access_token={tok}", payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("errcode") == 0:
        return True, "已发送"
    return False, (data.get("errmsg") or raw[:200] or f"HTTP {status}")


def _send_serverChan(p, title, content):
    key = str(p.get("serverChanKey", "")).strip()
    if not key:
        return False, "缺少 serverChanKey"
    m = re.match(r"^sctp(\d+)t", key, re.I)
    if m and m.group(1):
        url = f"https://{m.group(1)}.push.ft07.com/send/{key}.send"
    else:
        url = f"https://sctapi.ftqq.com/{key}.send"
    status, raw, err = _post_form(url, {"title": title, "desp": content})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("errno") == 0 or (isinstance(data.get("data"), dict) and data["data"].get("errno") == 0):
        return True, "已发送"
    return False, (data.get("message") or data.get("errmsg") or raw[:200] or f"HTTP {status}")


def _send_pushDeer(p, title, content):
    key = str(p.get("pushDeerKey", "")).strip()
    if not key:
        return False, "缺少 pushDeerKey"
    url = str(p.get("pushDeerUrl", "")).strip() or "https://api2.pushdeer.com/message/push"
    status, raw, err = _post_form(url, {"pushkey": key, "text": title, "desp": content, "type": "markdown"})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    result = ((data.get("content") or {}).get("result")) if isinstance(data.get("content"), dict) else None
    if isinstance(result, list) and len(result) > 0:
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_gotify(p, title, content):
    url_base = str(p.get("gotifyUrl", "")).strip().rstrip("/")
    token = str(p.get("gotifyToken", "")).strip()
    if not url_base or not token:
        return False, "缺少 gotifyUrl 或 gotifyToken"
    url = f"{url_base}/message?token={token}"
    priority = str(p.get("gotifyPriority", "") or "0")
    status, raw, err = _post_form(url, {"title": title, "message": content, "priority": priority})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if isinstance(data.get("id"), int):
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_ntfy(p, title, content):
    base = str(p.get("ntfyUrl", "")).strip() or "https://ntfy.sh"
    topic = str(p.get("ntfyTopic", "")).strip()
    if not topic:
        return False, "缺少 ntfyTopic"
    url = f"{base.rstrip('/')}/{topic}"
    headers = {
        "Title": "=?UTF-8?B?" + base64.b64encode(title.encode("utf-8")).decode("ascii") + "?=",
        "Priority": str(p.get("ntfyPriority", "") or "3"),
        "Icon": "https://qn.whyour.cn/logo.png",
    }
    tok = str(p.get("ntfyToken", "")).strip()
    uname = str(p.get("ntfyUsername", "")).strip()
    pwd = str(p.get("ntfyPassword", "")).strip()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    elif uname and pwd:
        headers["Authorization"] = "Basic " + base64.b64encode(f"{uname}:{pwd}".encode("utf-8")).decode("ascii")
    actions = str(p.get("ntfyActions", "")).strip()
    if actions:
        headers["Actions"] = "=?UTF-8?B?" + base64.b64encode(actions.encode("utf-8")).decode("ascii") + "?="
    status, raw, err = _notify_request(url, "POST", content.encode("utf-8"), headers)
    if err and status == 0:
        return False, _err_text(err)
    if status == 200:
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_lark(p, title, content):
    key = str(p.get("larkKey", "")).strip()
    if not key:
        return False, "缺少 larkKey"
    if not key.startswith("http"):
        key = f"https://open.feishu.cn/open-apis/bot/v2/hook/{key}"
    body: dict[str, Any] = {"msg_type": "text", "content": {"text": f"{title}\n\n{content}"}}
    secret = str(p.get("larkSecret", "")).strip()
    if secret:
        ts = str(int(time.time()))
        string_to_sign = f"{ts}\n{secret}"
        sign = base64.b64encode(hmac.new(string_to_sign.encode("utf-8"), b"", hashlib.sha256).digest()).decode("utf-8")
        body["timestamp"] = ts
        body["sign"] = sign
    status, raw, err = _post_json(key, body)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("StatusCode") == 0 or data.get("code") == 0:
        return True, "已发送"
    return False, (data.get("msg") or data.get("StatusMessage") or raw[:200] or f"HTTP {status}")


def _send_iGot(p, title, content):
    key = str(p.get("iGotPushKey", "")).strip()
    if not key:
        return False, "缺少 iGotPushKey"
    url = f"https://push.hellyw.com/{key.lower()}"
    status, raw, err = _post_form(url, {"title": title, "content": content})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("ret") == 0:
        return True, "已发送"
    return False, (data.get("message") or raw[:200] or f"HTTP {status}")


def _send_pushPlus(p, title, content):
    token = str(p.get("pushPlusToken", "")).strip()
    if not token:
        return False, "缺少 pushPlusToken"
    payload = {
        "token": token, "title": title,
        "content": re.sub(r"[\n\r]", "<br>", content),
        "topic": str(p.get("pushPlusUser", "") or ""),
        "template": str(p.get("pushPlusTemplate", "") or "html"),
        "channel": str(p.get("pushplusChannel", "") or "wechat"),
        "webhook": str(p.get("pushplusWebhook", "") or ""),
        "callbackUrl": str(p.get("pushplusCallbackUrl", "") or ""),
        "to": str(p.get("pushplusTo", "") or ""),
    }
    status, raw, err = _post_json("https://www.pushplus.plus/send", payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("code") == 200:
        return True, "已发送"
    return False, (data.get("msg") or raw[:200] or f"HTTP {status}")


def _send_wePlusBot(p, title, content):
    token = str(p.get("wePlusBotToken", "")).strip()
    if not token:
        return False, "缺少 wePlusBotToken"
    template = "txt"
    body_content = content
    if len(content) > 800:
        template = "html"
        body_content = re.sub(r"[\n\r]", "<br>", content)
    payload = {
        "token": token, "title": title, "template": template, "content": body_content,
        "receiver": str(p.get("wePlusBotReceiver", "") or ""),
        "version": str(p.get("wePlusBotVersion", "") or "pro"),
    }
    status, raw, err = _post_json("https://www.weplusbot.com/send", payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("code") == 200:
        return True, "已发送"
    return False, (data.get("msg") or raw[:200] or f"HTTP {status}")


def _send_wxPusherBot(p, title, content):
    token = str(p.get("wxPusherBotAppToken", "")).strip()
    if not token:
        return False, "缺少 wxPusherBotAppToken"
    topic_ids = [int(x) for x in [t.strip() for t in str(p.get("wxPusherBotTopicIds", "") or "").split(";")] if x.isdigit()]
    uids = [u.strip() for u in str(p.get("wxPusherBotUids", "") or "").split(";") if u.strip()]
    if not topic_ids and not uids:
        return False, "topicIds 与 uids 至少配置一个"
    payload = {
        "appToken": token,
        "content": f"<h1>{title}</h1><br/><div style='white-space: pre-wrap;'>{content}</div>",
        "summary": title, "contentType": 2, "topicIds": topic_ids, "uids": uids, "verifyPayType": 0,
    }
    status, raw, err = _post_json("https://wxpusher.zjiecode.com/api/send/message", payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("code") == 1000:
        return True, "已发送"
    return False, (data.get("msg") or raw[:200] or f"HTTP {status}")


def _send_wxPusherSpt(p, title, content):
    spts = [s.strip() for s in str(p.get("wxPusherSptList", "") or "").split(",") if s.strip()]
    if not spts:
        return False, "SPT 不能为空"
    if len(spts) > 10:
        return False, "SPT 最多支持 10 个"
    payload: dict[str, Any] = {
        "content": f"<h1>{title}</h1><br/><div style='white-space: pre-wrap;'>{content}</div>",
        "summary": title, "contentType": 2,
    }
    if len(spts) == 1:
        payload["spt"] = spts[0]
    else:
        payload["sptList"] = spts
    status, raw, err = _post_json("https://wxpusher.zjiecode.com/api/send/message/simple-push", payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("code") == 1000:
        return True, "已发送"
    return False, (data.get("msg") or raw[:200] or f"HTTP {status}")


def _send_goCqHttpBot(p, title, content):
    url = str(p.get("goCqHttpBotUrl", "")).strip()
    token = str(p.get("goCqHttpBotToken", "")).strip()
    qq = str(p.get("goCqHttpBotQq", "")).strip()
    if not url or not token or not qq:
        return False, "缺少 goCqHttpBotUrl / goCqHttpBotToken / goCqHttpBotQq"
    full = f"{url}?{qq}"
    status, raw, err = _post_json(full, {"message": f"{title}\n{content}"}, {"Authorization": f"Bearer {token}"})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("retcode") == 0:
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_chat(p, title, content):
    url = str(p.get("synologyChatUrl", "")).strip()
    if not url:
        return False, "缺少 synologyChatUrl"
    payload = {"payload": json.dumps({"text": f"{title}\n{content}"}, ensure_ascii=False)}
    status, raw, err = _post_form(url, payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("success"):
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_aibotk(p, title, content):
    key = str(p.get("aibotkKey", "")).strip()
    name = str(p.get("aibotkName", "")).strip()
    atype = str(p.get("aibotkType", "") or "room")
    if not key or not name:
        return False, "缺少 aibotkKey / aibotkName"
    if atype == "contact":
        url = "https://api-bot.aibotk.com/openapi/v1/chat/contact"
        payload = {"apiKey": key, "name": name, "message": {"type": 1, "content": f"【Frp 管理台】\n\n{title}\n{content}"}}
    else:
        url = "https://api-bot.aibotk.com/openapi/v1/chat/room"
        payload = {"apiKey": key, "roomName": name, "message": {"type": 1, "content": f"【Frp 管理台】\n\n{title}\n{content}"}}
    status, raw, err = _post_json(url, payload)
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("code") == 0:
        return True, "已发送"
    return False, (data.get("message") or raw[:200] or f"HTTP {status}")


def _send_pushMe(p, title, content):
    key = str(p.get("pushMeKey", "")).strip()
    if not key:
        return False, "缺少 pushMeKey"
    url = str(p.get("pushMeUrl", "")).strip() or "https://push.i-i.me/"
    status, raw, err = _post_json(url, {"push_key": key, "title": title, "content": content})
    if err and status == 0:
        return False, _err_text(err)
    if raw.strip() == "success":
        return True, "已发送"
    return False, (raw[:200] or f"HTTP {status}")


def _send_chronocat(p, title, content):
    base = str(p.get("chronocatURL", "")).strip()
    token = str(p.get("chronocatToken", "")).strip()
    qq = str(p.get("chronocatQQ", "") or "")
    if not base or not token:
        return False, "缺少 chronocatURL / chronocatToken"
    user_ids = re.findall(r"user_id=(\d+)", qq)
    group_ids = re.findall(r"group_id=(\d+)", qq)
    if not user_ids and not group_ids:
        return False, "chronocatQQ 需包含 user_id= 或 group_id="
    url = f"{base.rstrip('/')}/api/message/send"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    sent = False
    for chat_type, ids in ((1, user_ids), (2, group_ids)):
        for chat_id in ids:
            data = {"peer": {"chatType": chat_type, "peerUin": chat_id},
                    "elements": [{"elementType": 1, "textElement": {"content": f"{title}\n\n{content}"}}]}
            status, raw, err = _post_json(url, data, headers)
            if err and status == 0:
                return False, _err_text(err)
            if status == 200:
                sent = True
            else:
                return False, (raw[:200] or f"HTTP {status}")
    return (True, "已发送") if sent else (False, "未发送任何消息")


def _send_openiLink(p, title, content):
    token = str(p.get("openiLinkAppToken", "")).strip()
    if not token:
        return False, "缺少 openiLinkAppToken"
    base = str(p.get("openiLinkHubUrl", "")).strip().rstrip("/") or "https://hub.openilink.com"
    url = f"{base}/bot/v1/message/send"
    body: dict[str, Any] = {"type": "text", "content": f"{title}\n\n{content}"}
    ctx = str(p.get("openiLinkContextToken", "")).strip()
    if ctx:
        body["context_token"] = ctx
    status, raw, err = _post_json(url, body, {"Authorization": f"Bearer {token}"})
    if err and status == 0:
        return False, _err_text(err)
    data = _json_or_empty(raw)
    if data.get("ok"):
        return True, "已发送"
    return False, (data.get("message") or raw[:200] or f"HTTP {status}")


_NOTIFY_SENDERS = {
    "bark": _send_bark,
    "telegramBot": _send_telegram,
    "dingtalkBot": _send_dingtalk,
    "weWorkBot": _send_weWorkBot,
    "weWorkApp": _send_weWorkApp,
    "serverChan": _send_serverChan,
    "pushPlus": _send_pushPlus,
    "pushDeer": _send_pushDeer,
    "gotify": _send_gotify,
    "ntfy": _send_ntfy,
    "lark": _send_lark,
    "iGot": _send_iGot,
    "pushMe": _send_pushMe,
    "chat": _send_chat,
    "wePlusBot": _send_wePlusBot,
    "wxPusherBot": _send_wxPusherBot,
    "wxPusherSpt": _send_wxPusherSpt,
    "goCqHttpBot": _send_goCqHttpBot,
    "aibotk": _send_aibotk,
    "chronocat": _send_chronocat,
    "openiLink": _send_openiLink,
}


def send_notification(title: str, content: str, force: bool = False) -> dict[str, Any]:
    """按配置的通知渠道发送通知；返回结果。"""
    try:
        with db() as conn:
            cfg = notify_config(conn)
    except Exception as e:
        return {"ok": False, "error": f"读取通知配置失败：{e}", "results": []}
    if not cfg["enabled"] and not force:
        return {"ok": False, "error": "通知未启用", "results": []}
    ctype = str(cfg.get("type") or "").strip()
    if not ctype:
        return {"ok": False, "error": "未选择通知方式", "results": []}
    if ctype not in _NOTIFY_SENDERS:
        return {"ok": False, "error": f"不支持的通知方式：{ctype}", "results": []}
    ok, msg = _NOTIFY_SENDERS[ctype](cfg.get("params") or {}, title, content)
    return {"ok": ok, "results": [{"channel": ctype, "ok": ok, "message": msg}]}


# --- 面板版本更新检测（后台定时，默认每 8 小时一次）---
UPDATE_CHECK_HOURS = float(os.getenv("FML_UPDATE_CHECK_HOURS", "8") or "8")
PANEL_UPDATE_REPO = os.getenv("FML_UPDATE_REPO", "bohu-t/frp-manager-lite")
PANEL_UPDATE_TOKEN = os.getenv("FML_UPDATE_TOKEN", "")  # 私有仓库时需要（GitHub PAT）
PANEL_UPDATE_URL = os.getenv("FML_UPDATE_URL", "")  # 自定义纯文本版本地址（优先）
PANEL_VERSION_REPO = os.getenv("FML_UPDATE_VERSION_REPO", "bohu-t/lite-install")  # 公开仓库的 VERSION 文件
PANEL_UPDATE_LINK = os.getenv("FML_UPDATE_LINK", "https://github.com/bohu-t/lite-install#readme")
_update_check_started = False


def _version_tuple(value: str) -> tuple:
    out = []
    for part in str(value or "").strip().lstrip("vV").split(".")[:5]:
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out) if out else (0,)


def _normalize_version(raw: str) -> str:
    txt = str(raw or "").strip()
    if not txt:
        return ""
    txt = txt.splitlines()[0].strip()
    if txt.startswith("{"):
        try:
            txt = str(json.loads(txt).get("version") or "")
        except Exception:
            return ""
    if not txt:
        return ""
    return ".".join(str(x) for x in _version_tuple(txt))


def _github_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "frp-manager-lite"}
    if PANEL_UPDATE_TOKEN:
        headers["Authorization"] = f"Bearer {PANEL_UPDATE_TOKEN}"
    return headers


def _fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "frp-manager-lite"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return resp.read().decode("utf-8", "replace")


def _fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers=_github_headers())
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def fetch_latest_panel_version() -> str:
    """依次尝试：自定义地址 → GitHub Release → GitHub tag → 公开仓库 VERSION 文件。"""
    if PANEL_UPDATE_URL:
        try:
            v = _normalize_version(_fetch_text(PANEL_UPDATE_URL))
            if v:
                return v
        except Exception:
            pass
    base = f"https://api.github.com/repos/{PANEL_UPDATE_REPO}"
    try:
        v = _normalize_version(str((_fetch_json(f"{base}/releases/latest") or {}).get("tag_name") or ""))
        if v:
            return v
    except Exception:
        pass
    try:
        tags = _fetch_json(f"{base}/tags")
        best_key: tuple = ()
        best = ""
        if isinstance(tags, list):
            for item in tags:
                name = str((item or {}).get("name") or "").strip()
                key = _version_tuple(name)
                if key > best_key:
                    best_key, best = key, name
        v = _normalize_version(best)
        if v:
            return v
    except Exception:
        pass
    try:
        data = _fetch_json(f"https://api.github.com/repos/{PANEL_VERSION_REPO}/contents/VERSION")
        raw = str((data or {}).get("content") or "").replace("\n", "")
        if raw:
            v = _normalize_version(base64.b64decode(raw).decode("utf-8", "replace"))
            if v:
                return v
    except Exception:
        pass
    return ""


def refresh_update_check(force: bool = False) -> None:
    with db() as conn:
        try:
            last = float(setting_get(conn, "panel_update_checked_at", "0") or "0")
        except Exception:
            last = 0.0
        if not force and (time.time() - last) < UPDATE_CHECK_HOURS * 3600:
            return
        latest = fetch_latest_panel_version()
        setting_set(conn, "panel_update_checked_at", str(int(time.time())))
        if latest:
            setting_set(conn, "panel_latest_version", latest)


def panel_latest_version() -> str:
    try:
        with db() as conn:
            return setting_get(conn, "panel_latest_version", "")
    except Exception:
        return ""


def start_update_checker() -> None:
    global _update_check_started
    if _update_check_started:
        return
    _update_check_started = True

    def _loop() -> None:
        time.sleep(20)
        while True:
            try:
                refresh_update_check()
            except Exception:
                pass
            time.sleep(max(600, int(UPDATE_CHECK_HOURS * 3600 / 4)))

    threading.Thread(target=_loop, name="panel-update-checker", daemon=True).start()


# --- 软件授权静默心跳（定期向鉴权服务器校验，支持停用/解绑/过期下发）---
LICENSE_CHECK_HOURS = float(os.getenv("FML_LICENSE_CHECK_HOURS", "12") or "12")
LICENSE_GRACE_DAYS = float(os.getenv("FML_LICENSE_GRACE_DAYS", "7") or "7")
_license_heartbeat_started = False


def verify_license_remote(license_key: str, machine_id: str) -> dict[str, Any]:
    url = SOFTWARE_LICENSE_SERVER_URL.rstrip("/") + "/api/license/verify"
    body = json.dumps({"license_key": license_key, "machine_id": machine_id, "app": APP_NAME}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def refresh_license_check(force: bool = False) -> None:
    if not SOFTWARE_LICENSE_REQUIRED:
        return
    payload = load_software_license_file()
    if not payload:
        return
    license_key = str(payload.get("license_key") or "")
    machine_id = str(payload.get("machine_id") or "")
    if not license_key or not machine_id or not SOFTWARE_LICENSE_SERVER_URL:
        return
    with db() as conn:
        try:
            last = float(setting_get(conn, "license_last_check_at", "0") or "0")
        except Exception:
            last = 0.0
    if not force and (time.time() - last) < LICENSE_CHECK_HOURS * 3600:
        return
    ok: bool | None = None
    msg = ""
    lic = None
    try:
        data = verify_license_remote(license_key, machine_id)
        ok = bool(data.get("ok"))
        msg = str(data.get("error") or "")
        lic = data.get("license")
    except urllib.error.HTTPError as e:
        if e.code == 400:
            # 鉴权服务器明确判定无效（停用/解绑/过期/不存在）
            ok = False
            try:
                msg = str(json.loads(e.read().decode("utf-8", "replace")).get("error") or "")
            except Exception:
                msg = "授权校验失败"
        else:
            # 接口未上线(403/404)/服务异常(5xx) → 无法判定，不误判失效
            ok = None
            msg = f"授权服务器异常（HTTP {e.code}）"
    except Exception as e:
        ok = None
        msg = f"无法连接授权服务器：{e.__class__.__name__}"
    with db() as conn:
        setting_set(conn, "license_last_check_at", str(int(time.time())))
        if ok is True:
            setting_set(conn, "license_revoked", "0")
            setting_set(conn, "license_revoked_reason", "")
            setting_set(conn, "license_last_ok_at", str(int(time.time())))
            if isinstance(lic, dict) and lic.get("signature"):
                save_software_license_file({**payload, **lic, "last_check_at": int(time.time())})
        elif ok is False:
            setting_set(conn, "license_revoked", "1")
            setting_set(conn, "license_revoked_reason", msg or "软件授权已失效，请联系卖家")
        else:
            last_ok = float(setting_get(conn, "license_last_ok_at", "0") or "0")
            if last_ok and (time.time() - last_ok) > LICENSE_GRACE_DAYS * 86400:
                setting_set(conn, "license_revoked", "1")
                setting_set(conn, "license_revoked_reason", f"已超过 {LICENSE_GRACE_DAYS:g} 天无法连接授权服务器，请检查网络或联系卖家")


def start_license_heartbeat() -> None:
    global _license_heartbeat_started
    if _license_heartbeat_started:
        return
    _license_heartbeat_started = True

    def _loop() -> None:
        time.sleep(30)
        while True:
            try:
                refresh_license_check()
            except Exception:
                pass
            time.sleep(max(600, int(LICENSE_CHECK_HOURS * 3600 / 4)))

    threading.Thread(target=_loop, name="license-heartbeat", daemon=True).start()


def create_email_code(username: str, email: str) -> str:
    code = f"{secrets.randbelow(1000000):06d}"
    with db() as conn:
        conn.execute("DELETE FROM email_codes WHERE username=? OR expires_at<=?", (username, now()))
        conn.execute("INSERT INTO email_codes(username, email, code, expires_at, attempts, used, created_at) VALUES(?,?,?,?,0,0,?)",
                     (username, email, code, now() + 600, now()))
    return code


def verify_email_code(username: str, code: str) -> tuple[bool, str]:
    code = str(code or "").strip()
    with db() as conn:
        row = conn.execute("SELECT * FROM email_codes WHERE username=? ORDER BY id DESC LIMIT 1", (username,)).fetchone()
        if not row:
            return False, "请先获取验证码"
        if int(row["used"]):
            return False, "验证码已使用，请重新获取"
        if int(row["expires_at"]) <= now():
            return False, "验证码已过期，请重新获取"
        if int(row["attempts"]) >= 5:
            return False, "验证码尝试次数过多，请重新获取"
        if not hmac.compare_digest(str(row["code"]), code):
            conn.execute("UPDATE email_codes SET attempts=attempts+1 WHERE id=?", (row["id"],))
            return False, "验证码错误"
        conn.execute("UPDATE email_codes SET used=1 WHERE id=?", (row["id"],))
    return True, "ok"


def verify_registration_code(username: str, email: str, code: str) -> tuple[bool, str]:
    """校验注册邮箱验证码：必须与发送时的邮箱一致。"""
    email = str(email or "").strip().lower()
    with db() as conn:
        row = conn.execute("SELECT email FROM email_codes WHERE username=? ORDER BY id DESC LIMIT 1", (username,)).fetchone()
    if not row or str(row["email"] or "").strip().lower() != email:
        return False, "请先获取邮箱验证码"
    return verify_email_code(username, code)


def reset_password_by_code(username: str, code: str, new_password: str) -> tuple[bool, str]:
    username = str(username or "").strip()
    if not username:
        return False, "请输入用户名"
    if len(new_password) < 6:
        return False, "新密码至少 6 位"
    ok, msg = verify_email_code(username, code)
    if not ok:
        return False, msg
    with db() as conn:
        urow = conn.execute("SELECT id FROM users WHERE username=? AND role!='admin'", (username,)).fetchone()
        if not urow:
            return False, "用户不存在或不允许重置管理员密码"
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(new_password), urow["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (urow["id"],))
    audit("password_reset", None, None, None, "", f"用户 {username} 通过邮箱验证码修改密码")
    return True, "密码已重置，请用新密码登录"


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
    """账号不再有有效期限制（保留函数以兼容旧调用）。"""
    return False


def make_license_key() -> str:
    return "LIC-" + secrets.token_urlsafe(24).replace("-", "").replace("_", "")[:32].upper()


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


def public_software_license(record: sqlite3.Row | dict[str, Any] | None) -> dict[str, Any]:
    fingerprint = software_machine_fingerprint()
    configured = bool(SOFTWARE_LICENSE_SERVER_URL or SOFTWARE_LICENSE_SECRET or SOFTWARE_LICENSE_AUTHORITY)
    if not record:
        return {"configured": configured, "required": SOFTWARE_LICENSE_REQUIRED, "active": not SOFTWARE_LICENSE_REQUIRED, "licensed": False, "machine_id": fingerprint, "license_file": str(SOFTWARE_LICENSE_FILE), "message": "未激活软件授权" if SOFTWARE_LICENSE_REQUIRED else "未启用软件授权"}
    expires_at = int(record_val(record, "expires_at", 0) or 0)
    bound_machine_id = str(record_val(record, "machine_id", ""))
    payload = {
        "license_key": str(record_val(record, "license_key", "")),
        "machine_id": bound_machine_id,
        "plan": str(record_val(record, "plan", "deploy")),
        "expires_at": expires_at,
        "signature": str(record_val(record, "signature", "")),
    }
    valid_sig = verify_signed_license(payload)
    bound_ok = bound_machine_id == fingerprint
    active = bool(record_val(record, "active", 1)) and valid_sig and bound_ok and not (expires_at and expires_at <= now())
    return {
        "configured": configured,
        "required": SOFTWARE_LICENSE_REQUIRED,
        "active": active or not SOFTWARE_LICENSE_REQUIRED,
        "licensed": active,
        "license_key": payload["license_key"],
        "machine_id": fingerprint,
        "bound_machine_id": bound_machine_id,
        "plan": payload["plan"],
        "expires_at": expires_at,
        "expires_text": fmt_time(expires_at),
        "valid_signature": valid_sig,
        "bound_ok": bound_ok,
        "license_file": str(SOFTWARE_LICENSE_FILE),
        "message": "软件授权有效" if active else ("软件授权签名无效" if not valid_sig else "软件授权机器不匹配" if not bound_ok else "软件授权已停用或过期"),
    }


def load_software_license_file() -> dict[str, Any] | None:
    try:
        if not SOFTWARE_LICENSE_FILE.is_file():
            return None
        payload = json.loads(SOFTWARE_LICENSE_FILE.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


def save_software_license_file(payload: dict[str, Any]) -> None:
    SOFTWARE_LICENSE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SOFTWARE_LICENSE_FILE.with_suffix(SOFTWARE_LICENSE_FILE.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except Exception:
        pass
    tmp.replace(SOFTWARE_LICENSE_FILE)


def current_software_license(conn: sqlite3.Connection) -> dict[str, Any]:
    file_payload = load_software_license_file()
    if file_payload:
        status = public_software_license(file_payload)
    else:
        row = conn.execute("SELECT * FROM software_license ORDER BY id DESC LIMIT 1").fetchone()
        status = public_software_license(row)
        if row and status.get("licensed"):
            save_software_license_file({
                "app": APP_NAME,
                "license_key": row["license_key"],
                "machine_id": row["machine_id"],
                "server_url": row["server_url"] if "server_url" in row.keys() else "",
                "plan": row["plan"],
                "expires_at": int(row["expires_at"] or 0),
                "active": int(row["active"]),
                "signature": row["signature"],
                "activated_at": int(row["activated_at"] or now()),
                "last_check_at": int(row["last_check_at"] or now()),
                "created_at": int(row["created_at"] or now()),
            })
    # 卖家后台停用/解绑/过期 → 静默心跳置位，面板立即失效
    if setting_get(conn, "license_revoked", "0") == "1":
        status = dict(status)
        status["active"] = False
        status["licensed"] = False
        status["revoked"] = True
        status["message"] = setting_get(conn, "license_revoked_reason", "") or "软件授权已失效，请联系卖家"
    return status


def software_license_ok() -> bool:
    if not SOFTWARE_LICENSE_REQUIRED:
        return True
    try:
        with db() as conn:
            return bool(current_software_license(conn).get("active"))
    except Exception:
        return False


def public_user(user: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "token": user["token"],
        "invite_key_used": row_val(user, "invite_key_used"),
        "email": row_val(user, "email", "") or "",
        "max_ports": user["max_ports"],
        "points": q2(row_val(user, "points", 0)),
        "traffic_limit_bytes": int(row_val(user, "traffic_limit_bytes", 0) or 0),
        "active": bool(user["active"]),
        "expires_at": user["expires_at"],
        "expires_text": fmt_time(user["expires_at"]),
        "expired": is_expired(user),
        "created_at": user["created_at"],
        "node_id": user["node_id"] if "node_id" in user.keys() else None,
    }


def insert_user_record(conn: sqlite3.Connection, username: str, password_hash_value: str, role: str, token: str, max_ports: int, expires_at: int, node_id: int | None, invite_key_used: str = "", traffic_limit_bytes: int = 0, bandwidth_limit_kbps: int = 0, email: str = "") -> sqlite3.Cursor:
    """Insert a user without any user-facing license binding.

    Older deployments may still have legacy users.license_key/machine_id columns with
    NOT NULL/UNIQUE constraints. Fill only those legacy columns internally so old DBs
    keep working; new installs do not create or expose user authorization codes.
    """
    table_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    cols = ["username", "password_hash", "role", "token", "max_ports", "expires_at", "node_id", "created_at"]
    vals: list[Any] = [username, password_hash_value, role, token, max_ports, expires_at, node_id, now()]
    if "traffic_limit_bytes" in table_cols:
        cols.insert(-1, "traffic_limit_bytes")
        vals.insert(-1, int(traffic_limit_bytes or 0))
    if "bandwidth_limit_kbps" in table_cols:
        cols.insert(-1, "bandwidth_limit_kbps")
        vals.insert(-1, int(bandwidth_limit_kbps or 0))
    if "email" in table_cols:
        cols.insert(-1, "email")
        vals.insert(-1, str(email or ""))
    if "invite_key_used" in table_cols:
        cols.insert(4, "invite_key_used")
        vals.insert(4, invite_key_used)
    if "license_key" in table_cols:
        cols.insert(4, "license_key")
        vals.insert(4, make_license_key())
    placeholders = ",".join(["?"] * len(cols))
    return conn.execute(f"INSERT INTO users({','.join(cols)}) VALUES({placeholders})", vals)


def node_dashboard_url(row: sqlite3.Row | dict[str, Any] | None) -> str:
    if not row:
        return ""
    url = str(row_val(row, "dashboard_url", "") or "").strip().rstrip("/")
    if url:
        return url
    web_port = int(row_val(row, "web_port", 0) or 0)
    if web_port > 0:
        host = split_node_host(str(row_val(row, "server_addr", "") or ""))
        if host:
            return f"http://{host}:{web_port}"
    return ""


def node_dashboard_auth(row: sqlite3.Row | dict[str, Any] | None) -> tuple[str, str]:
    user = str(row_val(row, "dashboard_user", "") or "") if row else ""
    password = str(row_val(row, "dashboard_password", "") or "") if row else ""
    if not user and not password:
        user, password = FRPS_DASHBOARD_USER, FRPS_DASHBOARD_PASSWORD
    return user, password


def node_month_traffic(conn: sqlite3.Connection, node_id: int) -> int:
    """统计某节点本自然月流量（按当前绑定该节点的用户汇总）。"""
    month = time.strftime("%Y-%m", time.localtime())
    row = conn.execute(
        "SELECT COALESCE(SUM(bytes),0) FROM traffic_samples WHERE node_id=? AND day LIKE ?",
        (node_id, month + "%")).fetchone()
    return int(row[0] or 0) if row else 0


def node_traffic_exceeded(conn: sqlite3.Connection, node_id: int) -> bool:
    row = conn.execute("SELECT monthly_traffic_bytes FROM nodes WHERE id=?", (node_id,)).fetchone()
    limit = int(row["monthly_traffic_bytes"] or 0) if row else 0
    if limit <= 0:
        return False
    return node_month_traffic(conn, node_id) >= limit


def node_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "region": row["region"],
        "name": row["name"],
        "server_addr": row["server_addr"],
        "server_port": row["server_port"],
        "frps_version": row_val(row, "frps_version", "") or "",
        "bandwidth_mbps": int(row_val(row, "bandwidth_mbps", 0) or 0),
        "monthly_traffic_bytes": int(row_val(row, "monthly_traffic_bytes", 0) or 0),
        "monthly_traffic_gb": round(int(row_val(row, "monthly_traffic_bytes", 0) or 0) / 1024 / 1024 / 1024, 2),
        "auth_token": row["auth_token"],
        "port_start": row["port_start"],
        "port_end": row["port_end"],
        "web_port": int(row_val(row, "web_port", 0) or 0),
        "dashboard_url": row_val(row, "dashboard_url", "") or "",
        "dashboard_user": row_val(row, "dashboard_user", "") or "",
        "dashboard_configured": bool(node_dashboard_url(row)),
        "active": bool(row["active"]),
        "note": row["note"],
        "created_at": row["created_at"],
    }


def ensure_default_node(conn: sqlite3.Connection) -> int | None:
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
    if "web_port" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN web_port INTEGER NOT NULL DEFAULT 0")
    if "dashboard_url" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN dashboard_url TEXT NOT NULL DEFAULT ''")
    if "dashboard_user" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN dashboard_user TEXT NOT NULL DEFAULT ''")
    if "dashboard_password" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN dashboard_password TEXT NOT NULL DEFAULT ''")
    if "monthly_traffic_bytes" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN monthly_traffic_bytes INTEGER NOT NULL DEFAULT 0")
    if "plan_name" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN plan_name TEXT NOT NULL DEFAULT ''")
    if "price_per_gb" not in cols:
        conn.execute("ALTER TABLE nodes ADD COLUMN price_per_gb REAL NOT NULL DEFAULT 0")
    # Do not provision a node automatically. Existing nodes are left untouched;
    # a fresh installation starts empty and the administrator creates nodes in UI.
    row = conn.execute("SELECT id FROM nodes ORDER BY id LIMIT 1").fetchone()
    return int(row["id"]) if row else None


def migrate_region_nodes(conn: sqlite3.Connection, default_node_id: int | None) -> None:
    user_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "node_id" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL")
        if default_node_id is not None:
            conn.execute("UPDATE users SET node_id=? WHERE node_id IS NULL", (default_node_id,))
    if "invite_key_used" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN invite_key_used TEXT NOT NULL DEFAULT ''")
    if "email" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''")
    if "traffic_limit_bytes" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN traffic_limit_bytes INTEGER NOT NULL DEFAULT 0")
    if "announcement_seen_at" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN announcement_seen_at INTEGER NOT NULL DEFAULT 0")
        conn.execute("UPDATE users SET announcement_seen_at=?", (now(),))
    if "bandwidth_limit_kbps" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0")

    invite_cols = {r["name"] for r in conn.execute("PRAGMA table_info(invite_keys)").fetchall()}
    if "traffic_limit_bytes" not in invite_cols:
        conn.execute("ALTER TABLE invite_keys ADD COLUMN traffic_limit_bytes INTEGER NOT NULL DEFAULT 0")
    if "bandwidth_limit_kbps" not in invite_cols:
        conn.execute("ALTER TABLE invite_keys ADD COLUMN bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0")
    if "kind" not in invite_cols:
        conn.execute("ALTER TABLE invite_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'register'")

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
                last_proxy_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, name)
            );
            """
        )
        old_tunnel_cols = {r["name"] for r in conn.execute("PRAGMA table_info(tunnels_old)").fetchall()}
        last_proxy_expr = "COALESCE(last_proxy_at, 0)" if "last_proxy_at" in old_tunnel_cols else "0"
        conn.execute(f"INSERT OR IGNORE INTO tunnels(node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at, last_proxy_at) SELECT ?, user_id, name, proxy_type, local_ip, local_port, remote_port, '', '', enabled, created_at, {last_proxy_expr} FROM tunnels_old", (default_node_id,))
        conn.execute("DROP TABLE tunnels_old")
    else:
        if "custom_domains" not in tunnel_cols:
            conn.execute("ALTER TABLE tunnels ADD COLUMN custom_domains TEXT NOT NULL DEFAULT ''")
        if "secret_key" not in tunnel_cols:
            conn.execute("ALTER TABLE tunnels ADD COLUMN secret_key TEXT NOT NULL DEFAULT ''")
        if "last_proxy_at" not in tunnel_cols:
            conn.execute("ALTER TABLE tunnels ADD COLUMN last_proxy_at INTEGER NOT NULL DEFAULT 0")
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
                    last_proxy_at INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(user_id, name)
                );
                """
            )
            old_tunnel_cols = {r["name"] for r in conn.execute("PRAGMA table_info(tunnels_old)").fetchall()}
            last_proxy_expr = "COALESCE(last_proxy_at, 0)" if "last_proxy_at" in old_tunnel_cols else "0"
            conn.execute(f"INSERT OR IGNORE INTO tunnels(id, node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at, last_proxy_at) SELECT id, node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at, {last_proxy_expr} FROM tunnels_old")
            conn.execute("DROP TABLE tunnels_old")
    tunnel_cols2 = {r["name"] for r in conn.execute("PRAGMA table_info(tunnels)").fetchall()}
    if "plan_id" not in tunnel_cols2:
        conn.execute("ALTER TABLE tunnels ADD COLUMN plan_id INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        """UPDATE tunnels SET plan_id=COALESCE((SELECT upp.user_plan_id FROM user_plan_ports upp
           WHERE upp.user_id=tunnels.user_id AND upp.node_id=tunnels.node_id AND upp.port=tunnels.remote_port LIMIT 1), 0)
           WHERE plan_id=0 AND remote_port>0"""
    )
    schema = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='tunnels'").fetchone()["sql"] or ""
    if "UNIQUE(user_id, name)" in schema:
        # frp 的代理名在同一个 frps（节点）内全局唯一，改为按节点去重
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
                last_proxy_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(node_id, name)
            );
            """
        )
        conn.execute("INSERT OR IGNORE INTO tunnels(id, node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at, last_proxy_at) SELECT id, node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, enabled, created_at, COALESCE(last_proxy_at, 0) FROM tunnels_old")
        conn.execute("DROP TABLE tunnels_old")
    conn.execute("DROP INDEX IF EXISTS idx_tunnels_node_port")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tunnels_node_port_remote ON tunnels(node_id, remote_port) WHERE remote_port > 0")


def attach_node_month_usage(conn: sqlite3.Connection, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for n in nodes:
        used = node_month_traffic(conn, int(n["id"]))
        limit = int(n.get("monthly_traffic_bytes") or 0)
        n["month_used_bytes"] = used
        n["month_used_gb"] = round(used / 1024 / 1024 / 1024, 2)
        n["traffic_exceeded"] = bool(limit > 0 and used >= limit)
    return nodes


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
    return attach_node_month_usage(conn, result)


def split_node_host(server_addr: str) -> str:
    server_addr = str(server_addr or "").strip()
    if not server_addr:
        return ""
    if "://" in server_addr:
        parsed = urlparse(server_addr)
        return parsed.hostname or ""
    # Plain IPv4/domain or host:port. Keep IPv6 literals usable when not bracketed.
    if server_addr.count(":") == 1:
        return server_addr.rsplit(":", 1)[0]
    return server_addr.strip("[]")


def read_proc_meminfo() -> dict[str, int]:
    info: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, rest = line.split(":", 1)
            value = int(rest.strip().split()[0]) * 1024
            info[key] = value
    except Exception:
        pass
    return info


def read_cpu_times() -> tuple[int, int] | None:
    try:
        parts = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
        nums = [int(x) for x in parts]
        idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
        total = sum(nums)
        return idle, total
    except Exception:
        return None


def host_system_stats() -> dict[str, Any]:
    cpu_count = os.cpu_count() or 0
    load1 = load5 = load15 = 0.0
    try:
        load1, load5, load15 = os.getloadavg()
    except Exception:
        pass
    cpu_percent = None
    first = read_cpu_times()
    if first:
        time.sleep(0.05)
        second = read_cpu_times()
        if second:
            idle_delta = second[0] - first[0]
            total_delta = second[1] - first[1]
            if total_delta > 0:
                cpu_percent = round(max(0.0, min(100.0, (1 - idle_delta / total_delta) * 100)), 1)
    mem = read_proc_meminfo()
    mem_total = int(mem.get("MemTotal", 0))
    mem_available = int(mem.get("MemAvailable", 0))
    mem_used = max(0, mem_total - mem_available) if mem_total else 0
    mem_percent = round((mem_used / mem_total) * 100, 1) if mem_total else None
    return {
        "cpu_count": cpu_count,
        "cpu_percent": cpu_percent,
        "load1": round(load1, 2),
        "load5": round(load5, 2),
        "load15": round(load15, 2),
        "memory_total": mem_total,
        "memory_used": mem_used,
        "memory_available": mem_available,
        "memory_percent": mem_percent,
    }


def check_node_auth_port(node: dict[str, Any]) -> dict[str, Any]:
    """Check whether the frps auth/bind port accepts TCP connections."""
    checked_at = now()
    if not node.get("active"):
        return {"auth_status": "disabled", "auth_port_ok": False, "auth_checked_at": checked_at, "auth_message": "节点已停用"}
    host = split_node_host(str(node.get("server_addr", "")))
    port = int(node.get("server_port") or 0)
    if not host or not (1 <= port <= 65535):
        return {"auth_status": "offline", "auth_port_ok": False, "auth_checked_at": checked_at, "auth_message": "节点地址或认证端口无效"}
    start = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=NODE_CHECK_TIMEOUT):
            latency_ms = int((time.monotonic() - start) * 1000)
            return {"auth_status": "online", "auth_port_ok": True, "auth_checked_at": checked_at, "auth_latency_ms": latency_ms, "auth_message": f"认证端口正常（{latency_ms}ms）"}
    except Exception as e:
        return {"auth_status": "offline", "auth_port_ok": False, "auth_checked_at": checked_at, "auth_message": f"认证端口不可达：{e.__class__.__name__}"}


def attach_node_auth_port_status(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not nodes:
        return nodes
    pending: list[dict[str, Any]] = []
    for n in nodes:
        cached = node_health_lookup(n)
        if cached is not None:
            n.update(cached)
        else:
            pending.append(n)
    return probe_node_auth_ports(pending) if pending else nodes


# --- 节点健康快照：后台定时探测各节点 auth/bind 端口，页面读缓存（不再每次实时探测）---
NODE_HEALTH_SAMPLE_SECONDS = int(os.getenv("FML_NODE_HEALTH_SAMPLE_SECONDS", "600") or "600")
_node_health_lock = threading.Lock()
_node_health_cache: dict[str, dict[str, Any]] = {}
_node_health_ts = 0.0
_node_health_sampler_started = False
_node_prev_status: dict[str, str] = {}
_node_notify_last: dict[str, float] = {}


def _node_health_key(node: dict[str, Any]) -> str:
    return f"{node.get('server_addr', '')}:{node.get('server_port', '')}"


def probe_node_auth_ports(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not nodes:
        return nodes
    max_workers = max(1, min(NODE_CHECK_MAX_WORKERS, len(nodes)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(check_node_auth_port, n): n for n in nodes}
        for fut in as_completed(futures):
            futures[fut].update(fut.result())
    return nodes


def node_health_lookup(node: dict[str, Any]) -> dict[str, Any] | None:
    with _node_health_lock:
        ts = _node_health_ts
        cached = _node_health_cache.get(_node_health_key(node))
    if not cached:
        return None
    if ts and (time.time() - ts) > max(300, NODE_HEALTH_SAMPLE_SECONDS * 3):
        return None
    return dict(cached)


def apply_node_offline_policy(rows: list[dict[str, Any]]) -> None:
    """节点长时间离线自动停售；恢复在线后自动重新上架（不触发退款）。"""
    if NODE_OFFLINE_SUSPEND_HOURS <= 0:
        return
    threshold = int(NODE_OFFLINE_SUSPEND_HOURS * 3600)
    ts = now()
    with db() as conn:
        for n in rows:
            try:
                nid = int(n.get("id") or 0)
            except (TypeError, ValueError):
                continue
            if not nid:
                continue
            row = conn.execute("SELECT active, auto_suspended, last_online_at FROM nodes WHERE id=?", (nid,)).fetchone()
            if not row:
                continue
            online = n.get("auth_status") == "online"
            if online:
                conn.execute("UPDATE nodes SET last_online_at=? WHERE id=?", (ts, nid))
                if int(row["auto_suspended"] or 0):
                    conn.execute("UPDATE nodes SET active=1, auto_suspended=0 WHERE id=?", (nid,))
                    audit("node_auto_resume", None, nid, None, "", "节点恢复在线，自动重新上架")
                    for up in conn.execute("SELECT DISTINCT user_id FROM user_plans WHERE node_id=? AND status='active'", (nid,)).fetchall():
                        uid = int(up["user_id"])
                        notify_user(conn, uid, "node_status", "节点已恢复",
                                    f"实例所在节点「{n.get('name') or nid}」已恢复在线，服务正常。", "tunnels")
                        user_notify_send(conn, uid, "node_status", "节点已恢复",
                                         f"实例所在节点「{n.get('name') or nid}」已恢复在线。", ref=f"node{nid}:up")
            else:
                last = int(row["last_online_at"] or 0)
                if int(row["active"] or 0) and not int(row["auto_suspended"] or 0) and last and (ts - last) >= threshold:
                    conn.execute("UPDATE nodes SET active=0, auto_suspended=1 WHERE id=?", (nid,))
                    audit("node_auto_suspend", None, nid, None, "", f"离线超过 {NODE_OFFLINE_SUSPEND_HOURS:g} 小时，自动停售")
                    owner = conn.execute("""SELECT u.username, u.wecom_userid FROM nodes n JOIN users u ON u.id=n.owner_id WHERE n.id=?""", (nid,)).fetchone()
                    for up in conn.execute("SELECT DISTINCT user_id FROM user_plans WHERE node_id=? AND status='active'", (nid,)).fetchall():
                        uid = int(up["user_id"])
                        notify_user(conn, uid, "node_status", "节点已停售",
                                    f"实例所在节点「{n.get('name') or nid}」因离线被自动停售，已购实例暂不受影响，我们会尽快恢复。", "tunnels")
                        user_notify_send(conn, uid, "node_status", "节点已停售",
                                         f"实例所在节点「{n.get('name') or nid}」因离线被自动停售。", ref=f"node{nid}:down")
                    if owner:
                        bncr_notify_text(
                            "节点离线告警",
                            [f"节点「{n.get('name') or nid}」已离线超过 {NODE_OFFLINE_SUSPEND_HOURS:g} 小时，已自动停售。",
                             "请尽快登录面板检查母鸡状态，恢复后平台会自动重新上架。"],
                            [str(owner["wecom_userid"] or "")])


def refresh_node_health_snapshot() -> None:
    global _node_health_ts
    with db() as conn:
        rows = [node_public(r) for r in conn.execute("SELECT * FROM nodes ORDER BY id")]
    if rows:
        probe_node_auth_ports(rows)
    try:
        apply_node_offline_policy(rows)
    except Exception:
        pass
    cache: dict[str, dict[str, Any]] = {}
    for n in rows:
        cache[_node_health_key(n)] = {k: n.get(k) for k in ("auth_status", "auth_port_ok", "auth_checked_at", "auth_latency_ms", "auth_message")}
    with _node_health_lock:
        _node_health_cache.clear()
        _node_health_cache.update(cache)
        _node_health_ts = time.time()
    try:
        _notify_node_status_changes(rows)
    except Exception:
        pass


def _notify_node_status_changes(rows: list[dict[str, Any]]) -> None:
    """对比上次快照：节点在线↔离线时按配置发送通知（带冷却）。"""
    try:
        with db() as conn:
            cfg = notify_config(conn)
    except Exception:
        return
    now_ts = time.time()
    cooldown = max(0, int(cfg.get("cooldown_minutes", 30))) * 60
    ts_text = _beijing_now_text(now_ts)
    pending: list[tuple[str, str]] = []
    for n in rows:
        key = _node_health_key(n)
        if not n.get("active"):
            _node_prev_status.pop(key, None)
            continue
        current = "online" if n.get("auth_status") == "online" else "offline"
        prev = _node_prev_status.get(key)
        _node_prev_status[key] = current
        if prev is None or prev == current:
            continue
        if not cfg.get("enabled"):
            continue
        label = f"{n.get('region', '')} / {n.get('name', '')}".strip(" /")
        addr = f"{n.get('server_addr', '')}:{n.get('server_port', '')}"
        if prev == "online" and current == "offline":
            if not cfg.get("on_down"):
                continue
            title = f"【节点异常】{label} 离线"
            content = (
                f"节点 {label} 认证端口不可达，判定为离线。\n"
                f"地址：{addr}\n"
                f"原因：{n.get('auth_message', '')}\n"
                f"检测时间：{ts_text}"
            )
        elif prev == "offline" and current == "online":
            if not cfg.get("on_up"):
                continue
            title = f"【节点恢复】{label} 已恢复"
            content = (
                f"节点 {label} 已恢复在线。\n"
                f"地址：{addr}\n"
                f"延迟：{n.get('auth_latency_ms', '-')} ms\n"
                f"检测时间：{ts_text}"
            )
        else:
            continue
        if cooldown and (now_ts - _node_notify_last.get(key, 0.0)) < cooldown:
            continue
        _node_notify_last[key] = now_ts
        pending.append((title, content))
    for title, content in pending:
        threading.Thread(target=send_notification, args=(title, content), daemon=True).start()


def start_node_health_sampler() -> None:
    global _node_health_sampler_started
    if _node_health_sampler_started:
        return
    _node_health_sampler_started = True

    def _loop() -> None:
        time.sleep(8)
        while True:
            try:
                refresh_node_health_snapshot()
            except Exception:
                pass
            time.sleep(max(30, NODE_HEALTH_SAMPLE_SECONDS))

    threading.Thread(target=_loop, name="node-health-sampler", daemon=True).start()


NEW_NODE_VERIFY_ATTEMPTS = int(os.getenv("FML_NEW_NODE_VERIFY_ATTEMPTS", "5") or "5")
NEW_NODE_VERIFY_GAP = float(os.getenv("FML_NEW_NODE_VERIFY_GAP", "2") or "2")


def quick_verify_new_node(node: dict[str, Any]) -> None:
    """新节点接入后立即连续探测几次（连续 2 次在线即确认），并刷新健康/映射快照。"""
    global _node_health_ts
    attempts = max(1, NEW_NODE_VERIFY_ATTEMPTS)
    gap = max(0.5, NEW_NODE_VERIFY_GAP)
    result: dict[str, Any] | None = None
    online_streak = 0
    for i in range(attempts):
        result = check_node_auth_port(node)
        online_streak = online_streak + 1 if result.get("auth_status") == "online" else 0
        if online_streak >= 2:
            break
        if i < attempts - 1:
            time.sleep(gap)
    if result is not None:
        with _node_health_lock:
            _node_health_cache[_node_health_key(node)] = {k: result.get(k) for k in ("auth_status", "auth_port_ok", "auth_checked_at", "auth_latency_ms", "auth_message")}
            _node_health_ts = time.time()
    try:
        refresh_proxy_snapshot()
    except Exception:
        pass


def spawn_new_node_verify(node: dict[str, Any]) -> None:
    """后台线程执行新节点连续校验，不阻塞注册/创建请求。"""
    threading.Thread(target=quick_verify_new_node, args=(dict(node),), name="verify-new-node", daemon=True).start()


def check_tunnel_public_port(tunnel: dict[str, Any]) -> dict[str, Any]:
    """Best-effort user-facing mapping check for TCP tunnels."""
    if not tunnel.get("enabled"):
        return {"mapping_status": "disabled", "mapping_message": "隧道已停用"}
    if tunnel.get("proxy_type") != "tcp" or not tunnel.get("remote_port"):
        if tunnel.get("last_proxy_at"):
            age = max(0, now() - int(tunnel.get("last_proxy_at") or 0))
            if age <= TUNNEL_STATUS_TTL:
                return {"mapping_status": "registered", "mapping_message": f"frpc 已注册（{age} 秒前）"}
        return {"mapping_status": "unknown", "mapping_message": "此协议无法用端口探测，请以客户端日志或访问域名为准"}
    host = str(tunnel.get("server_addr") or "")
    port = int(tunnel.get("remote_port") or 0)
    if not host or not (1 <= port <= 65535):
        return {"mapping_status": "unknown", "mapping_message": "公网地址或端口无效"}
    try:
        with socket.create_connection((host, port), timeout=TUNNEL_CONNECT_TIMEOUT):
            msg = "公网端口可连接"
            if tunnel.get("last_proxy_at"):
                msg += f"；frpc 最近注册于 {fmt_time(int(tunnel['last_proxy_at']))}"
            return {"mapping_status": "online", "mapping_message": msg}
    except Exception as e:
        if tunnel.get("last_proxy_at") and now() - int(tunnel.get("last_proxy_at") or 0) <= TUNNEL_STATUS_TTL:
            return {"mapping_status": "registered", "mapping_message": f"frpc 已注册，但端口探测暂不可达：{e.__class__.__name__}"}
        return {"mapping_status": "offline", "mapping_message": f"公网端口暂不可连接：{e.__class__.__name__}"}


def attach_tunnel_mapping_status(tunnels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not tunnels:
        return tunnels
    max_workers = max(1, min(NODE_CHECK_MAX_WORKERS, len(tunnels)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(check_tunnel_public_port, t): t for t in tunnels}
        for fut in as_completed(futures):
            futures[fut].update(fut.result())
    return tunnels


def frps_dashboard_get(path: str, node: sqlite3.Row | dict[str, Any] | None = None) -> dict[str, Any]:
    url = node_dashboard_url(node) if node is not None else FRPS_DASHBOARD_URL
    url = str(url or "").rstrip("/")
    if not url:
        return {}
    req = urllib.request.Request(f"{url}{path}")
    user, password = node_dashboard_auth(node) if node is not None else (FRPS_DASHBOARD_USER, FRPS_DASHBOARD_PASSWORD)
    if user or password:
        raw = f"{user}:{password}".encode("utf-8")
        req.add_header("Authorization", "Basic " + base64.b64encode(raw).decode("ascii"))
    with urllib.request.urlopen(req, timeout=3) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize_frps_proxy(proxy: dict[str, Any], typ: str, node: sqlite3.Row | dict[str, Any] | None = None) -> dict[str, Any]:
    name = str(proxy.get("name") or "")
    username, short_name = (name.split(".", 1) + [""])[:2] if "." in name else ("", name)
    conf = proxy.get("conf") or {}
    bandwidth_limit = conf.get("bandwidthLimit") or conf.get("bandwidth_limit") or proxy.get("bandwidthLimit") or proxy.get("bandwidth_limit") or ""
    bandwidth_limit_kbps = normalize_bandwidth_to_kbps(bandwidth_limit) or 0
    domains = conf.get("customDomains") or conf.get("custom_domains") or []
    if isinstance(domains, str):
        domains = [d.strip() for d in domains.split(",") if d.strip()]
    return {
        "username": username,
        "name": short_name,
        "full_name": name,
        "type": typ,
        "status": proxy.get("status") or "unknown",
        "remote_port": conf.get("remotePort") or 0,
        "custom_domains": domains,
        "cur_conns": proxy.get("curConns") or 0,
        "today_traffic_in": proxy.get("todayTrafficIn") or 0,
        "today_traffic_out": proxy.get("todayTrafficOut") or 0,
        "bandwidth_limit": bandwidth_limit,
        "bandwidth_limit_kbps": bandwidth_limit_kbps,
        "client_version": proxy.get("clientVersion") or "",
        "last_start_time": proxy.get("lastStartTime") or "",
        "last_close_time": proxy.get("lastCloseTime") or "",
        "node_id": int(row_val(node, "id", 0) or 0) if node is not None else 0,
        "node_name": row_val(node, "name", "") or "" if node is not None else "",
        "node_region": row_val(node, "region", "") or "" if node is not None else "",
    }


def dashboard_nodes_for_user(conn: sqlite3.Connection, user: sqlite3.Row | None = None) -> list[sqlite3.Row]:
    if user is not None and user["role"] != "admin":
        rows = conn.execute(
            """SELECT DISTINCT n.* FROM nodes n
               WHERE n.active=1 AND (
                 n.id=? OR n.id IN (
                   SELECT up.node_id FROM user_plans up
                   WHERE up.user_id=? AND up.status='active' AND (up.expires_at=0 OR up.expires_at>?)
                 )
               ) ORDER BY n.region, n.id""",
            (int(user["node_id"] or 0), int(user["id"]), now())).fetchall()
    else:
        rows = conn.execute("SELECT * FROM nodes WHERE active=1 ORDER BY region, id").fetchall()
    return [r for r in rows if node_dashboard_url(r)]


def frps_all_proxies(nodes: list[sqlite3.Row] | None = None) -> list[dict[str, Any]]:
    if nodes is None:
        with db() as conn:
            nodes = dashboard_nodes_for_user(conn)
    jobs = [(node, typ) for node in nodes for typ in PROXY_TYPE_ORDER]
    if not jobs:
        return []
    # 并发拉取各节点 × 各代理类型：远端节点单次往返可能 1s+，串行会明显卡顿（节点越多越慢）。
    results: list[dict[str, Any]] = [{} for _ in jobs]

    def _fetch(idx: int, node: sqlite3.Row, typ: str) -> None:
        try:
            results[idx] = frps_dashboard_get(f"/api/proxy/{typ}", node)
        except Exception:
            results[idx] = {}

    with ThreadPoolExecutor(max_workers=min(16, len(jobs))) as ex:
        futures = [ex.submit(_fetch, i, node, typ) for i, (node, typ) in enumerate(jobs)]
        for _ in as_completed(futures):
            pass
    proxies: list[dict[str, Any]] = []
    for i, (node, typ) in enumerate(jobs):
        for p in results[i].get("proxies") or []:
            proxies.append(normalize_frps_proxy(p, typ, node))
    proxies.sort(key=lambda p: (p.get("node_region") or "", p.get("node_name") or "", p.get("username") or "", p.get("type") or "", p.get("name") or ""))
    return proxies


# --- 映射快照缓存：后台定时采集各节点 dashboard，页面直接读缓存（不再每次实时拉取）------
PROXY_SAMPLE_SECONDS = int(os.getenv("FML_PROXY_SAMPLE_SECONDS", "600") or "600")
_proxy_snapshot_lock = threading.Lock()
_proxy_snapshot: dict[str, Any] = {"ts": 0.0, "proxies": [], "error": ""}
_proxy_sampler_started = False


def refresh_proxy_snapshot() -> None:
    try:
        proxies = frps_all_proxies()
        error = ""
    except Exception as e:
        proxies = []
        error = e.__class__.__name__
    with _proxy_snapshot_lock:
        _proxy_snapshot["proxies"] = proxies
        _proxy_snapshot["error"] = error
        _proxy_snapshot["ts"] = time.time()


def proxy_snapshot(wait: bool = False) -> list[dict[str, Any]]:
    """返回最近一次定时采集的代理列表。从未采集过、或缓存过旧时（wait=True）同步刷新一次。"""
    with _proxy_snapshot_lock:
        ts = float(_proxy_snapshot.get("ts") or 0)
        proxies = list(_proxy_snapshot.get("proxies") or [])
    if wait and (ts <= 0 or (time.time() - ts) > max(120, PROXY_SAMPLE_SECONDS * 6)):
        refresh_proxy_snapshot()
        with _proxy_snapshot_lock:
            proxies = list(_proxy_snapshot.get("proxies") or [])
    return proxies


def start_proxy_sampler() -> None:
    global _proxy_sampler_started
    if _proxy_sampler_started:
        return
    _proxy_sampler_started = True

    def _loop() -> None:
        time.sleep(5)
        while True:
            try:
                refresh_proxy_snapshot()
            except Exception:
                pass
            time.sleep(max(5, PROXY_SAMPLE_SECONDS))

    threading.Thread(target=_loop, name="proxy-sampler", daemon=True).start()


def frps_user_dashboard(username: str, user: sqlite3.Row | None = None) -> dict[str, Any]:
    try:
        with db() as conn:
            nodes = dashboard_nodes_for_user(conn, user)
        if not nodes:
            return {"enabled": False, "error": "frps dashboard 未接入面板"}
        allowed_nodes = {int(r["id"]) for r in nodes}
        proxies = [p for p in proxy_snapshot(wait=True) if int(p.get("node_id") or 0) in allowed_nodes and p.get("username") == username]
        traffic_in = sum(int(p.get("today_traffic_in") or 0) for p in proxies)
        traffic_out = sum(int(p.get("today_traffic_out") or 0) for p in proxies)
        return {"enabled": True, "proxies": proxies, "total": len(proxies), "today_traffic_in": traffic_in, "today_traffic_out": traffic_out, "today_traffic_total": traffic_in + traffic_out}
    except Exception as e:
        return {"enabled": False, "error": f"读取 frps dashboard 失败：{e.__class__.__name__}"}


# --- Traffic history sampling & stats -------------------------------------------------
TRAFFIC_SAMPLE_SECONDS = int(os.getenv("FML_TRAFFIC_SAMPLE_SECONDS", "300") or "300")
TRAFFIC_RETAIN_DAYS = int(os.getenv("FML_TRAFFIC_RETAIN_DAYS", "45") or "45")

def local_day_str(ts: int | None = None) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts if ts is not None else now()))

def proxy_type_label(t: str) -> str:
    return {"tcp": "TCP", "udp": "UDP", "http": "HTTP", "https": "HTTPS", "stcp": "STCP", "xtcp": "XTCP", "tcpmux": "TCPMUX"}.get(str(t or "").lower(), (str(t or "").upper() or "其他"))

def sample_traffic_once() -> int:
    """Snapshot per-user, per-proxy-type cumulative daily traffic from the node dashboards."""
    try:
        with db() as conn:
            nodes = dashboard_nodes_for_user(conn)
            if not nodes:
                return 0
            user_rows = conn.execute("SELECT id, username FROM users").fetchall()
        id_by_name = {str(r["username"]): int(r["id"]) for r in user_rows}
        proxies = frps_all_proxies(nodes)
        if not proxies:
            return 0
        buckets: dict[tuple[str, str, int, int], int] = {}
        for p in proxies:
            uname = str(p.get("username") or "")
            if uname not in id_by_name:
                continue
            typ = str(p.get("type") or "tcp")
            node_id = int(p.get("node_id") or 0)
            remote_port = int(p.get("remote_port") or 0)
            key = (uname, typ, node_id, remote_port)
            buckets[key] = buckets.get(key, 0) + int(p.get("today_traffic_in") or 0) + int(p.get("today_traffic_out") or 0)
        day = local_day_str()
        ts = now()
        inserted = 0
        with db() as conn:
            for (uname, typ, node_id, remote_port), value in buckets.items():
                uid = id_by_name[uname]
                last = conn.execute(
                    "SELECT bytes FROM traffic_samples WHERE user_id=? AND day=? AND proxy_type=? AND node_id=? AND remote_port=? ORDER BY ts DESC LIMIT 1",
                    (uid, day, typ, node_id, remote_port)).fetchone()
                if last is not None and int(last["bytes"] or 0) == value:
                    continue
                conn.execute(
                    "INSERT INTO traffic_samples(user_id, username, day, proxy_type, node_id, remote_port, bytes, ts) VALUES(?,?,?,?,?,?,?,?)",
                    (uid, uname, day, typ, node_id, remote_port, value, ts))
                inserted += 1
            conn.execute("DELETE FROM traffic_samples WHERE ts < ?", (now() - TRAFFIC_RETAIN_DAYS * 86400,))
        return inserted
    except Exception:
        return 0

_bandwidth_strikes: dict[int, int] = {}
# 带宽滥用检测：每 6 分钟评估一次，连续 5 轮（约 30 分钟）超限才封禁 30 分钟
ABUSE_CHECK_SECONDS = int(os.getenv("FML_ABUSE_CHECK_SECONDS", "360") or "360")
ABUSE_STRIKES = int(os.getenv("FML_ABUSE_STRIKES", "5") or "5")
ABUSE_BAN_SECONDS = int(os.getenv("FML_ABUSE_BAN_MINUTES", "30") or "30") * 60
_abuse_last_check = 0.0


def auto_unban(conn: sqlite3.Connection) -> None:
    conn.execute("UPDATE users SET banned_until=0, ban_reason='' WHERE banned_until>0 AND banned_until<=?", (now(),))


def check_bandwidth_abuse(conn: sqlite3.Connection) -> None:
    """连续多个采样周期接近带宽上限的用户，临时封禁 30 分钟。"""
    window = now() - 900
    rows = conn.execute(
        "SELECT user_id, ts, SUM(bytes) AS total FROM traffic_samples WHERE ts>=? GROUP BY user_id, ts ORDER BY user_id, ts",
        (window,)).fetchall()
    per_user: dict[int, list[tuple[int, int]]] = {}
    for r in rows:
        per_user.setdefault(int(r["user_id"]), []).append((int(r["ts"]), int(r["total"] or 0)))
    for uid, points in per_user.items():
        if len(points) < 2:
            continue
        (t1, b1), (t2, b2) = points[-2], points[-1]
        if t2 <= t1:
            continue
        kbps = max(0, (b2 - b1)) * 8 / 1024 / max(1, t2 - t1)
        user = conn.execute("SELECT id, username, bandwidth_limit_kbps, banned_until FROM users WHERE id=?", (uid,)).fetchone()
        if not user:
            continue
        limit = int(user["bandwidth_limit_kbps"] or 0)
        if limit <= 0:
            _bandwidth_strikes[uid] = 0
            continue
        if kbps >= limit * 0.9:
            _bandwidth_strikes[uid] = _bandwidth_strikes.get(uid, 0) + 1
        else:
            _bandwidth_strikes[uid] = 0
        if _bandwidth_strikes.get(uid, 0) >= ABUSE_STRIKES and int(user["banned_until"] or 0) <= now():
            until = now() + ABUSE_BAN_SECONDS
            reason = f"持续占用带宽（约 {kbps:.0f} Kbps / 上限 {limit} Kbps）"
            conn.execute("UPDATE users SET banned_until=?, ban_reason=? WHERE id=?", (until, reason, uid))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            conn.execute("INSERT INTO user_bans(user_id, username, reason, banned_by, created_at) VALUES(?,?,?,NULL,?)",
                         (uid, user["username"], reason, now()))
            _bandwidth_strikes[uid] = 0


_plan_usage_started = False


def start_plan_usage_loop() -> None:
    """定期把用户流量计入流量型套餐，用尽后自动失效。"""
    global _plan_usage_started
    if _plan_usage_started:
        return
    _plan_usage_started = True

    def _loop() -> None:
        time.sleep(20)
        while True:
            try:
                auto_renew_plans_once()
                accrue_provider_income_once()
                expire_plans_once()
                remind_stale_tickets_once(24)
                remind_user_plans_once()
                with db() as conn:
                    reclaim_expired_plan_ports(conn)
                global _abuse_last_check
                with db() as conn:
                    auto_unban(conn)
                    if time.time() - _abuse_last_check >= ABUSE_CHECK_SECONDS:
                        _abuse_last_check = time.time()
                        check_bandwidth_abuse(conn)
                with db() as conn:
                    for r in conn.execute("SELECT DISTINCT user_id FROM user_plans").fetchall():
                        sync_user_plan_ports(conn, int(r["user_id"]))
                        recalc_user_entitlements(conn, int(r["user_id"]))
                    ids = [int(r["user_id"]) for r in conn.execute(
                        "SELECT DISTINCT user_id FROM user_plans WHERE quota_bytes>0 AND status='active'")]
                    for uid in ids:
                        refresh_user_plan_usage(conn, uid)
            except Exception:
                pass
            time.sleep(60)

    threading.Thread(target=_loop, name="plan-usage", daemon=True).start()


_traffic_sampler_started = False

def start_traffic_sampler() -> None:
    global _traffic_sampler_started
    if _traffic_sampler_started:
        return
    _traffic_sampler_started = True
    def _loop() -> None:
        time.sleep(15)
        while True:
            try:
                sample_traffic_once()
            except Exception:
                pass
            time.sleep(max(60, TRAFFIC_SAMPLE_SECONDS))
    threading.Thread(target=_loop, name="traffic-sampler", daemon=True).start()


# --- Host resource sampling (in-memory ring buffer powering 2D charts) ----------------
HOST_SAMPLE_SECONDS = int(os.getenv("FML_HOST_SAMPLE_SECONDS", "30") or "30")
HOST_SAMPLE_POINTS = int(os.getenv("FML_HOST_SAMPLE_POINTS", "60") or "60")
_host_history_lock = threading.Lock()
_host_history: "collections.deque[dict[str, Any]]" = collections.deque(maxlen=HOST_SAMPLE_POINTS)


def host_sample_snapshot(stats: dict[str, Any] | None = None) -> dict[str, Any]:
    s = stats if stats is not None else host_system_stats()
    return {
        "ts": now(),
        "cpu": s.get("cpu_percent"),
        "mem": s.get("memory_percent"),
        "load1": s.get("load1"),
    }


def record_host_sample(stats: dict[str, Any] | None = None, min_interval: int = 0) -> bool:
    """Append a host stats sample; skip when the newest sample is younger than min_interval."""
    with _host_history_lock:
        if min_interval and _host_history:
            try:
                if now() - int(_host_history[-1].get("ts") or 0) < min_interval:
                    return False
            except Exception:
                pass
        _host_history.append(host_sample_snapshot(stats))
    return True


def host_history() -> list[dict[str, Any]]:
    with _host_history_lock:
        return [dict(p) for p in _host_history]


def host_stats_with_history() -> dict[str, Any]:
    """host_system_stats() plus the recent sample ring buffer used by the admin charts."""
    stats = host_system_stats()
    record_host_sample(stats, min_interval=max(5, HOST_SAMPLE_SECONDS))
    stats["history"] = host_history()
    stats["sample_seconds"] = HOST_SAMPLE_SECONDS
    stats["sample_points"] = HOST_SAMPLE_POINTS
    return stats


_host_sampler_started = False


def start_host_sampler() -> None:
    global _host_sampler_started
    if _host_sampler_started:
        return
    _host_sampler_started = True

    def _loop() -> None:
        time.sleep(3)
        while True:
            try:
                record_host_sample(None, min_interval=max(5, HOST_SAMPLE_SECONDS))
            except Exception:
                pass
            time.sleep(max(5, HOST_SAMPLE_SECONDS))

    threading.Thread(target=_loop, name="host-sampler", daemon=True).start()

def traffic_stats_for_user(user: sqlite3.Row, range_key: str = "30d") -> dict[str, Any]:
    if range_key not in {"today", "7d", "30d"}:
        range_key = "30d"
    uid = int(user["id"])
    today = local_day_str()
    with db() as conn:
        source_ready = bool(dashboard_nodes_for_user(conn, user))
        rows = conn.execute("SELECT day, proxy_type, bytes, ts FROM traffic_samples WHERE user_id=?", (uid,)).fetchall()
    if range_key == "today":
        type_hour: dict[str, dict[int, int]] = {}
        for r in rows:
            if r["day"] != today:
                continue
            h = time.localtime(int(r["ts"])).tm_hour
            bucket = type_hour.setdefault(r["proxy_type"], {})
            v = int(r["bytes"] or 0)
            if v > bucket.get(h, 0):
                bucket[h] = v
        cum = [0] * 24
        for bucket in type_hour.values():
            run = 0
            for h in range(24):
                if bucket.get(h, 0) > run:
                    run = bucket[h]
                cum[h] += run
        series = []
        prev = 0
        for h in range(24):
            series.append({"label": f"{h:02d}:00", "short": f"{h:02d}", "bytes": max(0, cum[h] - prev)})
            prev = cum[h]
        unit = "小时"
    else:
        day_max: dict[str, int] = {}
        for r in rows:
            v = int(r["bytes"] or 0)
            if v > day_max.get(r["day"], 0):
                day_max[r["day"]] = v
        count = 7 if range_key == "7d" else 30
        base = now()
        series = []
        for i in range(count - 1, -1, -1):
            d = local_day_str(base - i * 86400)
            series.append({"label": d, "short": d[5:], "bytes": day_max.get(d, 0)})
        unit = "天"
    total = sum(int(p["bytes"]) for p in series)
    peak = max([int(p["bytes"]) for p in series] or [0])
    return {"ok": True, "range": range_key, "unit": unit, "enabled": source_ready, "has_data": total > 0, "total": total, "peak": peak, "series": series, "generated_at": now()}

def traffic_protocols_for_user(user: sqlite3.Row, month: str = "") -> dict[str, Any]:
    month = (month or "").strip()
    if len(month) != 7 or month[4] != "-":
        month = time.strftime("%Y-%m", time.localtime(now()))
    uid = int(user["id"])
    with db() as conn:
        source_ready = bool(dashboard_nodes_for_user(conn, user))
        rows = conn.execute("SELECT day, proxy_type, bytes FROM traffic_samples WHERE user_id=? AND day LIKE ?", (uid, month + "%")).fetchall()
    day_type_max: dict[tuple[str, str], int] = {}
    for r in rows:
        key = (r["day"], r["proxy_type"])
        v = int(r["bytes"] or 0)
        if v > day_type_max.get(key, 0):
            day_type_max[key] = v
    per_type: dict[str, int] = {}
    for (_day, typ), v in day_type_max.items():
        per_type[typ] = per_type.get(typ, 0) + v
    total = sum(per_type.values())
    order = list(PROXY_TYPE_ORDER) + [t for t in per_type if t not in PROXY_TYPE_ORDER]
    items = []
    for t in order:
        if t not in per_type:
            continue
        b = per_type[t]
        items.append({"type": t, "label": proxy_type_label(t), "bytes": b, "percent": round(b * 100 / total, 1) if total else 0.0})
    return {"ok": True, "enabled": source_ready, "has_data": total > 0, "month": month, "total": total, "items": items, "generated_at": now()}

_ACTIVITY_META = {
    "login": ("login", "登录"),
    "logout": ("login", "退出登录"),
    "tunnel_create": ("tunnel", "创建隧道"),
    "admin_tunnel_create": ("tunnel", "创建隧道"),
    "tunnel_delete": ("tunnel", "删除隧道"),
    "tunnel_toggle": ("tunnel", "隧道开关"),
    "user_node_switch": ("node", "切换节点"),
    "user_ban": ("risk", "账号处理"),
    "backup_download": ("backup", "下载备份"),
    "software_license_activate": ("license", "激活授权"),
}

def user_activity_feed(user: sqlite3.Row, limit: int = 8) -> dict[str, Any]:
    uid = int(user["id"])
    limit = max(1, min(20, int(limit or 8)))
    with db() as conn:
        rows = conn.execute("SELECT event, proxy_type, remote_port, detail, created_at FROM audit_logs WHERE user_id=? ORDER BY id DESC LIMIT ?", (uid, limit)).fetchall()
    items = []
    for r in rows:
        ev = str(r["event"] or "")
        kind, title = _ACTIVITY_META.get(ev, ("default", ev or "动态"))
        detail = str(r["detail"] or "")
        items.append({"kind": kind, "title": title, "text": detail or title, "at": int(r["created_at"] or 0)})
    try:
        tv = traffic_stats_for_user(user, "today")
        if tv.get("total"):
            items.insert(0, {"kind": "traffic", "title": "流量使用", "bytes": int(tv["total"]), "at": now()})
    except Exception:
        pass
    return {"ok": True, "items": items[:limit]}


def user_today_traffic_bytes(username: str, user: sqlite3.Row | None = None) -> int | None:
    try:
        data = frps_user_dashboard(username, user)
        if not data.get("enabled"):
            return None
        return int(data.get("today_traffic_total") or 0)
    except Exception:
        return None


def user_over_traffic_limit(user: sqlite3.Row) -> bool:
    limit = int(row_val(user, "traffic_limit_bytes", 0) or 0)
    if limit <= 0:
        return False
    used = user_today_traffic_bytes(user["username"], user)
    return used is not None and used >= limit


def frps_admin_dashboard(page: int = 1, page_size: int = 20, username: str = "") -> dict[str, Any]:
    try:
        page = max(1, int(page or 1))
        page_size = min(100, max(10, int(page_size or 20)))
        with db() as conn:
            nodes = dashboard_nodes_for_user(conn)
        if not nodes:
            return {"enabled": False, "error": "frps dashboard 未接入面板", "proxies": [], "total": 0, "page": page, "page_size": page_size, "traffic_in": 0, "traffic_out": 0, "traffic_total": 0, "cur_conns": 0, "online_count": 0}
        proxies = proxy_snapshot(wait=True)
        if username:
            proxies = [p for p in proxies if p.get("username") == username]
        total = len(proxies)
        traffic_in = sum(int(p.get("today_traffic_in") or 0) for p in proxies)
        traffic_out = sum(int(p.get("today_traffic_out") or 0) for p in proxies)
        stats = {
            "traffic_in": traffic_in,
            "traffic_out": traffic_out,
            "traffic_total": traffic_in + traffic_out,
            "cur_conns": sum(int(p.get("cur_conns") or 0) for p in proxies),
            "online_count": sum(1 for p in proxies if p.get("status") == "online"),
        }
        start = (page - 1) * page_size
        return {"enabled": True, "proxies": proxies[start:start + page_size], "total": total, "page": page, "page_size": page_size, "users": sorted({p.get("username") or "" for p in proxies if p.get("username")}), **stats}
    except Exception as e:
        return {"enabled": False, "error": f"读取 frps dashboard 失败：{e.__class__.__name__}", "proxies": [], "total": 0, "page": page, "page_size": page_size, "traffic_in": 0, "traffic_out": 0, "traffic_total": 0, "cur_conns": 0, "online_count": 0}


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
                web_port INTEGER NOT NULL DEFAULT 0,
                dashboard_url TEXT NOT NULL DEFAULT '',
                dashboard_user TEXT NOT NULL DEFAULT '',
                dashboard_password TEXT NOT NULL DEFAULT '',
                bandwidth_mbps INTEGER NOT NULL DEFAULT 0,
                monthly_traffic_bytes INTEGER NOT NULL DEFAULT 0,
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
                invite_key_used TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                max_ports INTEGER NOT NULL DEFAULT 5,
                traffic_limit_bytes INTEGER NOT NULL DEFAULT 0,
                bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                expires_at INTEGER NOT NULL DEFAULT 0,
                banned_until INTEGER NOT NULL DEFAULT 0,
                ban_reason TEXT NOT NULL DEFAULT '',
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
            CREATE TABLE IF NOT EXISTS traffic_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL DEFAULT '',
                day TEXT NOT NULL,
                proxy_type TEXT NOT NULL DEFAULT '',
                node_id INTEGER NOT NULL DEFAULT 0,
                remote_port INTEGER NOT NULL DEFAULT 0,
                bytes INTEGER NOT NULL DEFAULT 0,
                ts INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_traffic_user_ts ON traffic_samples(user_id, ts);
            CREATE INDEX IF NOT EXISTS idx_traffic_user_day ON traffic_samples(user_id, day, proxy_type);
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
                seq_no INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
                key TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL DEFAULT 'register',
                note TEXT NOT NULL DEFAULT '',
                max_uses INTEGER NOT NULL DEFAULT 1,
                used_count INTEGER NOT NULL DEFAULT 0,
                max_ports INTEGER NOT NULL DEFAULT 5,
                traffic_limit_bytes INTEGER NOT NULL DEFAULT 0,
                bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0,
                user_expires_days INTEGER NOT NULL DEFAULT 30,
                active INTEGER NOT NULL DEFAULT 1,
                expires_at INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                code TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                used INTEGER NOT NULL DEFAULT 0,
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
                seq_no INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
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
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq_no INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL,
                billing_mode TEXT NOT NULL DEFAULT 'time',
                price_cents INTEGER NOT NULL DEFAULT 0,
                max_ports INTEGER NOT NULL DEFAULT 5,
                traffic_limit_bytes INTEGER NOT NULL DEFAULT 0,
                bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0,
                duration_days INTEGER NOT NULL DEFAULT 30,
                node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
                note TEXT NOT NULL DEFAULT '',
                fair_use_note TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'announcement',
                active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'system',
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                link TEXT NOT NULL DEFAULT '',
                read_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
            CREATE TABLE IF NOT EXISTS uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'ticket',
                mime TEXT NOT NULL DEFAULT '',
                size INTEGER NOT NULL DEFAULT 0,
                data BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_income (
                owner_id INTEGER PRIMARY KEY,
                points INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payout_accounts (
                user_id INTEGER PRIMARY KEY,
                method TEXT NOT NULL DEFAULT 'alipay',
                account TEXT NOT NULL DEFAULT '',
                holder TEXT NOT NULL DEFAULT '',
                qr_token TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payout_no TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                points INTEGER NOT NULL DEFAULT 0,
                method TEXT NOT NULL DEFAULT 'alipay',
                account TEXT NOT NULL DEFAULT '',
                holder TEXT NOT NULL DEFAULT '',
                qr_token TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                note TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_no TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'issue',
                status TEXT NOT NULL DEFAULT 'open',
                node_id INTEGER NOT NULL DEFAULT 0,
                owner_id INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                attachments TEXT NOT NULL DEFAULT '[]',
                resolution TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                username TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'user',
                content TEXT NOT NULL DEFAULT '',
                attachments TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_guarantee (
                owner_id INTEGER PRIMARY KEY,
                points INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS platform_revenue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_no TEXT NOT NULL DEFAULT '',
                plan_id INTEGER NOT NULL DEFAULT 0,
                node_id INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_debts (
                owner_id INTEGER PRIMARY KEY,
                points INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                unit TEXT NOT NULL DEFAULT 'points',
                direction TEXT NOT NULL DEFAULT 'in',
                category TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL DEFAULT 0,
                user_id INTEGER NOT NULL DEFAULT 0,
                username TEXT NOT NULL DEFAULT '',
                node_id INTEGER NOT NULL DEFAULT 0,
                order_no TEXT NOT NULL DEFAULT '',
                ref TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger(ts);
            CREATE TABLE IF NOT EXISTS provider_earnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_no TEXT NOT NULL UNIQUE,
                node_id INTEGER NOT NULL,
                owner_id INTEGER NOT NULL,
                gross_points INTEGER NOT NULL DEFAULT 0,
                commission_points INTEGER NOT NULL DEFAULT 0,
                net_points INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_no TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL DEFAULT '',
                plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
                plan_name TEXT NOT NULL DEFAULT '',
                amount_cents INTEGER NOT NULL DEFAULT 0,
                duration_days INTEGER NOT NULL DEFAULT 30,
                max_ports INTEGER NOT NULL DEFAULT 0,
                traffic_limit_bytes INTEGER NOT NULL DEFAULT 0,
                bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0,
                node_id INTEGER,
                provider TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                pay_url TEXT NOT NULL DEFAULT '',
                transaction_id TEXT NOT NULL DEFAULT '',
                paid_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS point_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL DEFAULT '',
                delta INTEGER NOT NULL,
                balance_after INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT '',
                ref TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id, id);
            CREATE TABLE IF NOT EXISTS hosts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                region TEXT NOT NULL DEFAULT '默认地区',
                server_addr TEXT NOT NULL,
                server_port INTEGER NOT NULL DEFAULT 7000,
                auth_token TEXT NOT NULL DEFAULT '',
                port_start INTEGER NOT NULL DEFAULT 20000,
                port_end INTEGER NOT NULL DEFAULT 20199,
                bandwidth_mbps INTEGER NOT NULL DEFAULT 0,
                monthly_traffic_gb REAL NOT NULL DEFAULT 0,
                cpu TEXT NOT NULL DEFAULT '',
                memory TEXT NOT NULL DEFAULT '',
                disk TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                node_id INTEGER,
                reviewed_by INTEGER,
                reviewed_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts(user_id, id);
            CREATE TABLE IF NOT EXISTS user_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL DEFAULT '',
                plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
                plan_name TEXT NOT NULL DEFAULT '',
                billing_mode TEXT NOT NULL DEFAULT 'time',
                price_points INTEGER NOT NULL DEFAULT 0,
                quota_bytes INTEGER NOT NULL DEFAULT 0,
                used_bytes INTEGER NOT NULL DEFAULT 0,
                usage_started_at INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                order_no TEXT NOT NULL DEFAULT '',
                max_ports INTEGER NOT NULL DEFAULT 0,
                traffic_limit_bytes INTEGER NOT NULL DEFAULT 0,
                bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0,
                duration_days INTEGER NOT NULL DEFAULT 0,
                node_id INTEGER,
                starts_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_user_plans_user ON user_plans(user_id, id);
            CREATE TABLE IF NOT EXISTS user_plan_ports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_plan_id INTEGER NOT NULL REFERENCES user_plans(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL,
                node_id INTEGER NOT NULL,
                port INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                release_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_user_plan_ports_port ON user_plan_ports(node_id, port);
            CREATE TABLE IF NOT EXISTS recharge_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq_no INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
                key TEXT NOT NULL UNIQUE,
                points INTEGER NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                expires_at INTEGER NOT NULL DEFAULT 0,
                used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                used_at INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
            """
        )
        host_cols = {r["name"] for r in conn.execute("PRAGMA table_info(hosts)").fetchall()}
        if "deploy_token" not in host_cols:
            conn.execute("ALTER TABLE hosts ADD COLUMN deploy_token TEXT NOT NULL DEFAULT ''")
        ticket_cols = {r["name"] for r in conn.execute("PRAGMA table_info(tickets)").fetchall()}
        if "host_id" not in ticket_cols:
            conn.execute("ALTER TABLE tickets ADD COLUMN host_id INTEGER NOT NULL DEFAULT 0")
        if "reminded_at" not in ticket_cols:
            conn.execute("ALTER TABLE tickets ADD COLUMN reminded_at INTEGER NOT NULL DEFAULT 0")
        user_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "wecom_userid" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN wecom_userid TEXT NOT NULL DEFAULT ''")
        conn.execute("""CREATE TABLE IF NOT EXISTS user_notify_config (
                user_id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                type TEXT NOT NULL DEFAULT '',
                params TEXT NOT NULL DEFAULT '{}',
                events TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0
            )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS user_notify_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                event TEXT NOT NULL,
                ref TEXT NOT NULL DEFAULT '',
                day TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS wecom_bind_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )""")
        ann_cols = {r["name"] for r in conn.execute("PRAGMA table_info(announcements)").fetchall()}
        if "kind" not in ann_cols:
            conn.execute("ALTER TABLE announcements ADD COLUMN kind TEXT NOT NULL DEFAULT 'announcement'")
        default_node_id = ensure_default_node(conn)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "expires_at" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0")
        if "invite_key_used" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN invite_key_used TEXT NOT NULL DEFAULT ''")
        if "email" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''")
        if "traffic_limit_bytes" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN traffic_limit_bytes INTEGER NOT NULL DEFAULT 0")
        if "bandwidth_limit_kbps" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0")
        if "points" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0")
        if "banned_until" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN banned_until INTEGER NOT NULL DEFAULT 0")
        if "ban_reason" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''")
        plan_cols = {r["name"] for r in conn.execute("PRAGMA table_info(plans)").fetchall()}
        if "billing_mode" not in plan_cols:
            conn.execute("ALTER TABLE plans ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'time'")
        if "fair_use_note" not in plan_cols:
            conn.execute("ALTER TABLE plans ADD COLUMN fair_use_note TEXT NOT NULL DEFAULT ''")
        if setting_get(conn, "migration_billing_mode_v1", "") != "1":
            # 历史套餐：有流量额度且没有有效期，按流量模式处理（只执行一次）
            conn.execute("UPDATE plans SET billing_mode='traffic' WHERE duration_days=0 AND traffic_limit_bytes>0")
            setting_set(conn, "migration_billing_mode_v1", "1")
        up_cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_plans)").fetchall()}
        if "billing_mode" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'time'")
        if "price_points" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN price_points INTEGER NOT NULL DEFAULT 0")
        if "quota_bytes" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN quota_bytes INTEGER NOT NULL DEFAULT 0")
        if "used_bytes" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN used_bytes INTEGER NOT NULL DEFAULT 0")
        if "usage_started_at" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN usage_started_at INTEGER NOT NULL DEFAULT 0")
        if "auto_renew" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0")
        if "provider_paid_points" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN provider_paid_points INTEGER NOT NULL DEFAULT 0")
        if "guarantee_points" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN guarantee_points INTEGER NOT NULL DEFAULT 0")
        if "provider_id" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN provider_id INTEGER NOT NULL DEFAULT 0")
        upp_cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_plan_ports)").fetchall()}
        if "release_at" not in upp_cols:
            conn.execute("ALTER TABLE user_plan_ports ADD COLUMN release_at INTEGER NOT NULL DEFAULT 0")
        if "status" not in up_cols:
            conn.execute("ALTER TABLE user_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
        if "price_points" not in plan_cols:
            conn.execute("ALTER TABLE plans ADD COLUMN price_points INTEGER NOT NULL DEFAULT 0")
        if "seq_no" not in plan_cols:
            conn.execute("ALTER TABLE plans ADD COLUMN seq_no INTEGER NOT NULL DEFAULT 0")
        if "deleted" not in plan_cols:
            conn.execute("ALTER TABLE plans ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
        # 为历史套餐补齐展示序号
        missing = conn.execute("SELECT id FROM plans WHERE seq_no=0 ORDER BY id").fetchall()
        if missing:
            base = conn.execute("SELECT COALESCE(MAX(seq_no),0) FROM plans").fetchone()[0]
            for offset, r in enumerate(missing, start=1):
                conn.execute("UPDATE plans SET seq_no=? WHERE id=?", (int(base) + offset, r["id"]))
        ts_cols = {r["name"] for r in conn.execute("PRAGMA table_info(traffic_samples)").fetchall()}
        if "node_id" not in ts_cols:
            conn.execute("ALTER TABLE traffic_samples ADD COLUMN node_id INTEGER NOT NULL DEFAULT 0")
        if "remote_port" not in ts_cols:
            conn.execute("ALTER TABLE traffic_samples ADD COLUMN remote_port INTEGER NOT NULL DEFAULT 0")
        for table in ("invite_keys", "recharge_keys", "software_license_keys"):
            tcols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if "seq_no" not in tcols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN seq_no INTEGER NOT NULL DEFAULT 0")
            if "deleted" not in tcols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
            missing = conn.execute(f"SELECT id FROM {table} WHERE seq_no=0 ORDER BY id").fetchall()
            if missing:
                base = conn.execute(f"SELECT COALESCE(MAX(seq_no),0) FROM {table}").fetchone()[0]
                for offset, r in enumerate(missing, start=1):
                    conn.execute(f"UPDATE {table} SET seq_no=? WHERE id=?", (int(base) + offset, r["id"]))
        order_cols = {r["name"] for r in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "kind" not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan'")
        if "points" not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN points INTEGER NOT NULL DEFAULT 0")
        node_cols = {r["name"] for r in conn.execute("PRAGMA table_info(nodes)").fetchall()}
        if "owner_id" not in node_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0")
        if "last_online_at" not in node_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN last_online_at INTEGER NOT NULL DEFAULT 0")
        if "auto_suspended" not in node_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN auto_suspended INTEGER NOT NULL DEFAULT 0")
        if "expires_at" not in node_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0")
        if "frps_version" not in node_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN frps_version TEXT NOT NULL DEFAULT ''")
        for tbl, col, ddl in (
            ("payout_accounts", "qr_token", "TEXT NOT NULL DEFAULT ''"),
            ("tickets", "attachments", "TEXT NOT NULL DEFAULT '[]'"),
            ("tickets", "resolution", "TEXT NOT NULL DEFAULT ''"),
            ("ticket_messages", "attachments", "TEXT NOT NULL DEFAULT '[]'"),
            ("payouts", "qr_token", "TEXT NOT NULL DEFAULT ''"),
        ):
            cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()}
            if col not in cols:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {ddl}")
        host_cols = {r["name"] for r in conn.execute("PRAGMA table_info(hosts)").fetchall()}
        if "expires_at" not in host_cols:
            conn.execute("ALTER TABLE hosts ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """UPDATE nodes SET owner_id=(SELECT h.user_id FROM hosts h WHERE h.node_id=nodes.id AND h.status='approved' ORDER BY h.id LIMIT 1)
               WHERE owner_id=0 AND EXISTS (SELECT 1 FROM hosts h WHERE h.node_id=nodes.id AND h.status='approved')"""
        )
        if "bandwidth_mbps" not in node_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN bandwidth_mbps INTEGER NOT NULL DEFAULT 0")
        invite_cols = {r["name"] for r in conn.execute("PRAGMA table_info(invite_keys)").fetchall()}
        if "traffic_limit_bytes" not in invite_cols:
            conn.execute("ALTER TABLE invite_keys ADD COLUMN traffic_limit_bytes INTEGER NOT NULL DEFAULT 0")
        if "bandwidth_limit_kbps" not in invite_cols:
            conn.execute("ALTER TABLE invite_keys ADD COLUMN bandwidth_limit_kbps INTEGER NOT NULL DEFAULT 0")
        if "kind" not in invite_cols:
            conn.execute("ALTER TABLE invite_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'register'")
        # software_license.server_url migration
        sw_cols = {r["name"] for r in conn.execute("PRAGMA table_info(software_license)").fetchall()}
        if "server_url" not in sw_cols:
            conn.execute("ALTER TABLE software_license ADD COLUMN server_url TEXT NOT NULL DEFAULT ''")
        migrate_region_nodes(conn, default_node_id)
        # Port pools belong to a specific node. Seed them only when an existing
        # node is present; newly created nodes receive their own configured range.
        if default_node_id is not None:
            conn.executemany(
                "INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?, ?, ?)",
                [(default_node_id, p, now()) for p in range(PORT_START, PORT_END + 1)],
            )
        admin = conn.execute("SELECT * FROM users WHERE role='admin' LIMIT 1").fetchone()
        if not admin:
            insert_user_record(conn, ADMIN_USER, password_hash(ADMIN_PASSWORD), "admin", secrets.token_urlsafe(24), DEFAULT_MAX_PORTS, 0, default_node_id)
        else:
            # 每次启动同步 admin 密码到环境变量值，保证改 .env 后不丢登录
            if not verify_password(ADMIN_PASSWORD, admin["password_hash"]):
                conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(ADMIN_PASSWORD), admin["id"]))
                print(f"INFO: admin password synced from FML_ADMIN_PASSWORD")
            admin_node = admin["node_id"] or 0
            if not admin_node and default_node_id is not None:
                conn.execute("UPDATE users SET node_id=? WHERE id=?", (default_node_id, admin["id"]))
        for r in conn.execute(
            """
            SELECT t.node_id, t.remote_port, t.user_id
            FROM tunnels t
            JOIN users u ON u.id=t.user_id
            WHERE u.role='admin' AND t.proxy_type IN ('tcp','udp') AND t.remote_port>0
            """
        ).fetchall():
            conn.execute("UPDATE ports SET user_id=? WHERE node_id=? AND port=? AND user_id IS NULL", (r["user_id"], r["node_id"], r["remote_port"]))


def available_ports_for_assignment(conn: sqlite3.Connection, node_id: int, limit: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT p.port
        FROM ports p
        LEFT JOIN tunnels t
          ON t.node_id=p.node_id
         AND t.remote_port=p.port
         AND t.proxy_type IN ('tcp','udp')
        WHERE p.node_id=? AND p.user_id IS NULL AND t.id IS NULL
        ORDER BY p.port
        LIMIT ?
        """,
        (node_id, limit),
    ).fetchall()


def create_user(username: str, password: str, max_ports: int, expires_days: int, node_id: int, traffic_limit_bytes: int = 0, bandwidth_limit_kbps: int = 0, email: str = "") -> tuple[bool, str]:
    username = username.strip()
    email = str(email or "").strip()[:120]
    if not username or len(username) > 32 or not username.replace("_", "").replace("-", "").isalnum():
        return False, "用户名只能包含字母、数字、下划线、短横线，长度 1-32"
    if email and ("@" not in email or len(email) < 5):
        return False, "邮箱格式不正确"
    if len(password) < 6:
        return False, "密码至少 6 位"
    if max_ports < 1 or max_ports > 100:
        return False, "端口数量必须在 1-100 之间"
    if expires_days < 0 or expires_days > 3650:
        return False, "有效期天数必须在 0-3650 之间"
    if traffic_limit_bytes < 0:
        return False, "流量限制不能小于 0"
    if bandwidth_limit_kbps < 0:
        return False, "网速限制不能小于 0"
    expires_at = 0
    with db() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=? AND active=1", (node_id,)).fetchone()
        if not node:
            return False, "地区节点不存在或已停用"
        free_ports = available_ports_for_assignment(conn, node_id, max_ports)
        if len(free_ports) < max_ports:
            return False, f"端口池不足，只剩 {len(free_ports)} 个可用端口"
        try:
            cur = insert_user_record(conn, username, password_hash(password), "user", secrets.token_urlsafe(24), max_ports, expires_at, node_id, "", traffic_limit_bytes, bandwidth_limit_kbps, email)
        except sqlite3.IntegrityError:
            return False, "用户名已存在"
        user_id = cur.lastrowid
        if free_ports:
            conn.executemany("UPDATE ports SET user_id=? WHERE node_id=? AND port=?", [(user_id, node_id, r["port"]) for r in free_ports])
    extra = []
    if traffic_limit_bytes:
        extra.append(f"今日流量上限 {traffic_limit_bytes / 1024 / 1024 / 1024:.1f}GB")
    if bandwidth_limit_kbps:
        extra.append(f"速率策略 {bandwidth_limit_kbps / 1024:.1f}MB/s")
    suffix = "，" + "，".join(extra) if extra else ""
    return True, f"已创建用户 {username}，地区节点：{node['region']} / {node['name']}，分配 {max_ports} 个端口，到期时间：{fmt_time(expires_at)}{suffix}"


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
    server_url = SOFTWARE_LICENSE_SERVER_URL.rstrip("/")
    if not server_url:
        return local_license_authority_activate(license_key, machine_id)
    body = json.dumps({"license_key": license_key, "machine_id": machine_id, "app": APP_NAME}).encode("utf-8")
    req = urllib.request.Request(
        f"{server_url}/api/license/activate",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "frp-manager-lite-license-client/1.0",
        },
    )
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
        return False, "授权服务器返回的机器指纹与当前服务器不一致", None
    return True, str(data.get("message") or "授权成功"), payload


def activate_software_license(license_key: str, server_url: str = "") -> tuple[bool, str]:
    license_key = license_key.strip().upper()
    if not license_key:
        return False, "请输入鉴权密钥"
    server_url = SOFTWARE_LICENSE_SERVER_URL.rstrip("/")
    machine_id = software_machine_fingerprint()
    ok, msg, payload = call_license_server(license_key, machine_id)
    if not ok or not payload:
        return False, msg
    saved_payload = {
        "app": APP_NAME,
        "license_key": payload["license_key"],
        "machine_id": payload["machine_id"],
        "server_url": server_url,
        "plan": payload.get("plan", "deploy"),
        "expires_at": int(payload.get("expires_at") or 0),
        "active": 1,
        "signature": payload.get("signature", ""),
        "activated_at": now(),
        "last_check_at": now(),
        "created_at": now(),
    }
    with db() as conn:
        conn.execute("UPDATE software_license SET active=0")
        conn.execute(
            "INSERT INTO software_license(license_key, machine_id, server_url, plan, expires_at, active, signature, activated_at, last_check_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (saved_payload["license_key"], saved_payload["machine_id"], server_url, saved_payload["plan"], saved_payload["expires_at"], 1, saved_payload["signature"], saved_payload["activated_at"], saved_payload["last_check_at"], saved_payload["created_at"]),
        )
    save_software_license_file(saved_payload)
    return True, f"软件授权已激活，授权文件已保存到 {SOFTWARE_LICENSE_FILE}；重装后机器指纹一致会自动通过"


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


def create_invite_key(note: str, max_uses: int, max_ports: int, user_expires_days: int, key_expires_days: int, created_by: int, traffic_limit_bytes: int = 0, bandwidth_limit_kbps: int = 0) -> tuple[bool, str, str | None]:
    note = note.strip()[:120]
    max_uses = 1  # 注册密钥按业务规则只能使用一次
    if max_ports < 1 or max_ports > 100:
        return False, "端口数量必须在 1-100 之间", None
    if user_expires_days < 0 or user_expires_days > 3650:
        return False, "用户有效期必须在 0-3650 天之间", None
    if key_expires_days < 0 or key_expires_days > 3650:
        return False, "密钥有效期必须在 0-3650 天之间", None
    if traffic_limit_bytes < 0 or bandwidth_limit_kbps < 0:
        return False, "流量/网速限制不能小于 0", None
    key = "FML-" + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24].upper()
    key_expires_at = 0 if key_expires_days == 0 else now() + key_expires_days * 86400
    with db() as conn:
        conn.execute(
            "INSERT INTO invite_keys(seq_no, key, note, max_uses, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, user_expires_days, expires_at, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (int(conn.execute("SELECT COALESCE(MAX(seq_no),0) FROM invite_keys").fetchone()[0]) + 1,
             key, note, max_uses, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, user_expires_days, key_expires_at, created_by, now()),
        )
    return True, "密钥已生成", key


def create_invite_keys_batch(note: str, max_uses: int, max_ports: int, user_expires_days: int, key_expires_days: int, created_by: int, count: int, traffic_limit_bytes: int = 0, bandwidth_limit_kbps: int = 0, kind: str = "register") -> tuple[bool, str, list[str]]:
    note = note.strip()[:120]
    max_uses = 1  # 注册/续期密钥按业务规则只能使用一次
    kind = str(kind).lower()
    if kind not in ("register", "renew", "reset"):
        kind = "register"
    if count < 1 or count > 500:
        return False, "单次生成数量必须在 1-500 之间", []
    if kind == "register" and (max_ports < 1 or max_ports > 100):
        return False, "端口数量必须在 1-100 之间", []
    if user_expires_days < 0 or user_expires_days > 3650:
        return False, ("续期天数" if kind == "renew" else "用户有效期") + "必须在 0-3650 天之间", []
    if key_expires_days < 0 or key_expires_days > 3650:
        return False, "密钥有效期必须在 0-3650 天之间", []
    if traffic_limit_bytes < 0 or bandwidth_limit_kbps < 0:
        return False, "流量/网速限制不能小于 0", []
    keys: list[str] = []
    key_expires_at = 0 if key_expires_days == 0 else now() + key_expires_days * 86400
    prefix = {"renew": "RNW-", "reset": "RST-"}.get(kind, "FML-")
    with db() as conn:
        for _ in range(count):
            key = prefix + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24].upper()
            conn.execute(
                "INSERT INTO invite_keys(seq_no, key, note, max_uses, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, user_expires_days, expires_at, created_by, created_at, kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (int(conn.execute("SELECT COALESCE(MAX(seq_no),0) FROM invite_keys").fetchone()[0]) + 1,
                 key, note, max_uses, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, user_expires_days, key_expires_at, created_by, now(), kind),
            )
            keys.append(key)
    return True, f"已生成 {len(keys)} 枚密钥", keys


def register_with_invite(username: str, password: str, invite_key: str, node_id: int, email: str = "", code: str = "") -> tuple[bool, str]:
    username = username.strip()
    invite_key = invite_key.strip().upper()
    email = str(email or "").strip()
    if not username or len(username) > 32 or not username.replace("_", "").replace("-", "").isalnum():
        return False, "用户名只能包含字母、数字、下划线、短横线，长度 1-32"
    if len(password) < 6:
        return False, "密码至少 6 位"
    if not OPEN_REGISTRATION and not invite_key:
        return False, "请输入注册密钥"
    if OPEN_REGISTRATION and not invite_key:
        # 开放注册：必须填写邮箱并通过邮箱验证码校验
        if not email or "@" not in email or len(email) < 5 or len(email) > 120:
            return False, "请填写正确的邮箱地址"
        if not str(code or "").strip():
            return False, "请填写邮箱验证码"
        ok_code, msg_code = verify_registration_code(username, email, code)
        if not ok_code:
            return False, msg_code
        with db() as conn:
            if conn.execute("SELECT id FROM users WHERE lower(email)=lower(?) AND email!=''", (email,)).fetchone():
                return False, "该邮箱已被注册"
    with db() as conn:
        key_row = None
        if invite_key:
            key_row = conn.execute("SELECT * FROM invite_keys WHERE key=? AND deleted=0", (invite_key,)).fetchone()
            if not key_row:
                if not OPEN_REGISTRATION:
                    return False, "注册密钥无效"
                key_row = None
            elif (row_val(key_row, "kind", "register") or "register") != "register":
                return False, "注册密钥无效"
            elif key_row["used_count"] >= 1:
                return False, "注册密钥已使用"
            elif not key_row["active"]:
                return False, "注册密钥已停用"
            elif key_row["expires_at"] and key_row["expires_at"] <= now():
                return False, "注册密钥已过期"
        node = conn.execute("SELECT * FROM nodes WHERE id=? AND active=1", (node_id,)).fetchone() if node_id else None
        if key_row and not node:
            return False, "请选择有效的地区节点"
        if not node:
            node_id = None
        max_ports = int(key_row["max_ports"]) if key_row else OPEN_REGISTRATION_MAX_PORTS
        traffic_limit_bytes = int(row_val(key_row, "traffic_limit_bytes", 0) or 0) if key_row else 0
        bandwidth_limit_kbps = int(row_val(key_row, "bandwidth_limit_kbps", 0) or 0) if key_row else 0
        free_ports = available_ports_for_assignment(conn, node_id, max_ports) if node and max_ports else []
        if node and len(free_ports) < max_ports:
            return False, f"端口池不足，只剩 {len(free_ports)} 个可用端口"
        user_expires_at = 0
        try:
            cur = insert_user_record(conn, username, password_hash(password), "user", secrets.token_urlsafe(24), max_ports, user_expires_at, node_id, invite_key if key_row else ("OPEN-" + secrets.token_urlsafe(10)), traffic_limit_bytes, bandwidth_limit_kbps, email)
        except sqlite3.IntegrityError as exc:
            if "users.username" in str(exc) or "username" in str(exc).lower():
                return False, "用户名已存在"
            print(f"[register] database integrity error: {exc}", flush=True)
            return False, "注册失败，请稍后重试"
        user_id = cur.lastrowid
        if free_ports:
            conn.executemany("UPDATE ports SET user_id=? WHERE node_id=? AND port=?", [(user_id, node_id, r["port"]) for r in free_ports])
        if key_row:
            claimed = conn.execute("UPDATE invite_keys SET used_count=used_count+1, active=0 WHERE id=? AND used_count=0 AND active=1", (key_row["id"],)).rowcount
            if claimed != 1:
                conn.rollback()
                return False, "注册密钥已使用"
    detail = f"地区节点：{node['region']} / {node['name']}，已分配 {max_ports} 个端口" if node else "暂未绑定节点和端口"
    return True, f"注册成功，{detail}，到期时间：{fmt_time(user_expires_at)}"

def reset_password_with_key(username: str, new_password: str, raw_key: str) -> tuple[bool, str]:
    username = str(username or "").strip()
    key = str(raw_key or "").strip().upper()
    if not username:
        return False, "请输入用户名"
    if len(new_password) < 6:
        return False, "新密码至少 6 位"
    if not key:
        return False, "请输入重置密钥"
    with db() as conn:
        row = conn.execute("SELECT * FROM invite_keys WHERE key=? AND deleted=0", (key,)).fetchone()
        if not row or (row_val(row, "kind", "register") or "register") != "reset":
            return False, "重置密钥无效"
        if row["used_count"] >= 1:
            return False, "重置密钥已使用"
        if not row["active"]:
            return False, "重置密钥已停用"
        if row["expires_at"] and row["expires_at"] <= now():
            return False, "重置密钥已过期"
        urow = conn.execute("SELECT id FROM users WHERE username=? AND role!='admin'", (username,)).fetchone()
        if not urow:
            return False, "用户不存在或不允许重置管理员密码"
        claimed = conn.execute("UPDATE invite_keys SET used_count=used_count+1, active=0 WHERE id=? AND used_count=0 AND active=1", (row["id"],)).rowcount
        if claimed != 1:
            conn.rollback()
            return False, "重置密钥已使用"
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(new_password), urow["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (urow["id"],))
    audit("password_reset", None, None, None, "", f"用户 {username} 通过重置密钥修改密码")
    return True, "密码已重置，请用新密码登录"


def renew_user_with_key(user: sqlite3.Row, raw_key: str) -> tuple[bool, str]:
    key = raw_key.strip().upper()
    if not key:
        return False, "请输入续期密钥"
    with db() as conn:
        row = conn.execute("SELECT * FROM invite_keys WHERE key=? AND deleted=0", (key,)).fetchone()
        if not row or (row_val(row, "kind", "register") or "register") != "renew":
            return False, "续期密钥无效"
        if row["used_count"] >= 1:
            return False, "续期密钥已使用"
        if not row["active"]:
            return False, "续期密钥已停用"
        if row["expires_at"] and row["expires_at"] <= now():
            return False, "续期密钥已过期"
        days = int(row["user_expires_days"])
        if days <= 0:
            return False, "续期密钥未设置有效天数"
        urow = conn.execute("SELECT expires_at FROM users WHERE id=?", (user["id"],)).fetchone()
        base = int(urow["expires_at"] or 0) if urow else 0
        new_expires_at = max(now(), base) + days * 86400
        claimed = conn.execute("UPDATE invite_keys SET used_count=used_count+1, active=0 WHERE id=? AND used_count=0 AND active=1", (row["id"],)).rowcount
        if claimed != 1:
            conn.rollback()
            return False, "续期密钥已使用"
        conn.execute("UPDATE users SET expires_at=?, active=1 WHERE id=?", (new_expires_at, user["id"]))
    audit("user_renew", user, None, None, "", f"使用续期密钥 +{days} 天")
    return True, f"续期成功，已延长 {days} 天，到期时间：{fmt_time(new_expires_at)}"


def audit(event: str, user: sqlite3.Row | None = None, node_id: int | None = None, remote_port: int | None = None, proxy_type: str = "", detail: str = "") -> None:
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO audit_logs(event, user_id, username, node_id, remote_port, proxy_type, detail, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (event, user["id"] if user else None, user["username"] if user else "", node_id, remote_port, proxy_type, detail[:1000], now()),
            )
    except Exception:
        pass


def first_nested_value(obj: Any, keys: set[str], max_depth: int = 5) -> Any:
    """Find a key in frp plugin payload variants without trusting one exact shape."""
    if max_depth < 0:
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k) in keys:
                return v
        for v in obj.values():
            found = first_nested_value(v, keys, max_depth - 1)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = first_nested_value(v, keys, max_depth - 1)
            if found is not None:
                return found
    return None


def int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def plugin_node_from_query(path: str) -> tuple[int | None, str]:
    # frps appends plugin metadata as `?op=Login&version=...` to the configured
    # httpPlugins.path. If the configured path already contains query params,
    # current frp versions may produce `/frp-plugin?node_id=1&node_token=x?op=...`.
    # Treat the second `?` as the start of frps metadata so node_token remains `x`.
    parsed = urlparse(path)
    qs = urllib.parse.parse_qs(parsed.query)
    node_id = int_or_none((qs.get("node_id") or qs.get("node") or [None])[0])
    node_token = str((qs.get("node_token") or qs.get("node_auth") or qs.get("token") or [""])[0])
    if "?" in node_token:
        node_token = node_token.split("?", 1)[0]
    return node_id, node_token


def frp_plugin_path(node: sqlite3.Row) -> str:
    token = urllib.parse.quote(str(node["auth_token"]), safe="")
    return f"/frp-plugin?node_id={int(node['id'])}&node_token={token}"


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
            WHERE s.token=? AND s.expires_at>? AND u.active=1
            """,
            (morsel.value, now()),
        ).fetchone()


def download_token_user(token: str) -> sqlite3.Row | None:
    """Resolve a normal user by their long-lived panel token for script URL downloads."""
    token = str(token or "").strip()
    if not token:
        return None
    with db() as conn:
        return conn.execute(
            """
            SELECT * FROM users
            WHERE token=? AND role!='admin' AND active=1
            """,
            (token,),
        ).fetchone()


def clear_session(cookie_header: str | None) -> None:
    cookie = SimpleCookie(cookie_header)
    morsel = cookie.get("fml_session")
    if morsel:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (morsel.value,))


NOTIFY_TEMPLATES: dict[str, dict[str, str]] = {
    "ticket_new_owner": {
        "title": "新工单：{title}",
        "content": "用户 {username} 提交了故障工单（{ticket_no}），关联实例：{node}。请尽快处理。",
    },
    "ticket_new_admin": {
        "title": "新工单：{title}",
        "content": "用户 {username} 提交了平台工单（{ticket_no}），关联实例：{node}。请尽快处理。",
    },
    "ticket_reply_owner": {
        "title": "工单有新回复：{title}",
        "content": "工单 {ticket_no} 收到 {username} 的回复，请及时查看并跟进。",
    },
    "ticket_reply_user": {
        "title": "工单有新回复：{title}",
        "content": "你提交的工单 {ticket_no} 收到新回复，请查看处理进度。",
    },
    "ticket_closed": {
        "title": "工单已关闭：{title}",
        "content": "工单 {ticket_no} 已处理完成并关闭。处理结果：{resolution}",
    },
    "payout_new": {
        "title": "提现申请：¥{amount}",
        "content": "用户 {username} 提交提现申请，单号 {payout_no}，方式 {method}。请审核打款。",
    },
    "payout_paid": {
        "title": "提现已打款：¥{amount}",
        "content": "提现单 {payout_no} 已打款，请留意到账。",
    },
    "host_approved": {
        "title": "托管审核通过：{name}",
        "content": "你的母鸡「{name}」已通过审核，节点与套餐已上架，用户可开始购买。",
    },
    "host_submitted": {
        "title": "托管待审核：{name}",
        "content": "用户 {username} 的母鸡「{name}」已接入平台，请核查信息后决定是否上架。",
    },
    "income_to_balance": {
        "title": "收益已转入余额：¥{amount}",
        "content": "你的托管收益 ¥{amount} 已转入账户余额，可直接用于购买套餐。",
    },
    "payout_rejected": {
        "title": "提现被驳回：¥{amount}",
        "content": "提现单 {payout_no} 未通过审核，金额已退回可提现收益。原因：{reason}",
    },
}


def render_notification(kind: str, **params: Any) -> tuple[str, str]:
    tpl = NOTIFY_TEMPLATES.get(kind)
    if not tpl:
        return str(params.get("title", "")), str(params.get("content", ""))
    safe = {k: ("" if v is None else str(v)) for k, v in params.items()}
    def fmt(text: str) -> str:
        try:
            return text.format(**safe)
        except (KeyError, IndexError):
            return text
    return fmt(tpl["title"]), fmt(tpl["content"])


def notify(conn: sqlite3.Connection, user_id: int, kind: str, link: str = "", **params: Any) -> None:
    """按固定模板发送通知。"""
    title, content = render_notification(kind, **params)
    notify_user(conn, user_id, kind, title, content, link)


def notify_admins_tpl(conn: sqlite3.Connection, kind: str, link: str = "", **params: Any) -> None:
    title, content = render_notification(kind, **params)
    notify_admins(conn, kind, title, content, link)


def notify_user(conn: sqlite3.Connection, user_id: int, kind: str, title: str, content: str = "", link: str = "") -> None:
    if not user_id:
        return
    conn.execute(
        "INSERT INTO notifications(user_id, kind, title, content, link, read_at, created_at) VALUES(?,?,?,?,?,0,?)",
        (int(user_id), str(kind)[:24], str(title)[:120], str(content)[:500], str(link)[:200], now()))


def notify_admins(conn: sqlite3.Connection, kind: str, title: str, content: str = "", link: str = "") -> None:
    for r in conn.execute("SELECT id FROM users WHERE role='admin' AND active=1"):
        notify_user(conn, int(r["id"]), kind, title, content, link)


def provider_income_balance(conn: sqlite3.Connection, owner_id: int) -> int:
    row = conn.execute("SELECT points FROM provider_income WHERE owner_id=?", (owner_id,)).fetchone()
    return int(row["points"] or 0) if row else 0


def provider_income_consume(conn: sqlite3.Connection, owner_id: int, points: int) -> None:
    points = int(points)
    if points <= 0:
        raise ValueError("提现金额必须大于 0")
    have = provider_income_balance(conn, owner_id)
    if points > have:
        raise ValueError(f"可提现收益不足，当前 {have} 积分")
    conn.execute("UPDATE provider_income SET points=points-?, updated_at=? WHERE owner_id=?", (points, now(), owner_id))


TICKET_ALLOWED_TAGS = {"b", "strong", "i", "em", "u", "ul", "ol", "li", "br", "p", "div", "span"}


def sanitize_ticket_html(raw: str) -> str:
    """工单内容白名单清洗：只保留基础格式标签，去掉所有属性与脚本。"""
    text = str(raw or "")[:6000]
    text = re.sub(r"(?is)<(script|style|iframe|object|embed)[^>]*>.*?</\1>", "", text)
    def _tag(m):
        name = re.match(r"</?\s*([a-zA-Z0-9]+)", m.group(0))
        if not name:
            return ""
        tag = name.group(1).lower()
        if tag not in TICKET_ALLOWED_TAGS:
            return ""
        return f"</{tag}>" if m.group(0).startswith("</") else f"<{tag}>"
    return re.sub(r"(?s)<[^>]+>", _tag, text).strip()


def clean_attachment_tokens(conn: sqlite3.Connection, user_id: int, raw: Any, limit: int = 6) -> str:
    items = raw if isinstance(raw, list) else []
    tokens: list[str] = []
    for t in items[:limit]:
        tok = str(t or "").strip()
        if not tok or tok in tokens:
            continue
        row = conn.execute("SELECT 1 FROM uploads WHERE token=? AND user_id=?", (tok, user_id)).fetchone()
        if row:
            tokens.append(tok)
    return json.dumps(tokens, ensure_ascii=False)


def new_ticket_no() -> str:
    return "TK" + time.strftime("%Y%m%d%H%M%S", time.localtime()) + secrets.token_hex(2).upper()


def new_payout_no() -> str:
    return "PO" + time.strftime("%Y%m%d%H%M%S", time.localtime()) + secrets.token_hex(2).upper()


def ticket_message_public(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["attachments"] = json.loads(d.get("attachments") or "[]")
    except Exception:
        d["attachments"] = []
    return d


def ticket_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "ticket_no": row["ticket_no"], "kind": row["kind"], "status": row["status"],
        "user_id": int(row["user_id"]), "username": row["username"], "node_id": int(row["node_id"] or 0),
        "owner_id": int(row["owner_id"] or 0), "title": row["title"], "content": row["content"],
        "node_name": (row["node_name"] if "node_name" in row.keys() else "") or "",
        "attachments": json.loads(row["attachments"] or "[]") if "attachments" in row.keys() else [],
        "resolution": (row["resolution"] if "resolution" in row.keys() else "") or "",
        "created_at": int(row["created_at"] or 0), "updated_at": int(row["updated_at"] or 0),
    }


def reject_payout(conn: sqlite3.Connection, row: sqlite3.Row, reason: str = "", status: str = "rejected") -> bool:
    """把待处理的提现单置为已拒绝/已撤销，并把积分退回收益池。"""
    if not row or str(row["status"] or "") != "pending":
        return False
    status = "cancelled" if status == "cancelled" else "rejected"
    conn.execute("UPDATE payouts SET status=?, updated_at=? WHERE id=?", (status, now(), int(row["id"])))
    conn.execute(
        "INSERT INTO provider_income(owner_id, points, updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET points=points+excluded.points, updated_at=excluded.updated_at",
        (int(row["user_id"]), int(row["points"] or 0), now()))
    ledger_add(conn, "points", "reverse", "payout_reject", q2(row["points"]), int(row["user_id"]),
               row["username"], 0, str(row["payout_no"]), "", reason or "提现冲正")
    return True


def payout_ticket_id(conn: sqlite3.Connection, payout_no: str) -> int:
    """提现单对应的工单 id（提现工单内容里带有单号）。"""
    if not payout_no:
        return 0
    row = conn.execute("SELECT id FROM tickets WHERE kind='withdraw' AND content LIKE ? ORDER BY id DESC LIMIT 1",
                       (f"%{payout_no}%",)).fetchone()
    return int(row["id"]) if row else 0


def payout_public(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "payout_no": row["payout_no"], "user_id": int(row["user_id"]),
        "username": row["username"], "points": int(row["points"] or 0), "method": row["method"],
        "account": row["account"], "holder": row["holder"],
        "qr_token": row_val(row, "qr_token", "") or "", "status": row["status"],
        "note": row["note"], "created_at": int(row["created_at"] or 0), "updated_at": int(row["updated_at"] or 0),
        "ticket_id": payout_ticket_id(conn, str(row["payout_no"] or "")) if conn is not None else 0,
    }


def make_csrf_token() -> str:
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("DELETE FROM csrf_tokens WHERE expires_at <= ?", (now(),))
        conn.execute("INSERT INTO csrf_tokens(token, expires_at, created_at) VALUES(?,?,?)", (token, now() + CSRF_TTL, now()))
    return token


def validate_csrf(token: str | None, cookie_header: str | None = None) -> bool:
    if not token:
        return False
    # 双提交（double-submit）：请求头里的 token 必须与 fml_csrf Cookie 一致，
    # 防止攻击者用自己领取的 token 去伪造跨站请求。没有该 Cookie 一律拒绝。
    try:
        morsel = SimpleCookie(cookie_header or "").get("fml_csrf")
    except Exception:
        morsel = None
    if not morsel or not hmac.compare_digest(str(morsel.value), str(token)):
        return False
    with db() as conn:
        row = conn.execute("SELECT token FROM csrf_tokens WHERE token=? AND expires_at>?", (token, now())).fetchone()
    return bool(row)


def _ip_in_cidrs(ip: str, cidrs: list[str]) -> bool:
    try:
        addr = ipaddress.ip_address(str(ip))
    except ValueError:
        return False
    for c in cidrs:
        c = (c or "").strip()
        if not c:
            continue
        try:
            if "/" in c:
                if addr in ipaddress.ip_network(c, strict=False):
                    return True
            elif addr == ipaddress.ip_address(c):
                return True
        except ValueError:
            continue
    return False


# 只有来自受信任代理（默认：回环 + 内网）的连接才采信 X-Real-IP / X-Forwarded-For，
# 否则直接使用 TCP 对端地址，避免公网客户端伪造 IP 绕过登录限流。
TRUSTED_PROXIES = [c for c in os.getenv(
    "FML_TRUSTED_PROXIES",
    "127.0.0.0/8,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
).split(",") if c.strip()]


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    peer = handler.client_address[0]
    if _ip_in_cidrs(peer, TRUSTED_PROXIES):
        xri = (handler.headers.get("X-Real-IP") or "").strip()
        if xri:
            return xri
        xff = (handler.headers.get("X-Forwarded-For") or "").strip()
        if xff:
            return xff.split(",")[0].strip()
    return peer


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


def user_instance_tunnels(conn: sqlite3.Connection, user_id: int, node_id: int, plan_id: int = 0) -> list[sqlite3.Row] | None:
    """按实例取隧道；plan_id 不属于该用户时返回 None。"""
    if not plan_id:
        return conn.execute("SELECT * FROM tunnels WHERE user_id=? AND node_id=? ORDER BY id", (user_id, node_id)).fetchall()
    own = conn.execute("SELECT id FROM user_plans WHERE id=? AND user_id=? AND node_id=?",
                       (plan_id, user_id, node_id)).fetchone()
    if not own:
        return None
    plan_ports = [int(r["port"]) for r in conn.execute(
        "SELECT port FROM user_plan_ports WHERE user_plan_id=?", (plan_id,)).fetchall()]
    if plan_ports:
        placeholders = ",".join("?" * len(plan_ports))
        return conn.execute(
            f"SELECT * FROM tunnels WHERE user_id=? AND node_id=? AND (plan_id=? OR (plan_id=0 AND remote_port IN ({placeholders}))) ORDER BY id",
            (user_id, node_id, plan_id, *plan_ports)).fetchall()
    return conn.execute("SELECT * FROM tunnels WHERE user_id=? AND node_id=? AND plan_id=? ORDER BY id",
                        (user_id, node_id, plan_id)).fetchall()


def tunnel_config(user: sqlite3.Row, node: sqlite3.Row, tunnels: list[sqlite3.Row]) -> str:
    def _ts(v):
        return json.dumps(str(v) if v is not None else "", ensure_ascii=False)
    lines = [
        f"serverAddr = {_ts(node['server_addr'])}",
        f"serverPort = {node['server_port']}",
        "",
        'auth.method = "token"',
        f"auth.token = {_ts(node['auth_token'])}",
        f"user = {_ts(user['username'])}",
        f"metadatas.panelToken = {_ts(user['token'])}",
        "",
        "transport.poolCount = 5",
        "transport.tcpMux = true",
        "",
    ]
    for t in tunnels:
        if not t["enabled"]:
            continue
        proxy_type = t["proxy_type"]
        lines.extend(
            [
                "[[proxies]]",
                f"name = {_ts(t['name'])}",
                f'type = "{proxy_type}"',
                f"localIP = {_ts(t['local_ip'])}",
                f"localPort = {t['local_port']}",
            ]
        )
        if proxy_type in REMOTE_PORT_PROXY_TYPES:
            lines.append(f'remotePort = {t["remote_port"]}')
        if proxy_type == "tcpmux":
            lines.append('multiplexer = "httpconnect"')
        if proxy_type in DOMAIN_PROXY_TYPES and t["custom_domains"]:
            domains = [d.strip() for d in str(t["custom_domains"]).split(",") if d.strip()]
            lines.append("customDomains = [" + ", ".join(json.dumps(d, ensure_ascii=False) for d in domains) + "]")
        if proxy_type in SECRET_KEY_PROXY_TYPES and t["secret_key"]:
            lines.append(f'secretKey = {json.dumps(t["secret_key"], ensure_ascii=False)}')
        lines.append("")
    return "\n".join(lines)


def frpc_deploy_script(config: str, frp_version: str = FRP_CLIENT_VERSION) -> str:
    cfg_b64 = base64.b64encode(config.encode("utf-8")).decode("ascii")
    return f'''#!/usr/bin/env bash
set -euo pipefail

FRP_VERSION="{frp_version}"
SERVICE_NAME="frpc"
DEFAULT_CONFIG="/etc/frp/frpc.toml"
CONFIG_B64='{cfg_b64}'

log() {{ printf '\\033[1;32m[frpc-deploy]\\033[0m %s\\n' "$*"; }}
warn() {{ printf '\\033[1;33m[frpc-deploy] WARN:\\033[0m %s\\n' "$*"; }}
fail() {{ printf '\\033[1;31m[frpc-deploy] ERROR:\\033[0m %s\\n' "$*" >&2; exit 1; }}

[ "$(id -u)" = "0" ] || fail "请用 root 执行：sudo bash deploy-frpc.sh"

need_cmd() {{ command -v "$1" >/dev/null 2>&1; }}

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) FRP_ARCH="amd64" ;;
  aarch64|arm64) FRP_ARCH="arm64" ;;
  armv7l|armv7*) FRP_ARCH="arm" ;;
  armv6l|armv6*) FRP_ARCH="arm" ;;
  i386|i686) FRP_ARCH="386" ;;
  *) fail "暂不支持的架构：$arch" ;;
esac

config_path="$DEFAULT_CONFIG"
if need_cmd systemctl && systemctl list-unit-files 2>/dev/null | grep -q '^frpc\\.service'; then
  detected="$(systemctl cat frpc 2>/dev/null | sed -nE 's/.*[[:space:]]-c[[:space:]]+([^[:space:]]+).*/\\1/p' | tail -1 || true)"
  [ -n "$detected" ] && config_path="$detected"
elif [ -f /etc/init.d/frpc ]; then
  detected="$(grep -Eo -- '-c[[:space:]]+[^[:space:]]+' /etc/init.d/frpc 2>/dev/null | awk '{{print $2}}' | tail -1 || true)"
  [ -n "$detected" ] && config_path="$detected"
fi

install_dir="/usr/local/bin"
frpc_bin="$install_dir/frpc"
mkdir -p "$(dirname "$config_path")" "$install_dir"

if [ -f "$config_path" ]; then
  cp -a "$config_path" "$config_path.bak.$(date +%Y%m%d-%H%M%S)"
  log "已备份旧配置：$config_path.bak.*"
fi

if need_cmd base64; then
  printf '%s' "$CONFIG_B64" | base64 -d > "$config_path"
else
  python3 - <<PY > "$config_path"
import base64
print(base64.b64decode("$CONFIG_B64").decode(), end="")
PY
fi
chmod 600 "$config_path"
log "已写入配置：$config_path"

installed=0
if need_cmd frpc; then
  current="$(frpc --version 2>/dev/null || true)"
  if [ "$current" = "$FRP_VERSION" ]; then installed=1; fi
fi
if [ -x "$frpc_bin" ]; then
  current="$($frpc_bin --version 2>/dev/null || true)"
  if [ "$current" = "$FRP_VERSION" ]; then installed=1; fi
fi

if [ "$installed" != "1" ]; then
  need_cmd tar || fail "缺少 tar，请先安装 tar"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  package="frp_${{FRP_VERSION}}_linux_${{FRP_ARCH}}"
  url="https://github.com/fatedier/frp/releases/download/v${{FRP_VERSION}}/${{package}}.tar.gz"
  log "下载 frpc $FRP_VERSION ($FRP_ARCH)"
  if need_cmd curl; then
    curl -fL --retry 3 -o "$tmp/frp.tgz" "$url"
  elif need_cmd wget; then
    wget -O "$tmp/frp.tgz" "$url"
  else
    fail "缺少 curl 或 wget，无法下载 frpc"
  fi
  tar -xzf "$tmp/frp.tgz" -C "$tmp"
  install -m 0755 "$tmp/$package/frpc" "$frpc_bin"
  log "已安装：$frpc_bin"
else
  log "检测到 frpc $FRP_VERSION，跳过下载"
fi

if need_cmd systemctl; then
  cat > /etc/systemd/system/frpc.service <<EOF
[Unit]
Description=frp client
Documentation=https://github.com/fatedier/frp
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$frpc_bin -c $config_path
Restart=always
RestartSec=5s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable frpc >/dev/null
  systemctl restart frpc
  sleep 1
  systemctl --no-pager --full status frpc || true
  log "frpc systemd 服务已启动"
elif command -v rc-service >/dev/null 2>&1; then
  cat > /etc/init.d/frpc <<EOF
#!/sbin/openrc-run
name="frpc"
description="frp client"
command="$frpc_bin"
command_args="-c $config_path"
command_background=true
pidfile="/run/frpc.pid"
start_stop_daemon_args="--background --make-pidfile"
depend() {{ need net; }}
EOF
  chmod +x /etc/init.d/frpc
  rc-update add frpc default >/dev/null 2>&1 || true
  rc-service frpc restart
  rc-service frpc status || true
  log "frpc OpenRC 服务已启动"
else
  warn "未检测到 systemd/OpenRC，改用 nohup 后台启动；建议手动配置守护服务。"
  pkill -f "frpc .* -c $config_path" 2>/dev/null || true
  nohup "$frpc_bin" -c "$config_path" >/var/log/frpc.log 2>&1 &
  log "frpc 已后台启动，日志：/var/log/frpc.log"
fi

log "完成。可用以下命令查看日志："
if need_cmd journalctl; then
  echo "  journalctl -u frpc -f"
else
  echo "  tail -f /var/log/frpc.log"
fi
'''


def frps_example_config(node: sqlite3.Row) -> str:
    return f'''# frps.example.toml for {node["region"]} / {node["name"]}
# frp 0.66+ 配置模板
bindPort = {node["server_port"]}

auth.method = "token"
auth.token = "{node["auth_token"]}"

allowPorts = [
  {{ start = {node["port_start"]}, end = {node["port_end"]} }}
]

# frp 0.66+ 传输层优化
transport.tcpMux = true
transport.maxPoolCount = 5

# 可选：TLS 加密 frpc↔frps 通信
# transport.tls.force = false
# transport.tls.certFile = "server.crt"
# transport.tls.keyFile = "server.key"

webServer.addr = "127.0.0.1"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "CHANGE_ME"

# Prometheus 监控指标（/metrics 端点）

# frps HTTP 插件鉴权 —— 面板会校验节点身份、账号状态、会话令牌和端口归属。
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "127.0.0.1:{PORT}"
path = "{frp_plugin_path(node)}"
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


def restore_full_backup_zip(admin_username: str, filename: str, content_base64: str) -> tuple[bool, str, dict[str, Any]]:
    raw = content_base64.strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        payload = base64.b64decode(raw, validate=True)
    except Exception as e:
        return False, f"备份文件 base64 解析失败：{e}", {}
    if not payload:
        return False, "备份文件为空", {}
    try:
        with zipfile.ZipFile(io.BytesIO(payload), "r") as z:
            names = set(z.namelist())
            if "data.sqlite3" not in names:
                return False, "备份 zip 中缺少 data.sqlite3", {}
            db_bytes = z.read("data.sqlite3")
            meta = json.loads(z.read("metadata.json").decode("utf-8")) if "metadata.json" in names else {}
    except Exception as e:
        return False, f"备份 zip 无效：{e}", {}
    if meta and meta.get("app") != APP_NAME:
        return False, "备份文件不是 frp-manager-lite 生成的", {}
    # 用临时文件校验：内存库 deserialize 后执行 PRAGMA 会报
    # "unable to open database file"，因此必须落盘校验。
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    probe = DB_PATH.parent / f".restore-probe-{secrets.token_hex(6)}.db"
    try:
        probe.write_bytes(db_bytes)
        with sqlite3.connect(probe) as chk:
            ok = chk.execute("PRAGMA integrity_check").fetchone()[0]
            if ok != "ok":
                return False, f"SQLite 完整性检查失败：{ok}", {}
            required = {"users", "nodes", "ports", "tunnels", "invite_keys"}
            tables = {r[0] for r in chk.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            missing = sorted(required - tables)
            if missing:
                return False, "备份数据库缺少必要表：" + ", ".join(missing), {}
    finally:
        try:
            probe.unlink()
        except FileNotFoundError:
            pass
        except Exception:
            pass
    backup_stamp, current_payload = make_full_backup_zip(admin_username)
    restore_dir = DB_PATH.parent / "restore-backups"
    restore_dir.mkdir(parents=True, exist_ok=True)
    current_backup = restore_dir / f"before-restore-{backup_stamp}.zip"
    current_backup.write_bytes(current_payload)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = DB_PATH.with_suffix(DB_PATH.suffix + ".restore.tmp")
    tmp.write_bytes(db_bytes)
    # WAL 模式下必须清掉旧的 -wal / -shm，否则旧日志会盖到新库上导致损坏。
    for wal_suffix in ("-wal", "-shm"):
        try:
            (DB_PATH.parent / (DB_PATH.name + wal_suffix)).unlink()
        except FileNotFoundError:
            pass
        except Exception:
            pass
    os.replace(tmp, DB_PATH)
    init_db()
    return True, "全量备份已恢复，当前数据库已替换", {"source_filename": filename, "pre_restore_backup": str(current_backup), "size": len(db_bytes), "metadata": meta}


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def setting_get(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return str(row["value"]) if row else default


def setting_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (key, value, now()),
    )


def r2_config_from_db(conn: sqlite3.Connection) -> dict[str, str]:
    # DB settings are primary; env vars are retained only as compatibility fallback.
    return {
        "account_id": setting_get(conn, "r2.account_id", R2_ACCOUNT_ID).strip(),
        "access_key_id": setting_get(conn, "r2.access_key_id", R2_ACCESS_KEY_ID).strip(),
        "secret_access_key": setting_get(conn, "r2.secret_access_key", R2_SECRET_ACCESS_KEY).strip(),
        "bucket": setting_get(conn, "r2.bucket", R2_BUCKET).strip(),
        "prefix": setting_get(conn, "r2.prefix", R2_PREFIX).strip(),
    }


def public_r2_config(conn: sqlite3.Connection) -> dict[str, Any]:
    cfg = r2_config_from_db(conn)
    db_has_values = any(setting_get(conn, f"r2.{k}", "").strip() for k in ["account_id", "access_key_id", "secret_access_key", "bucket", "prefix"])
    env_has_values = any([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET])
    configured = bool(cfg["account_id"] and cfg["access_key_id"] and cfg["secret_access_key"] and cfg["bucket"])
    return {
        "configured": configured,
        "source": "database" if db_has_values else ("env" if env_has_values else "empty"),
        "account_id": cfg["account_id"],
        "access_key_id": cfg["access_key_id"],
        "secret_set": bool(cfg["secret_access_key"]),
        "bucket": cfg["bucket"],
        "prefix": cfg["prefix"],
    }


def r2_configured(cfg: dict[str, str] | None = None) -> bool:
    if cfg is None:
        return bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET)
    return bool(cfg.get("account_id") and cfg.get("access_key_id") and cfg.get("secret_access_key") and cfg.get("bucket"))


def static_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        return "text/html; charset=utf-8"
    if suffix == ".js":
        return "application/javascript; charset=utf-8"
    if suffix == ".css":
        return "text/css; charset=utf-8"
    if suffix == ".svg":
        return "image/svg+xml; charset=utf-8"
    guessed = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if guessed.startswith("text/"):
        return guessed + "; charset=utf-8"
    return guessed


def upload_to_r2(object_key: str, body: bytes, content_type: str = "application/zip", cfg: dict[str, str] | None = None) -> str:
    cfg = cfg or {
        "account_id": R2_ACCOUNT_ID,
        "access_key_id": R2_ACCESS_KEY_ID,
        "secret_access_key": R2_SECRET_ACCESS_KEY,
        "bucket": R2_BUCKET,
        "prefix": R2_PREFIX,
    }
    if not r2_configured(cfg):
        raise RuntimeError("R2 未配置完整，请在仪表盘填写 Account ID、Access Key ID、Secret Access Key 和 Bucket")
    host = f"{cfg['account_id']}.r2.cloudflarestorage.com"
    region = "auto"
    service = "s3"
    method = "PUT"
    encoded_key = "/" + "/".join(urllib.parse.quote(part, safe="") for part in object_key.split("/"))
    url = f"https://{host}/{cfg['bucket']}{encoded_key}"
    t = time.gmtime()
    amz_date = time.strftime("%Y%m%dT%H%M%SZ", t)
    date_stamp = time.strftime("%Y%m%d", t)
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_uri = f"/{cfg['bucket']}{encoded_key}"
    canonical_headers = f"content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([method, canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, credential_scope, hashlib.sha256(canonical_request.encode()).hexdigest()])
    signing_key = _sign(_sign(_sign(_sign(("AWS4" + cfg["secret_access_key"]).encode("utf-8"), date_stamp), region), service), "aws4_request")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={cfg['access_key_id']}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
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



# ---------------------------------------------------------------------------
# 套餐 / 订单 / 在线支付
# ---------------------------------------------------------------------------

SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")
DEFAULT_ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do"
DEFAULT_WECHAT_GATEWAY = "https://api.mch.weixin.qq.com/pay/unifiedorder"


def _pem_to_der(pem: str) -> bytes:
    lines = [ln.strip() for ln in str(pem or "").strip().splitlines()
             if ln.strip() and not ln.strip().startswith("-----")]
    return base64.b64decode("".join(lines))


def _der_item(data: bytes, i: int):
    tag = data[i]
    i += 1
    ln = data[i]
    i += 1
    if ln & 0x80:
        n = ln & 0x7F
        ln = int.from_bytes(data[i:i + n], "big")
        i += n
    return tag, data[i:i + ln], i + ln


def _der_seq(data: bytes):
    out = []
    i = 0
    while i < len(data):
        tag, val, i = _der_item(data, i)
        out.append((tag, val))
    return out


def rsa_private_numbers(pem: str):
    der = _pem_to_der(pem)
    _, body, _ = _der_item(der, 0)
    items = _der_seq(body)
    # PKCS#8: INTEGER version, SEQUENCE algorithm, OCTET STRING privateKey
    if len(items) >= 3 and items[1][0] == 0x30 and items[2][0] == 0x04:
        inner = items[2][1]
        _, ibody, _ = _der_item(inner, 0)
        items = _der_seq(ibody)
    items = items[1:]
    return (int.from_bytes(items[0][1], "big"),
            int.from_bytes(items[1][1], "big"),
            int.from_bytes(items[2][1], "big"))


def rsa_public_numbers(pem: str):
    der = _pem_to_der(pem)
    _, body, _ = _der_item(der, 0)
    items = _der_seq(body)
    if len(items) >= 2 and items[0][0] == 0x30 and items[1][0] == 0x03:
        bits = items[1][1][1:]
        _, ibody, _ = _der_item(bits, 0)
        seq = _der_seq(ibody)
    else:
        seq = items
    return int.from_bytes(seq[0][1], "big"), int.from_bytes(seq[1][1], "big")


def rsa_sign_sha256(message: bytes, private_pem: str) -> str:
    n, _e, d = rsa_private_numbers(private_pem)
    k = (n.bit_length() + 7) // 8
    t = SHA256_DIGEST_INFO + hashlib.sha256(message).digest()
    if k < len(t) + 11:
        raise ValueError("RSA 私钥长度不足")
    em = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    s = pow(int.from_bytes(em, "big"), d, n)
    return base64.b64encode(s.to_bytes(k, "big")).decode()


def rsa_verify_sha256(message: bytes, signature_b64: str, public_pem: str) -> bool:
    try:
        n, e = rsa_public_numbers(public_pem)
        k = (n.bit_length() + 7) // 8
        sig = base64.b64decode(signature_b64)
        if len(sig) > k:
            return False
        em = pow(int.from_bytes(sig, "big"), e, n).to_bytes(k, "big")
        t = SHA256_DIGEST_INFO + hashlib.sha256(message).digest()
        expected = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
        return hmac.compare_digest(em, expected)
    except Exception:
        return False


def payment_config(conn: sqlite3.Connection) -> dict[str, Any]:
    return {
        "provider": setting_get(conn, "pay_provider", ""),
        "providers": setting_get(conn, "pay_providers", ""),
        "public_url": setting_get(conn, "pay_public_url", "").rstrip("/"),
        "alipay_app_id": setting_get(conn, "alipay_app_id", ""),
        "alipay_private_key": setting_get(conn, "alipay_private_key", ""),
        "alipay_public_key": setting_get(conn, "alipay_public_key", ""),
        "alipay_gateway": setting_get(conn, "alipay_gateway", DEFAULT_ALIPAY_GATEWAY),
        "wechat_appid": setting_get(conn, "wechat_appid", ""),
        "wechat_mch_id": setting_get(conn, "wechat_mch_id", ""),
        "wechat_api_key": setting_get(conn, "wechat_api_key", ""),
        "points_per_yuan": 1,
        "refund_fee_percent": max(0, min(100, int(setting_get(conn, "refund_fee_percent", "10") or 10))),
    }


PAYMENT_NAMES = {"alipay": "支付宝", "wechat": "微信支付", "mock": "测试模式"}
# 测试支付只允许在显式开启的本地环境使用，避免被用户直接调用刷积分
MOCK_PAY_ENABLED = os.getenv("FML_ALLOW_MOCK_PAY", "0").strip().lower() in ("1", "true", "yes", "on")


def enabled_payment_providers(cfg: dict[str, Any]) -> list[str]:
    raw = str(cfg.get("providers") or "").strip()
    if not raw:
        raw = str(cfg.get("provider") or "").strip()
    out: list[str] = []
    for item in raw.split(","):
        name = item.strip()
        if name == "mock" and not MOCK_PAY_ENABLED:
            continue
        if name in PAYMENT_NAMES and name not in out:
            out.append(name)
    return out


def provider_ready(name: str, cfg: dict[str, Any]) -> bool:
    if name == "mock":
        return True
    if name == "alipay":
        return bool(cfg.get("alipay_app_id") and cfg.get("alipay_private_key") and cfg.get("alipay_public_key"))
    if name == "wechat":
        return bool(cfg.get("wechat_appid") and cfg.get("wechat_mch_id") and cfg.get("wechat_api_key"))
    return False


def payment_public(cfg: dict[str, Any]) -> dict[str, Any]:
    # 测试模式仅用于本地联调，不对外展示
    enabled = [k for k in enabled_payment_providers(cfg) if k != "mock"]
    providers = [{"key": k, "name": PAYMENT_NAMES[k], "ready": provider_ready(k, cfg)} for k in enabled]
    ready = any(x["ready"] for x in providers)
    provider = next((x["key"] for x in providers if x["ready"]), (enabled[0] if enabled else ""))
    return {
        "providers": providers,
        "provider": provider,
        "ready": ready,
        "public_url": cfg.get("public_url", ""),
        "alipay_app_id": cfg.get("alipay_app_id", ""),
        "alipay_gateway": cfg.get("alipay_gateway", DEFAULT_ALIPAY_GATEWAY),
        "wechat_appid": cfg.get("wechat_appid", ""),
        "wechat_mch_id": cfg.get("wechat_mch_id", ""),
        "points_per_yuan": 1,
        "refund_fee_percent": int(cfg.get("refund_fee_percent") or 10),
        "alipay_configured": bool(cfg.get("alipay_app_id") and cfg.get("alipay_private_key") and cfg.get("alipay_public_key")),
        "wechat_configured": bool(cfg.get("wechat_appid") and cfg.get("wechat_mch_id") and cfg.get("wechat_api_key")),
    }


def plan_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "seq_no": int(row_val(row, "seq_no", 0) or 0),
        "name": row["name"],
        "price_cents": int(row["price_cents"] or 0),
        "price_text": f"{int(row['price_cents'] or 0) / 100:.2f}",
        "price_points": int(row_val(row, "price_points", 0) or 0),
        "billing_mode": (row_val(row, "billing_mode", "time") or "time"),
        "max_ports": int(row["max_ports"] or 0),
        "traffic_limit_bytes": int(row["traffic_limit_bytes"] or 0),
        "traffic_limit_gb": round(int(row["traffic_limit_bytes"] or 0) / 1024 / 1024 / 1024, 2),
        "bandwidth_limit_kbps": int(row["bandwidth_limit_kbps"] or 0),
        "bandwidth_limit_mbs": round(int(row["bandwidth_limit_kbps"] or 0) / 1024, 2),
        "duration_days": int(row["duration_days"] or 0),
        "node_id": int(row["node_id"] or 0),
        "note": row["note"] or "",
        "fair_use_note": row_val(row, "fair_use_note", "") or "",
        "active": bool(row["active"]),
        "sort_order": int(row["sort_order"] or 0),
        "created_at": int(row["created_at"] or 0),
    }


def list_plans(conn: sqlite3.Connection, active_only: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT * FROM plans WHERE deleted=0"
    if active_only:
        sql += " AND active=1"
    sql += " ORDER BY sort_order, seq_no, id"
    items = [plan_public(r) for r in conn.execute(sql)]
    for item in items:
        need = int(item.get("max_ports") or 0)
        if need <= 0:
            stock = 1
        elif item.get("node_id"):
            free = conn.execute("SELECT COUNT(*) FROM ports WHERE node_id=? AND user_id IS NULL", (int(item["node_id"]),)).fetchone()[0]
            stock = max(0, int(free) // need)
        else:
            free = conn.execute(
                "SELECT COUNT(*) FROM ports p JOIN nodes n ON n.id=p.node_id WHERE n.active=1 AND p.user_id IS NULL").fetchone()[0]
            stock = max(0, int(free) // need)
        item["stock"] = stock
        item["sold_out"] = stock <= 0
        item["stock_text"] = "已售罄" if stock <= 0 else f"剩余 {stock}"
    return items


def save_plan(plan_id: int, name: str, price_cents: int, max_ports: int, traffic_limit_bytes: int,
              bandwidth_limit_kbps: int, duration_days: int, node_id: int, note: str,
              active: bool, sort_order: int, price_points: int = 0, billing_mode: str = "time",
              fair_use_note: str = "") -> tuple[bool, str]:
    name = str(name or "").strip()[:60]
    if not name:
        return False, "请填写套餐名称"
    if price_cents < 0 or price_cents > 100_000_000:
        return False, "价格不合法"
    if max_ports < 0 or max_ports > 100:
        return False, "端口数量必须在 0-100 之间"
    if duration_days < 0 or duration_days > 3650:
        return False, "有效期必须在 0-3650 天之间"
    if traffic_limit_bytes < 0 or bandwidth_limit_kbps < 0:
        return False, "流量/速率限制不能小于 0"
    if price_points < 0 or price_points > 100_000_000:
        return False, "积分价格不合法"
    billing_mode = "traffic" if str(billing_mode) == "traffic" else "time"
    if billing_mode == "traffic" and traffic_limit_bytes <= 0:
        return False, "流量套餐必须填写流量额度"
    if billing_mode == "traffic":
        duration_days = 0
    if billing_mode == "time" and duration_days <= 0:
        return False, "时间套餐必须填写有效期天数"
    if billing_mode == "time" and duration_days > 30:
        return False, "时间套餐单次最长 30 天（按月购买）"
    node_id = int(node_id or 0)
    with db() as conn:
        if node_id and not conn.execute("SELECT 1 FROM nodes WHERE id=?", (node_id,)).fetchone():
            return False, "所选节点不存在"
        if plan_id:
            cur = conn.execute(
                "UPDATE plans SET name=?, price_cents=?, price_points=?, billing_mode=?, max_ports=?, traffic_limit_bytes=?, bandwidth_limit_kbps=?, duration_days=?, node_id=?, note=?, fair_use_note=?, active=?, sort_order=? WHERE id=?",
                (name, price_cents, price_points, billing_mode, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, duration_days,
                 node_id or None, str(note or "")[:200], str(fair_use_note or "")[:500], 1 if active else 0, sort_order, plan_id))
            if cur.rowcount == 0:
                return False, "套餐不存在"
        else:
            seq_no = int(conn.execute("SELECT COALESCE(MAX(seq_no),0) FROM plans").fetchone()[0]) + 1
            conn.execute(
                "INSERT INTO plans(seq_no, name, price_cents, price_points, billing_mode, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, duration_days, node_id, note, fair_use_note, active, sort_order, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (seq_no, name, price_cents, price_points, billing_mode, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, duration_days,
                 node_id or None, str(note or "")[:200], str(fair_use_note or "")[:500], 1 if active else 0, sort_order, now()))
    return True, "套餐已保存"


def order_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "order_no": row["order_no"],
        "username": row["username"],
        "plan_id": int(row["plan_id"] or 0),
        "plan_name": row["plan_name"],
        "kind": row_val(row, "kind", "plan") or "plan",
        "points": int(row_val(row, "points", 0) or 0),
        "amount_cents": int(row["amount_cents"] or 0),
        "amount_text": f"{int(row['amount_cents'] or 0) / 100:.2f}",
        "duration_days": int(row["duration_days"] or 0),
        "max_ports": int(row["max_ports"] or 0),
        "node_id": int(row["node_id"] or 0),
        "provider": row["provider"] or "",
        "status": row["status"],
        "pay_url": row["pay_url"] or "",
        "paid_at": int(row["paid_at"] or 0),
        "created_at": int(row["created_at"] or 0),
    }


def new_order_no() -> str:
    return time.strftime("%Y%m%d%H%M%S") + f"{secrets.randbelow(1000000):06d}"


def q2(value: Any) -> float:
    """积分保留两位小数（四舍五入）。"""
    try:
        return round(float(value or 0) + 1e-9, 2)
    except (TypeError, ValueError):
        return 0.0


def points_change(conn: sqlite3.Connection, user_id: int, delta: float, kind: str, ref: str = "", note: str = "") -> float:
    row = conn.execute("SELECT points, username FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise ValueError("用户不存在")
    delta = q2(delta)
    balance = q2(q2(row["points"]) + delta)
    if balance < 0:
        raise ValueError("积分不足")
    conn.execute("UPDATE users SET points=? WHERE id=?", (balance, user_id))
    conn.execute(
        "INSERT INTO point_logs(user_id, username, delta, balance_after, kind, ref, note, created_at) VALUES(?,?,?,?,?,?,?,?)",
        (user_id, row["username"], delta, balance, str(kind)[:32], str(ref)[:64], str(note)[:200], now()))
    return balance


def points_balance(user_id: int) -> float:
    with db() as conn:
        row = conn.execute("SELECT points FROM users WHERE id=?", (user_id,)).fetchone()
    return q2(row["points"]) if row else 0.0


LEDGER_CATEGORIES = {
    "plan_sale": "套餐销售",
    "recharge_cash": "在线充值",
    "recharge_points": "充值到账",
    "key_recharge": "密钥兑换",
    "refund": "退订退款",
    "node_refund": "节点故障退款",
    "provider_settle": "供应商结算",
    "guarantee": "保证金留存",
    "income_to_balance": "收益转余额",
    "withdraw_points": "收益转出",
    "withdraw_cash": "提现打款",
    "payout_reject": "提现驳回退回",
}


def ledger_add(conn: sqlite3.Connection, unit: str, direction: str, category: str, amount: float,
               user_id: int = 0, username: str = "", node_id: int = 0, order_no: str = "",
               ref: str = "", note: str = "", ts: int | None = None) -> None:
    """写入统一收支流水。unit=points/cash，direction=in/out（平台视角）。"""
    amount = q2(amount)
    if amount <= 0:
        return
    stamp = int(ts or now())
    conn.execute(
        "INSERT INTO ledger(ts, unit, direction, category, amount, user_id, username, node_id, order_no, ref, note, created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (stamp, str(unit), str(direction), str(category), amount, int(user_id or 0), str(username or ""),
         int(node_id or 0), str(order_no or ""), str(ref or ""), str(note or "")[:200], stamp))


def create_recharge_keys(points: int, count: int, note: str, expires_days: int, created_by: int) -> tuple[bool, str, list[str]]:
    points = int(points)
    count = int(count)
    if points < 1 or points > 1_000_000:
        return False, "单个密钥积分必须在 1-1000000 之间", []
    if count < 1 or count > 500:
        return False, "单次生成数量必须在 1-500 之间", []
    if expires_days < 0 or expires_days > 3650:
        return False, "有效期必须在 0-3650 天之间", []
    expires_at = 0 if expires_days == 0 else now() + expires_days * 86400
    keys: list[str] = []
    with db() as conn:
        for _ in range(count):
            key = "PT-" + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24].upper()
            conn.execute(
                "INSERT INTO recharge_keys(seq_no, key, points, note, active, expires_at, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (int(conn.execute("SELECT COALESCE(MAX(seq_no),0) FROM recharge_keys").fetchone()[0]) + 1,
                 key, points, str(note or "")[:120], 1, expires_at, created_by, now()))
            keys.append(key)
    return True, f"已生成 {len(keys)} 枚充值密钥", keys


def redeem_recharge_key(user: sqlite3.Row, raw_key: str) -> tuple[bool, str, int]:
    key = str(raw_key or "").strip().upper()
    if not key:
        return False, "请输入充值密钥", 0
    with db() as conn:
        row = conn.execute("SELECT * FROM recharge_keys WHERE key=? AND deleted=0", (key,)).fetchone()
        if not row:
            return False, "充值密钥无效", 0
        if int(row["used_by"] or 0):
            return False, "充值密钥已被使用", 0
        if not int(row["active"] or 0):
            return False, "充值密钥已停用", 0
        if int(row["expires_at"] or 0) and int(row["expires_at"]) <= now():
            return False, "充值密钥已过期", 0
        claimed = conn.execute("UPDATE recharge_keys SET used_by=?, used_at=? WHERE id=? AND used_by IS NULL AND active=1",
                               (user["id"], now(), row["id"])).rowcount
        if claimed != 1:
            return False, "充值密钥已被使用", 0
        balance = points_change(conn, user["id"], int(row["points"] or 0), "key_recharge", key[-8:], "充值密钥兑换")
        ledger_add(conn, "points", "in", "key_recharge", int(row["points"] or 0), int(user["id"]), user["username"], 0, "", key[-8:], "充值密钥兑换")
    return True, f"充值成功，获得 {int(row['points'])} 积分", balance


def sync_user_plan_ports(conn: sqlite3.Connection, user_id: int) -> int:
    """把账号名下端口收敛到「套餐端口」范围；无套餐记录的账号不动。"""
    has_plans = conn.execute("SELECT 1 FROM user_plans WHERE user_id=? LIMIT 1", (user_id,)).fetchone()
    if not has_plans:
        return 0
    plan_port_rows = conn.execute(
        "SELECT node_id, port FROM user_plan_ports WHERE user_id=? AND (release_at=0 OR release_at>?)",
        (user_id, now())).fetchall()
    if not plan_port_rows:
        # 有套餐但没有任何端口记录：视为历史数据异常，不主动回收
        return 0
    allowed = {(int(r["node_id"]), int(r["port"])) for r in plan_port_rows}
    extra = [(int(r["node_id"]), int(r["port"])) for r in conn.execute(
        "SELECT node_id, port FROM ports WHERE user_id=?", (user_id,))
        if (int(r["node_id"]), int(r["port"])) not in allowed]
    for node_id, port in extra:
        conn.execute("UPDATE tunnels SET enabled=0 WHERE user_id=? AND node_id=? AND remote_port=?", (user_id, node_id, port))
        conn.execute("UPDATE ports SET user_id=NULL WHERE node_id=? AND port=?", (node_id, port))
    return len(extra)


def recalc_user_entitlements(conn: sqlite3.Connection, user_id: int) -> None:
    """按当前有效套餐汇总用户权益；没有套餐记录时保持原值。"""
    rows = conn.execute(
        "SELECT * FROM user_plans WHERE user_id=? AND status='active' AND (expires_at=0 OR expires_at>?) ORDER BY id",
        (user_id, now())).fetchall()
    if not rows:
        conn.execute("UPDATE users SET max_ports=0, expires_at=0 WHERE id=?", (user_id,))
        return
    total_ports = sum(int(r["max_ports"] or 0) for r in rows)
    traffic_vals = [int(r["traffic_limit_bytes"] or 0) for r in rows]
    bw_vals = [int(r["bandwidth_limit_kbps"] or 0) for r in rows]
    expiry_vals = [int(r["expires_at"] or 0) for r in rows]
    traffic = 0 if any(v == 0 for v in traffic_vals) else sum(traffic_vals)
    bandwidth = 0 if any(v == 0 for v in bw_vals) else max(bw_vals)
    expires_at = 0 if any(v == 0 for v in expiry_vals) else max(expiry_vals)
    conn.execute(
        "UPDATE users SET max_ports=?, traffic_limit_bytes=?, bandwidth_limit_kbps=?, expires_at=? WHERE id=?",
        (min(100, total_ports), traffic, bandwidth, expires_at, user_id))


def refund_fee_percent(conn: sqlite3.Connection) -> int:
    try:
        return max(0, min(100, int(setting_get(conn, "refund_fee_percent", "10") or 10)))
    except (TypeError, ValueError):
        return 10


def plan_traffic_since(conn: sqlite3.Connection, plan_row: sqlite3.Row) -> int:
    since = int(plan_row["starts_at"] or 0)
    total = 0
    for pr in conn.execute("SELECT node_id, port FROM user_plan_ports WHERE user_plan_id=?", (plan_row["id"],)).fetchall():
        row = conn.execute(
            "SELECT COALESCE(SUM(bytes),0) FROM traffic_samples WHERE user_id=? AND node_id=? AND remote_port=? AND ts>?",
            (plan_row["user_id"], int(pr["node_id"]), int(pr["port"]), since)).fetchone()
        total += int(row[0] or 0) if row else 0
    return total


FULL_REFUND_WINDOW = int(os.getenv("FML_FULL_REFUND_MINUTES", "10") or 10) * 60


def compute_plan_refund(conn: sqlite3.Connection, plan_row: sqlite3.Row) -> dict[str, Any]:
    price = int(plan_row["price_points"] or 0)
    if (plan_row["status"] or "active") != "active":
        return {"eligible": False, "points": 0, "ratio": 0.0, "fee_percent": refund_fee_percent(conn), "gross": 0}
    within = (now() - int(plan_row["starts_at"] or 0)) <= FULL_REFUND_WINDOW
    if within and plan_traffic_since(conn, plan_row) == 0:
        return {"eligible": True, "points": price, "ratio": 1.0, "fee_percent": 0, "gross": price, "full_refund": True}
    ratios: list[float] = []
    if int(plan_row["expires_at"] or 0):
        total = max(1, int(plan_row["duration_days"] or 0) * 86400)
        remaining = max(0, int(plan_row["expires_at"]) - now())
        ratios.append(min(1.0, remaining / total))
    if int(plan_row["quota_bytes"] or 0) > 0:
        ratios.append(max(0.0, 1 - int(plan_row["used_bytes"] or 0) / int(plan_row["quota_bytes"])))
    ratio = min(ratios) if ratios else 1.0
    fee = refund_fee_percent(conn)
    gross = q2(price * ratio)
    net = q2(gross * (100 - fee) / 100)
    return {"eligible": True, "points": net, "ratio": round(ratio, 4), "fee_percent": fee, "gross": gross}


def cancel_user_plan(user: sqlite3.Row, user_plan_id: int) -> tuple[bool, str, dict[str, Any]]:
    with db() as conn:
        p = conn.execute("SELECT * FROM user_plans WHERE id=? AND user_id=?", (user_plan_id, user["id"])).fetchone()
        if not p:
            return False, "套餐记录不存在", {}
        if (p["status"] or "active") != "active":
            return False, "该套餐已失效，无法退订", {}
        info = compute_plan_refund(conn, p)
        conn.execute("UPDATE user_plans SET status='cancelled', expires_at=? WHERE id=?", (now(), p["id"]))
        release_plan_resources(conn, p, keep_ports=False)
        if q2(info["points"]) > 0:
            points_change(conn, int(user["id"]), q2(info["points"]), "plan_refund", p["plan_name"], "套餐退订退款")
            ledger_add(conn, "points", "out", "refund", q2(info["points"]), int(user["id"]), user["username"],
                       int(p["node_id"] or 0), str(p["order_no"] or ""), str(p["id"]), f"退订 {p['plan_name']}")
        recalc_user_entitlements(conn, int(user["id"]))
    amount = f"{q2(info['points']):.2f}"
    if info.get("full_refund"):
        msg = f"退订成功，10 分钟内未产生流量，全额退回 {amount} 积分"
    else:
        msg = f"退订成功，退回 {amount} 积分（剩余比例 {int(info['ratio']*100)}%，手续费 {info['fee_percent']}%）"
    return True, msg, info


PLAN_GRACE_SECONDS = int(os.getenv("FML_PLAN_GRACE_HOURS", "0") or 0) * 3600


def release_plan_resources(conn: sqlite3.Connection, plan_row: sqlite3.Row, keep_ports: bool = True) -> None:
    """停用隧道。宽限期为 0 时，到期/用尽也立即回收端口。"""
    if keep_ports and PLAN_GRACE_SECONDS <= 0:
        keep_ports = False
    ports = conn.execute("SELECT node_id, port FROM user_plan_ports WHERE user_plan_id=?", (plan_row["id"],)).fetchall()
    for pr in ports:
        node_id, port = int(pr["node_id"]), int(pr["port"])
        if keep_ports:
            conn.execute("UPDATE tunnels SET enabled=0 WHERE user_id=? AND node_id=? AND remote_port=?",
                         (plan_row["user_id"], node_id, port))
        else:
            # 主动退订：隧道随套餐一起删除，避免残留记录占住端口
            conn.execute("DELETE FROM tunnels WHERE user_id=? AND node_id=? AND remote_port=?",
                         (plan_row["user_id"], node_id, port))
            conn.execute("UPDATE ports SET user_id=NULL WHERE node_id=? AND port=?", (node_id, port))
    if keep_ports:
        conn.execute("UPDATE user_plan_ports SET release_at=? WHERE user_plan_id=? AND release_at=0",
                     (now() + PLAN_GRACE_SECONDS, plan_row["id"]))
    else:
        conn.execute("DELETE FROM user_plan_ports WHERE user_plan_id=?", (plan_row["id"],))


def ledger_analysis(conn: sqlite3.Connection, days: int = 7) -> dict[str, Any]:
    """收支分析：今天按小时，其余按天。金额统一 ¥。"""
    days = max(1, min(90, int(days or 7)))
    points: list[dict[str, Any]] = []
    if days <= 1:
        start = int(time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1)))
        rows = conn.execute(
            """SELECT strftime('%H', ts, 'unixepoch', 'localtime') AS h,
                      COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS inc,
                      COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS exp
               FROM ledger WHERE ts>=? GROUP BY h""", (start,)).fetchall()
        bucket = {str(r["h"]).zfill(2): r for r in rows}
        for hour in range(24):
            key = f"{hour:02d}"
            r = bucket.get(key)
            points.append({"label": key + ":00", "income": q2(r["inc"] if r else 0), "expense": q2(r["exp"] if r else 0)})
    else:
        start = now() - days * 86400
        rows = conn.execute(
            """SELECT date(ts,'unixepoch','localtime') AS d,
                      COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS inc,
                      COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS exp
               FROM ledger WHERE ts>=? GROUP BY d""", (start,)).fetchall()
        bucket = {str(r["d"]): r for r in rows}
        today = time.localtime()
        for i in range(days - 1, -1, -1):
            ts = time.mktime((today.tm_year, today.tm_mon, today.tm_mday - i, 0, 0, 0, 0, 0, -1))
            key = time.strftime("%Y-%m-%d", time.localtime(ts))
            r = bucket.get(key)
            points.append({"label": key[5:], "income": q2(r["inc"] if r else 0), "expense": q2(r["exp"] if r else 0)})
    cats = conn.execute(
        """SELECT category, direction, COALESCE(SUM(amount),0) AS total FROM ledger WHERE ts>=?
           GROUP BY category, direction ORDER BY total DESC LIMIT 8""", (now() - days * 86400,)).fetchall()
    totals = {
        "income": q2(sum(p["income"] for p in points)),
        "expense": q2(sum(p["expense"] for p in points)),
    }
    return {
        "days": days,
        "points": points,
        "totals": totals,
        "categories": [{"category": r["category"], "text": LEDGER_CATEGORIES.get(r["category"], r["category"]),
                        "direction": r["direction"], "amount": q2(r["total"])} for r in cats],
    }


def repair_port_assignments(conn: sqlite3.Connection) -> int:
    """清理僵尸端口归属：既不属于有效套餐，也没有对应隧道。"""
    cur = conn.execute(
        """UPDATE ports SET user_id=NULL
           WHERE user_id IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM user_plan_ports upp JOIN user_plans up ON up.id=upp.user_plan_id
                 WHERE upp.node_id=ports.node_id AND upp.port=ports.port
                   AND upp.release_at=0 AND up.status='active' AND (up.expires_at=0 OR up.expires_at>?)
             )
             AND NOT EXISTS (
                 SELECT 1 FROM tunnels t
                 WHERE t.node_id=ports.node_id AND t.remote_port=ports.port AND t.proxy_type IN ('tcp','udp')
             )""", (now(),))
    return cur.rowcount


def reclaim_expired_plan_ports(conn: sqlite3.Connection) -> int:
    """回收保留期已过的套餐端口。"""
    rows = conn.execute("SELECT id, user_id, node_id, port FROM user_plan_ports WHERE release_at>0 AND release_at<=?", (now(),)).fetchall()
    for r in rows:
        conn.execute("DELETE FROM tunnels WHERE user_id=? AND node_id=? AND remote_port=?",
                     (int(r["user_id"]), int(r["node_id"]), int(r["port"])))
        conn.execute("UPDATE ports SET user_id=NULL WHERE node_id=? AND port=?", (int(r["node_id"]), int(r["port"])))
        conn.execute("DELETE FROM user_plan_ports WHERE id=?", (r["id"],))
    return len(rows)


def claim_retained_ports(conn: sqlite3.Connection, user_id: int, new_plan_id: int, wanted: int, node_id: int = 0) -> list[sqlite3.Row]:
    """续期时优先接管保留中的端口（必须同一节点），并恢复对应隧道。"""
    if node_id:
        rows = conn.execute(
            "SELECT id, node_id, port FROM user_plan_ports WHERE user_id=? AND node_id=? AND release_at>0 ORDER BY release_at, id LIMIT ?",
            (user_id, node_id, wanted)).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, node_id, port FROM user_plan_ports WHERE user_id=? AND release_at>0 ORDER BY release_at, id LIMIT ?",
            (user_id, wanted)).fetchall()
    for r in rows:
        conn.execute("UPDATE user_plan_ports SET user_plan_id=?, release_at=0 WHERE id=?", (new_plan_id, r["id"]))
        conn.execute("UPDATE tunnels SET enabled=1 WHERE user_id=? AND node_id=? AND remote_port=?",
                     (user_id, int(r["node_id"]), int(r["port"])))
    return rows


def remind_user_plans_once() -> int:
    """到期前 3 天、流量用掉 90% 时，按用户自己的渠道提醒一次/天。"""
    sent = 0
    with db() as conn:
        soon = now() + 3 * 86400
        rows = conn.execute(
            """SELECT * FROM user_plans WHERE status='active' AND billing_mode='time'
               AND expires_at>? AND expires_at<=?""", (now(), soon)).fetchall()
        for p in rows:
            left_days = max(1, (int(p["expires_at"]) - now()) // 86400)
            if user_notify_send(conn, int(p["user_id"]), "plan_expiring",
                                "实例即将到期",
                                f"你的实例「{p['plan_name']}」还有 {left_days} 天到期，请及时续费以免端口被回收。",
                                ref=f"plan:{p['id']}"):
                sent += 1
        traffic = conn.execute(
            """SELECT * FROM user_plans WHERE status='active' AND quota_bytes>0""").fetchall()
        for p in traffic:
            quota = int(p["quota_bytes"] or 0)
            used = int(p["used_bytes"] or 0)
            if quota and used >= quota * 0.9:
                pct = min(100, int(used * 100 / quota))
                if user_notify_send(conn, int(p["user_id"]), "traffic_low",
                                    "流量即将用尽",
                                    f"实例「{p['plan_name']}」已使用 {pct}% 流量，用尽后将停止服务。",
                                    ref=f"quota:{p['id']}"):
                    sent += 1
    return sent


def remind_stale_tickets_once(hours: int = 24) -> int:
    """工单超过 N 小时未响应，在群里 @供货商催办一次。"""
    sent = 0
    with db() as conn:
        rows = conn.execute(
            "SELECT id, ticket_no, title, owner_id, updated_at FROM tickets WHERE status IN ('open','processing') AND updated_at<=? AND reminded_at<updated_at",
            (now() - hours * 3600,)).fetchall()
        for t in rows:
            at_ids: list[str] = []
            if int(t["owner_id"] or 0) > 0:
                owner = conn.execute("SELECT wecom_userid FROM users WHERE id=?", (int(t["owner_id"]),)).fetchone()
                if owner and str(owner["wecom_userid"] or "").strip():
                    at_ids.append(str(owner["wecom_userid"]).strip())
            ok = bncr_notify_text(
                "工单超时催办",
                [f"工单 {t['ticket_no']}：{t['title']}",
                 f"已超过 {hours} 小时未响应，请尽快登录面板处理。"],
                at_ids)
            conn.execute("UPDATE tickets SET reminded_at=? WHERE id=?", (now(), int(t["id"])))
            if ok:
                sent += 1
    return sent


def auto_renew_plans_once() -> int:
    """自动续期：套餐到期时扣积分延期；积分不足则关闭开关，让其正常到期。"""
    renewed = 0
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM user_plans WHERE status='active' AND auto_renew=1 AND billing_mode='time' AND expires_at>0 AND expires_at<=?",
            (now(),)).fetchall()
        for r in rows:
            plan = conn.execute("SELECT price_points, duration_days FROM plans WHERE id=? AND deleted=0", (r["plan_id"],)).fetchone()
            cost = int(row_val(plan, "price_points", 0) or 0) if plan else int(r["price_points"] or 0)
            days = int(row_val(plan, "duration_days", 0) or 0) if plan else int(r["duration_days"] or 0)
            if days <= 0:
                conn.execute("UPDATE user_plans SET auto_renew=0 WHERE id=?", (r["id"],))
                continue
            try:
                if cost > 0:
                    points_change(conn, int(r["user_id"]), -cost, "plan_auto_renew", f"up:{r['id']}", f"自动续期 {r['plan_name']}")
                base = max(now(), int(r["expires_at"] or 0))
                conn.execute("UPDATE user_plans SET expires_at=?, duration_days=duration_days+?, price_points=price_points+?, status='active' WHERE id=?",
                             (base + days * 86400, days, max(0, cost), r["id"]))
                renewed += 1
            except ValueError:
                conn.execute("UPDATE user_plans SET auto_renew=0 WHERE id=?", (r["id"],))
    return renewed


def expire_plans_once() -> int:
    """把已到期的时间套餐标记为 expired，并回收端口。"""
    count = 0
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM user_plans WHERE status='active' AND billing_mode='time' AND expires_at>0 AND expires_at<=?",
            (now(),)).fetchall()
        users: set[int] = set()
        for r in rows:
            realize_guarantee(conn, r)
            conn.execute("UPDATE user_plans SET status='expired' WHERE id=?", (r["id"],))
            release_plan_resources(conn, r)
            users.add(int(r["user_id"]))
            count += 1
        for uid in users:
            recalc_user_entitlements(conn, uid)
    return count


def refresh_user_plan_usage(conn: sqlite3.Connection, user_id: int) -> None:
    """流量型套餐只统计该套餐分配端口产生的流量，用尽即失效。"""
    traffic_plans = conn.execute(
        "SELECT * FROM user_plans WHERE user_id=? AND quota_bytes>0 AND status='active' ORDER BY id",
        (user_id,)).fetchall()
    if not traffic_plans:
        return
    changed = False
    for p in traffic_plans:
        quota = int(p["quota_bytes"] or 0)
        if quota <= 0:
            conn.execute("UPDATE user_plans SET usage_started_at=? WHERE id=?", (now(), p["id"]))
            continue
        since = int(p["usage_started_at"] or p["starts_at"] or 0)
        ports = conn.execute("SELECT node_id, port FROM user_plan_ports WHERE user_plan_id=?", (p["id"],)).fetchall()
        total = 0
        for pr in ports:
            row = conn.execute(
                "SELECT COALESCE(SUM(bytes),0) FROM traffic_samples WHERE user_id=? AND node_id=? AND remote_port=? AND ts>?",
                (user_id, int(pr["node_id"]), int(pr["port"]), since)).fetchone()
            total += int(row[0] or 0) if row else 0
        used = int(p["used_bytes"] or 0) + total
        conn.execute("UPDATE user_plans SET used_bytes=?, usage_started_at=? WHERE id=?", (used, now(), p["id"]))
        if used >= quota:
            conn.execute("UPDATE user_plans SET status='exhausted', expires_at=? WHERE id=?", (now(), p["id"]))
            release_plan_resources(conn, p)
            changed = True
    if changed:
        recalc_user_entitlements(conn, user_id)


def provision_order(conn: sqlite3.Connection, order: sqlite3.Row) -> tuple[bool, str]:
    user = conn.execute("SELECT * FROM users WHERE id=?", (order["user_id"],)).fetchone()
    if not user:
        return False, "用户不存在"
    node_id = int(order["node_id"] or 0) or int(user["node_id"] or 0)
    if not node_id:
        row = conn.execute("SELECT id FROM nodes WHERE active=1 ORDER BY id LIMIT 1").fetchone()
        node_id = int(row["id"]) if row else 0
    if not node_id:
        return False, "没有可用节点，请联系管理员"
    max_ports = int(order["max_ports"] or 0)
    duration_days = int(order["duration_days"] or 0)
    existing = conn.execute(
        "SELECT * FROM user_plans WHERE user_id=? AND plan_id=? AND node_id=? ORDER BY id DESC LIMIT 1",
        (user["id"], order["plan_id"], node_id)).fetchone() if order["plan_id"] else None
    plan_row = conn.execute("SELECT billing_mode FROM plans WHERE id=?", (order["plan_id"],)).fetchone() if order["plan_id"] else None
    billing_mode = (row_val(plan_row, "billing_mode", "time") if plan_row else "time") or "time"
    quota_bytes = int(order["traffic_limit_bytes"] or 0)
    if billing_mode == "traffic":
        expires_at = 0
    else:
        expires_at = 0 if duration_days <= 0 else now() + duration_days * 86400
    if existing:
        # 同一节点同一套餐重复购买：时间叠加、流量叠加，端口不增加
        add_points = int(order["points"] or 0)
        if billing_mode == "traffic":
            conn.execute("UPDATE user_plans SET quota_bytes=quota_bytes+?, price_points=price_points+?, status='active', expires_at=0 WHERE id=?",
                         (quota_bytes, add_points, existing["id"]))
        else:
            base = max(now(), int(existing["expires_at"] or 0))
            conn.execute("UPDATE user_plans SET expires_at=?, duration_days=duration_days+?, price_points=price_points+?, status='active' WHERE id=?",
                         (base + duration_days * 86400, duration_days, add_points, existing["id"]))
        conn.execute("UPDATE user_plan_ports SET release_at=0 WHERE user_plan_id=?", (existing["id"],))
        conn.execute("UPDATE ports SET user_id=? WHERE node_id=? AND port IN (SELECT port FROM user_plan_ports WHERE user_plan_id=?)",
                     (user["id"], node_id, existing["id"]))
        # 退订后重新购买会复用同一条记录，但端口已被回收：补齐端口
        have_ports = [int(r["port"]) for r in conn.execute(
            "SELECT port FROM user_plan_ports WHERE user_plan_id=? AND release_at=0", (existing["id"],)).fetchall()]
        need_ports = max(0, max_ports - len(have_ports))
        if need_ports:
            free_ports = available_ports_for_assignment(conn, node_id, need_ports)
            if len(free_ports) < need_ports:
                conn.rollback()
                return False, f"节点端口不足，只剩 {len(free_ports)} 个可用端口"
            conn.executemany("UPDATE ports SET user_id=? WHERE node_id=? AND port=?",
                             [(user["id"], node_id, r["port"]) for r in free_ports])
            conn.executemany(
                "INSERT OR IGNORE INTO user_plan_ports(user_plan_id, user_id, node_id, port, created_at) VALUES(?,?,?,?,?)",
                [(existing["id"], user["id"], node_id, r["port"], now()) for r in free_ports])
        conn.execute("UPDATE users SET node_id=? WHERE id=? AND (node_id IS NULL OR node_id=0)", (node_id, user["id"]))
        recalc_user_entitlements(conn, int(user["id"]))
        return True, "已叠加到原套餐"
    conn.execute(
        "INSERT INTO user_plans(user_id, username, plan_id, plan_name, order_no, billing_mode, price_points, quota_bytes, used_bytes, usage_started_at, status, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, duration_days, node_id, starts_at, expires_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (user["id"], user["username"], order["plan_id"], order["plan_name"], order["order_no"],
         billing_mode, int(order["points"] or 0), quota_bytes, 0, now(), "active",
         max_ports, int(order["traffic_limit_bytes"] or 0), int(order["bandwidth_limit_kbps"] or 0),
         duration_days, node_id, now(), expires_at, now()))
    conn.execute("UPDATE users SET node_id=? WHERE id=? AND (node_id IS NULL OR node_id=0)", (node_id, user["id"]))
    plan_id_new = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    # 续期优先接管保留中的端口（宽限期内），恢复原隧道
    claimed = claim_retained_ports(conn, int(user["id"]), plan_id_new, max_ports, node_id) if max_ports else []
    need = max(0, max_ports - len(claimed))
    free_ports = available_ports_for_assignment(conn, node_id, need) if need else []
    if need and len(free_ports) < need:
        conn.rollback()
        return False, f"实例端口不足，只剩 {len(free_ports)} 个可用端口"
    if free_ports:
        conn.executemany("UPDATE ports SET user_id=? WHERE node_id=? AND port=?",
                         [(user["id"], node_id, r["port"]) for r in free_ports])
        conn.executemany(
            "INSERT OR IGNORE INTO user_plan_ports(user_plan_id, user_id, node_id, port, created_at) VALUES(?,?,?,?,?)",
            [(plan_id_new, user["id"], node_id, r["port"], now()) for r in free_ports])
    recalc_user_entitlements(conn, int(user["id"]))
    return True, "已开通"


def mark_order_paid(order_no: str, transaction_id: str = "", provider: str = "") -> tuple[bool, str]:
    with db() as conn:
        row = conn.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
        if not row:
            return False, "订单不存在"
        if row["status"] == "paid":
            return True, "订单已支付"
        if row["status"] != "pending":
            return False, "订单状态不可支付"
        if (row_val(row, "kind", "plan") or "plan") == "points":
            pts = q2(row_val(row, "points", 0))
            cash = q2(int(row_val(row, "amount_cents", 0) or 0) / 100.0)
            points_change(conn, row["user_id"], pts, "recharge", order_no, "在线充值")
            ledger_add(conn, "cash", "in", "recharge_cash", cash, row["user_id"], row["username"], 0, order_no, "", "在线充值")
        else:
            ok, msg = provision_order(conn, row)
            if not ok:
                return False, msg
        conn.execute(
            "UPDATE orders SET status='paid', transaction_id=?, provider=CASE WHEN ?='' THEN provider ELSE ? END, paid_at=?, updated_at=? WHERE id=?",
            (str(transaction_id or ""), provider, provider, now(), now(), row["id"]))
    audit("order_paid", None, None, None, "", f"订单 {order_no} 支付成功 {transaction_id}")
    return True, "已开通"


MAX_PLANS_PER_NODE = max(1, int(os.getenv("FML_MAX_PLANS_PER_NODE", "2") or 2))


def refund_plans_on_node(conn: sqlite3.Connection, node_id: int, reason: str = "节点停用，按剩余价值退款") -> tuple[int, int]:
    """节点故障/停用：退还未服务部分，并用留存保证金补偿买家。"""
    rows = conn.execute("SELECT * FROM user_plans WHERE node_id=? AND status='active'", (node_id,)).fetchall()
    if not rows:
        return 0, 0
    items = []
    for p in rows:
        price = int(p["price_points"] or 0)
        target = q2(price * plan_progress(p))
        remaining = q2(max(0.0, price - target))
        items.append((p, price, remaining, int(p["guarantee_points"] or 0)))
    total_remaining = sum(x[2] for x in items)
    owners = {int(x[0]["provider_id"] or 0) for x in items if int(x[0]["provider_id"] or 0) > 0}
    pools: dict[int, int] = {}
    for owner in owners:
        g = conn.execute("SELECT points FROM provider_guarantee WHERE owner_id=?", (owner,)).fetchone()
        pools[owner] = int(g["points"] or 0) if g else 0
    count = 0
    total_refund = 0
    users: set[int] = set()
    for p, price, remaining, keep in items:
        owner = int(p["provider_id"] or 0)
        bonus = 0
        if keep > 0 and pools.get(owner, 0) > 0:
            available = min(keep, pools[owner])
            platform_take = available // 2
            buyer_part = available - platform_take
            if platform_take > 0:
                conn.execute(
                    "INSERT INTO platform_revenue(order_no, plan_id, node_id, points, created_at) VALUES(?,?,?,?,?)",
                    (str(p["order_no"] or ""), int(p["id"]), int(node_id), platform_take, now()))
            pools[owner] -= available
            conn.execute("UPDATE provider_guarantee SET points=points-?, updated_at=? WHERE owner_id=?", (available, now(), owner))
            if buyer_part > 0 and total_remaining > 0:
                bonus = buyer_part * remaining // total_remaining
                bonus = min(bonus, max(0, price - remaining))
        refund = remaining + bonus
        if refund > 0:
            points_change(conn, int(p["user_id"]), refund, "plan_refund", f"node:{node_id}", reason)
            ledger_add(conn, "points", "out", "node_refund", refund, int(p["user_id"]), p["username"],
                       int(node_id), str(p["order_no"] or ""), str(p["id"]), reason)
            total_refund += refund
        conn.execute("UPDATE user_plans SET status='cancelled', expires_at=?, guarantee_points=0 WHERE id=?", (now(), p["id"]))
        release_plan_resources(conn, p, keep_ports=False)
        conn.execute("UPDATE provider_earnings SET status='refunded' WHERE order_no=? AND status='pending'", (p["order_no"],))
        users.add(int(p["user_id"]))
        count += 1
    for uid in users:
        recalc_user_entitlements(conn, uid)
    return count, total_refund


def settle_provider_earnings_once() -> int:
    """把超过结算期的待结算收益转入供给方积分余额。"""
    if PROVIDER_SETTLE_DAYS < 0:
        return 0
    cutoff = now() - int(PROVIDER_SETTLE_DAYS * 86400)
    settled = 0
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM provider_earnings WHERE status='pending' AND created_at<=?", (cutoff,)).fetchall()
        for r in rows:
            net = int(r["net_points"] or 0)
            owner = int(r["owner_id"])
            debt_row = conn.execute("SELECT points FROM provider_debts WHERE owner_id=?", (owner,)).fetchone()
            debt = int(debt_row["points"] or 0) if debt_row else 0
            if debt > 0 and net > 0:
                offset = min(net, debt)
                net -= offset
                debt -= offset
                conn.execute("UPDATE provider_debts SET points=?, updated_at=? WHERE owner_id=?", (debt, now(), owner))
            if net > 0:
                points_change(conn, owner, net, "provider_income", r["order_no"], f"节点 #{r['node_id']} 收益")
            conn.execute("UPDATE provider_earnings SET status='settled' WHERE id=?", (r["id"],))
            settled += 1
    return settled


def plan_progress(plan: sqlite3.Row) -> float:
    """实例服务进度：时间套餐按已服务天数，流量套餐按已用额度。"""
    quota = int(plan["quota_bytes"] or 0)
    if (plan["billing_mode"] or "time") == "traffic" and quota > 0:
        return max(0.0, min(1.0, int(plan["used_bytes"] or 0) / quota))
    start = int(plan["starts_at"] or 0)
    expires = int(plan["expires_at"] or 0)
    if start and expires and expires > start:
        total = expires - start
        served = max(0, min(total, now() - start))
        return served / total
    return 1.0


def accrue_provider_income_once() -> int:
    """按交付进度结算：90% 给供给方，10% 留作保证金。"""
    paid_count = 0
    with db() as conn:
        rows = conn.execute(
            """SELECT up.*, n.owner_id AS node_owner FROM user_plans up
               JOIN nodes n ON n.id=up.node_id
               WHERE up.status='active' AND n.owner_id>0""").fetchall()
        for up in rows:
            price = int(up["price_points"] or 0)
            owner = int(up["node_owner"] or 0)
            if price <= 0 or owner <= 0:
                continue
            target = q2(price * plan_progress(up))
            done = int(up["provider_paid_points"] or 0) + int(up["guarantee_points"] or 0)
            delta = target - done
            if delta <= 0:
                continue
            pay = q2(delta * 90 / 100)
            keep = q2(delta - pay)
            if pay > 0:
                ledger_add(conn, "points", "out", "provider_settle", pay, owner, "", int(up["node_id"] or 0),
                           str(up["order_no"] or ""), str(up["id"]), f"结算 {up['plan_name']}")
            if keep > 0:
                ledger_add(conn, "points", "in", "guarantee", keep, owner, "", int(up["node_id"] or 0),
                           str(up["order_no"] or ""), str(up["id"]), "保证金留存")
                conn.execute(
                    "INSERT INTO provider_income(owner_id, points, updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET points=points+excluded.points, updated_at=excluded.updated_at",
                    (owner, pay, now()))
            conn.execute(
                "UPDATE user_plans SET provider_paid_points=provider_paid_points+?, guarantee_points=guarantee_points+?, provider_id=? WHERE id=?",
                (pay, keep, owner, up["id"]))
            if keep > 0:
                conn.execute(
                    "INSERT INTO provider_guarantee(owner_id, points, updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET points=points+excluded.points, updated_at=excluded.updated_at",
                    (owner, keep, now()))
            paid_count += 1
    return paid_count


def realize_guarantee(conn: sqlite3.Connection, plan_row: sqlite3.Row) -> None:
    """服务完整交付后，留存保证金转为平台收入。"""
    owner = int(row_val(plan_row, "provider_id", 0) or 0)
    keep = int(row_val(plan_row, "guarantee_points", 0) or 0)
    if owner <= 0 or keep <= 0:
        return
    gor = conn.execute("SELECT points FROM provider_guarantee WHERE owner_id=?", (owner,)).fetchone()
    have = int(gor["points"] or 0) if gor else 0
    take = min(have, keep)
    if take > 0:
        conn.execute("UPDATE provider_guarantee SET points=points-?, updated_at=? WHERE owner_id=?", (take, now(), owner))
    conn.execute(
        "INSERT INTO platform_revenue(order_no, plan_id, node_id, points, created_at) VALUES(?,?,?,?,?)",
        (str(plan_row["order_no"] or ""), int(plan_row["id"]), int(plan_row["node_id"] or 0), keep, now()))
    conn.execute("UPDATE user_plans SET guarantee_points=0 WHERE id=?", (int(plan_row["id"]),))


def record_provider_earning(conn: sqlite3.Connection, order_no: str, node_id: int, gross_points: int) -> None:
    """记录供给方收益（平台抽成后）。节点无归属（平台自营）时不记录。"""
    if not node_id or gross_points <= 0:
        return
    node = conn.execute("SELECT owner_id FROM nodes WHERE id=?", (node_id,)).fetchone()
    owner_id = int(row_val(node, "owner_id", 0) or 0) if node else 0
    if owner_id <= 0:
        return
    pct = max(0.0, min(100.0, PROVIDER_COMMISSION_PCT))
    commission = int(round(gross_points * pct / 100))
    net = max(0, gross_points - commission)
    conn.execute(
        "INSERT OR IGNORE INTO provider_earnings(order_no, node_id, owner_id, gross_points, commission_points, net_points, status, created_at) VALUES(?,?,?,?,?,?,?,?)",
        (order_no, node_id, owner_id, gross_points, commission, net, "pending", now()))


def create_order(user: sqlite3.Row, plan_id: int, provider: str = "", node_id: int = 0, tunnels: list[dict[str, Any]] | None = None) -> tuple[bool, str, dict[str, Any] | None]:
    """积分购买套餐：用户自选节点，扣积分后立即开通。"""
    with db() as conn:
        plan = conn.execute("SELECT * FROM plans WHERE id=? AND active=1 AND deleted=0", (plan_id,)).fetchone()
        if not plan:
            return False, "套餐不存在或已下架", None
        chosen_node = None
        if node_id:
            chosen_node = conn.execute("SELECT id, name FROM nodes WHERE id=? AND active=1", (node_id,)).fetchone()
            if not chosen_node:
                return False, "所选实例不存在或已停用", None
        plan_node_id = int(row_val(plan, "node_id", 0) or 0)
        if plan_node_id and plan_node_id != int(node_id or 0):
            return False, "该套餐不适用于所选节点，请重新选择", None

        if tunnels and int(node_id or 0):
            seen: set[str] = set()
            for item in tunnels:
                nm = str(item.get("name", "")).strip()
                if not nm:
                    return False, "请填写隧道名称", None
                if nm in seen:
                    return False, f"隧道名称「{nm}」重复，请更换", None
                seen.add(nm)
                if conn.execute("SELECT 1 FROM tunnels WHERE node_id=? AND name=?", (int(node_id), nm)).fetchone():
                    return False, f"隧道名称「{nm}」已被使用，请更换", None

        cost = int(row_val(plan, "price_points", 0) or 0)
        balance = q2(row_val(conn.execute("SELECT points FROM users WHERE id=?", (user["id"],)).fetchone(), "points", 0))
        if cost > balance:
            return False, f"积分不足，还需 {q2(cost - balance):.2f} 积分", None
        order_no = new_order_no()
        conn.execute(
            "INSERT INTO orders(order_no, user_id, username, plan_id, plan_name, kind, points, amount_cents, duration_days, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, node_id, provider, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (order_no, user["id"], user["username"], plan["id"], plan["name"], "plan", cost, 0,
             int(plan["duration_days"] or 0), int(plan["max_ports"] or 0), int(plan["traffic_limit_bytes"] or 0),
             int(plan["bandwidth_limit_kbps"] or 0), int(node_id or 0), "points", "pending", now(), now()))
        order = conn.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
        try:
            if cost:
                points_change(conn, user["id"], -cost, "plan_purchase", order_no, plan["name"])
                ledger_add(conn, "points", "in", "plan_sale", cost, user["id"], user["username"],
                           int(node_id or 0), order_no, str(plan["id"]), plan["name"])
        except ValueError:
            conn.rollback()
            return False, "积分不足", None
        ok, msg = provision_order(conn, order)
        if not ok:
            conn.rollback()
            return False, msg, None
        new_plan_row = conn.execute("SELECT id FROM user_plans WHERE order_no=? ORDER BY id DESC LIMIT 1", (order_no,)).fetchone()
        allowed_ports = [int(x["port"]) for x in conn.execute(
            "SELECT port FROM user_plan_ports WHERE user_plan_id=? AND release_at=0 ORDER BY port",
            (new_plan_row["id"],)).fetchall()] if new_plan_row else []
        created_tunnels = create_preconfigured_tunnels(conn, user, int(node_id or 0), tunnels or [], int(plan["max_ports"] or 0), allowed_ports, int(new_plan_row["id"]) if new_plan_row else 0)
        # 收益改为按交付进度结算，购买时不再预生成待结算记录
        conn.execute("UPDATE orders SET status='paid', paid_at=?, updated_at=? WHERE id=?", (now(), now(), order["id"]))
        provision_msg = msg
    with db() as conn:
        row = conn.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
        balance = q2(row_val(conn.execute("SELECT points FROM users WHERE id=?", (user["id"],)).fetchone(), "points", 0))
    payload = order_public(row)
    payload["balance"] = balance
    payload["tunnels"] = created_tunnels
    return True, ("购买成功，已叠加到原套餐" if provision_msg == "已叠加到原套餐" else "购买成功，套餐已开通"), payload


def create_preconfigured_tunnels(conn: sqlite3.Connection, user: sqlite3.Row, node_id: int, items: list[dict[str, Any]], max_ports: int, allowed_ports: list[int] | None = None, plan_id: int = 0) -> list[dict[str, Any]]:
    """开通后按用户预配置创建隧道，端口优先使用本次套餐分配的端口。"""
    if not items or not node_id:
        return []
    owned = [int(p) for p in (allowed_ports or [])] or [int(r["port"]) for r in conn.execute(
        "SELECT port FROM ports WHERE node_id=? AND user_id=? ORDER BY port", (node_id, user["id"])).fetchall()]
    used = {int(r["remote_port"]) for r in conn.execute(
        "SELECT remote_port FROM tunnels WHERE node_id=? AND proxy_type IN ('tcp','udp') AND remote_port>0", (node_id,)).fetchall()}
    free = [p for p in owned if p not in used]
    created: list[dict[str, Any]] = []
    limit = max_ports if max_ports > 0 else len(free)
    for item in items[:max(1, min(limit, 20))]:
        try:
            name = str(item.get("name", "")).strip()[:40]
            if not name or not name.replace("_", "").replace("-", "").isalnum():
                continue
            proxy_type = str(item.get("proxy_type", "tcp")).lower()
            if proxy_type not in ("tcp", "udp"):
                continue
            local_port = int(item.get("local_port", 0))
            if not (1 <= local_port <= 65535):
                continue
            local_ip = str(item.get("local_ip", "127.0.0.1")).strip()[:60] or "127.0.0.1"
            want = int(item.get("remote_port", 0) or 0)
            port = want if want in free else (free[0] if free else 0)
            if not port:
                continue
            free.remove(port)
            if conn.execute("SELECT 1 FROM tunnels WHERE node_id=? AND name=?", (node_id, name)).fetchone():
                continue
            conn.execute(
                "INSERT INTO tunnels(node_id, user_id, plan_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (node_id, user["id"], int(plan_id or 0), name, proxy_type, local_ip, local_port, port, "", "", now()))
            created.append({"name": name, "proxy_type": proxy_type, "local_port": local_port, "remote_port": port})
        except Exception:
            continue
    return created


def create_points_order(user: sqlite3.Row, points: int, provider: str = "") -> tuple[bool, str, dict[str, Any] | None]:
    """在线充值积分：创建支付订单，支付成功后加积分。"""
    try:
        points = int(points)
    except (TypeError, ValueError):
        return False, "充值积分数量不合法", None
    if points < 1 or points > 1_000_000:
        return False, "充值积分必须在 1-1000000 之间", None
    with db() as conn:
        cfg = payment_config(conn)
        rate = 1
    enabled = enabled_payment_providers(cfg)
    if not enabled:
        return False, "管理员未配置在线支付，请使用密钥充值", None
    provider = provider or next((x for x in enabled if provider_ready(x, cfg)), enabled[0])
    if provider not in enabled:
        return False, "该支付方式未开通", None
    if not provider_ready(provider, cfg):
        return False, f"{PAYMENT_NAMES.get(provider, provider)} 尚未配置完成", None
    amount_cents = max(1, int(round(points * 100.0 / rate)))
    order_no = new_order_no()
    with db() as conn:
        conn.execute(
            "INSERT INTO orders(order_no, user_id, username, plan_id, plan_name, kind, points, amount_cents, duration_days, max_ports, traffic_limit_bytes, bandwidth_limit_kbps, node_id, provider, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (order_no, user["id"], user["username"], None, f"积分充值 {points}", "points", points, amount_cents,
             0, 0, 0, 0, None, provider, "pending", now(), now()))
        order = conn.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    payload = order_public(order)
    ok, msg, pay_url = build_payment(provider, payload, cfg)
    if not ok:
        with db() as conn:
            conn.execute("UPDATE orders SET status='cancelled', updated_at=? WHERE order_no=?", (now(), order_no))
        return False, msg, None
    with db() as conn:
        conn.execute("UPDATE orders SET pay_url=?, updated_at=? WHERE order_no=?", (pay_url, now(), order_no))
    payload["pay_url"] = pay_url
    return True, "订单已创建", payload



def _notify_base(cfg: dict[str, Any], fallback: str) -> str:
    base = (cfg.get("public_url") or fallback or "").rstrip("/")
    return base


def build_payment(provider: str, order: dict[str, Any], cfg: dict[str, Any]) -> tuple[bool, str, str]:
    if provider == "mock":
        return True, "ok", f"/api/pay/mock/{order['order_no']}"
    if provider == "alipay":
        return alipay_page_pay(order, cfg)
    if provider == "wechat":
        return wechat_h5_pay(order, cfg)
    return False, "不支持的支付方式", ""


def alipay_page_pay(order: dict[str, Any], cfg: dict[str, Any]) -> tuple[bool, str, str]:
    if not (cfg.get("alipay_app_id") and cfg.get("alipay_private_key") and cfg.get("alipay_public_key")):
        return False, "支付宝支付未配置", ""
    base = _notify_base(cfg, "")
    if not base:
        return False, "请先在设置中填写对外访问地址", ""
    biz = json.dumps({
        "out_trade_no": order["order_no"],
        "total_amount": f"{int(order['amount_cents']) / 100:.2f}",
        "subject": f"Frp 管理台 - {order['plan_name']}",
        "product_code": "FAST_INSTANT_TRADE_PAY",
    }, ensure_ascii=False, separators=(",", ":"))
    params = {
        "app_id": cfg["alipay_app_id"],
        "method": "alipay.trade.page.pay",
        "format": "JSON",
        "charset": "utf-8",
        "sign_type": "RSA2",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        "notify_url": f"{base}/api/pay/notify/alipay",
        "return_url": f"{base}/api/pay/return/alipay",
        "biz_content": biz,
    }
    sign_content = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "sign" and str(v) != "")
    try:
        params["sign"] = rsa_sign_sha256(sign_content.encode("utf-8"), cfg["alipay_private_key"])
    except Exception as exc:
        return False, f"支付宝签名失败：{exc}", ""
    gateway = cfg.get("alipay_gateway") or DEFAULT_ALIPAY_GATEWAY
    return True, "ok", gateway + "?" + urllib.parse.urlencode(params)


def _xml_to_dict(raw: str) -> dict[str, str]:
    import xml.etree.ElementTree as ET
    out: dict[str, str] = {}
    try:
        root = ET.fromstring(raw)
        for child in root:
            out[child.tag] = child.text or ""
    except Exception:
        return {}
    return out


def _dict_to_xml(payload: dict[str, str]) -> str:
    body = "".join(f"<{k}><![CDATA[{v}]]></{k}>" for k, v in payload.items())
    return f"<xml>{body}</xml>"


def wechat_sign(params: dict[str, str], api_key: str) -> str:
    raw = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "sign" and str(v) != "")
    raw += "&key=" + api_key
    return hashlib.md5(raw.encode("utf-8")).hexdigest().upper()


def wechat_h5_pay(order: dict[str, Any], cfg: dict[str, Any]) -> tuple[bool, str, str]:
    if not (cfg.get("wechat_appid") and cfg.get("wechat_mch_id") and cfg.get("wechat_api_key")):
        return False, "微信支付未配置", ""
    base = _notify_base(cfg, "")
    if not base:
        return False, "请先在设置中填写对外访问地址", ""
    payload = {
        "appid": cfg["wechat_appid"],
        "mch_id": cfg["wechat_mch_id"],
        "nonce_str": secrets.token_hex(16),
        "body": f"Frp管理台-{order['plan_name']}",
        "out_trade_no": order["order_no"],
        "total_fee": str(int(order["amount_cents"])),
        "spbill_create_ip": "127.0.0.1",
        "notify_url": f"{base}/api/pay/notify/wechat",
        "trade_type": "MWEB",
        "scene_info": json.dumps({"h5_info": {"type": "Wap", "wap_url": base, "wap_name": "Frp管理台"}}),
    }
    payload["sign"] = wechat_sign(payload, cfg["wechat_api_key"])
    try:
        req = urllib.request.Request(DEFAULT_WECHAT_GATEWAY, data=_dict_to_xml(payload).encode("utf-8"),
                                     headers={"Content-Type": "text/xml"}, method="POST")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = _xml_to_dict(resp.read().decode("utf-8", "replace"))
    except Exception as exc:
        return False, f"微信下单失败：{exc}", ""
    if data.get("return_code") != "SUCCESS" or data.get("result_code") != "SUCCESS":
        return False, data.get("err_code_des") or data.get("return_msg") or "微信下单失败", ""
    return True, "ok", data.get("mweb_url", "")


def alipay_verify_notify(form: dict[str, str], cfg: dict[str, Any]) -> bool:
    public_key = cfg.get("alipay_public_key") or ""
    if not public_key:
        return False
    sign = form.get("sign", "")
    if not sign:
        return False
    content = "&".join(f"{k}={v}" for k, v in sorted(form.items()) if k not in ("sign", "sign_type") and v != "")
    return rsa_verify_sha256(content.encode("utf-8"), sign, public_key)


def wechat_verify_notify(form: dict[str, str], cfg: dict[str, Any]) -> bool:
    api_key = cfg.get("wechat_api_key") or ""
    if not api_key or not form.get("sign"):
        return False
    return hmac.compare_digest(wechat_sign(form, api_key), form["sign"].upper())


def handle_payment_notify(provider: str, raw_body: bytes, form: dict[str, str], cfg: dict[str, Any]) -> tuple[bool, str]:
    if provider == "alipay":
        if not alipay_verify_notify(form, cfg):
            return False, "签名校验失败"
        if form.get("trade_status") not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
            return True, "忽略"
        return mark_order_paid(form.get("out_trade_no", ""), form.get("trade_no", ""), "alipay")
    if provider == "wechat":
        data = _xml_to_dict(raw_body.decode("utf-8", "replace")) if raw_body else dict(form)
        if not wechat_verify_notify(data, cfg):
            return False, "签名校验失败"
        if data.get("return_code") != "SUCCESS" or data.get("result_code") != "SUCCESS":
            return True, "忽略"
        return mark_order_paid(data.get("out_trade_no", ""), data.get("transaction_id", ""), "wechat")
    return False, "未知支付方式"



# ---------------------------------------------------------------------------
# 托管中心（用户提交母鸡，管理员审核后自动建节点）
# ---------------------------------------------------------------------------

HOST_STATUS_TEXT = {"pending": "待审核", "approved": "已通过", "rejected": "已拒绝", "blacklisted": "已拉黑"}


def host_ticket_id(conn: sqlite3.Connection, host_id: int) -> int:
    row = conn.execute("SELECT id FROM tickets WHERE kind='host' AND host_id=? ORDER BY id DESC LIMIT 1", (int(host_id),)).fetchone()
    return int(row["id"]) if row else 0


def host_public(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "user_id": int(row["user_id"]),
        "username": row["username"] or "",
        "name": row["name"] or "",
        "region": row["region"] or "",
        "server_addr": row["server_addr"] or "",
        "server_port": int(row["server_port"] or 0),
        "port_start": int(row["port_start"] or 0),
        "port_end": int(row["port_end"] or 0),
        "bandwidth_mbps": int(row["bandwidth_mbps"] or 0),
        "monthly_traffic_gb": float(row["monthly_traffic_gb"] or 0),
        "cpu": row["cpu"] or "",
        "memory": row["memory"] or "",
        "disk": row["disk"] or "",
        "note": row["note"] or "",
        "status": row["status"] or "pending",
        "status_text": HOST_STATUS_TEXT.get(row["status"] or "pending", row["status"] or ""),
        "ticket_id": host_ticket_id(conn, int(row["id"])) if conn is not None else 0,
        "node_id": int(row["node_id"] or 0),
        "reviewed_at": int(row["reviewed_at"] or 0),
        "expires_at": int(row_val(row, "expires_at", 0) or 0),
        "created_at": int(row["created_at"] or 0),
    }


def provider_plan_save(user: sqlite3.Row, data: dict[str, Any]) -> tuple[bool, str]:
    """供给方在自己的节点上架/修改套餐（写入 plans 表，绑定节点）。"""
    try:
        pid = int(data.get("id", 0) or 0)
        node_id = int(data.get("node_id", 0) or 0)
        price = int(data.get("price_points", 0) or 0)
        max_ports = int(data.get("max_ports", 1) or 0)
        days = int(data.get("duration_days", 0) or 0)
        traffic_gb = float(data.get("traffic_limit_gb", 0) or 0)
        bandwidth = int(data.get("bandwidth_limit_mbps", 0) or 0)
    except (TypeError, ValueError):
        return False, "表单数值格式不正确"
    name = str(data.get("name", "")).strip()
    mode = str(data.get("billing_mode", "time") or "time").lower()
    if mode not in ("time", "traffic"):
        return False, "计费方式不合法"
    if not name or len(name) > 40:
        return False, "套餐名称不能为空且不超过 40 字"
    if price < 0 or price > 1_000_000:
        return False, "价格必须在 0-1000000 积分之间"
    if max_ports < 1 or max_ports > 100:
        return False, "端口数量必须在 1-100 之间"
    if mode == "time":
        if days < 1 or days > 30:
            return False, "时间套餐时长必须在 1-30 天之间"
        traffic_gb = 0
    else:
        days = 0
        if traffic_gb <= 0 or traffic_gb > 1_000_000:
            return False, "流量套餐必须填写大于 0 的流量额度"
    if bandwidth < 0 or bandwidth > 10_000:
        return False, "带宽上限不合法"
    traffic_bytes = int(traffic_gb * 1024 ** 3)
    with db() as conn:
        node = conn.execute("SELECT id, owner_id, expires_at, active FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node or int(node["owner_id"] or 0) != int(user["id"]):
            return False, "只能在自己的节点上架套餐"
        node_exp = int(node["expires_at"] or 0)
        if node_exp and node_exp <= now():
            return False, "节点已到期，无法上架套餐"
        if mode == "time" and node_exp:
            remain_days = (node_exp - now()) // 86400
            if days > remain_days:
                return False, f"套餐时长超过母鸡剩余可用天数（{remain_days} 天）"
        node_active = int(node["active"] or 0)
        want_active = 1 if data.get("active", True) else 0
        active_value = want_active if node_active else 0
        if pid:
            row = conn.execute(
                "SELECT p.id FROM plans p JOIN nodes n ON n.id=p.node_id WHERE p.id=? AND n.owner_id=? AND p.deleted=0",
                (pid, int(user["id"]))).fetchone()
            if not row:
                return False, "套餐不存在或无权修改"
            conn.execute(
                """UPDATE plans SET name=?, billing_mode=?, price_points=?, max_ports=?, traffic_limit_bytes=?,
                   bandwidth_limit_kbps=?, duration_days=?, node_id=?, active=? WHERE id=?""",
                (name, mode, price, max_ports, traffic_bytes, bandwidth * 1000 // 8, days, node_id,
                 active_value, pid))
            return True, "套餐已更新"
        conn.execute(
            """INSERT INTO plans(seq_no, deleted, name, billing_mode, price_cents, price_points, max_ports,
               traffic_limit_bytes, bandwidth_limit_kbps, duration_days, node_id, note, fair_use_note, active, sort_order, created_at)
               VALUES(0,0,?,?,0,?,?,?,?,?,?,?,?,?,0,?)""",
            (name, mode, price, max_ports, traffic_bytes, bandwidth * 1000 // 8, days, node_id,
             f"供给方套餐（{user['username']}）", "", active_value, now()))
        return True, ("套餐已保存，待节点审核通过后自动上架" if not node_active else "套餐已上架")


def provider_nodes_payload(conn: sqlite3.Connection, user_id: int) -> list[dict[str, Any]]:
    """供给方视角：自己名下节点的容量、流量与实例数。"""
    out: list[dict[str, Any]] = []
    rows = conn.execute("SELECT * FROM nodes WHERE owner_id=? ORDER BY id DESC", (user_id,)).fetchall()
    for n in rows:
        nid = int(n["id"])
        total_ports = conn.execute("SELECT COUNT(*) FROM ports WHERE node_id=?", (nid,)).fetchone()[0]
        used_ports = conn.execute("SELECT COUNT(*) FROM ports WHERE node_id=? AND user_id IS NOT NULL", (nid,)).fetchone()[0]
        active_plans = conn.execute(
            "SELECT COUNT(*) FROM user_plans WHERE node_id=? AND status='active' AND (expires_at=0 OR expires_at>?)",
            (nid, now())).fetchone()[0]
        out.append({
            "id": nid, "name": n["name"], "region": n["region"],
            "server_addr": n["server_addr"], "server_port": int(n["server_port"] or 0),
            "active": bool(n["active"]),
            "auto_suspended": bool(row_val(n, "auto_suspended", 0)),
            "last_online_at": int(row_val(n, "last_online_at", 0) or 0),
            "expires_at": int(row_val(n, "expires_at", 0) or 0),
            "port_start": int(n["port_start"] or 0), "port_end": int(n["port_end"] or 0),
            "ports_total": int(total_ports), "ports_used": int(used_ports),
            "ports_free": max(0, int(total_ports) - int(used_ports)),
            "month_used_bytes": node_month_traffic(conn, nid),
            "monthly_traffic_bytes": int(n["monthly_traffic_bytes"] or 0),
            "active_plans": int(active_plans),
            "bandwidth_mbps": int(n["bandwidth_mbps"] or 0),
        })
    return out


def list_hosts(conn: sqlite3.Connection, user_id: int | None = None) -> list[dict[str, Any]]:
    if user_id is None:
        rows = conn.execute("SELECT * FROM hosts ORDER BY id DESC LIMIT 300").fetchall()
    else:
        rows = conn.execute("SELECT * FROM hosts WHERE user_id=? ORDER BY id DESC LIMIT 100", (user_id,)).fetchall()
    return [host_public(r, conn) for r in rows]


def create_host_application(user: sqlite3.Row, data: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    name = str(data.get("name", "")).strip()[:40]
    region = str(data.get("region", "")).strip()[:40]
    server_addr = str(data.get("server_addr", "")).strip()[:200]
    note = str(data.get("note", "")).strip()[:300]
    expires_at = parse_date_epoch(str(data.get("expires_at", "")))
    if not name or not name.replace("_", "").replace("-", "").isalnum():
        return False, "母鸡名称只能包含字母、数字、下划线、短横线", {}
    if not region:
        return False, "请填写地区", {}
    if not server_addr:
        return False, "请填写公网 IP 或域名", {}
    if not note:
        return False, "请填写备注（线路 / 机房 / 联系方式）", {}
    if not expires_at:
        return False, "请填写服务器到期时间（格式 2026-12-31）", {}
    if expires_at <= now() + 86400:
        return False, "服务器到期时间必须晚于明天", {}
    try:
        server_port = int(data.get("server_port", 0) or 0)
        port_start = int(data.get("port_start", 0) or 0)
        port_end = int(data.get("port_end", 0) or 0)
        bandwidth = int(data.get("bandwidth_mbps", 0) or 0)
        monthly = float(data.get("monthly_traffic_gb", 0) or 0)
    except (TypeError, ValueError):
        return False, "端口 / 带宽 / 流量格式不正确", {}
    if not (1 <= server_port <= 65535):
        return False, "frps 端口不合法", {}
    if not (1 <= port_start <= port_end <= 65535):
        return False, "端口范围不合法", {}
    if port_end - port_start > 20000:
        return False, "端口池不要超过 20000 个", {}
    if bandwidth <= 0:
        return False, "请填写带宽（Mbps，必须大于 0）", {}
    if monthly <= 0:
        return False, "请填写月流量（GB，必须大于 0）", {}
    with db() as conn:
        wecom_id = str(row_val(conn.execute("SELECT wecom_userid FROM users WHERE id=?", (user["id"],)).fetchone(), "wecom_userid", "") or "").strip()
        if not wecom_id:
            return False, "请先在企微群内发送绑定码完成入群验证，再提交托管申请", {}
        pending = conn.execute("SELECT COUNT(*) FROM hosts WHERE user_id=? AND status IN ('pending','pending_node')", (user["id"],)).fetchone()[0]
        if pending >= 5:
            return False, "待审核的托管申请过多，请等待处理", {}
        node_name = name
        suffix = 1
        while conn.execute("SELECT 1 FROM nodes WHERE name=?", (node_name,)).fetchone():
            suffix += 1
            node_name = f"{name}-{suffix}"
        node_token = secrets.token_urlsafe(24)
        cur = conn.execute(
            "INSERT INTO nodes(region, name, server_addr, server_port, auth_token, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, monthly_traffic_bytes, active, note, created_at, owner_id, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (region, node_name, server_addr, server_port, node_token, port_start, port_end, 0, "", "", "",
             bandwidth, int(monthly * 1024 ** 3), 0, f"托管：{user['username']} / {note}".strip(), now(), int(user["id"]), expires_at))
        node_id = int(cur.lastrowid)
        conn.executemany("INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?,?,?)",
                         [(node_id, p, now()) for p in range(port_start, port_end + 1)])
        deploy_token = secrets.token_urlsafe(24)
        conn.execute(
            "INSERT INTO hosts(user_id, username, name, region, server_addr, server_port, port_start, port_end, bandwidth_mbps, monthly_traffic_gb, cpu, memory, disk, note, status, node_id, deploy_token, created_at, updated_at, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (user["id"], user["username"], name, region, server_addr, server_port, port_start, port_end,
             bandwidth, monthly, "", "", "", note, "pending_node", node_id, deploy_token, now(), now(), expires_at))
        host_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        summary = (
            f"<p>母鸡：{name}（{region}）</p>"
            f"<p>接入地址：{server_addr}:{server_port}</p>"
            f"<p>端口池：{port_start}-{port_end} · 带宽 {bandwidth} Mbps · 月流量 {monthly} GB</p>"
            f"<p>服务器到期：{fmt_time(expires_at)}</p>"
            f"<p>备注：{note}</p>"
        )
        conn.execute(
            "INSERT INTO tickets(ticket_no, user_id, username, kind, status, node_id, owner_id, host_id, title, content, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (new_ticket_no(), int(user["id"]), user["username"], "host", "open", 0, 0, host_id,
             f"托管申请：{name}", summary, now(), now()))
    return True, "母鸡信息已保存，请继续配置套餐并执行接入脚本", {
        "host_id": host_id, "node_id": node_id, "node_name": node_name,
        "deploy_token": deploy_token, "auth_token": node_token,
        "region": region, "server_addr": server_addr, "server_port": server_port,
        "port_start": port_start, "port_end": port_end, "bandwidth_mbps": bandwidth,
    }


def review_host_application(admin: sqlite3.Row, host_id: int, action: str, reason: str = "") -> tuple[bool, str]:
    action = str(action or "").lower()
    if action not in ("approve", "reject", "blacklist"):
        return False, "未知操作"
    with db() as conn:
        host = conn.execute("SELECT * FROM hosts WHERE id=?", (host_id,)).fetchone()
        if not host:
            return False, "托管申请不存在"
        if action == "reject":
            conn.execute("UPDATE hosts SET status='rejected', reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
                         (admin["id"], now(), now(), host_id))
            conn.execute("UPDATE tickets SET status='closed', resolution=?, updated_at=? WHERE kind='host' AND host_id=?",
                         (f"审核未通过：{reason}" if reason else "审核未通过", now(), host_id))
            return True, "已拒绝该申请"
        if action == "blacklist":
            conn.execute("UPDATE hosts SET status='blacklisted', reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
                         (admin["id"], now(), now(), host_id))
            if host["node_id"]:
                conn.execute("UPDATE nodes SET active=0 WHERE id=?", (int(host["node_id"]),))
                refund_plans_on_node(conn, int(host["node_id"]), "节点被平台下架，按剩余价值退款")
            conn.execute("UPDATE tickets SET status='closed', resolution=?, updated_at=? WHERE kind='host' AND host_id=?",
                         ("已加入黑名单", now(), host_id))
            return True, "已加入黑名单"
        if host["status"] == "approved" and host["node_id"]:
            return False, "该申请已通过"
        existing_node = int(host["node_id"] or 0)
        if existing_node:
            conn.execute(
                "UPDATE nodes SET region=?, server_addr=?, server_port=?, port_start=?, port_end=?, bandwidth_mbps=?, monthly_traffic_bytes=?, active=1, expires_at=? WHERE id=?",
                (host["region"], host["server_addr"], int(host["server_port"]), int(host["port_start"]),
                 int(host["port_end"]), int(host["bandwidth_mbps"] or 0),
                 int(float(host["monthly_traffic_gb"] or 0) * 1024 ** 3), int(host["expires_at"] or 0), existing_node))
            conn.executemany("INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?,?,?)",
                             [(existing_node, p, now()) for p in range(int(host["port_start"]), int(host["port_end"]) + 1)])
            conn.execute("UPDATE plans SET active=1 WHERE node_id=?", (existing_node,))
            conn.execute("UPDATE hosts SET status='approved', reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
                         (admin["id"], now(), now(), host_id))
            notify(conn, int(host["user_id"]), "host_approved", "hosts",
                   name=str(host["name"]))
            conn.execute("UPDATE tickets SET status='closed', resolution=?, updated_at=? WHERE kind='host' AND host_id=?",
                         ("审核通过，节点与套餐已上架", now(), host_id))
            return True, "已通过审核，节点与套餐已上架"
        # approve -> create node
        base_name = str(host["name"])
        node_name = base_name
        suffix = 1
        while conn.execute("SELECT 1 FROM nodes WHERE name=?", (node_name,)).fetchone():
            suffix += 1
            node_name = f"{base_name}-{suffix}"
        token = str(host["auth_token"] or "") or secrets.token_urlsafe(24)
        cur = conn.execute(
            "INSERT INTO nodes(region, name, server_addr, server_port, auth_token, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, monthly_traffic_bytes, active, note, created_at, owner_id, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (host["region"], node_name, host["server_addr"], int(host["server_port"]), token,
             int(host["port_start"]), int(host["port_end"]), 0, "", "", "", int(host["bandwidth_mbps"] or 0),
             int(float(host["monthly_traffic_gb"] or 0) * 1024 ** 3), 1,
             f"托管：{host['username']} / {host['note'] or ''}".strip(), now(), int(host["user_id"]), int(host["expires_at"] or 0)))
        node_id = int(cur.lastrowid)
        conn.executemany("INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?,?,?)",
                         [(node_id, p, now()) for p in range(int(host["port_start"]), int(host["port_end"]) + 1)])
        conn.execute("UPDATE hosts SET status='approved', node_id=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
                     (node_id, admin["id"], now(), now(), host_id))
        conn.execute("UPDATE hosts SET auth_token=? WHERE id=?", (token, host_id))
    return True, f"已通过并创建节点「{node_name}」"


class Handler(BaseHTTPRequestHandler):
    server_version = "frp-manager-lite-api/2.0.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), fmt % args))

    @property
    def current_user(self) -> sqlite3.Row | None:
        return session_user(self.headers.get("Cookie"))

    def request_is_https(self) -> bool:
        """判断当前请求是否经 HTTPS（直连 TLS 或反向代理头）。"""
        if isinstance(self.connection, ssl.SSLSocket):
            return True
        proto = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
        if proto == "https":
            return True
        if (self.headers.get("X-Forwarded-Ssl") or "").strip().lower() == "on":
            return True
        if (self.headers.get("Front-End-Https") or "").strip().lower() == "on":
            return True
        return False

    def secure_cookie_suffix(self) -> str:
        return "; Secure" if self.request_is_https() else ""

    def send_body(self, body: bytes, status: int = 200, content_type: str = "application/octet-stream", headers: dict[str, str] | None = None, cache_control: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", cache_control or "no-store")
        if HSTS_MAX_AGE > 0 and self.request_is_https():
            self.send_header("Strict-Transport-Security", f"max-age={HSTS_MAX_AGE}; includeSubDomains")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data: Any, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self.send_body(json.dumps(data, ensure_ascii=False).encode(), status, "application/json; charset=utf-8", headers)

    def read_body_raw(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > MAX_BODY:
            raise ValueError("请求体过大")
        return self.rfile.read(length) if length else b""

    def read_json(self) -> dict[str, Any]:
        raw = self.read_body_raw().decode("utf-8")
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
        elif path == "/__fml_ping":
            # Public node-side latency probe (no auth, no DB). When this panel is
            # served under an frps node's public host, the browser measures a real
            # user→node round trip by fetching this endpoint.
            self.send_body(b"", 204, "text/plain", headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Timing-Allow-Origin": "*",
            })
        elif path == "/config/frpc.toml":
            self.download_frpc()
        elif path == "/config/deploy-frpc.sh":
            self.download_frpc_deploy_script()
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
        elif path == "/api/setup/register-node":
            self.setup_register_node()
        elif path == "/api/wecom/bind":
            self.wecom_bind_callback()
        elif path == "/api/license/activate" and SOFTWARE_LICENSE_AUTHORITY:
            self.license_authority_activate()
        elif path == "/api/license/activate" and SOFTWARE_LICENSE_REQUIRED and not software_license_ok():
            self.api_license_activate_public()
        elif path.startswith("/api/pay/notify/"):
            self.pay_notify(path)
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

    def wecom_bind_callback(self) -> None:
        """Bncr 插件回调：群里发送绑定码后，绑定企微 userid。"""
        try:
            data = self.read_json()
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
            return
        code = str(data.get("code", "")).strip().upper()
        userid = str(data.get("userid", "")).strip()[:64]
        if not code.startswith("FML-"):
            self.send_json({"ok": False, "error": "code invalid"}, 400)
            return
        with db() as conn:
            cfg = bncr_config(conn)
            if cfg["token"]:
                supplied = str(data.get("token", ""))
                if not hmac.compare_digest(supplied, cfg["token"]):
                    self.send_json({"ok": False, "error": "token invalid"}, 403)
                    return
            row = conn.execute("SELECT id, user_id FROM wecom_bind_codes WHERE code=? AND expires_at>?", (code, now())).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "code not found or expired"}, 404)
                return
            username = conn.execute("SELECT username FROM users WHERE id=?", (int(row["user_id"]),)).fetchone()
            conn.execute("UPDATE users SET wecom_userid=? WHERE id=?", (userid, int(row["user_id"])))
            conn.execute("DELETE FROM wecom_bind_codes WHERE id=?", (int(row["id"]),))
        self.send_json({"ok": True, "message": "绑定成功", "username": username["username"] if username else ""})
        return

    def setup_register_node(self) -> None:
        """One-click frps node registration — authenticated via FML_SETUP_KEY."""
        try:
            data = self.read_json()
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
            return
        setup_key = str(data.get("setup_key", ""))
        expected_setup_key = effective_setup_key()
        host_apply = None
        if not (expected_setup_key and hmac.compare_digest(setup_key, expected_setup_key)):
            with db() as conn:
                host_apply = conn.execute("SELECT * FROM hosts WHERE deploy_token=? AND status IN ('pending_node','pending')", (setup_key,)).fetchone()
            if not host_apply:
                self.send_json({"ok": False, "error": "接入密钥无效，请在托管页面重新生成脚本"}, 403)
                return
        try:
            region = str(data.get("region", "")).strip() or "默认地区"
            name = str(data.get("name", "")).strip()
            server_addr = str(data.get("server_addr", "")).strip()
            server_port = int(data.get("server_port", 7000))
            if host_apply is not None:
                node_id = int(host_apply["node_id"] or 0)
                if node_id:
                    with db() as conn:
                        conn.execute("UPDATE nodes SET server_addr=?, server_port=?, active=0 WHERE id=?",
                                     (server_addr or host_apply["server_addr"], server_port, node_id))
                        conn.execute("UPDATE hosts SET status='pending', updated_at=? WHERE id=?", (now(), int(host_apply["id"])))
                        notify_admins_tpl(conn, "host_submitted", "hosts", name=str(host_apply["name"]), username=str(host_apply["username"]))
                self.send_json({"ok": True, "message": "母鸡已接入平台，已提交管理员审核", "node_id": int(host_apply["node_id"] or 0)})
                return
            auth_token = str(data.get("auth_token", "")).strip()
            port_start = int(data.get("port_start", 20000))
            port_end = int(data.get("port_end", 20199))
            note = str(data.get("note", "")).strip()[:120]
            web_port = int(data.get("web_port", 0) or 0)
            dashboard_url = str(data.get("dashboard_url", "")).strip().rstrip("/")[:300]
            dashboard_user = str(data.get("dashboard_user", "")).strip()[:80]
            dashboard_password = str(data.get("dashboard_password", "")).strip()[:200]
            bandwidth_mbps = max(0, int(data.get("bandwidth_mbps", 0) or 0))
            if not name or not name.replace("_", "").replace("-", "").isalnum():
                raise ValueError("节点名称只能包含字母、数字、下划线、短横线")
            if not server_addr:
                raise ValueError("server_addr 不能为空")
            if len(auth_token) < 6:
                raise ValueError("auth_token 至少 6 位")
            if not (1 <= port_start <= port_end <= 65535):
                raise ValueError("端口池范围不合法")
            if web_port and not (1 <= web_port <= 65535):
                raise ValueError("frps dashboard 端口不合法")
            if port_end - port_start > 20000:
                raise ValueError("单节点端口池不要超过 20000 个")
            reused = False
            with db() as conn:
                existing = conn.execute("SELECT * FROM nodes WHERE name=?", (name,)).fetchone()
                if existing:
                    if str(existing["auth_token"]) != auth_token:
                        self.send_json({"ok": False, "error": f"节点名称 {name} 已被其他 token 使用"}, 409)
                        return
                    # 幂等重跑：同名 + token 一致 → 同一节点重新部署，复用 node_id，更新配置
                    node_id = int(existing["id"])
                    conn.execute(
                        "UPDATE nodes SET region=?, server_addr=?, server_port=?, port_start=?, port_end=?, web_port=?, dashboard_url=?, dashboard_user=?, dashboard_password=?, bandwidth_mbps=?, note=?, active=1 WHERE id=?",
                        (region, server_addr, server_port, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, note, node_id),
                    )
                    reused = True
                else:
                    cur = conn.execute(
                        "INSERT INTO nodes(region, name, server_addr, server_port, auth_token, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, note, active, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (region, name, server_addr, server_port, auth_token, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, note, 1, now()),
                    )
                    node_id = cur.lastrowid
                # 端口池（新建或补建）
                conn.executemany(
                    "INSERT OR IGNORE INTO ports(node_id, port, user_id, created_at) VALUES(?,?,NULL,?)",
                    [(node_id, p, now()) for p in range(port_start, port_end + 1)],
                )
            # 节点接入：立即连续探测几次确认正常（不阻塞响应）
            spawn_new_node_verify({"name": name, "server_addr": server_addr, "server_port": server_port, "active": True})
            self.send_json({"ok": True, "message": f"节点 {name} {'已重新部署' if reused else '注册成功'}", "node_id": node_id, "reused": reused}, 200 if reused else 201)
        except ValueError as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": f"注册失败：{e}"}, 500)

    def api_license_activate_public(self) -> None:
        try:
            data = self.read_json()
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
            return
        csrf = self.headers.get("X-CSRF-Token")
        if not validate_csrf(csrf, self.headers.get("Cookie")):
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

    def admin_r2_config_save(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        account_id = str(data.get("account_id", "")).strip()
        access_key_id = str(data.get("access_key_id", "")).strip()
        secret_access_key = str(data.get("secret_access_key", "")).strip()
        bucket = str(data.get("bucket", "")).strip()
        prefix = str(data.get("prefix", "frp-manager-lite/backups")).strip().strip("/")
        if any(ch in bucket for ch in " /\\"):
            self.send_json({"ok": False, "error": "Bucket 名称不能包含空格或斜杠"}, 400)
            return
        with db() as conn:
            current = r2_config_from_db(conn)
            if not secret_access_key:
                secret_access_key = current.get("secret_access_key", "")
            for key, value in {
                "r2.account_id": account_id,
                "r2.access_key_id": access_key_id,
                "r2.secret_access_key": secret_access_key,
                "r2.bucket": bucket,
                "r2.prefix": prefix,
            }.items():
                setting_set(conn, key, value)
            cfg = public_r2_config(conn)
        audit("r2_config_update", admin, None, None, "", f"bucket={bucket}, prefix={prefix}")
        self.send_json({"ok": True, "message": "R2 配置已保存", "r2": cfg})

    def admin_backup_r2(self, admin: sqlite3.Row) -> None:
        if not self.require_admin():
            return
        try:
            with db() as conn:
                cfg = r2_config_from_db(conn)
            stamp, payload = make_full_backup_zip(admin["username"])
            prefix = cfg.get("prefix", "").strip("/")
            object_key = f"{prefix}/frp-manager-lite-backup-{stamp}.zip" if prefix else f"frp-manager-lite-backup-{stamp}.zip"
            upload_to_r2(object_key, payload, cfg=cfg)
            audit("backup_r2_upload", admin, None, None, "", object_key)
            self.send_json({"ok": True, "message": "已上传全量备份到 R2", "object_key": object_key, "size": len(payload)})
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def admin_restore_backup(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        if str(data.get("confirm", "")).strip() != "RESTORE":
            self.send_json({"ok": False, "error": "请输入确认词 RESTORE 后再恢复"}, 400)
            return
        ok, msg, info = restore_full_backup_zip(admin["username"], str(data.get("filename", "backup.zip")), str(data.get("content_base64", "")))
        if ok:
            audit("backup_restore", admin, None, None, "", f"{info.get('source_filename','')} pre={info.get('pre_restore_backup','')}")
        self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "restore": info}, 200 if ok else 400)

    def admin_tunnel_create_for_user(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("user_id", 0))
        try:
            raw_items = data.get("tunnels")
            if isinstance(raw_items, list):
                items = [x for x in raw_items if isinstance(x, dict)]
            else:
                items = [data]
            if not items:
                raise ValueError("请至少添加一个隧道")
            if len(items) > 20:
                raise ValueError("一次最多创建 20 个隧道")

            parsed: list[dict[str, Any]] = []
            for item in items:
                name = str(item.get("name", "")).strip()
                proxy_type = str(item.get("proxy_type", "tcp")).lower()
                local_ip = str(item.get("local_ip", "127.0.0.1")).strip()
                local_port = int(item.get("local_port", 0))
                remote_port = int(item.get("remote_port", 0) or 0)
                custom_domains = ",".join([d.strip().lower() for d in str(item.get("custom_domains", "")).replace("\n", ",").split(",") if d.strip()])[:500]
                secret_key = str(item.get("secret_key", "")).strip()[:120]
                if not name or len(name) > 40 or not name.replace("_", "").replace("-", "").isalnum():
                    raise ValueError("隧道名称只能包含字母、数字、下划线、短横线，长度 1-40")
                if proxy_type not in ALLOWED_PROXY_TYPES:
                    raise ValueError("协议不支持")
                if not (1 <= local_port <= 65535):
                    raise ValueError("本地端口不合法")
                if proxy_type not in REMOTE_PORT_PROXY_TYPES:
                    remote_port = 0
                if proxy_type in DOMAIN_PROXY_TYPES and not custom_domains:
                    raise ValueError("HTTP/HTTPS/TCPMUX 必须填写自定义域名")
                if proxy_type in SECRET_KEY_PROXY_TYPES and not secret_key:
                    secret_key = secrets.token_urlsafe(16)
                parsed.append({"name": name, "proxy_type": proxy_type, "local_ip": local_ip, "local_port": local_port, "remote_port": remote_port, "custom_domains": custom_domains, "secret_key": secret_key})

            created: list[dict[str, Any]] = []
            with db() as conn:
                target = conn.execute("SELECT * FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
                if not target:
                    raise ValueError("用户不存在")
                if not target["active"] or is_expired(target):
                    raise ValueError("用户已停用或已到期")
                node = conn.execute("SELECT * FROM nodes WHERE id=?", (target["node_id"],)).fetchone()
                if not node:
                    raise ValueError("用户所属节点不存在")
                reserved_ports: set[int] = set()
                for item in parsed:
                    remote_port = int(item["remote_port"] or 0)
                    proxy_type = str(item["proxy_type"])
                    if proxy_type in REMOTE_PORT_PROXY_TYPES:
                        if remote_port:
                            if remote_port in reserved_ports:
                                raise ValueError(f"公网端口 {remote_port} 在本次配置中重复")
                            owned = conn.execute("SELECT 1 FROM ports WHERE node_id=? AND user_id=? AND port=?", (target["node_id"], target["id"], remote_port)).fetchone()
                            if not owned:
                                raise ValueError(f"公网端口 {remote_port} 不属于该用户")
                            used = conn.execute("SELECT 1 FROM tunnels WHERE node_id=? AND remote_port=? AND proxy_type IN ('tcp','udp')", (target["node_id"], remote_port)).fetchone()
                            if used:
                                raise ValueError(f"公网端口 {remote_port} 已被其他隧道使用")
                        else:
                            row = conn.execute("""
                                SELECT p.port FROM ports p
                                LEFT JOIN tunnels t ON t.node_id=p.node_id AND t.remote_port=p.port AND t.proxy_type IN ('tcp','udp')
                                WHERE p.node_id=? AND p.user_id=? AND t.id IS NULL
                                ORDER BY p.port
                            """, (target["node_id"], target["id"])).fetchall()
                            available = [int(r["port"]) for r in row if int(r["port"]) not in reserved_ports]
                            if not available:
                                raise ValueError("该用户没有可用公网端口")
                            remote_port = available[0]
                        reserved_ports.add(remote_port)
                        item["remote_port"] = remote_port
                    conn.execute(
                        "INSERT INTO tunnels(node_id, user_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (target["node_id"], target["id"], item["name"], proxy_type, item["local_ip"], item["local_port"], remote_port, item["custom_domains"], item["secret_key"], now()),
                    )
                    created.append({"name": item["name"], "proxy_type": proxy_type, "remote_port": remote_port, "local_ip": item["local_ip"], "local_port": item["local_port"]})
                tunnels = conn.execute("SELECT * FROM tunnels WHERE user_id=? ORDER BY id", (target["id"],)).fetchall()
                cfg = tunnel_config(target, node, tunnels)
            for item in created:
                audit("admin_tunnel_create", admin, target["node_id"], item["remote_port"] or None, item["proxy_type"], f"target={target['username']} {item['name']} -> {item['local_ip']}:{item['local_port']}")
            audit("admin_frpc_config_download", admin, target["node_id"], None, "", f"target={target['username']} after_create={len(created)}")
            script = frpc_deploy_script(cfg)
            self.send_json({"ok": True, "message": f"已创建 {len(created)} 个隧道并生成 frpc 配置和部署脚本", "created": created, "filename": f"frpc-{target['username']}.toml", "config": cfg, "script_filename": f"deploy-frpc-{target['username']}.sh", "deploy_script": script})
        except sqlite3.IntegrityError:
            self.send_json({"ok": False, "error": "隧道名称或公网端口已被使用"}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def export_invite_keys_csv(self) -> None:
        if not self.require_admin() or not self.require_software_license():
            return
        import csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["密钥", "类型", "备注", "已用次数", "可用次数", "端口数", "每日流量上限(GB)", "速率上限(MB/s)", "有效期或续期天数", "状态", "密钥到期", "创建时间"])
        with db() as conn:
            for k in conn.execute("SELECT * FROM invite_keys WHERE deleted=0 AND active=1 AND used_count=0 AND used_count < max_uses AND (expires_at=0 OR expires_at>?) ORDER BY id DESC", (now(),)):
                kind = row_val(k, "kind", "register") or "register"
                is_register = kind == "register"
                kind_label = {"register": "注册", "renew": "续期", "reset": "重置"}.get(kind, "注册")
                w.writerow([
                    k["key"],
                    kind_label,
                    k["note"],
                    k["used_count"],
                    k["max_uses"],
                    k["max_ports"] if is_register else "-",
                    round(int(row_val(k, "traffic_limit_bytes", 0) or 0) / 1024 / 1024 / 1024, 2) if is_register else "-",
                    round(int(row_val(k, "bandwidth_limit_kbps", 0) or 0) / 1024, 2) if is_register else "-",
                    k["user_expires_days"],
                    "启用" if k["active"] else "停用",
                    fmt_time(k["expires_at"]),
                    fmt_time(k["created_at"]),
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
        body = target.read_bytes()
        ctype = static_content_type(target)
        q = urllib.parse.parse_qs(urlparse(self.path).query)
        if target.name.endswith(".html"):
            cache = "no-store"
        elif q.get("v"):
            cache = "public, max-age=31536000, immutable"
        else:
            cache = "public, max-age=3600"
        extra: dict[str, str] = {}
        accept = (self.headers.get("Accept-Encoding") or "").lower()
        compressible = ctype.startswith("text/") or any(x in ctype for x in ("javascript", "json", "svg", "xml"))
        if "gzip" in accept and compressible and len(body) > 1024:
            body = gzip.compress(body, 6)
            extra["Content-Encoding"] = "gzip"
            extra["Vary"] = "Accept-Encoding"
        self.send_body(body, 200, ctype, extra, cache_control=cache)

    def host_port_rate_rules(self) -> None:
        """Host-side tc/iptables sync endpoint, authenticated by FML_SETUP_KEY."""
        token = self.headers.get("X-FML-Setup-Key", "")
        if not token:
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            token = str((q.get("setup_key") or q.get("token") or [""])[0])
        expected_setup_key = effective_setup_key()
        if not expected_setup_key or not hmac.compare_digest(str(token), expected_setup_key):
            self.send_json({"ok": False, "error": "forbidden"}, 403)
            return
        q = urllib.parse.parse_qs(urlparse(self.path).query)
        node_id = int_or_none((q.get("node_id") or [""])[0])
        params: list[Any] = []
        node_clause = ""
        if node_id:
            node_clause = "AND t.node_id=?"
            params.append(node_id)
        with db() as conn:
            rows = conn.execute(f"""
                SELECT DISTINCT t.remote_port, t.proxy_type, u.id AS user_id, u.username, u.bandwidth_limit_kbps, t.node_id, n.name AS node_name, n.region AS node_region
                FROM tunnels t
                JOIN users u ON u.id=t.user_id
                LEFT JOIN nodes n ON n.id=t.node_id
                WHERE t.enabled=1
                  AND t.proxy_type IN ('tcp','udp')
                  AND t.remote_port IS NOT NULL
                  AND u.active=1
                  AND u.bandwidth_limit_kbps>0
                  {node_clause}
                ORDER BY t.remote_port
            """, params).fetchall()
        rules = []
        seen: set[tuple[int, str]] = set()
        for r in rows:
            port = int(r["remote_port"] or 0)
            speed_kib = int(r["bandwidth_limit_kbps"] or 0)
            proto = str(r["proxy_type"] or "tcp")
            if port <= 0 or speed_kib <= 0 or (port, proto) in seen:
                continue
            seen.add((port, proto))
            rules.append({
                "port": port,
                "protocol": proto,
                "rate_kib_per_sec": speed_kib,
                "rate_kbit": max(8, speed_kib * 8),
                "user_id": int(r["user_id"]),
                "username": r["username"],
                "node_id": int(r["node_id"] or 0),
                "node_name": r["node_name"] or "",
                "node_region": r["node_region"] or "",
            })
        self.send_json({"ok": True, "generated_at": now(), "node_id": node_id or 0, "rules": rules})

    def api_get(self, path: str) -> None:
        if path == "/api/csrf":
            token = make_csrf_token()
            self.send_json({"ok": True, "csrf_token": token}, headers={"Set-Cookie": f"fml_csrf={token}; SameSite=Lax; Path=/; Max-Age={CSRF_TTL}{self.secure_cookie_suffix()}"})
            return
        if path == "/api/ping":
            # Lightweight client-side latency probe (no DB / no auth work).
            self.send_json({"ok": True, "t": now()}, headers={"Cache-Control": "no-store"})
            return
        if path == "/api/plans":
            with db() as conn:
                cfg = payment_config(conn)
                self.send_json({"ok": True, "plans": list_plans(conn, active_only=True), "payment": payment_public(cfg)})
            return
        if path == "/api/orders/status":
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            order_no = (q.get("order_no") or [""])[0]
            user = self.current_user
            if not user:
                self.send_json({"ok": False, "error": "unauthorized"}, 401)
                return
            with db() as conn:
                row = conn.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
            if not row or (int(row["user_id"]) != int(user["id"]) and user["role"] != "admin"):
                self.send_json({"ok": False, "error": "订单不存在"}, 404)
                return
            self.send_json({"ok": True, "order": order_public(row)})
            return
        if path.startswith("/api/pay/mock/"):
            order_no = path.rsplit("/", 1)[-1]
            with db() as conn:
                cfg = payment_config(conn)
            if (cfg.get("provider") or "") != "mock":
                self.send_json({"ok": False, "error": "mock 支付未启用"}, 404)
                return
            ok, msg = mark_order_paid(order_no, "MOCK-" + order_no, "mock")
            target = f"/?pay={'success' if ok else 'fail'}&order={urllib.parse.quote(order_no)}"
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/api/pay/return/alipay":
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            order_no = (q.get("out_trade_no") or [""])[0]
            self.send_response(302)
            self.send_header("Location", f"/?pay=return&order={urllib.parse.quote(order_no)}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/api/registration-status":
            self.send_json({"ok": True, "open_registration": OPEN_REGISTRATION, "max_ports": OPEN_REGISTRATION_MAX_PORTS, "expires_days": OPEN_REGISTRATION_EXPIRES_DAYS})
            return
        if path == "/api/nodes":
            with db() as conn:
                self.send_json({"ok": True, "nodes": list_public_nodes(conn, active_only=True)})
            return
        if path == "/api/user/nodes":
            user_row = self.current_user
            if not user_row:
                self.send_json({"ok": False, "error": "unauthorized"}, 401)
                return
            with db() as conn:
                nodes = list_public_nodes(conn, active_only=True)
            current_node_id = int(user_row["node_id"] or 0)
            attach_node_auth_port_status(nodes)
            for n in nodes:
                for k in ("auth_token", "dashboard_url", "dashboard_user", "dashboard_password", "dashboard_configured"):
                    n.pop(k, None)
                n["is_current"] = int(n["id"]) == current_node_id
            self.send_json({"ok": True, "nodes": nodes, "current_node_id": current_node_id})
            return
        if path.startswith("/api/user/nodes/") and path.endswith("/ports"):
            user_row = self.current_user
            if not user_row:
                self.send_json({"ok": False, "error": "unauthorized"}, 401)
                return
            try:
                nid = int(path.split("/")[4])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "节点不存在"}, 400)
                return
            with db() as conn:
                rows = conn.execute(
                    """SELECT p.port,
                              CASE WHEN t.id IS NULL THEN 0 ELSE 1 END AS used
                       FROM ports p
                       LEFT JOIN tunnels t ON t.node_id=p.node_id AND t.remote_port=p.port AND t.proxy_type IN ('tcp','udp')
                       WHERE p.node_id=? AND p.user_id=? ORDER BY p.port""",
                    (nid, int(user_row["id"]))).fetchall()
            self.send_json({"ok": True, "ports": [{"port": int(r["port"]), "used": bool(r["used"])} for r in rows]})
            return
        if path.startswith("/api/user/nodes/") and path.endswith("/free-ports"):
            user_row = self.current_user
            if not user_row:
                self.send_json({"ok": False, "error": "unauthorized"}, 401)
                return
            try:
                nid = int(path.split("/")[4])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "节点不存在"}, 400)
                return
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            try:
                count = int((q.get("count") or ["1"])[0])
            except ValueError:
                count = 1
            count = max(1, min(20, count))
            with db() as conn:
                rows = available_ports_for_assignment(conn, nid, count)
            self.send_json({"ok": True, "ports": [int(r["port"]) for r in rows]})
            return
        if path == "/api/license/status":
            with db() as conn:
                self.send_json({"ok": True, "license": current_software_license(conn)})
            return
        if path == "/api/host/port-rate-rules":
            self.host_port_rate_rules()
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
                node_id = int(user["node_id"] or 0)
                node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone() if node_id else None
                ports = [r["port"] for r in conn.execute("SELECT port FROM ports WHERE node_id=? AND user_id=? ORDER BY port", (node_id, user["id"]))] if node_id else []
                if not ports and user["role"] == "admin":
                    # Admin doesn't own ports — return empty; port_stats from node totals
                    ports = []
                    port_count = conn.execute("SELECT MAX(port)-MIN(port)+1 FROM ports WHERE node_id=?", (node_id,)).fetchone()
                    port_count = (port_count[0] or 0) if port_count else 0
                tunnel_rows = [row_dict(r) for r in conn.execute("""
                    SELECT t.*, n.server_addr, n.server_port
                    FROM tunnels t
                    LEFT JOIN nodes n ON n.id=t.node_id
                    WHERE t.user_id=? ORDER BY t.id DESC
                """, (user["id"],))]
                tunnel_rows = attach_tunnel_mapping_status(tunnel_rows)
                port_count = len(ports)
                owned_port_set = {int(x) for x in ports}
                used_ports = sorted({int(t["remote_port"]) for t in tunnel_rows
                                     if t["remote_port"] and int(t["remote_port"]) in owned_port_set})
                # Cap: only send first 200 for rendering, too many would freeze the browser
                ports_display = ports[:200] if port_count > 200 else ports
                port_stats = {"total": port_count, "used": len(used_ports), "free": port_count - len(used_ports)}
                user_dashboard = frps_user_dashboard(user["username"], user) if node else None
                refresh_user_plan_usage(conn, int(user["id"]))
                my_plans = []
                plan_price_map = {int(x["id"]): int(x["price_points"] or 0) for x in conn.execute("SELECT id, price_points FROM plans WHERE deleted=0").fetchall()}
                for r in conn.execute("SELECT * FROM user_plans WHERE user_id=? ORDER BY id DESC", (user["id"],)):
                    exp = int(r["expires_at"] or 0)
                    status = r["status"] or "active"
                    if status == "active" and exp and exp <= now():
                        status = "expired"
                    my_plans.append({
                        "id": r["id"], "plan_id": int(r["plan_id"] or 0), "plan_name": r["plan_name"], "node_id": int(r["node_id"] or 0), "max_ports": r["max_ports"],
                        "billing_mode": r["billing_mode"] or "time",
                        "quota_bytes": int(r["quota_bytes"] or 0), "used_bytes": int(r["used_bytes"] or 0),
                        "quota_gb": round(int(r["quota_bytes"] or 0) / 1024 / 1024 / 1024, 2),
                        "used_gb": round(int(r["used_bytes"] or 0) / 1024 / 1024 / 1024, 2),
                        "traffic_limit_bytes": r["traffic_limit_bytes"], "bandwidth_limit_kbps": r["bandwidth_limit_kbps"],
                        "expires_at": exp, "expires_text": fmt_time(exp),
                        "status": status, "expired": status != "active", "created_at": r["created_at"],
                        "price_points": int(r["price_points"] or 0),
                        "renew_price_points": plan_price_map.get(int(r["plan_id"] or 0)),
                        "refund_points": (compute_plan_refund(conn, r)["points"] if status == "active" else 0),
                        "grace_until": int(conn.execute(
                            "SELECT COALESCE(MAX(release_at),0) FROM user_plan_ports WHERE user_plan_id=?", (r["id"],)).fetchone()[0] or 0),
                        "paused": False,
                        "auto_renew": int(row_val(r, "auto_renew", 0) or 0),
                        "ports": [int(x["port"]) for x in conn.execute(
                            "SELECT port FROM user_plan_ports WHERE user_plan_id=? AND release_at=0 ORDER BY port", (r["id"],)).fetchall()],
                    })
            node_payload = node_public(node) if node else None
            if node_payload:
                # 用节点健康快照（后台定时采集），避免每次打开概览都实时探测。
                health = node_health_lookup(node_payload)
                node_payload.update(health if health is not None else check_node_auth_port(node_payload))
                node_payload["latency_ms"] = node_payload.get("auth_latency_ms")
            self.send_json({"ok": True, "version": APP_VERSION, "uptime_seconds": int(time.time() - SERVER_START_TS), "latest_version": panel_latest_version(), "update_link": PANEL_UPDATE_LINK, "user": public_user(user), "software_license": sw_license, "node": node_payload, "ports": ports_display, "port_stats": port_stats, "tunnels": tunnel_rows, "my_plans": my_plans, "payment": payment_public(payment_config(conn)), "frps_user_dashboard": user_dashboard, "allowed_proxy_types": PROXY_TYPE_ORDER, "frps": {"addr": node["server_addr"] if node else FRP_SERVER_ADDR, "port": node["server_port"] if node else FRP_SERVER_PORT}})
            return
        if path == "/api/user/provider/plans":
            with db() as conn:
                rows = conn.execute(
                    """SELECT p.* FROM plans p JOIN nodes n ON n.id=p.node_id
                       WHERE n.owner_id=? AND p.deleted=0 ORDER BY p.id DESC""", (int(user["id"]),)).fetchall()
                self.send_json({"ok": True, "plans": [plan_public(r) for r in rows]})
            return
        if path.startswith("/api/upload/"):
            tok = path.rsplit("/", 1)[-1]
            with db() as conn:
                row = conn.execute("SELECT * FROM uploads WHERE token=?", (tok,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "文件不存在"}, 404)
                return
            if row["kind"] == "qr" and int(row["user_id"]) != int(user["id"]) and user["role"] != "admin":
                self.send_json({"ok": False, "error": "无权查看"}, 403)
                return
            self.send_body(bytes(row["data"]), 200, row["mime"] or "application/octet-stream", cache_control="private, max-age=86400")
            return
        if path == "/api/announcements":
            with db() as conn:
                rows = conn.execute("SELECT * FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 20").fetchall()
            self.send_json({"ok": True, "announcements": [dict(r) for r in rows]})
            return
        if path == "/api/admin/announcements":
            if not self.require_admin():
                return
            with db() as conn:
                rows = conn.execute("SELECT * FROM announcements ORDER BY id DESC LIMIT 100").fetchall()
            self.send_json({"ok": True, "announcements": [{**dict(r), "kind": row_val(r, "kind", "announcement")} for r in rows]})
            return
        if path == "/api/notifications":
            with db() as conn:
                rows = conn.execute("SELECT * FROM notifications WHERE user_id=? AND read_at=0 ORDER BY id DESC LIMIT 30", (int(user["id"]),)).fetchall()
                unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at=0", (int(user["id"]),)).fetchone()[0]
                seen = int(row_val(conn.execute("SELECT announcement_seen_at FROM users WHERE id=?", (int(user["id"]),)).fetchone(), "announcement_seen_at", 0) or 0)
                unseen_ann = conn.execute("SELECT COUNT(*) FROM announcements WHERE active=1 AND created_at>?", (seen,)).fetchone()[0]
            self.send_json({"ok": True, "notifications": [dict(r) for r in rows], "unread": int(unread or 0) + int(unseen_ann or 0), "unread_notifications": int(unread or 0), "unseen_announcements": int(unseen_ann or 0)})
            return
        if path == "/api/user/notify-config":
            with db() as conn:
                cfg = user_notify_config_get(conn, int(user["id"]))
            self.send_json({"ok": True, "config": cfg, "channels": NOTIFY_CHANNELS, "events": USER_NOTIFY_EVENTS})
            return
        if path == "/api/user/wecom/bindcode":
            with db() as conn:
                row = conn.execute("SELECT code, expires_at FROM wecom_bind_codes WHERE user_id=? AND expires_at>? ORDER BY id DESC LIMIT 1",
                                   (int(user["id"]), now())).fetchone()
                if row and now() < int(row["expires_at"]):
                    code = row["code"]
                else:
                    code = "FML-" + secrets.token_hex(4).upper()
                    conn.execute("DELETE FROM wecom_bind_codes WHERE user_id=? OR expires_at<=?", (int(user["id"]), now()))
                    conn.execute("INSERT INTO wecom_bind_codes(code, user_id, created_at, expires_at) VALUES(?,?,?,?)",
                                 (code, int(user["id"]), now(), now() + 3600))
                cfg = bncr_config(conn)
                bound = str(row_val(user, "wecom_userid", "") or "").strip() if user else ""
                bound_now = conn.execute("SELECT wecom_userid FROM users WHERE id=?", (int(user["id"]),)).fetchone()
            self.send_json({"ok": True, "code": code, "bound": bool(str(bound_now["wecom_userid"] or "").strip()) if bound_now else False,
                            "expires_at": now() + 3600})
            return
        if path == "/api/user/payout-account":
            with db() as conn:
                row = conn.execute("SELECT * FROM payout_accounts WHERE user_id=?", (int(user["id"]),)).fetchone()
            self.send_json({"ok": True, "account": {
                "method": row["method"] if row else "alipay",
                "account": row["account"] if row else "",
                "holder": row["holder"] if row else "",
                "qr_token": (row_val(row, "qr_token", "") or "") if row else "",
            }})
            return
        if path == "/api/user/payouts":
            with db() as conn:
                rows = conn.execute("SELECT * FROM payouts WHERE user_id=? ORDER BY id DESC LIMIT 50", (int(user["id"]),)).fetchall()
            conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link='payouts'", (now(), int(user["id"])))
            self.send_json({"ok": True, "payouts": [payout_public(r, conn) for r in rows], "income": provider_income_balance(conn, int(user["id"]))})
            return
        if path == "/api/tickets/summary":
            with db() as conn:
                if user["role"] == "admin":
                    t_count = conn.execute("SELECT COUNT(*) FROM tickets WHERE status='open' AND kind='issue'").fetchone()[0]
                    p_count = conn.execute("SELECT COUNT(*) FROM payouts WHERE status='pending'").fetchone()[0]
                    h_count = conn.execute("SELECT COUNT(*) FROM hosts WHERE status='pending'").fetchone()[0]
                else:
                    t_own = conn.execute("SELECT COUNT(*) FROM tickets WHERE user_id=? AND status='processing' AND kind='issue'", (int(user["id"]),)).fetchone()[0]
                    t_owner = conn.execute(
                        """SELECT COUNT(*) FROM tickets t JOIN nodes n ON n.id=t.node_id
                           WHERE n.owner_id=? AND t.status='open' AND t.user_id<>? AND t.kind='issue'""",
                        (int(user["id"]), int(user["id"]))).fetchone()[0]
                    t_count = int(t_own or 0) + int(t_owner or 0)
                    p_count = 0
                    h_count = conn.execute("SELECT COUNT(*) FROM hosts WHERE user_id=? AND status='pending'", (int(user["id"]),)).fetchone()[0]
                total = int(t_count or 0) + int(p_count or 0) + int(h_count or 0)
            self.send_json({"ok": True, "count": total, "tickets": int(t_count or 0), "payouts": int(p_count or 0), "hosts": int(h_count or 0)})
            return
        if path == "/api/user/tickets":
            qs = urllib.parse.parse_qs(urlparse(self.path).query)
            tid = int_or_none((qs.get("id") or [""])[0])
            with db() as conn:
                if tid:
                    row = conn.execute("SELECT t.*, n.name AS node_name FROM tickets t LEFT JOIN nodes n ON n.id=t.node_id WHERE t.id=?", (tid,)).fetchone()
                    if not row:
                        self.send_json({"ok": False, "error": "工单不存在"}, 404)
                        return
                    is_owner = int(row["owner_id"] or 0) == int(user["id"])
                    if int(row["user_id"]) != int(user["id"]) and not is_owner and user["role"] != "admin":
                        self.send_json({"ok": False, "error": "无权查看该工单"}, 403)
                        return
                    conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link=?",
                                 (now(), int(user["id"]), f"ticket:{tid}"))
                    msgs = conn.execute("SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY id", (tid,)).fetchall()
                    payout = None
                    if (row["kind"] or "") == "withdraw":
                        m = re.search(r"PO[0-9A-Za-z]{6,}", str(row["content"] or ""))
                        if m:
                            pr = conn.execute("SELECT * FROM payouts WHERE payout_no=?", (m.group(0),)).fetchone()
                            if pr:
                                payout = payout_public(pr, conn)
                    self.send_json({"ok": True, "ticket": ticket_public(row), "messages": [ticket_message_public(m) for m in msgs], "payout": payout})
                    return
                rows = conn.execute("SELECT t.*, n.name AS node_name FROM tickets t LEFT JOIN nodes n ON n.id=t.node_id WHERE t.user_id=? ORDER BY t.id DESC LIMIT 100", (int(user["id"]),)).fetchall()
                conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link='tickets'", (now(), int(user["id"])))
            self.send_json({"ok": True, "tickets": [ticket_public(r) for r in rows]})
            return
        if path == "/api/provider/tickets":
            with db() as conn:
                if user["role"] == "admin":
                    rows = conn.execute("SELECT t.*, n.name AS node_name FROM tickets t LEFT JOIN nodes n ON n.id=t.node_id ORDER BY t.id DESC LIMIT 100").fetchall()
                else:
                    rows = conn.execute(
                        """SELECT t.*, n.name AS node_name FROM tickets t JOIN nodes n ON n.id=t.node_id
                           WHERE n.owner_id=? ORDER BY t.id DESC LIMIT 100""", (int(user["id"]),)).fetchall()
            self.send_json({"ok": True, "tickets": [ticket_public(r) for r in rows]})
            return
        if path == "/api/admin/payouts":
            if not self.require_admin():
                return
            with db() as conn:
                rows = conn.execute("SELECT * FROM payouts ORDER BY id DESC LIMIT 200").fetchall()
            conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link='payouts'", (now(), int(user["id"])))
            self.send_json({"ok": True, "payouts": [payout_public(r, conn) for r in rows]})
            return
        if path == "/api/admin/ledger/analysis":
            if not self.require_admin():
                return
            qs = urllib.parse.parse_qs(urlparse(self.path).query)
            try:
                days = int((qs.get("days") or ["7"])[0])
            except ValueError:
                days = 7
            with db() as conn:
                info = ledger_analysis(conn, days)
            self.send_json({"ok": True, **info})
            return
        if path == "/api/admin/ports/stats":
            if not self.require_admin():
                return
            with db() as conn:
                repair_port_assignments(conn)
                row = conn.execute(
                    """SELECT COUNT(*) AS total,
                              COUNT(CASE WHEN p.user_id IS NOT NULL
                                           OR EXISTS (SELECT 1 FROM tunnels t
                                                      WHERE t.node_id=p.node_id AND t.remote_port=p.port
                                                        AND t.proxy_type IN ('tcp','udp'))
                                         THEN 1 END) AS used
                       FROM ports p"""
                ).fetchone()
            total = int(row["total"] or 0)
            used = int(row["used"] or 0)
            self.send_json({"ok": True, "total": total, "used": used, "free": max(0, total - used)})
            return
        if path == "/api/admin/ledger":
            if not self.require_admin():
                return
            qs = urllib.parse.parse_qs(urlparse(self.path).query)
            def qv(name, default=""):
                return (qs.get(name) or [default])[0]
            unit = qv("unit")
            direction = qv("direction")
            category = qv("category")
            keyword = qv("q").strip()
            try:
                start_ts = int(qv("from") or 0)
            except ValueError:
                start_ts = 0
            try:
                end_ts = int(qv("to") or 0)
            except ValueError:
                end_ts = 0
            try:
                limit = max(1, min(500, int(qv("limit") or 200)))
            except ValueError:
                limit = 200
            base_where: list[str] = []
            base_args: list[Any] = []
            if unit in ("points", "cash"):
                base_where.append("unit=?")
                base_args.append(unit)
            if direction in ("in", "out"):
                base_where.append("direction=?")
                base_args.append(direction)
            if category:
                base_where.append("category=?")
                base_args.append(category)
            if keyword:
                base_where.append("(order_no LIKE ? OR username LIKE ? OR note LIKE ? OR ref LIKE ?)")
                like = f"%{keyword}%"
                base_args.extend([like, like, like, like])
            where = list(base_where)
            args = list(base_args)
            if start_ts:
                where.append("ts>=?")
                args.append(start_ts)
            if end_ts:
                where.append("ts<=?")
                args.append(end_ts)
            base_clause = (" WHERE " + " AND ".join(base_where)) if base_where else ""
            clause = (" WHERE " + " AND ".join(where)) if where else ""
            with db() as conn:
                rate = 1
                # 期初余额：起始时间之前（同筛选条件）的累计
                open_clause = base_clause
                open_args = list(base_args)
                if start_ts:
                    open_clause = (open_clause + (" AND " if open_clause else " WHERE ") + "ts<?")
                    open_args = open_args + [start_ts]
                if start_ts:
                    row = conn.execute(
                        "SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amt WHEN 'out' THEN -amt WHEN 'reverse' THEN amt ELSE 0 END),0) FROM ("
                        " SELECT CASE WHEN unit='cash' THEN amount ELSE amount * 1.0 / ? END AS amt, direction FROM ledger"
                        + open_clause + ")", (rate, *open_args)).fetchone()
                    opening = q2(row[0] if row else 0)
                else:
                    opening = 0.0
                rows = conn.execute(
                    "SELECT * FROM ledger" + clause + " ORDER BY ts ASC, id ASC LIMIT ?", (*args, limit)).fetchall()
                totals = conn.execute(
                    "SELECT direction, COALESCE(SUM(CASE WHEN unit='cash' THEN amount ELSE amount * 1.0 / ? END),0)"
                    " FROM ledger" + clause + " GROUP BY direction", (rate, *args)).fetchall()
            summary = {"in": 0.0, "out": 0.0, "reverse": 0.0}
            for d, total in totals:
                summary[str(d)] = q2(total)
            balance = opening
            out_rows = []
            for r in rows:
                amt = q2(r["amount"] if r["unit"] == "cash" else r["amount"] / rate)
                if r["direction"] == "in":
                    balance = q2(balance + amt)
                elif r["direction"] == "out":
                    balance = q2(balance - amt)
                elif r["direction"] == "reverse":
                    balance = q2(balance + amt)
                out_rows.append({
                    "id": int(r["id"]), "ts": int(r["ts"]), "unit": r["unit"], "direction": r["direction"],
                    "category": r["category"], "category_text": LEDGER_CATEGORIES.get(r["category"], r["category"]),
                    "amount": amt, "balance": balance,
                    "user_id": int(r["user_id"] or 0), "username": r["username"],
                    "node_id": int(r["node_id"] or 0), "order_no": r["order_no"], "ref": r["ref"], "note": r["note"],
                })
            out_rows.reverse()
            self.send_json({"ok": True, "rows": out_rows, "summary": summary,
                            "opening": opening, "closing": balance, "categories": LEDGER_CATEGORIES})
            return
        if path == "/api/admin/tickets":
            if not self.require_admin():
                return
            with db() as conn:
                rows = conn.execute("SELECT t.*, n.name AS node_name FROM tickets t LEFT JOIN nodes n ON n.id=t.node_id ORDER BY t.id DESC LIMIT 200").fetchall()
                conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link='tickets'", (now(), int(user["id"])))
            self.send_json({"ok": True, "tickets": [ticket_public(r) for r in rows]})
            return
        if path == "/api/user/provider/earnings":
            with db() as conn:
                rows = conn.execute(
                    """SELECT up.*, n.name AS node_name FROM user_plans up
                       JOIN nodes n ON n.id=up.node_id
                       WHERE n.owner_id=? ORDER BY up.id DESC LIMIT 100""", (int(user["id"]),)).fetchall()
                plans = []
                paid_total = 0
                keep_total = 0
                for r in rows:
                    price = int(r["price_points"] or 0)
                    paid = int(r["provider_paid_points"] or 0)
                    keep = int(r["guarantee_points"] or 0)
                    paid_total += paid
                    keep_total += keep
                    plans.append({
                        "id": int(r["id"]), "plan_name": r["plan_name"], "node_id": int(r["node_id"] or 0),
                        "node_name": r["node_name"], "price_points": price,
                        "paid_points": paid, "guarantee_points": keep,
                        "progress": round(plan_progress(r), 4), "status": r["status"],
                    })
                g = conn.execute("SELECT points FROM provider_guarantee WHERE owner_id=?", (int(user["id"]),)).fetchone()
                inc = conn.execute("SELECT points FROM provider_income WHERE owner_id=?", (int(user["id"]),)).fetchone()
                debt_row = conn.execute("SELECT points FROM provider_debts WHERE owner_id=?", (int(user["id"]),)).fetchone()
                self.send_json({
                    "ok": True, "plans": plans,
                    "total_paid": paid_total, "guarantee": int(g["points"] or 0) if g else 0,
                    "income": int(row_val(inc, "points", 0) or 0) if inc else 0,
                    "debt": int(debt_row["points"] or 0) if debt_row else 0,
                    "commission_pct": PROVIDER_COMMISSION_PCT,
                })
            return
        if path == "/api/user/provider/nodes":
            with db() as conn:
                self.send_json({"ok": True, "nodes": provider_nodes_payload(conn, int(user["id"]))})
            return
        if path == "/api/user/hosts":
            with db() as conn:
                conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link='hosts'", (now(), int(user["id"])))
                self.send_json({"ok": True, "hosts": list_hosts(conn, int(user["id"]))})
            return
        if path == "/api/user/points":
            with db() as conn:
                logs = []
                for r in conn.execute("SELECT * FROM point_logs WHERE user_id=? ORDER BY id DESC LIMIT 100", (user["id"],)):
                    logs.append({"id": r["id"], "delta": r["delta"], "balance_after": r["balance_after"],
                                 "kind": r["kind"], "ref": r["ref"], "note": r["note"], "created_at": r["created_at"]})
                cfg = payment_config(conn)
            self.send_json({"ok": True, "balance": points_balance(user["id"]), "logs": logs, "payment": payment_public(cfg)})
            return
        if path == "/api/user/orders":
            with db() as conn:
                rows = conn.execute("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50", (user["id"],)).fetchall()
                cfg = payment_config(conn)
            active_modes = [r[0] for r in conn.execute(
                "SELECT DISTINCT billing_mode FROM user_plans WHERE user_id=? AND status='active' AND (expires_at=0 OR expires_at>?)",
                (user["id"], now()))]
            self.send_json({"ok": True, "orders": [order_public(r) for r in rows], "payment": payment_public(cfg), "active_modes": active_modes})
            return
        if path == "/api/user/traffic":
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            self.send_json(traffic_stats_for_user(user, (q.get("range") or ["30d"])[0]))
            return
        if path == "/api/user/traffic/protocols":
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            self.send_json(traffic_protocols_for_user(user, (q.get("month") or [""])[0]))
            return
        if path == "/api/user/activity":
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            try:
                limit = int((q.get("limit") or ["8"])[0])
            except Exception:
                limit = 8
            self.send_json(user_activity_feed(user, limit))
            return
        if path == "/api/admin/recharge-keys":
            if not self.require_admin():
                return
            with db() as conn:
                keys = []
                for r in conn.execute("SELECT * FROM recharge_keys WHERE deleted=0 ORDER BY id DESC LIMIT 300"):
                    keys.append({"id": r["id"], "seq_no": r["seq_no"], "key": r["key"], "points": r["points"], "note": r["note"],
                                 "active": bool(r["active"]), "expires_at": r["expires_at"],
                                 "used_by": r["used_by"], "used_at": r["used_at"], "created_at": r["created_at"]})
                stats = {
                    "total": conn.execute("SELECT COUNT(*) FROM recharge_keys WHERE deleted=0").fetchone()[0],
                    "unused": conn.execute("SELECT COUNT(*) FROM recharge_keys WHERE deleted=0 AND used_by IS NULL AND active=1").fetchone()[0],
                    "points_total": conn.execute("SELECT COALESCE(SUM(delta),0) FROM point_logs WHERE kind='key_recharge'").fetchone()[0],
                }
            self.send_json({"ok": True, "keys": keys, "stats": stats})
            return
        if path == "/api/admin/hosts":
            if not self.require_admin():
                return
            with db() as conn:
                conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0 AND link='hosts'", (now(), int(user["id"])))
                self.send_json({"ok": True, "hosts": list_hosts(conn)})
            return
        if path == "/api/admin/plans":
            if not self.require_admin():
                return
            with db() as conn:
                self.send_json({"ok": True, "plans": list_plans(conn, active_only=False), "payment": payment_public(payment_config(conn))})
            return
        if path == "/api/admin/orders":
            if not self.require_admin():
                return
            with db() as conn:
                rows = conn.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 200").fetchall()
                stats = {
                    "total": conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0],
                    "paid": conn.execute("SELECT COUNT(*) FROM orders WHERE status='paid'").fetchone()[0],
                    "pending": conn.execute("SELECT COUNT(*) FROM orders WHERE status='pending'").fetchone()[0],
                    "revenue_cents": conn.execute("SELECT COALESCE(SUM(amount_cents),0) FROM orders WHERE status='paid'").fetchone()[0],
                }
            self.send_json({"ok": True, "orders": [order_public(r) for r in rows], "stats": stats})
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
                    WHERE u.role != 'admin'
                    GROUP BY u.id ORDER BY u.id
                    """
                ):
                    item = public_user(r)
                    item["bandwidth_limit_kbps"] = int(row_val(r, "bandwidth_limit_kbps", 0) or 0)
                    item["port_count"] = r["port_count"]
                    item["tunnel_count"] = r["tunnel_count"]
                    item["node_name"] = r["node_name"]
                    item["node_region"] = r["node_region"]
                    users.append(item)
                nodes = list_public_nodes(conn, active_only=False)
                invite_keys = []
                for k in conn.execute("SELECT * FROM invite_keys WHERE deleted=0 ORDER BY id DESC LIMIT 200"):
                    invite_keys.append({
                        "id": k["id"],
                        "seq_no": row_val(k, "seq_no", 0),
                        "key": k["key"],
                        "kind": row_val(k, "kind", "register") or "register",
                        "note": k["note"],
                        "max_uses": k["max_uses"],
                        "used_count": k["used_count"],
                        "remaining": max(0, k["max_uses"] - k["used_count"]),
                        "max_ports": k["max_ports"],
                        "traffic_limit_bytes": int(row_val(k, "traffic_limit_bytes", 0) or 0),
                        "bandwidth_limit_kbps": int(row_val(k, "bandwidth_limit_kbps", 0) or 0),
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
                    "invite_key_count": conn.execute("SELECT COUNT(*) c FROM invite_keys WHERE deleted=0").fetchone()["c"],
                    "ban_count": conn.execute("SELECT COUNT(*) c FROM user_bans").fetchone()["c"],
                    "plan_count": conn.execute("SELECT COUNT(*) c FROM plans WHERE active=1").fetchone()["c"],
                    "order_count": conn.execute("SELECT COUNT(*) c FROM orders WHERE status='paid'").fetchone()["c"],
                    "revenue_cents": conn.execute("SELECT COALESCE(SUM(amount_cents),0) FROM orders WHERE status='paid'").fetchone()[0],
                }
                sw_license = current_software_license(conn)
                software_keys = []
                if SOFTWARE_LICENSE_AUTHORITY:
                    for k in conn.execute("SELECT * FROM software_license_keys WHERE deleted=0 ORDER BY id DESC LIMIT 200"):
                        software_keys.append({
                            "id": k["id"], "seq_no": k["seq_no"], "license_key": k["license_key"], "note": k["note"], "plan": k["plan"], "machine_id": k["machine_id"],
                            "active": bool(k["active"]), "expires_at": k["expires_at"], "expires_text": fmt_time(k["expires_at"]),
                            "expired": bool(k["expires_at"] and k["expires_at"] <= now()), "activated_at": k["activated_at"], "last_check_at": k["last_check_at"], "created_at": k["created_at"],
                        })
            self.send_json({"ok": True, "stats": stats, "users": users, "nodes": nodes, "invite_keys": invite_keys, "logs": logs, "allowed_proxy_types": PROXY_TYPE_ORDER, "software_license": sw_license, "software_license_authority": SOFTWARE_LICENSE_AUTHORITY, "software_license_keys": software_keys, "setup_key": effective_setup_key(), "has_setup_key": bool(effective_setup_key()), "setup_key_source": setup_key_source(), "smtp": smtp_public(smtp_config(conn)), "payment": payment_public(payment_config(conn)), "plans": list_plans(conn, active_only=False), "orders": [order_public(r) for r in conn.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 100")], "recharge_keys": [{"id": r["id"], "seq_no": r["seq_no"], "key": r["key"], "points": r["points"], "note": r["note"], "active": bool(r["active"]), "expires_at": r["expires_at"], "used_by": r["used_by"], "used_at": r["used_at"], "created_at": r["created_at"]} for r in conn.execute("SELECT * FROM recharge_keys WHERE deleted=0 ORDER BY id DESC LIMIT 200")]})
            return
        if path == "/api/admin/frps-proxies":
            if not self.require_admin():
                return
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            page = int_or_none((q.get("page") or ["1"])[0]) or 1
            page_size = int_or_none((q.get("page_size") or ["20"])[0]) or 20
            username = str((q.get("username") or [""])[0]).strip()
            self.send_json({"ok": True, "dashboard": frps_admin_dashboard(page, page_size, username), "username": username})
            return
        if path == "/api/admin/dashboard":
            if not self.require_admin():
                return
            with db() as conn:
                nodes = list_public_nodes(conn, active_only=False)
                node_count = len(nodes)
                active_node_count = sum(1 for n in nodes if n.get("active"))
                repair_port_assignments(conn)
                port_row = conn.execute(
                    """SELECT COUNT(*) AS total,
                              COUNT(CASE WHEN p.user_id IS NOT NULL
                                           OR EXISTS (SELECT 1 FROM tunnels t
                                                      WHERE t.node_id=p.node_id AND t.remote_port=p.port
                                                        AND t.proxy_type IN ('tcp','udp'))
                                         THEN 1 END) AS used
                       FROM ports p"""
                ).fetchone()
                port_stats = {
                    "total": int(port_row["total"]),
                    "used": int(port_row["used"]),
                    "free": int(port_row["total"]) - int(port_row["used"]),
                }
                user_row = conn.execute(
                    "SELECT COUNT(*) AS total, SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active FROM users WHERE role!='admin'"
                ).fetchone()
                user_stats = {
                    "total": int(user_row["total"]),
                    "active": int(user_row["active"] or 0),
                }
                tunnel_count = conn.execute("SELECT COUNT(*) c FROM tunnels").fetchone()["c"]
                invite_key_count = conn.execute("SELECT COUNT(*) c FROM invite_keys WHERE deleted=0").fetchone()["c"]
                ban_count = conn.execute("SELECT COUNT(*) c FROM user_bans").fetchone()["c"]
                traffic_row = conn.execute(
                    "SELECT COALESCE(SUM(mx), 0) AS total FROM (SELECT MAX(bytes) AS mx FROM traffic_samples WHERE day=? GROUP BY user_id, proxy_type)",
                    (local_day_str(),),
                ).fetchone()
                traffic_today = int(traffic_row["total"] or 0)
                r2_public = public_r2_config(conn)
                frpc_users = []
                for u in conn.execute("""
                    SELECT u.id, u.username, u.token, u.active, u.expires_at, u.node_id, n.name AS node_name, n.region AS node_region,
                           COUNT(DISTINCT p.id) AS port_count, COUNT(DISTINCT t.id) AS tunnel_count
                    FROM users u
                    LEFT JOIN nodes n ON n.id=u.node_id
                    LEFT JOIN ports p ON p.user_id=u.id AND p.node_id=u.node_id
                    LEFT JOIN tunnels t ON t.user_id=u.id
                    WHERE u.role!='admin'
                    GROUP BY u.id ORDER BY u.id
                """):
                    assigned_ports = [int(r["port"]) for r in conn.execute("SELECT port FROM ports WHERE node_id=? AND user_id=? ORDER BY port", (u["node_id"], u["id"]))]
                    used_remote_ports = [int(r["remote_port"]) for r in conn.execute("SELECT remote_port FROM tunnels WHERE node_id=? AND user_id=? AND proxy_type IN ('tcp','udp') AND remote_port>0 ORDER BY remote_port", (u["node_id"], u["id"]))]
                    used_set = set(used_remote_ports)
                    frpc_users.append({
                        "id": u["id"], "username": u["username"], "token": u["token"], "active": bool(u["active"]), "expired": is_expired(u),
                        "node_id": u["node_id"], "node_name": u["node_name"], "node_region": u["node_region"],
                        "port_count": u["port_count"], "tunnel_count": u["tunnel_count"],
                        "assigned_ports": assigned_ports,
                        "used_remote_ports": used_remote_ports,
                        "available_ports": [p for p in assigned_ports if p not in used_set],
                    })
            node_list = attach_node_auth_port_status([
                {
                    "id": n["id"],
                    "region": n.get("region", ""),
                    "name": n["name"],
                    "active": n["active"],
                    "server_addr": n["server_addr"],
                    "server_port": n["server_port"],
                    "port_start": n.get("port_start"),
                    "port_end": n.get("port_end"),
                    "bandwidth_mbps": n.get("bandwidth_mbps", 0),
                    "dashboard_configured": bool(n.get("dashboard_configured")),
                    "note": n.get("note", ""),
                    "created_at": n.get("created_at", 0),
                    "port_count": n.get("port_count", 0),
                    "free_count": n.get("free_count", 0),
                }
                for n in nodes
            ])
            ledger_info = ledger_analysis(conn, 7)
            ledger_daily = ledger_info["points"]
            ledger_categories = ledger_info["categories"]
            ledger_totals = ledger_info["totals"]
            self.send_json({
                "ok": True,
                "version": APP_VERSION,
                "panel_version": APP_VERSION,
                "ledger_daily": ledger_daily,
                "ledger_categories": ledger_categories,
                "ledger_totals": ledger_totals,
                "uptime_seconds": int(time.time() - SERVER_START_TS),
                "latest_version": panel_latest_version(),
                "update_link": PANEL_UPDATE_LINK,
                "refresh_seconds": NODE_DASHBOARD_REFRESH_SECONDS,
                "node_count": node_count,
                "active_node_count": active_node_count,
                "port_stats": port_stats,
                "user_stats": user_stats,
                "tunnel_count": int(tunnel_count),
                "invite_key_count": int(invite_key_count),
                "ban_count": int(ban_count),
                "traffic_today": traffic_today,
                "host": host_stats_with_history(),
                "nodes": node_list,
                "setup_key": effective_setup_key(),
                "has_setup_key": bool(effective_setup_key()),
                "setup_key_source": setup_key_source(),
                "smtp": smtp_public(smtp_config(conn)),
                "payment": payment_public(payment_config(conn)),
                "plans": list_plans(conn, active_only=False),
                "notify": notify_public(notify_config(conn)),
                "bncr": bncr_public(bncr_config(conn)),
                "r2": r2_public,
                "r2_configured": r2_public["configured"],
                "frpc_users": frpc_users,
                "allowed_proxy_types": PROXY_TYPE_ORDER,
            })
            return
        self.send_json({"ok": False, "error": "not found"}, 404)

    def api_post(self, path: str) -> None:
        try:
            data = self.read_json()
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
            return

        csrf = self.headers.get("X-CSRF-Token")
        if not validate_csrf(csrf, self.headers.get("Cookie")):
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
                self.send_json({"ok": False, "error": "software_license_required", "license": sw_license, "message": "请先激活鉴权密钥"}, 402)
                return

        if path == "/api/login":
            ok_rate, retry_after = rate_limit_check(f"login:{client_ip(self)}", LOGIN_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"登录尝试过多，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            try_login_user = str(data.get("username", "")).strip().lower()
            if try_login_user:
                ok_user, retry_user = rate_limit_check(f"login-user:{try_login_user}", LOGIN_RATE_LIMIT)
                if not ok_user:
                    self.send_json({"ok": False, "error": f"该账号登录尝试过多，请 {retry_user} 秒后再试", "retry_after": retry_user}, 429)
                    return
            with db() as conn:
                user = conn.execute("SELECT * FROM users WHERE username=?", (str(data.get("username", "")),)).fetchone()
            if not user or not verify_password(str(data.get("password", "")), user["password_hash"]):
                self.send_json({"ok": False, "error": "用户名或密码错误"}, 401)
                return
            if not user["active"]:
                self.send_json({"ok": False, "error": "账号已停用"}, 403)
                return
            banned_until = int(row_val(user, "banned_until", 0) or 0)
            if banned_until > now():
                self.send_json({"ok": False, "error": f"账号因异常占用带宽被封禁，解除时间：{fmt_time(banned_until)}"}, 403)
                return
            if is_expired(user):
                self.send_json({"ok": False, "error": "账号已到期"}, 403)
                return
            token = make_session(user["id"])
            audit("login", user, user["node_id"], None, "", "面板登录")
            self.send_json({"ok": True, "user": public_user(user)}, headers={"Set-Cookie": f"fml_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL}{self.secure_cookie_suffix()}"})
            return

        if path == "/api/register/request-code":
            if not OPEN_REGISTRATION:
                self.send_json({"ok": False, "error": "当前未开放注册"}, 400)
                return
            ok_rate, retry_after = rate_limit_check(f"regcode:{client_ip(self)}", REGISTER_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"操作过于频繁，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            username = str(data.get("username", "")).strip()
            email = str(data.get("email", "")).strip()
            if not username or len(username) > 32 or not username.replace("_", "").replace("-", "").isalnum():
                self.send_json({"ok": False, "error": "用户名只能包含字母、数字、下划线、短横线，长度 1-32"}, 400)
                return
            if not email or "@" not in email or len(email) < 5 or len(email) > 120:
                self.send_json({"ok": False, "error": "请填写正确的邮箱地址"}, 400)
                return
            with db() as conn:
                if not smtp_configured(conn):
                    self.send_json({"ok": False, "error": "邮件服务未配置，请联系管理员"}, 400)
                    return
                if conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
                    self.send_json({"ok": False, "error": "用户名已存在"}, 400)
                    return
                if conn.execute("SELECT id FROM users WHERE lower(email)=lower(?) AND email!=''", (email,)).fetchone():
                    self.send_json({"ok": False, "error": "该邮箱已被注册"}, 400)
                    return
                last = conn.execute("SELECT created_at FROM email_codes WHERE username=? ORDER BY id DESC LIMIT 1", (username,)).fetchone()
            if last and now() - int(last["created_at"]) < 60:
                self.send_json({"ok": False, "error": f"验证码已发送，请 {60 - (now() - int(last['created_at']))} 秒后再试"}, 429)
                return
            code = create_email_code(username, email)
            ok, msg = send_email(email, "【Frp 管理台】注册验证码",
                                 f"您的注册验证码是：{code}（10 分钟内有效）。如果不是您本人操作，请忽略本邮件。")
            if not ok:
                self.send_json({"ok": False, "error": msg}, 500)
                return
            masked = mask_email(email)
            audit("register_code_sent", None, None, None, "", f"向 {masked} 发送注册验证码")
            self.send_json({"ok": True, "message": f"验证码已发送至 {masked}", "email": masked})
            return

        if path == "/api/register":
            ok_rate, retry_after = rate_limit_check(f"register:{client_ip(self)}", REGISTER_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"注册尝试过多，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            ok, msg = register_with_invite(str(data.get("username", "")), str(data.get("password", "")), str(data.get("invite_key", "")), int(data.get("node_id", 0)), str(data.get("email", "")), str(data.get("code", "")))
            self.send_json({"ok": ok, "message": msg, "error": None if ok else msg}, 200 if ok else 400)
            return

        if path == "/api/user/hosts":
            user = self.require_user()
            if not user:
                return
            ok_rate, retry_after = rate_limit_check(f"host:{user['id']}", 5)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"提交过于频繁，请 {retry_after} 秒后再试"}, 429)
                return
            ok, msg, extra = create_host_application(user, data)
            if ok:
                audit("host_apply", user, None, None, "", str(data.get("name", "")))
            payload = {"ok": ok, "message": msg if ok else None, "error": None if ok else msg}
            if ok:
                payload.update(extra)
            self.send_json(payload, 200 if ok else 400)
            return

        if path == "/api/user/provider/plans/save":
            user = self.require_user()
            if not user:
                return
            ok, msg = provider_plan_save(user, data)
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)
            return

        if path == "/api/user/provider/plans/delete":
            user = self.require_user()
            if not user:
                return
            try:
                pid = int(data.get("id", 0))
            except (TypeError, ValueError):
                pid = 0
            with db() as conn:
                row = conn.execute(
                    "SELECT p.id FROM plans p JOIN nodes n ON n.id=p.node_id WHERE p.id=? AND n.owner_id=? AND p.deleted=0",
                    (pid, int(user["id"]))).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "套餐不存在或无权操作"}, 404)
                    return
                conn.execute("UPDATE plans SET deleted=1, active=0 WHERE id=?", (pid,))
            self.send_json({"ok": True, "message": "套餐已下架"})
            return

        if path == "/api/admin/announcements/save":
            if not self.require_admin():
                return
            title = str(data.get("title", "")).strip()[:120]
            content = sanitize_ticket_html(str(data.get("content", "")))[:4000]
            kind = "notice" if str(data.get("kind", "")).strip() == "notice" else "announcement"
            if not title or not content:
                self.send_json({"ok": False, "error": "请填写标题和内容"}, 400)
                return
            with db() as conn:
                conn.execute("INSERT INTO announcements(title, content, kind, active, created_at) VALUES(?,?,?,1,?)",
                             (title, content, kind, now()))
                if kind == "notice":
                    plain = re.sub(r"<[^>]+>", "", content).strip()
                    for r in conn.execute("SELECT id FROM users WHERE active=1 AND role!='admin'").fetchall():
                        notify_user(conn, int(r["id"]), "system_notice", title, plain[:500], "")
            msg = "通知已发送" if kind == "notice" else "公告已发布"
            self.send_json({"ok": True, "message": msg, "kind": kind})
            return

        if path == "/api/admin/announcements/delete":
            if not self.require_admin():
                return
            try:
                aid = int(data.get("id", 0))
            except (TypeError, ValueError):
                aid = 0
            with db() as conn:
                conn.execute("UPDATE announcements SET active=0 WHERE id=?", (aid,))
            self.send_json({"ok": True, "message": "公告已下架"})
            return

        if path == "/api/notifications/read":
            user = self.require_user()
            if not user:
                return
            if data.get("announcements"):
                with db() as conn:
                    conn.execute("UPDATE users SET announcement_seen_at=? WHERE id=?", (now(), int(user["id"])))
            elif data.get("all"):
                with db() as conn:
                    conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at=0", (now(), int(user["id"])))
                    conn.execute("UPDATE users SET announcement_seen_at=? WHERE id=?", (now(), int(user["id"])))
            else:
                try:
                    nid = int(data.get("id", 0))
                except (TypeError, ValueError):
                    nid = 0
                with db() as conn:
                    conn.execute("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?", (now(), nid, int(user["id"])))
            self.send_json({"ok": True})
            return

        if path == "/api/user/upload":
            user = self.require_user()
            if not user:
                return
            kind = str(data.get("kind", "ticket")).strip().lower()
            if kind not in ("ticket", "qr"):
                self.send_json({"ok": False, "error": "上传类型不支持"}, 400)
                return
            mime = str(data.get("mime", "")).strip().lower()
            if mime not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
                self.send_json({"ok": False, "error": "只支持 PNG / JPG / WEBP / GIF 图片"}, 400)
                return
            raw = str(data.get("data", "") or "")
            if "," in raw[:100] and raw.strip().startswith("data:"):
                raw = raw.split(",", 1)[1]
            try:
                blob = base64.b64decode(raw, validate=True)
            except Exception:
                self.send_json({"ok": False, "error": "图片数据无效"}, 400)
                return
            if len(blob) > 3 * 1024 * 1024:
                self.send_json({"ok": False, "error": "图片不能超过 3MB"}, 400)
                return
            tok = secrets.token_urlsafe(18)
            with db() as conn:
                conn.execute(
                    "INSERT INTO uploads(token, user_id, kind, mime, size, data, created_at) VALUES(?,?,?,?,?,?,?)",
                    (tok, int(user["id"]), kind, mime, len(blob), sqlite3.Binary(blob), now()))
            self.send_json({"ok": True, "token": tok, "url": f"/api/upload/{tok}"})
            return

        if path == "/api/user/notify-config":
            user = self.require_user()
            if not user:
                return
            enabled = "1" if str(data.get("enabled", "")) in ("1", "true", "True", "on", "yes") else "0"
            ctype = str(data.get("type", "")).strip()
            if ctype and ctype not in NOTIFY_CHANNEL_MAP:
                self.send_json({"ok": False, "error": "不支持的通知方式"}, 400)
                return
            raw_params = data.get("params")
            if not isinstance(raw_params, dict):
                raw_params = {}
            clean: dict[str, str] = {}
            if ctype:
                for f in NOTIFY_CHANNEL_MAP[ctype]["fields"]:
                    val = raw_params.get(f["key"], "")
                    if val is None:
                        val = ""
                    clean[f["key"]] = str(val).strip()[:2000]
            events_raw = data.get("events")
            if isinstance(events_raw, list):
                events = [str(x) for x in events_raw if str(x) in USER_NOTIFY_EVENTS]
            else:
                events = [x for x in str(events_raw or "").split(",") if x in USER_NOTIFY_EVENTS]
            with db() as conn:
                conn.execute(
                    """INSERT INTO user_notify_config(user_id, enabled, type, params, events, updated_at)
                       VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
                       enabled=excluded.enabled, type=excluded.type, params=excluded.params,
                       events=excluded.events, updated_at=excluded.updated_at""",
                    (int(user["id"]), int(enabled), ctype, json.dumps(clean, ensure_ascii=False), ",".join(events), now()))
            self.send_json({"ok": True, "message": "通知设置已保存"})
            return
        if path == "/api/user/notify-test":
            user = self.require_user()
            if not user:
                return
            with db() as conn:
                cfg = user_notify_config_get(conn, int(user["id"]))
            if not cfg["enabled"] or not cfg["type"] or cfg["type"] not in _NOTIFY_SENDERS:
                self.send_json({"ok": False, "error": "请先启用并选择通知方式"}, 400)
                return
            try:
                ok, msg = _NOTIFY_SENDERS[cfg["type"]](cfg["params"], "【Frp 管理台】测试通知",
                                                       f"这是一条测试通知，说明你的通知渠道已配置成功。\n时间：{_beijing_now_text()}")
            except Exception as e:
                ok, msg = False, str(e)
            self.send_json({"ok": ok, "message": "测试通知已发送" if ok else None, "error": None if ok else (msg or "发送失败")},
                           200 if ok else 400)
            return
        if path == "/api/user/payout-account/save":
            user = self.require_user()
            if not user:
                return
            method = str(data.get("method", "alipay")).strip().lower()
            account = str(data.get("account", "")).strip()[:120]
            holder = str(data.get("holder", "")).strip()[:60]
            if method not in ("alipay", "wechat"):
                self.send_json({"ok": False, "error": "收款方式不支持"}, 400)
                return
            if not account or not holder:
                self.send_json({"ok": False, "error": "请填写收款账号和姓名"}, 400)
                return
            qr_token = str(data.get("qr_token", "") or "").strip()
            with db() as conn:
                if qr_token:
                    own = conn.execute("SELECT 1 FROM uploads WHERE token=? AND user_id=? AND kind='qr'", (qr_token, int(user["id"]))).fetchone()
                    if not own:
                        self.send_json({"ok": False, "error": "收款码无效，请重新上传"}, 400)
                        return
                else:
                    existing = conn.execute("SELECT qr_token FROM payout_accounts WHERE user_id=?", (int(user["id"]),)).fetchone()
                    if not (existing and str(existing["qr_token"] or "").strip()):
                        self.send_json({"ok": False, "error": "请上传收款码"}, 400)
                        return
                conn.execute(
                    "INSERT INTO payout_accounts(user_id, method, account, holder, qr_token, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET method=excluded.method, account=excluded.account, holder=excluded.holder, qr_token=CASE WHEN excluded.qr_token<>'' THEN excluded.qr_token ELSE payout_accounts.qr_token END, updated_at=excluded.updated_at",
                    (int(user["id"]), method, account, holder, qr_token, now()))
            self.send_json({"ok": True, "message": "收款信息已保存"})
            return

        if path == "/api/user/withdraw":
            user = self.require_user()
            if not user:
                return
            ok_rate, retry = rate_limit_check(f"withdraw:{user['id']}", 5)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"操作过于频繁，请 {retry} 秒后再试"}, 429)
                return
            mode = str(data.get("mode", "balance")).strip().lower()
            try:
                points = q2(data.get("points", 0) or 0)
            except (TypeError, ValueError):
                points = 0.0
            try:
                with db() as conn:
                    provider_income_consume(conn, int(user["id"]), points)
                    if mode == "balance":
                        points_change(conn, int(user["id"]), points, "provider_withdraw", "balance", "收益转入余额")
                        ledger_add(conn, "points", "none", "income_to_balance", points, int(user["id"]), user["username"],
                                   0, "", "balance", "收益转入余额（内部划转）")
                        notify(conn, int(user["id"]), "income_to_balance", "dashboard-points", amount=f"{q2(points):.2f}")
                        self.send_json({"ok": True, "message": f"{q2(points):.2f} 积分已转入余额"})
                        return
                    if mode != "external":
                        raise ValueError("未知提现方式")
                    acc = conn.execute("SELECT * FROM payout_accounts WHERE user_id=?", (int(user["id"]),)).fetchone()
                    if not acc or not acc["account"]:
                        raise ValueError("请先在个人中心配置收款信息")
                    pno = new_payout_no()
                    conn.execute(
                        "INSERT INTO payouts(payout_no, user_id, username, points, method, account, holder, qr_token, status, note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                        (pno, int(user["id"]), user["username"], points, acc["method"], acc["account"], acc["holder"], row_val(acc, "qr_token", "") or "", "pending", "", now(), now()))
                    ledger_add(conn, "points", "out", "withdraw_points", points, int(user["id"]), user["username"], 0, pno, "external", "提现申请")
                    conn.execute(
                        "INSERT INTO tickets(ticket_no, user_id, username, kind, status, node_id, owner_id, title, content, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (new_ticket_no(), int(user["id"]), user["username"], "withdraw", "open", 0, 0,
                         f"提现 {points} 积分", f"提现单号 {pno}，方式 {acc['method']}，账号 {acc['account']}，姓名 {acc['holder']}", now(), now()))
                    notify_admins_tpl(conn, "payout_new", "payouts", amount=f"{q2(points):.2f}", username=user["username"], payout_no=pno, method=acc["method"])
                self.send_json({"ok": True, "message": "提现申请已提交，等待管理员处理"})
            except ValueError as e:
                self.send_json({"ok": False, "error": str(e)}, 400)
            return

        if path == "/api/user/tickets/create":
            user = self.require_user()
            if not user:
                return
            ok_rate, retry = rate_limit_check(f"ticket:{user['id']}", 10)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"提交过于频繁，请 {retry} 秒后再试"}, 429)
                return
            title = str(data.get("title", "")).strip()[:80]
            content = sanitize_ticket_html(str(data.get("content", "")))
            try:
                node_id = int(data.get("node_id", 0) or 0)
            except (TypeError, ValueError):
                node_id = 0
            if not title or not content:
                self.send_json({"ok": False, "error": "请填写标题和问题描述"}, 400)
                return
            with db() as conn:
                owner_id = 0
                node_name = ""
                if node_id:
                    node = conn.execute("SELECT id, name, owner_id FROM nodes WHERE id=?", (node_id,)).fetchone()
                    if not node:
                        self.send_json({"ok": False, "error": "节点不存在"}, 400)
                        return
                    owns = conn.execute("SELECT 1 FROM user_plans WHERE user_id=? AND node_id=? LIMIT 1", (int(user["id"]), node_id)).fetchone()
                    if not owns:
                        self.send_json({"ok": False, "error": "只能对已购买的实例提交工单"}, 400)
                        return
                    owner_id = int(node["owner_id"] or 0)
                    node_name = str(node["name"] or "")
                tno = new_ticket_no()
                att = clean_attachment_tokens(conn, int(user["id"]), data.get("attachments"))
                conn.execute(
                    "INSERT INTO tickets(ticket_no, user_id, username, kind, status, node_id, owner_id, title, content, attachments, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (tno, int(user["id"]), user["username"], "issue", "open", node_id, owner_id, title, content, att, now(), now()))
                if owner_id:
                    notify(conn, owner_id, "ticket_new_owner", f"ticket:{int(conn.execute('SELECT last_insert_rowid()').fetchone()[0])}",
                           title=title, username=user["username"], ticket_no=tno, node=node_name or "不关联")
                    owner_row = conn.execute("SELECT wecom_userid FROM users WHERE id=?", (owner_id,)).fetchone()
                    bncr_notify_text(
                        "新故障工单",
                        [f"工单 {tno}：{title}",
                         f"用户 {user['username']} 提交，关联实例：{node_name or '不关联'}",
                         "请尽快登录面板处理，超时未处理会影响考核。"],
                        [str((owner_row or {"wecom_userid": ""})["wecom_userid"] or "")])
                else:
                    notify_admins_tpl(conn, "ticket_new_admin", "tickets", title=title, username=user["username"], ticket_no=tno, node=node_name or "不关联")
                    bncr_notify_text(
                        "新平台工单",
                        [f"工单 {tno}：{title}",
                         f"用户 {user['username']} 提交，关联实例：{node_name or '不关联'}",
                         "请管理员登录面板处理。"])
            self.send_json({"ok": True, "message": "工单已提交"})
            return

        if path == "/api/user/tickets/reply":
            user = self.require_user()
            if not user:
                return
            try:
                tid = int(data.get("id", 0))
            except (TypeError, ValueError):
                tid = 0
            content = sanitize_ticket_html(str(data.get("content", "")))
            if not content:
                self.send_json({"ok": False, "error": "回复内容不能为空"}, 400)
                return
            with db() as conn:
                row = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "工单不存在"}, 404)
                    return
                role = "user"
                if int(row["owner_id"] or 0) == int(user["id"]) and int(row["user_id"]) != int(user["id"]):
                    role = "owner"
                elif user["role"] == "admin":
                    role = "admin"
                elif int(row["user_id"]) != int(user["id"]):
                    self.send_json({"ok": False, "error": "无权回复该工单"}, 403)
                    return
                att = clean_attachment_tokens(conn, int(user["id"]), data.get("attachments"))
                conn.execute(
                    "INSERT INTO ticket_messages(ticket_id, user_id, username, role, content, attachments, created_at) VALUES(?,?,?,?,?,?,?)",
                    (tid, int(user["id"]), user["username"], role, content, att, now()))
                conn.execute("UPDATE tickets SET status=CASE WHEN status='open' THEN 'processing' ELSE status END, updated_at=? WHERE id=?", (now(), tid))
                if role == "user":
                    if int(row["owner_id"] or 0):
                        notify(conn, int(row["owner_id"]), "ticket_reply_owner", f"ticket:{tid}",
                               title=row["title"], ticket_no=row["ticket_no"], username=user["username"])
                    else:
                        notify_admins_tpl(conn, "ticket_reply_owner", f"ticket:{tid}",
                                          title=row["title"], ticket_no=row["ticket_no"], username=user["username"])
                else:
                    notify(conn, int(row["user_id"]), "ticket_reply_user", f"ticket:{tid}",
                           title=row["title"], ticket_no=row["ticket_no"], username=user["username"])
            self.send_json({"ok": True, "message": "已回复"})
            return

        if path == "/api/user/tickets/close":
            user = self.require_user()
            if not user:
                return
            try:
                tid = int(data.get("id", 0))
            except (TypeError, ValueError):
                tid = 0
            with db() as conn:
                row = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "工单不存在"}, 404)
                    return
                if int(row["user_id"]) != int(user["id"]) and int(row["owner_id"] or 0) != int(user["id"]) and user["role"] != "admin":
                    self.send_json({"ok": False, "error": "无权关闭该工单"}, 403)
                    return
                resolution = sanitize_ticket_html(str(data.get("resolution", "")))[:1000]
                conn.execute("UPDATE tickets SET status='closed', resolution=?, updated_at=? WHERE id=?", (resolution, now(), tid))
                refunded = False
                if (row["kind"] or "") == "withdraw":
                    m = re.search(r"PO[0-9A-Za-z]{6,}", str(row["content"] or ""))
                    if m:
                        pay = conn.execute("SELECT * FROM payouts WHERE payout_no=?", (m.group(0),)).fetchone()
                        by_user = user["role"] != "admin" and pay and int(pay["user_id"]) == int(user["id"])
                        refunded = reject_payout(conn, pay,
                                                 "用户撤销提现工单，已退回收益" if by_user else "管理员结束工单，提现已取消",
                                                 "cancelled" if by_user else "rejected")
            msg = "工单已关闭"
            if refunded:
                msg = "工单已关闭，提现已取消，积分已退回收益池"
            self.send_json({"ok": True, "message": msg})
            return

        if path == "/api/admin/payouts/review":
            if not self.require_admin():
                return
            try:
                pid = int(data.get("id", 0))
            except (TypeError, ValueError):
                pid = 0
            action = str(data.get("action", "")).strip().lower()
            if action not in ("paid", "reject"):
                self.send_json({"ok": False, "error": "未知操作"}, 400)
                return
            with db() as conn:
                row = conn.execute("SELECT * FROM payouts WHERE id=?", (pid,)).fetchone()
                if not row or row["status"] != "pending":
                    self.send_json({"ok": False, "error": "提现单不存在或已处理"}, 404)
                    return
                rate = 1
                if action == "paid":
                    conn.execute("UPDATE payouts SET status='paid', updated_at=? WHERE id=?", (now(), pid))
                    ledger_add(conn, "cash", "out", "withdraw_cash", q2(int(row["points"] or 0) / rate),
                               int(row["user_id"]), row["username"], 0, str(row["payout_no"]), "", f"提现打款 {row['method']}")
                else:
                    conn.execute("UPDATE payouts SET status='rejected', updated_at=? WHERE id=?", (now(), pid))
                    ledger_add(conn, "points", "reverse", "payout_reject", q2(row["points"]), int(row["user_id"]),
                               row["username"], 0, str(row["payout_no"]), "", "提现冲正")
                    conn.execute(
                        "INSERT INTO provider_income(owner_id, points, updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET points=points+excluded.points, updated_at=excluded.updated_at",
                        (int(row["user_id"]), int(row["points"] or 0), now()))
                # 处理完提现单，同步关闭对应工单
                tid = payout_ticket_id(conn, str(row["payout_no"] or ""))
                if tid:
                    conn.execute("UPDATE tickets SET status='closed', resolution=?, updated_at=? WHERE id=? AND status<>'closed'",
                                 ("已打款，提现完成" if action == "paid" else "已拒绝，积分退回收益池", now(), tid))
            self.send_json({"ok": True, "message": "已打款，工单已关闭" if action == "paid" else "已拒绝，工单已关闭"})
            return

        if path == "/api/user/plans/cancel":
            user = self.require_user()
            if not user:
                return
            try:
                upid = int(data.get("id", 0))
            except (TypeError, ValueError):
                upid = 0
            ok, msg, info = cancel_user_plan(user, upid)
            if ok:
                audit("plan_cancel", user, None, None, "", msg)
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "refund": info}, 200 if ok else 400)
            return

        if path == "/api/user/plans/auto-renew":
            user = self.require_user()
            if not user:
                return
            try:
                upid = int(data.get("id", 0))
            except (TypeError, ValueError):
                upid = 0
            enabled = 1 if data.get("enabled") else 0
            with db() as conn:
                row = conn.execute("SELECT id FROM user_plans WHERE id=? AND user_id=?", (upid, user["id"])).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "实例不存在"}, 404)
                    return
                conn.execute("UPDATE user_plans SET auto_renew=? WHERE id=?", (enabled, upid))
            audit("plan_auto_renew", user, None, None, "", f"自动延期 {'开启' if enabled else '关闭'}")
            self.send_json({"ok": True, "auto_renew": enabled})
            return

        if path == "/api/user/points/redeem":
            user = self.require_user()
            if not user:
                return
            ok_rate, retry_after = rate_limit_check(f"redeem:{user['id']}", 10)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"操作过于频繁，请 {retry_after} 秒后再试"}, 429)
                return
            ok, msg, balance = redeem_recharge_key(user, str(data.get("key", "")))
            if ok:
                audit("points_redeem", user, None, None, "", msg)
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "balance": balance}, 200 if ok else 400)
            return

        if path == "/api/user/points/orders":
            user = self.require_user()
            if not user:
                return
            ok_rate, retry_after = rate_limit_check(f"pointorder:{user['id']}", 10)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"下单过于频繁，请 {retry_after} 秒后再试"}, 429)
                return
            try:
                points = int(data.get("points", 0))
            except (TypeError, ValueError):
                points = 0
            ok, msg, payload = create_points_order(user, points, str(data.get("provider", "")))
            if ok:
                audit("points_order_create", user, None, None, "", f"{payload['points']} 积分 订单 {payload['order_no']}")
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "order": payload}, 200 if ok else 400)
            return

        if path == "/api/user/orders":
            user = self.require_user()
            if not user:
                return
            ok_rate, retry_after = rate_limit_check(f"order:{user['id']}", 10)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"下单过于频繁，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            try:
                plan_id = int(data.get("plan_id", 0))
            except Exception:
                plan_id = 0
            try:
                node_id = int(data.get("node_id", 0) or 0)
            except (TypeError, ValueError):
                node_id = 0
            raw_tunnels = data.get("tunnels")
            tunnels = raw_tunnels if isinstance(raw_tunnels, list) else []
            ok, msg, payload = create_order(user, plan_id, str(data.get("provider", "")), node_id, tunnels)
            if ok:
                audit("order_create", user, None, None, "", f"套餐 {payload['plan_name']} 订单 {payload['order_no']}")
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "order": payload}, 200 if ok else 400)
            return

        if path == "/api/logout":
            clear_session(self.headers.get("Cookie"))
            self.send_json({"ok": True}, headers={"Set-Cookie": f"fml_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{self.secure_cookie_suffix()}"})
            return

        if path == "/api/password/reset":
            ok_rate, retry_after = rate_limit_check(f"pwreset:{client_ip(self)}", REGISTER_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"操作过于频繁，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            ok, msg = reset_password_with_key(str(data.get("username", "")), str(data.get("password", "")), str(data.get("reset_key", "")))
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)
            return

        if path == "/api/password/request-code":
            ok_rate, retry_after = rate_limit_check(f"pwcode:{client_ip(self)}", REGISTER_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"操作过于频繁，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            username = str(data.get("username", "")).strip()
            with db() as conn:
                urow = conn.execute("SELECT id, username, email FROM users WHERE username=? AND role!='admin'", (username,)).fetchone()
                last = conn.execute("SELECT created_at FROM email_codes WHERE username=? ORDER BY id DESC LIMIT 1", (username,)).fetchone() if username else None
                if not smtp_configured(conn):
                    self.send_json({"ok": False, "error": "邮件服务未配置，请联系管理员"}, 400)
                    return
            if not urow or not str(urow["email"] or "").strip():
                self.send_json({"ok": False, "error": "账号不存在或未绑定邮箱，请联系管理员"}, 400)
                return
            if last and now() - int(last["created_at"]) < 60:
                self.send_json({"ok": False, "error": f"验证码已发送，请 {60 - (now() - int(last['created_at']))} 秒后再试"}, 429)
                return
            code = create_email_code(username, str(urow["email"]).strip())
            ok, msg = send_email(str(urow["email"]).strip(), "【Frp 管理台】密码重置验证码",
                                 f"您的验证码是：{code}（10 分钟内有效）。如果不是您本人操作，请忽略本邮件。")
            if not ok:
                self.send_json({"ok": False, "error": msg}, 500)
                return
            masked = mask_email(str(urow["email"]).strip())
            audit("password_code_sent", None, None, None, "", f"向 {masked} 发送密码重置验证码")
            self.send_json({"ok": True, "message": f"验证码已发送至 {masked}", "email": masked})
            return

        if path == "/api/password/reset-by-code":
            ok_rate, retry_after = rate_limit_check(f"pwcode2:{client_ip(self)}", REGISTER_RATE_LIMIT)
            if not ok_rate:
                self.send_json({"ok": False, "error": f"操作过于频繁，请 {retry_after} 秒后再试", "retry_after": retry_after}, 429)
                return
            ok, msg = reset_password_by_code(str(data.get("username", "")), str(data.get("code", "")), str(data.get("password", "")))
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)
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

        if path == "/api/user/renew":
            if user["role"] == "admin":
                self.send_json({"ok": False, "error": "管理员账号无需续期"}, 403)
                return
            ok, msg = renew_user_with_key(user, str(data.get("key", "")))
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)
            return

        if path == "/api/user/email":
            if user["role"] == "admin":
                self.send_json({"ok": False, "error": "管理员账号无需设置邮箱"}, 403)
                return
            email = str(data.get("email", "")).strip()[:120]
            if email and "@" not in email:
                self.send_json({"ok": False, "error": "邮箱格式不正确"}, 400)
                return
            with db() as conn:
                conn.execute("UPDATE users SET email=? WHERE id=?", (email, user["id"]))
            audit("user_email_update", user, None, None, "", f"设置邮箱 {mask_email(email) if email else '（清除）'}")
            self.send_json({"ok": True, "message": "邮箱已更新"})
            return

        if path == "/api/user/node/switch":
            self.send_json({"ok": False, "error": "该功能已停用，请在对应实例中操作"}, 410)
            return
            if user["role"] == "admin":
                self.send_json({"ok": False, "error": "管理员账号不能通过用户面板切换节点"}, 403)
                return
            try:
                target_node_id = int(data.get("node_id", 0))
            except (TypeError, ValueError):
                self.send_json({"ok": False, "error": "节点编号无效"}, 400)
                return
            with db() as conn:
                target = conn.execute("SELECT id, name, active FROM nodes WHERE id=?", (target_node_id,)).fetchone()
                if not target or not target["active"]:
                    self.send_json({"ok": False, "error": "目标节点不存在或已停用"}, 400)
                    return
                expires_at = int(user["expires_at"] or 0)
                if expires_at and expires_at <= now():
                    self.send_json({"ok": False, "error": "套餐已到期，请先购买套餐后再切换节点"}, 403)
                    return
                if int(user["node_id"] or 0) == target_node_id:
                    self.send_json({"ok": True, "message": "当前已使用该节点"})
                    return
                existing_tunnels = conn.execute("SELECT COUNT(*) FROM tunnels WHERE user_id=?", (user["id"],)).fetchone()[0]
                if existing_tunnels:
                    self.send_json({"ok": False, "error": "该账号已有隧道。为避免破坏现有映射，暂不自动迁移；请先删除或迁移现有隧道后再切换节点。"}, 409)
                    return
                conn.execute("UPDATE users SET node_id=? WHERE id=?", (target_node_id, user["id"]))
            audit("user_node_switch", user, target_node_id, None, "", str(target["name"]))
            self.send_json({"ok": True, "message": f"已切换到节点 {target['name']}"})
            return
        if path == "/api/account/password":
            self.account_change_password(user, data)
            return
        if path == "/api/tunnels/create":
            self.tunnel_create(user, data)
        elif path == "/api/tunnels/update":
            self.tunnel_update(user, data)
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
                if t and user["role"] == "admin" and t["proxy_type"] in REMOTE_PORT_PROXY_TYPES and t["remote_port"]:
                    conn.execute("UPDATE ports SET user_id=NULL WHERE node_id=? AND port=? AND user_id=?", (t["node_id"], t["remote_port"], user["id"]))
            if t: audit("tunnel_delete", user, t["node_id"], t["remote_port"], t["proxy_type"], t["name"])
            self.send_json({"ok": True})
        elif path == "/api/admin/users/create":
            self.admin_create_user(data)
        elif path == "/api/admin/users/toggle":
            self.admin_toggle_user(user, data)
        elif path == "/api/admin/users/extend":
            self.admin_extend_user(data)
        elif path == "/api/admin/users/limits":
            self.admin_update_user_limits(data)
        elif path == "/api/admin/users/reset-password":
            self.admin_reset_password(data)
        elif path == "/api/admin/users/reset-token":
            self.admin_reset_token(user, data)
        elif path == "/api/admin/users/delete":
            self.admin_delete_user(user, data)
        elif path == "/api/admin/users/ban":
            self.admin_ban_user(user, data)
        elif path == "/api/admin/risk/lookup-port":
            self.admin_lookup_port(data)
        elif path == "/api/admin/r2/config":
            self.admin_r2_config_save(user, data)
        elif path == "/api/admin/setup-key":
            self.admin_setup_key(user, data)
        elif path == "/api/admin/recharge-keys/create":
            self.admin_recharge_keys_create(data)
        elif path == "/api/admin/recharge-keys/toggle":
            self.admin_recharge_key_toggle(data)
        elif path == "/api/admin/recharge-keys/delete":
            self.admin_recharge_key_delete(data)
        elif path == "/api/admin/users/points":
            self.admin_user_points(data)
        elif path == "/api/admin/hosts/review":
            admin = self.require_admin()
            if not admin:
                return
            try:
                host_id = int(data.get("id", 0))
            except (TypeError, ValueError):
                host_id = 0
            ok, msg = review_host_application(admin, host_id, str(data.get("action", "")), str(data.get("reason", "")))
            if ok:
                audit("host_review", admin, None, None, "", f"host={host_id} {msg}")
            self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)
        elif path == "/api/admin/plans/save":
            self.admin_plan_save(data)
        elif path == "/api/admin/plans/delete":
            self.admin_plan_delete(data)
        elif path == "/api/admin/plans/toggle":
            self.admin_plan_toggle(data)
        elif path == "/api/admin/orders/complete":
            self.admin_order_complete(data)
        elif path == "/api/admin/payment-config":
            self.admin_payment_config_save(data)
        elif path == "/api/admin/smtp-config":
            self.admin_smtp_config_save(user, data)
        elif path == "/api/admin/smtp-test":
            self.admin_smtp_test(user, data)
        elif path == "/api/admin/bncr-config":
            self.admin_bncr_config_save(user, data)
        elif path == "/api/admin/bncr-test":
            self.admin_bncr_test(user, data)
        elif path == "/api/admin/notify-config":
            self.admin_notify_config_save(user, data)
        elif path == "/api/admin/notify-test":
            self.admin_notify_test(user, data)
        elif path == "/api/admin/users/email":
            self.admin_set_user_email(data)
        elif path == "/api/admin/backup/r2":
            self.admin_backup_r2(user)
        elif path == "/api/admin/backup/restore":
            self.admin_restore_backup(user, data)
        elif path == "/api/admin/tunnels/create-for-user":
            self.admin_tunnel_create_for_user(user, data)
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
        if user["role"] == "admin":
            self.send_json({"ok": False, "error": "管理员不能创建隧道"}, 403)
            return
        try:
            name = str(data.get("name", "")).strip()
            proxy_type = str(data.get("proxy_type", "tcp")).lower()
            local_ip = str(data.get("local_ip", "127.0.0.1")).strip()
            local_port = int(data.get("local_port", 0))
            remote_port = int(data.get("remote_port", 0) or 0)
            custom_domains = ",".join([d.strip().lower() for d in str(data.get("custom_domains", "")).replace("\n", ",").split(",") if d.strip()])[:500]
            secret_key = str(data.get("secret_key", "")).strip()[:120]
            node_id = int(data.get("node_id", 0) or 0) or int(node_id or 0)
            plan_id = int(data.get("plan_id", 0) or 0)
            if not name or len(name) > 40 or not name.replace("_", "").replace("-", "").isalnum():
                raise ValueError("隧道名称只能包含字母、数字、下划线、短横线，长度 1-40")
            if proxy_type not in ALLOWED_PROXY_TYPES:
                audit("tunnel_rejected_protocol", user, node_id, remote_port, proxy_type, "协议不在白名单")
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
            if int(row_val(user, "banned_until", 0) or 0) > now():
                raise ValueError("账号因异常占用带宽被封禁，暂时无法创建隧道")
            with db() as conn:
                node_row = conn.execute("SELECT id, active FROM nodes WHERE id=?", (node_id,)).fetchone()
                if not node_row or not int(node_row["active"] or 0):
                    raise ValueError("实例所在节点不存在或已停用")
                if plan_id:
                    ok_plan = conn.execute(
                        "SELECT 1 FROM user_plans WHERE id=? AND user_id=? AND node_id=? AND status='active'",
                        (plan_id, user["id"], node_id)).fetchone()
                    if not ok_plan:
                        raise ValueError("实例不存在、已失效或不属于该节点")
                else:
                    pick = conn.execute(
                        "SELECT id FROM user_plans WHERE user_id=? AND node_id=? AND status='active' ORDER BY id DESC LIMIT 1",
                        (user["id"], node_id)).fetchone()
                    plan_id = int(pick["id"]) if pick else 0
                if node_id and node_traffic_exceeded(conn, int(node_id)):
                    raise ValueError("当前实例本月流量已用尽，暂时无法创建新隧道")
                total_plans = conn.execute("SELECT COUNT(*) FROM user_plans WHERE user_id=?", (user["id"],)).fetchone()[0]
                if total_plans and proxy_type in DOMAIN_PROXY_TYPES:
                    quota_active = conn.execute(
                        "SELECT 1 FROM user_plans WHERE user_id=? AND quota_bytes>0 AND status='active' AND (expires_at=0 OR expires_at>?) LIMIT 1",
                        (user["id"], now())).fetchone()
                    unlimited_active = conn.execute(
                        "SELECT 1 FROM user_plans WHERE user_id=? AND billing_mode='time' AND quota_bytes=0 AND status='active' AND (expires_at=0 OR expires_at>?) LIMIT 1",
                        (user["id"], now())).fetchone()
                    if quota_active and not unlimited_active:
                        raise ValueError("当前套餐含流量额度，域名隧道无法计入流量，请使用 TCP/UDP 端口隧道")
                if total_plans:
                    refresh_user_plan_usage(conn, int(user["id"]))
                    active_plans = conn.execute(
                        "SELECT COUNT(*) FROM user_plans WHERE user_id=? AND status='active' AND (expires_at=0 OR expires_at>?)",
                        (user["id"], now())).fetchone()[0]
                    if not active_plans:
                        raise ValueError("套餐已到期或流量已用尽，请先购买套餐")
                if proxy_type in REMOTE_PORT_PROXY_TYPES:
                    if user["role"] != "admin":
                        owned = conn.execute("SELECT 1 FROM ports WHERE node_id=? AND user_id=? AND port=?", (node_id, user["id"], remote_port)).fetchone()
                        if not owned:
                            raise ValueError("这个公网端口不属于当前账号")
                    else:
                        # Admin: check port is in node range, not assigned to another user, and not already tunneled.
                        port_row = conn.execute("SELECT user_id FROM ports WHERE node_id=? AND port=?", (node_id, remote_port)).fetchone()
                        if not port_row:
                            raise ValueError("端口不在当前节点的端口池范围内")
                        if port_row["user_id"] is not None and port_row["user_id"] != user["id"]:
                            raise ValueError("该端口已分配给其他用户")
                        used = conn.execute("SELECT 1 FROM tunnels WHERE node_id=? AND remote_port=? AND proxy_type IN ('tcp','udp')", (node_id, remote_port)).fetchone()
                        if used:
                            raise ValueError("该端口已被其他隧道使用")
                        conn.execute("UPDATE ports SET user_id=? WHERE node_id=? AND port=? AND user_id IS NULL", (user["id"], node_id, remote_port))
                conn.execute(
                    "INSERT INTO tunnels(node_id, user_id, plan_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (node_id, user["id"], plan_id, name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, now()),
                )
            detail = f"{name} -> {local_ip}:{local_port}"
            if custom_domains:
                detail += f" domains={custom_domains}"
            audit("tunnel_create", user, node_id, remote_port or None, proxy_type, detail)
            self.send_json({"ok": True})
        except sqlite3.IntegrityError:
            self.send_json({"ok": False, "error": "隧道名称或公网端口已被使用"}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def tunnel_update(self, user: sqlite3.Row, data: dict[str, Any]) -> None:
        if user["role"] == "admin":
            self.send_json({"ok": False, "error": "管理员不能修改隧道"}, 403)
            return
        try:
            tid = int(data.get("id", 0))
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
            with db() as conn:
                t = conn.execute("SELECT * FROM tunnels WHERE id=? AND user_id=?", (tid, user["id"])).fetchone()
                if not t:
                    self.send_json({"ok": False, "error": "隧道不存在"}, 404)
                    return
                node_id = int(t["node_id"])
                if proxy_type in SECRET_KEY_PROXY_TYPES and not secret_key:
                    secret_key = t["secret_key"] or secrets.token_urlsafe(16)
                if proxy_type in REMOTE_PORT_PROXY_TYPES:
                    # 用户端口是预分配的：改隧道只需确认新端口仍属于本账号，
                    # 不改动 ports 归属（否则旧端口会被误释放、从「端口资源」里消失）。
                    owned = conn.execute("SELECT 1 FROM ports WHERE node_id=? AND user_id=? AND port=?", (node_id, user["id"], remote_port)).fetchone()
                    if not owned:
                        raise ValueError("这个公网端口不属于当前账号")
                    used = conn.execute("SELECT 1 FROM tunnels WHERE node_id=? AND remote_port=? AND proxy_type IN ('tcp','udp') AND id!=?", (node_id, remote_port, tid)).fetchone()
                    if used:
                        raise ValueError("该端口已被其他隧道使用")
                conn.execute(
                    "UPDATE tunnels SET name=?, proxy_type=?, local_ip=?, local_port=?, remote_port=?, custom_domains=?, secret_key=? WHERE id=? AND user_id=?",
                    (name, proxy_type, local_ip, local_port, remote_port, custom_domains, secret_key, tid, user["id"]),
                )
            detail = f"{name} -> {local_ip}:{local_port}"
            if custom_domains:
                detail += f" domains={custom_domains}"
            audit("tunnel_update", user, node_id, remote_port or None, proxy_type, detail)
            self.send_json({"ok": True})
        except sqlite3.IntegrityError:
            self.send_json({"ok": False, "error": "隧道名称或公网端口已被使用"}, 400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 400)

    def admin_create_user(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        ok, msg = create_user(
            str(data.get("username", "")),
            str(data.get("password", "")),
            int(data.get("max_ports", DEFAULT_MAX_PORTS)),
            int(data.get("expires_days", 30)),
            int(data.get("node_id", 0)),
            traffic_gb_to_bytes(data.get("traffic_limit_gb", 0)),
            speed_mbs_to_kbps(data.get("bandwidth_limit_mbs", 0)),
            str(data.get("email", "")),
        )
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

    def admin_update_user_limits(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        traffic_limit_bytes = traffic_gb_to_bytes(data.get("traffic_limit_gb", 0))
        bandwidth_limit_kbps = speed_mbs_to_kbps(data.get("bandwidth_limit_mbs", 0))
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许修改管理员"}, 404)
                return
            conn.execute("UPDATE users SET traffic_limit_bytes=?, bandwidth_limit_kbps=? WHERE id=?", (traffic_limit_bytes, bandwidth_limit_kbps, user_id))
        self.send_json({"ok": True, "message": f"已更新用户 {row['username']} 的流量/速率策略"})

    def admin_reset_password(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        new_password = str(data.get("password") or "").strip() or secrets.token_urlsafe(8)
        if len(new_password) < 6:
            self.send_json({"ok": False, "error": "密码至少 6 位"}, 400)
            return
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许重置管理员"}, 404)
                return
            conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(new_password), user_id))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        self.send_json({"ok": True, "message": f"用户 {row['username']} 新密码：{new_password}", "password": new_password})

    def admin_reset_token(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        new_token = str(data.get("token") or "").strip() or secrets.token_urlsafe(24)
        if len(new_token) < 8:
            self.send_json({"ok": False, "error": "令牌至少 8 位"}, 400)
            return
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许重置管理员"}, 404)
                return
            conn.execute("UPDATE users SET token=? WHERE id=?", (new_token, user_id))
        audit("user_token_reset", admin, None, None, "", f"重置用户 {row['username']} 的面板令牌")
        self.send_json({"ok": True, "message": f"已重置 {row['username']} 的面板令牌：{new_token}（请让该用户重新下载 frpc 配置）", "token": new_token})

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

    def admin_setup_key(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        key = str(data.get("setup_key", "")).strip()
        if key and not (6 <= len(key) <= 128):
            self.send_json({"ok": False, "error": "密钥长度需在 6-128 之间"}, 400)
            return
        with db() as conn:
            setting_set(conn, "setup_key", key)
        audit("setup_key_update", admin, None, None, "", "设置一键添加节点密钥" if key else "清除一键添加节点密钥")
        self.send_json({"ok": True, "message": "已保存自定义密钥" if key else "已清除（回退到环境变量 FML_SETUP_KEY）", "setup_key": effective_setup_key(), "has_setup_key": bool(effective_setup_key()), "setup_key_source": setup_key_source()})

    def pay_notify(self, path: str) -> None:
        provider = path.rsplit("/", 1)[-1]
        raw = self.read_body_raw()
        form: dict[str, str] = {}
        ctype = (self.headers.get("Content-Type") or "").lower()
        try:
            if "json" in ctype:
                payload = json.loads(raw.decode("utf-8", "replace") or "{}")
                form = {str(k): str(v) for k, v in payload.items()}
            elif raw:
                form = {k: v[0] for k, v in urllib.parse.parse_qs(raw.decode("utf-8", "replace")).items()}
        except Exception:
            form = {}
        with db() as conn:
            cfg = payment_config(conn)
        ok, msg = handle_payment_notify(provider, raw, form, cfg)
        if provider == "wechat":
            body = "<xml><return_code><![CDATA[%s]]></return_code><return_msg><![CDATA[%s]]></return_msg></xml>" % ("SUCCESS" if ok else "FAIL", msg)
            self.send_body(body.encode("utf-8"), 200, "application/xml")
            return
        self.send_body(b"success" if ok else b"fail", 200, "text/plain")

    def admin_recharge_keys_create(self, data: dict[str, Any]) -> None:
        admin = self.require_admin()
        if not admin:
            return
        try:
            points = int(data.get("points", 0) or 0)
            count = int(data.get("count", 1) or 1)
            expires_days = int(data.get("expires_days", 0) or 0)
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "表单数值格式不正确"}, 400)
            return
        ok, msg, keys = create_recharge_keys(points, count, str(data.get("note", "")), expires_days, admin["id"])
        if ok:
            audit("recharge_keys_create", admin, None, None, "", f"{len(keys)} 枚 / {points} 积分")
        self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg, "keys": keys}, 200 if ok else 400)

    def admin_recharge_key_toggle(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        try:
            kid = int(data.get("id", 0))
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "参数错误"}, 400)
            return
        with db() as conn:
            conn.execute("UPDATE recharge_keys SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?", (kid,))
        self.send_json({"ok": True, "message": "密钥状态已更新"})

    def admin_recharge_key_delete(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        try:
            kid = int(data.get("id", 0))
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "参数错误"}, 400)
            return
        with db() as conn:
            conn.execute("UPDATE recharge_keys SET deleted=1, active=0 WHERE id=? AND used_by IS NULL", (kid,))
        self.send_json({"ok": True, "message": "密钥已删除"})

    def admin_user_points(self, data: dict[str, Any]) -> None:
        admin = self.require_admin()
        if not admin:
            return
        try:
            uid = int(data.get("id", 0))
            delta = int(data.get("delta", 0))
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "参数错误"}, 400)
            return
        if delta == 0:
            self.send_json({"ok": False, "error": "调整数量不能为 0"}, 400)
            return
        try:
            with db() as conn:
                balance = points_change(conn, uid, delta, "admin_adjust", admin["username"], str(data.get("note", "")))
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
            return
        audit("points_adjust", admin, None, None, "", f"user={uid} delta={delta} balance={balance}")
        self.send_json({"ok": True, "message": f"已调整，当前余额 {balance} 积分", "balance": balance})

    def admin_plan_save(self, data: dict[str, Any]) -> None:
        admin = self.require_admin()
        if not admin:
            return
        try:
            plan_id = int(data.get("id", 0) or 0)
            price_cents = int(round(float(data.get("price", 0) or 0) * 100))
            max_ports = int(data.get("max_ports", 0) or 0)
            traffic_gb = float(data.get("traffic_limit_gb", 0) or 0)
            bandwidth_mbs = float(data.get("bandwidth_limit_mbs", 0) or 0)
            duration_days = int(data.get("duration_days", 30) or 0)
            node_id = int(data.get("node_id", 0) or 0)
            sort_order = int(data.get("sort_order", 0) or 0)
            price_points = int(data.get("price_points", 0) or 0)
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "表单数值格式不正确"}, 400)
            return
        ok, msg = save_plan(plan_id, str(data.get("name", "")), price_cents, max_ports,
                            int(traffic_gb * 1024 ** 3), int(bandwidth_mbs * 1024), duration_days,
                            node_id, str(data.get("note", "")),
                            str(data.get("active", "1")) in ("1", "true", "on", "True"), sort_order, price_points,
                            str(data.get("billing_mode", "time")), str(data.get("fair_use_note", "")))
        if ok:
            audit("plan_save", admin, None, None, "", f"套餐 {data.get('name','')} id={plan_id or 'new'}")
        self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)

    def admin_plan_delete(self, data: dict[str, Any]) -> None:
        admin = self.require_admin()
        if not admin:
            return
        try:
            plan_id = int(data.get("id", 0))
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "参数错误"}, 400)
            return
        with db() as conn:
            conn.execute("UPDATE plans SET deleted=1, active=0 WHERE id=?", (plan_id,))
        audit("plan_delete", admin, None, None, "", f"逻辑删除套餐 id={plan_id}")
        self.send_json({"ok": True, "message": "套餐已删除"})

    def admin_plan_toggle(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        try:
            plan_id = int(data.get("id", 0))
        except (TypeError, ValueError):
            self.send_json({"ok": False, "error": "参数错误"}, 400)
            return
        with db() as conn:
            conn.execute("UPDATE plans SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?", (plan_id,))
        self.send_json({"ok": True, "message": "套餐状态已更新"})

    def admin_order_complete(self, data: dict[str, Any]) -> None:
        admin = self.require_admin()
        if not admin:
            return
        order_no = str(data.get("order_no", "")).strip()
        ok, msg = mark_order_paid(order_no, "MANUAL-" + admin["username"], "manual")
        self.send_json({"ok": ok, "message": msg if ok else None, "error": None if ok else msg}, 200 if ok else 400)

    def admin_payment_config_save(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        has_channel_field = ("providers" in data) or ("provider" in data)
        raw = data.get("providers", data.get("provider", ""))
        if isinstance(raw, (list, tuple)):
            items = [str(x).strip() for x in raw]
        else:
            items = [x.strip() for x in str(raw or "").split(",")]
        providers = [x for x in items if x in PAYMENT_NAMES]
        providers = list(dict.fromkeys(providers))
        provider = providers[0] if providers else ""
        with db() as conn:
            if has_channel_field:
                setting_set(conn, "pay_providers", ",".join(providers))
                setting_set(conn, "pay_provider", provider)
            # 只更新本次提交的字段，避免弹窗单独保存时清空其他配置
            if "public_url" in data:
                setting_set(conn, "pay_public_url", str(data.get("public_url", "")).strip().rstrip("/"))
            if "alipay_app_id" in data:
                setting_set(conn, "alipay_app_id", str(data.get("alipay_app_id", "")).strip())
            if "alipay_gateway" in data:
                setting_set(conn, "alipay_gateway", str(data.get("alipay_gateway", "")).strip() or DEFAULT_ALIPAY_GATEWAY)
            if "wechat_appid" in data:
                setting_set(conn, "wechat_appid", str(data.get("wechat_appid", "")).strip())
            if "wechat_mch_id" in data:
                setting_set(conn, "wechat_mch_id", str(data.get("wechat_mch_id", "")).strip())
            for key in ("alipay_private_key", "alipay_public_key", "wechat_api_key"):
                if str(data.get(key, "")).strip():
                    setting_set(conn, key, str(data.get(key, "")).strip())
            # 汇率固定 1 积分 = 1 元，不再允许修改
            setting_set(conn, "points_per_yuan", "1")
            if "refund_fee_percent" in data:
                try:
                    fee = int(data.get("refund_fee_percent", 10) or 0)
                except (TypeError, ValueError):
                    fee = 10
                setting_set(conn, "refund_fee_percent", str(max(0, min(100, fee))))
        self.send_json({"ok": True, "message": "支付设置已保存"})

    def admin_smtp_config_save(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        host = str(data.get("host", "")).strip()
        user = str(data.get("user", "")).strip()
        from_addr = str(data.get("from_addr", "")).strip()
        password = str(data.get("password", ""))
        try:
            port = int(data.get("port", 0) or 0)
        except (TypeError, ValueError):
            port = 0
        ssl_flag = "1" if str(data.get("ssl", "1")) in ("1", "true", "True", "on") else "0"
        with db() as conn:
            setting_set(conn, "smtp_host", host)
            setting_set(conn, "smtp_port", str(port))
            setting_set(conn, "smtp_user", user)
            setting_set(conn, "smtp_from", from_addr)
            setting_set(conn, "smtp_ssl", ssl_flag)
            if password:
                setting_set(conn, "smtp_password", password)
            cfg = smtp_config(conn)
        audit("smtp_config_update", admin, None, None, "", f"更新邮件设置：{host}:{port} user={user}")
        self.send_json({"ok": True, "message": "邮件设置已保存", "smtp": smtp_public(cfg)})

    def admin_smtp_test(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        to_addr = str(data.get("to", "")).strip()
        if not to_addr or "@" not in to_addr:
            self.send_json({"ok": False, "error": "请填写有效的收件邮箱"}, 400)
            return
        ok, msg = send_email(to_addr, "【Frp 管理台】测试邮件", "这是一封测试邮件，说明邮件服务配置成功。")
        self.send_json({"ok": ok, "message": "测试邮件已发送" if ok else None, "error": None if ok else msg}, 200 if ok else 400)

    def admin_notify_config_save(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        def _flag(value: Any, default: str = "0") -> str:
            raw = value if value is not None else default
            return "1" if str(raw) in ("1", "true", "True", "on", "yes") else "0"
        ctype = str(data.get("type", "")).strip()
        if ctype and ctype not in NOTIFY_CHANNEL_MAP:
            self.send_json({"ok": False, "error": "不支持的通知方式"}, 400)
            return
        raw_params = data.get("params")
        if not isinstance(raw_params, dict):
            raw_params = {}
        clean: dict[str, str] = {}
        if ctype:
            for f in NOTIFY_CHANNEL_MAP[ctype]["fields"]:
                val = raw_params.get(f["key"], "")
                if val is None:
                    val = ""
                clean[f["key"]] = str(val).strip()[:2000]
        try:
            cooldown = int(data.get("cooldown_minutes", 30) or 0)
        except (TypeError, ValueError):
            cooldown = 30
        cooldown = max(0, min(cooldown, 1440))
        with db() as conn:
            setting_set(conn, "notify_enabled", _flag(data.get("enabled")))
            setting_set(conn, "notify_on_down", _flag(data.get("on_down"), "1"))
            setting_set(conn, "notify_on_up", _flag(data.get("on_up"), "1"))
            setting_set(conn, "notify_type", ctype)
            setting_set(conn, "notify_params", json.dumps(clean, ensure_ascii=False))
            setting_set(conn, "notify_cooldown_minutes", str(cooldown))
            cfg = notify_config(conn)
        audit("notify_config_update", admin, None, None, "", f"更新通知设置：enabled={cfg['enabled']} type={cfg['type'] or '无'}")
        self.send_json({"ok": True, "message": "通知设置已保存", "notify": notify_public(cfg)})

    def admin_notify_test(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        ts_text = _beijing_now_text()
        result = send_notification("【Frp 管理台】测试通知", f"这是一条测试通知，用于验证通知配置是否可用。\n时间：{ts_text}", force=True)
        if result.get("ok"):
            self.send_json({"ok": True, "message": "测试通知已发送", "results": result.get("results", [])})
        else:
            detail = result.get("error") or "；".join(f"{r['channel']}: {r['message']}" for r in result.get("results", []))
            self.send_json({"ok": False, "error": detail or "发送失败"}, 400)

    def admin_bncr_config_save(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        enabled = "1" if str(data.get("enabled", "")) in ("1", "true", "True", "on", "yes") else "0"
        url = str(data.get("url", "")).strip()[:300]
        token = str(data.get("token", "")).strip()[:200]
        platform = str(data.get("platform", "wecomLong")).strip()[:40] or "wecomLong"
        group_id = str(data.get("group_id", "")).strip()[:100]
        if enabled == "1" and (not url.startswith("http://") and not url.startswith("https://")):
            self.send_json({"ok": False, "error": "Bncr 地址必须以 http:// 或 https:// 开头"}, 400)
            return
        if enabled == "1" and not group_id:
            self.send_json({"ok": False, "error": "请填写群 chatid（群里发送「企业微信ID」可查询）"}, 400)
            return
        with db() as conn:
            setting_set(conn, "bncr_enabled", enabled)
            setting_set(conn, "bncr_url", url)
            setting_set(conn, "bncr_token", token)
            setting_set(conn, "bncr_platform", platform)
            setting_set(conn, "bncr_group_id", group_id)
            cfg = bncr_config(conn)
        audit("bncr_config_update", admin, None, None, "", f"更新 Bncr 群通知设置：enabled={cfg['enabled']}")
        self.send_json({"ok": True, "message": "Bncr 通知设置已保存", "bncr": bncr_public(cfg)})

    def admin_bncr_test(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        ok = bncr_notify_text("Frp 管理台测试通知",
                              ["这是一条来自面板的测试消息，说明 Bncr 群通知链路已打通。",
                               f"时间：{_beijing_now_text()}"])
        if ok:
            self.send_json({"ok": True, "message": "测试消息已发送，请在群里确认"})
        else:
            self.send_json({"ok": False, "error": "发送失败：请检查 Bncr 插件是否运行、地址与 token 是否匹配"}, 400)

    def account_change_password(self, user: sqlite3.Row, data: dict[str, Any]) -> None:
        old_pwd = str(data.get("old_password", ""))
        new_pwd = str(data.get("new_password", ""))
        if len(new_pwd) < 6:
            self.send_json({"ok": False, "error": "新密码至少 6 位"}, 400)
            return
        if not verify_password(old_pwd, user["password_hash"]):
            self.send_json({"ok": False, "error": "原密码不正确"}, 400)
            return
        if verify_password(new_pwd, user["password_hash"]):
            self.send_json({"ok": False, "error": "新密码不能与原密码相同"}, 400)
            return
        with db() as conn:
            conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(new_pwd), user["id"]))
        audit("account_password_change", user, None, None, "", "自助修改登录密码")
        self.send_json({"ok": True, "message": "密码已修改"})

    def admin_set_user_email(self, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        user_id = int(data.get("id", 0))
        email = str(data.get("email", "")).strip()[:120]
        if email and "@" not in email:
            self.send_json({"ok": False, "error": "邮箱格式不正确"}, 400)
            return
        with db() as conn:
            row = conn.execute("SELECT username FROM users WHERE id=? AND role!='admin'", (user_id,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "用户不存在或不允许修改管理员"}, 404)
                return
            conn.execute("UPDATE users SET email=? WHERE id=?", (email, user_id))
        self.send_json({"ok": True, "message": f"已更新 {row['username']} 的邮箱"})

    def admin_invite_create(self, admin: sqlite3.Row, data: dict[str, Any]) -> None:
        if not self.require_admin():
            return
        ok, msg, keys = create_invite_keys_batch(
            str(data.get("note", "")),
            1,
            int(data.get("max_ports", DEFAULT_MAX_PORTS)),
            int(data.get("user_expires_days", 30)),
            0,
            admin["id"],
            int(data.get("count", 1)),
            traffic_gb_to_bytes(data.get("traffic_limit_gb", 0)),
            speed_mbs_to_kbps(data.get("bandwidth_limit_mbs", 0)),
            str(data.get("kind", "register")),
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
            conn.execute("UPDATE invite_keys SET deleted=1, active=0 WHERE id=?", (key_id,))
        self.send_json({"ok": True, "message": "密钥已删除"})

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
            web_port = int(data.get("web_port", 0) or 0)
            dashboard_url = str(data.get("dashboard_url", "")).strip().rstrip("/")[:300]
            dashboard_user = str(data.get("dashboard_user", "")).strip()[:80]
            dashboard_password = str(data.get("dashboard_password", "")).strip()[:200]
            bandwidth_mbps = max(0, int(data.get("bandwidth_mbps", 0) or 0))
            try:
                monthly_gb = max(0.0, float(data.get("monthly_traffic_gb", 0) or 0))
            except (TypeError, ValueError):
                raise ValueError("月流量不合法")
            monthly_traffic_bytes = int(monthly_gb * 1024 ** 3)
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
            if web_port and not (1 <= web_port <= 65535):
                raise ValueError("frps dashboard 端口不合法")
            if not (1 <= port_start <= port_end <= 65535):
                raise ValueError("端口池范围不合法")
            if port_end - port_start > 20000:
                raise ValueError("单节点端口池不要超过 20000 个")
            with db() as conn:
                cur = conn.execute(
                    "INSERT INTO nodes(region, name, server_addr, server_port, auth_token, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, monthly_traffic_bytes, active, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (region, name, server_addr, server_port, auth_token, port_start, port_end, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, monthly_traffic_bytes, 1, note, now()),
                )
                node_id = int(cur.lastrowid)
                conn.executemany("INSERT OR IGNORE INTO ports(node_id, port, created_at) VALUES(?,?,?)", [(node_id, p, now()) for p in range(port_start, port_end + 1)])
            # 新节点创建：立即连续探测几次确认正常（不阻塞响应）
            spawn_new_node_verify({"name": name, "server_addr": server_addr, "server_port": server_port, "active": True})
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
            web_port = int(data.get("web_port", 0) or 0)
            dashboard_url = str(data.get("dashboard_url", "")).strip().rstrip("/")[:300]
            dashboard_user = str(data.get("dashboard_user", "")).strip()[:80]
            dashboard_password = str(data.get("dashboard_password", "")).strip()[:200]
            bandwidth_mbps = max(0, int(data.get("bandwidth_mbps", 0) or 0))
            try:
                monthly_gb = max(0.0, float(data.get("monthly_traffic_gb", 0) or 0))
            except (TypeError, ValueError):
                raise ValueError("月流量不合法")
            monthly_traffic_bytes = int(monthly_gb * 1024 ** 3)
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
            if web_port and not (1 <= web_port <= 65535):
                raise ValueError("frps dashboard 端口不合法")
            with db() as conn:
                row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "节点不存在"}, 404)
                    return
                conn.execute(
                    "UPDATE nodes SET region=?, name=?, server_addr=?, server_port=?, auth_token=?, web_port=?, dashboard_url=?, dashboard_user=?, dashboard_password=?, bandwidth_mbps=?, monthly_traffic_bytes=?, active=?, note=? WHERE id=?",
                    (region, name, server_addr, server_port, auth_token, web_port, dashboard_url, dashboard_user, dashboard_password, bandwidth_mbps, monthly_traffic_bytes, active, note, node_id),
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
            row = conn.execute("SELECT active FROM nodes WHERE id=?", (node_id,)).fetchone()
            if row and not int(row["active"] or 0):
                refund_plans_on_node(conn, node_id)
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
        user = self.current_user
        if not user:
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            user = download_token_user(str((q.get("token") or [""])[0]))
        if not user:
            self.send_json({"ok": False, "error": "unauthorized"}, 401)
            return
        if not self.require_software_license():
            return
        if user["role"] == "admin":
            self.send_json({"ok": False, "error": "管理员请在仪表盘下载模块为普通用户生成 frpc 配置"}, 403)
            return
        q = urllib.parse.parse_qs(urlparse(self.path).query)
        try:
            node_id = int((q.get("node_id") or ["0"])[0] or 0)
        except ValueError:
            node_id = 0
        try:
            plan_id = int((q.get("plan_id") or ["0"])[0] or 0)
        except ValueError:
            plan_id = 0
        node_id = node_id or int(user["node_id"] or 0)
        with db() as conn:
            node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
            tunnels = user_instance_tunnels(conn, int(user["id"]), node_id, plan_id)
        if not node:
            self.send_json({"ok": False, "error": "实例所在节点不存在"}, 400)
            return
        if tunnels is None:
            self.send_json({"ok": False, "error": "实例不存在或不属于当前账号"}, 403)
            return
        self.send_body(tunnel_config(user, node, tunnels).encode(), 200, "application/toml; charset=utf-8", {"Content-Disposition": 'attachment; filename="frpc.toml"'})

    def download_frpc_deploy_script(self) -> None:
        # Browser downloads use the normal login session. Server-side curl/wget can use
        # /config/deploy-frpc.sh?token=<user panel token>, which is shown only to the
        # logged-in normal user as an optional deployment script address.
        user = self.current_user
        if not user:
            q = urllib.parse.parse_qs(urlparse(self.path).query)
            user = download_token_user(str((q.get("token") or [""])[0]))
        if not user:
            self.send_json({"ok": False, "error": "unauthorized"}, 401)
            return
        if not self.require_software_license():
            return
        if user["role"] == "admin":
            self.send_json({"ok": False, "error": "管理员请在仪表盘下载模块为普通用户生成部署脚本"}, 403)
            return
        q = urllib.parse.parse_qs(urlparse(self.path).query)
        try:
            node_id = int((q.get("node_id") or ["0"])[0] or 0)
        except ValueError:
            node_id = 0
        try:
            plan_id = int((q.get("plan_id") or ["0"])[0] or 0)
        except ValueError:
            plan_id = 0
        node_id = node_id or int(user["node_id"] or 0)
        with db() as conn:
            node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
            tunnels = user_instance_tunnels(conn, int(user["id"]), node_id, plan_id)
        if not node:
            self.send_json({"ok": False, "error": "实例所在节点不存在"}, 400)
            return
        if tunnels is None:
            self.send_json({"ok": False, "error": "实例不存在或不属于当前账号"}, 403)
            return
        cfg = tunnel_config(user, node, tunnels)
        script = frpc_deploy_script(cfg)
        self.send_body(script.encode(), 200, "application/x-sh; charset=utf-8", {"Content-Disposition": 'attachment; filename="deploy-frpc.sh"'})

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
            op = str(payload.get("op") or payload.get("Op") or "")
            content = payload.get("content") or payload.get("Content") or payload
            if not isinstance(content, dict):
                raise ValueError("invalid plugin content")

            # frp 0.66 server plugin payloads differ by op:
            # - Login:    content.user is a string, content.metas contains global metadata.
            # - NewProxy: content.user is an object: { user, metas, run_id }, and content.metas is proxy metadata.
            raw_user = content.get("user") or content.get("User") or content.get("clientUser") or ""
            user_block = raw_user if isinstance(raw_user, dict) else {}
            user_name = str(
                user_block.get("user")
                or user_block.get("User")
                or raw_user
                or ""
            )

            metas = user_block.get("metas") or user_block.get("metadatas") or user_block.get("Metas")
            if not isinstance(metas, dict):
                metas = content.get("metas") or content.get("metadatas") or content.get("Metas") or {}
            if not isinstance(metas, dict):
                metas = {}

            panel_token = str(metas.get("panelToken") or metas.get("panel_token") or content.get("panelToken") or "")
            callback_node_id, callback_node_token = plugin_node_from_query(self.path)
            frp_version = str(payload.get("version") or content.get("version") or "")[:32]
            reject = False
            reason = ""

            with db() as conn:
                if frp_version and callback_node_id and op.lower() == "login":
                    conn.execute("UPDATE nodes SET frps_version=? WHERE id=?", (frp_version, int(callback_node_id)))
                user = conn.execute("SELECT * FROM users WHERE username=? AND active=1", (user_name,)).fetchone()
                if not user:
                    reject, reason = True, "unknown, disabled or expired user"
                elif user_over_traffic_limit(user):
                    reject, reason = True, "daily traffic quota exceeded"
                elif not panel_token or not hmac.compare_digest(panel_token, user["token"]):
                    reject, reason = True, "invalid panel token"
                elif callback_node_id is not None:
                    node = conn.execute("SELECT * FROM nodes WHERE id=? AND active=1", (callback_node_id,)).fetchone()
                    if not node:
                        reject, reason = True, "unknown or disabled frps node"
                    elif not callback_node_token or not hmac.compare_digest(callback_node_token, node["auth_token"]):
                        reject, reason = True, "invalid frps node token"
                elif op.lower() == "newproxy":
                    active_nodes = conn.execute("SELECT COUNT(*) AS c FROM nodes WHERE active=1").fetchone()["c"]
                    if active_nodes > 1:
                        reject, reason = True, "frps node identity missing; update httpPlugins.path"

                if not reject and op.lower() == "newproxy":
                    actual_node_id = callback_node_id or user["node_id"]
                    proxy_name = str(first_nested_value(content, {"proxy_name", "proxyName", "ProxyName", "name", "Name"}) or "")
                    expected_prefix = f"{user['username']}."
                    tunnel_name = proxy_name[len(expected_prefix):] if proxy_name.startswith(expected_prefix) else proxy_name
                    legacy_prefix = f"{user['username']}_"
                    if tunnel_name.startswith(legacy_prefix):
                        tunnel_name = tunnel_name[len(legacy_prefix):]
                    remote_port = int_or_none(first_nested_value(content, {"remote_port", "remotePort", "RemotePort"}))
                    proxy_type = str(first_nested_value(content, {"proxy_type", "proxyType", "ProxyType", "type", "Type"}) or "").lower()
                    domains_raw = first_nested_value(content, {"custom_domains", "customDomains", "CustomDomains"})
                    if isinstance(domains_raw, list):
                        requested_domains = sorted([str(d).strip().lower() for d in domains_raw if str(d).strip()])
                    else:
                        requested_domains = sorted([d.strip().lower() for d in str(domains_raw or "").replace("\n", ",").split(",") if d.strip()])
                    tunnel = conn.execute("SELECT * FROM tunnels WHERE node_id=? AND user_id=? AND name=? AND enabled=1", (actual_node_id, user["id"], tunnel_name)).fetchone()
                    if not tunnel:
                        reject, reason = True, "proxy is not configured or disabled in panel"
                    elif proxy_type != str(tunnel["proxy_type"]):
                        reject, reason = True, "proxy type does not match panel tunnel"
                    elif proxy_type in REMOTE_PORT_PROXY_TYPES:
                        if remote_port is None:
                            reject, reason = True, "remote port missing"
                        elif int(tunnel["remote_port"] or 0) != int(remote_port):
                            reject, reason = True, "remote port does not match panel tunnel"
                    elif proxy_type in DOMAIN_PROXY_TYPES:
                        expected_domains = sorted([d.strip().lower() for d in str(tunnel["custom_domains"] or "").split(",") if d.strip()])
                        if requested_domains != expected_domains:
                            reject, reason = True, "custom domains do not match panel tunnel"
                    elif proxy_type in SECRET_KEY_PROXY_TYPES:
                        requested_secret = str(first_nested_value(content, {"sk", "secret_key", "secretKey", "SecretKey"}) or "")
                        if str(tunnel["secret_key"] or "") and requested_secret != str(tunnel["secret_key"] or ""):
                            reject, reason = True, "secret key does not match panel tunnel"
                    if not reject and tunnel:
                        conn.execute("UPDATE tunnels SET last_proxy_at=? WHERE id=?", (now(), tunnel["id"]))

            self.send_json({"reject": reject, "reject_reason": reason, "unchange": not reject})
        except Exception as e:
            self.send_json({"reject": True, "reject_reason": f"plugin error: {e}"})


def main() -> None:
    init_db()
    start_traffic_sampler()
    start_plan_usage_loop()
    start_host_sampler()
    start_proxy_sampler()
    start_node_health_sampler()
    start_update_checker()
    start_license_heartbeat()
    print(f"{APP_NAME} separated server listening on http://{HOST}:{PORT}")
    print(f"DB: {DB_PATH}")
    if ADMIN_PASSWORD == "admin123":
        print("WARNING: default admin password is admin123. Set FML_ADMIN_PASSWORD in production.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
