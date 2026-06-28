#!/usr/bin/env bash
set -Eeuo pipefail

# frp-manager-lite 一键添加 frps 节点
# 在新的 VPS 上运行，自动安装 frps 并注册到面板。
#
# 前置条件：面板 .env 中已设置 FML_SETUP_KEY
#
# 用法：
#   PANEL_URL=https://panel.example.com SETUP_KEY=*** bash add-frps-node.sh
#
# 非交互式：
#   PANEL_URL=... SETUP_KEY=... NODE_NAME=hk-01 REGION=香港 \
#   FRPS_BIND_PORT=7000 FRPS_TOKEN=*** PORT_START=30000 PORT_END=30199 \
#   bash add-frps-node.sh

APP_NAME="frp-manager-lite"
FRP_VERSION="${FRP_VERSION:-0.62.1}"
NODE_NAME="${NODE_NAME:-}"
REGION="${REGION:-}"
FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
FRPS_TOKEN="${FRPS_TOKEN:-}"
PORT_START="${PORT_START:-20000}"
PORT_END="${PORT_END:-20199}"
FRPS_DASHBOARD_PORT="${FRPS_DASHBOARD_PORT:-7500}"
FRPS_DASHBOARD_USER="${FRPS_DASHBOARD_USER:-admin}"
FRPS_DASHBOARD_PWD="${FRPS_DASHBOARD_PWD:-}"  # 留空则随机生成

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[frps-node]${NC} $*"; }
warn() { echo -e "${YELLOW}[frps-node]${NC} $*"; }
err()  { echo -e "${RED}[frps-node]${NC} $*"; exit 1; }

prompt() {
  local var="$1" prompt_text="$2" default="${3:-}"
  local val="${!var}"
  if [[ -n "$val" ]]; then return; fi
  if [[ -n "$default" ]]; then
    read -r -p "${prompt_text} [${default}]: " val
    val="${val:-$default}"
  else
    read -r -p "${prompt_text}: " val
  fi
  printf -v "$var" '%s' "$val"
}

prompt_secret() {
  local var="$1" prompt_text="$2"
  local val="${!var}"
  if [[ -n "$val" ]]; then return; fi
  read -r -s -p "${prompt_text}（不回显）: " val; echo
  printf -v "$var" '%s' "$val"
}

require_cmd() { command -v "$1" >/dev/null 2>&1 || err "请先安装 $1"; }

# ── 交互式输入 ──────────────────────────────────────────────

PANEL_URL="${PANEL_URL:-}"
SETUP_KEY="${SETUP_KEY:-}"

echo ''
echo '  frp-manager-lite 一键添加 frps 节点'
echo '  ─────────────────────────────────'
echo ''

# 如果面板和密钥已通过 env 提供，保留；否则交互输入
prompt PANEL_URL "① 面板地址（例如 https://panel.example.com）"
prompt SETUP_KEY "② 面板 FML_SETUP_KEY（在面板 .env 中配置）"

SERVER_IP="$(curl -fsS --connect-timeout 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")"

prompt NODE_NAME "③ 节点名称（英文，例如 hk-01）"
prompt REGION "④ 地区（例如 香港）"
prompt FRPS_BIND_PORT "⑤ frps bindPort"
prompt_secret FRPS_TOKEN "⑥ frps token（至少 6 位）"
prompt SERVER_IP "⑦ 本机公网 IP（自动检测）" "$SERVER_IP"
prompt PORT_START "⑧ 端口池起始"
prompt PORT_END "⑨ 端口池结束"
echo ''

# ── 注册到面板 ──────────────────────────────────────────────

log "正在向面板注册节点…"
API_RESP="$(curl -fsS --connect-timeout 10 -X POST "${PANEL_URL}/api/setup/register-node" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys; json.dump({'setup_key':sys.argv[1],'name':sys.argv[2],'region':sys.argv[3],'server_addr':sys.argv[4],'server_port':int(sys.argv[5]),'auth_token':sys.argv[6],'port_start':int(sys.argv[7]),'port_end':int(sys.argv[8])}, ensure_ascii=False)" \
    "$SETUP_KEY" "$NODE_NAME" "$REGION" "$SERVER_IP" "$FRPS_BIND_PORT" "$FRPS_TOKEN" "$PORT_START" "$PORT_END")")"

if echo "$API_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('ok') else 1)" 2>/dev/null; then
  log "节点注册成功：$(echo "$API_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))")"
else
  err "节点注册失败：$API_RESP"
fi

# ── 安装 frps ───────────────────────────────────────────────

FRPS_DIR="/opt/frps-${NODE_NAME}"
mkdir -p "${FRPS_DIR}"

if [[ ! -f "${FRPS_DIR}/frps" ]]; then
  log "正在下载 frps ${FRP_VERSION} …"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  FRP_ARCH="amd64" ;;
    aarch64) FRP_ARCH="arm64" ;;
    *)       err "不支持的架构：$ARCH" ;;
  esac
  TARBALL="frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz"
  URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${TARBALL}"
  TMPD="$(mktemp -d)"
  curl -fsSL "$URL" -o "${TMPD}/${TARBALL}"
  tar xzf "${TMPD}/${TARBALL}" -C "$TMPD"
  cp "${TMPD}/frp_${FRP_VERSION}_linux_${FRP_ARCH}/frps" "${FRPS_DIR}/frps"
  rm -rf "$TMPD"
  chmod +x "${FRPS_DIR}/frps"
  log "frps 已安装"
fi

# ── 生成 frps 配置 ──────────────────────────────────────────

if [[ -z "$FRPS_DASHBOARD_PWD" ]]; then
  FRPS_DASHBOARD_PWD="$(openssl rand -base64 12 2>/dev/null || python3 -c "import secrets; print(secrets.token_urlsafe(12))")"
fi

cat > "${FRPS_DIR}/frps.toml" << EOF
# frp-manager-lite frps 节点：${NODE_NAME}
# 由 add-frps-node.sh 自动生成

bindAddr = "0.0.0.0"
bindPort = ${FRPS_BIND_PORT}
kcpBindPort = ${FRPS_BIND_PORT}

auth.token = "${FRPS_TOKEN}"

# 指向面板，frps 每次新连接都会回调面板验权
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "${PANEL_URL#https://}"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]

# frps 自带的仪表盘（可选）
webServer.addr = "0.0.0.0"
webServer.port = ${FRPS_DASHBOARD_PORT}
webServer.user = "${FRPS_DASHBOARD_USER}"
webServer.password = "${FRPS_DASHBOARD_PWD}"
EOF

log "frps 配置文件已生成"

# ── systemd 服务 ────────────────────────────────────────────

SERVICE_NAME="frps-${NODE_NAME}"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=frps node ${NODE_NAME} for frp-manager-lite
After=network.target

[Service]
Type=simple
ExecStart=${FRPS_DIR}/frps -c ${FRPS_DIR}/frps.toml
Restart=always
RestartSec=10
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

# ── 等待启动 ────────────────────────────────────────────────

log "等待 frps 启动…"
for _ in $(seq 1 15); do
  if ss -tlnp | grep -q ":${FRPS_BIND_PORT}"; then
    break
  fi
  sleep 1
done

if ss -tlnp | grep -q ":${FRPS_BIND_PORT}"; then
  log "frps 已启动，端口 ${FRPS_BIND_PORT}"
else
  warn "frps 可能启动失败，请检查：journalctl -u ${SERVICE_NAME} -n 50"
fi

# ── 防火墙提示 ──────────────────────────────────────────────

echo ''
log "==============================================="
log "  frps 节点 ${NODE_NAME} 添加完成！"
log "==============================================="
echo ''
log "  节点名称：      ${NODE_NAME}"
log "  地区：          ${REGION}"
log "  公网 IP：       ${SERVER_IP}"
log "  bindPort：      ${FRPS_BIND_PORT}"
log "  端口池：        ${PORT_START}-${PORT_END}"
log "  仪表盘：        http://${SERVER_IP}:${FRPS_DASHBOARD_PORT}"
log "  仪表盘用户：    ${FRPS_DASHBOARD_USER}"
log "  仪表盘密码：    ${FRPS_DASHBOARD_PWD}"
echo ''
log "【常用命令】"
log "  启动：    systemctl start ${SERVICE_NAME}"
log "  停止：    systemctl stop ${SERVICE_NAME}"
log "  状态：    systemctl status ${SERVICE_NAME}"
log "  日志：    journalctl -u ${SERVICE_NAME} -f"
echo ''
warn "【防火墙】请确保以下端口已放行："
warn "  TCP ${FRPS_BIND_PORT}  (frps)"
warn "  TCP ${PORT_START}-${PORT_END}  (用户隧道)"
warn "  TCP ${FRPS_DASHBOARD_PORT}  (仪表盘，仅局域网建议)"
echo ''
