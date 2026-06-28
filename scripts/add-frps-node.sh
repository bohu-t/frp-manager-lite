#!/usr/bin/env bash
set -Eeuo pipefail

# frp-manager-lite 一键添加 frps 节点（小白友好版）
# 在新的 VPS 上运行，全中文交互，零脑力。
#
# 直接用 curl 下载运行即可：
#   curl -fsSL https://raw.githubusercontent.com/.../add-frps-node.sh | bash
#
# 高级用户也可用环境变量跳过交互：
#   PANEL_URL=... SETUP_KEY=... NODE_NAME=hk-01 bash add-frps-node.sh

FRP_VERSION="${FRP_VERSION:-0.62.1}"
NODE_NAME="${NODE_NAME:-}"
REGION="${REGION:-}"
FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
FRPS_TOKEN="${FRPS_TOKEN:-}"
PORT_START="${PORT_START:-20000}"
PORT_END="${PORT_END:-20199}"
FRPS_DASHBOARD_PORT="${FRPS_DASHBOARD_PORT:-7500}"
FRPS_DASHBOARD_USER="${FRPS_DASHBOARD_USER:-admin}"
FRPS_DASHBOARD_PWD="${FRPS_DASHBOARD_PWD:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️${NC}  $*"; }
err()  { echo -e "${RED}❌${NC} $*"; exit 1; }

# ── 交互式引导 ──────────────────────────────────────────────

echo ''
echo -e "${CYAN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║   frp-manager-lite · 添加 frps 节点  ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════╝${NC}"
echo ''
echo '  本脚本会：'
echo '    ① 向你的面板注册新节点'
echo '    ② 安装并启动 frps'
echo '    ③ 配置 systemd 开机自启'
echo ''
echo '  需要提前准备：'
echo '    · 面板地址（如 https://panel.example.com）'
echo '    · 面板后台 → 设置页 → FML_SETUP_KEY'
echo '    · 本机公网 IP 已开放对应端口（防火墙 / 安全组）'
echo ''

# ── 第 1 步：面板连接信息 ──────────────────────────────────

PANEL_URL="${PANEL_URL:-}"
SETUP_KEY="${SETUP_KEY:-}"

echo -e "${CYAN}━━━ 第 1 步：连接你的面板 ━━━${NC}"
echo ''

while [[ -z "$PANEL_URL" ]]; do
  read -r -p "  面板地址（例如 https://panel.example.com）：" PANEL_URL
done
if [[ "$PANEL_URL" =~ /$ ]]; then PANEL_URL="${PANEL_URL%/}"; fi

while [[ -z "$SETUP_KEY" ]]; do
  read -r -s -p "  FML_SETUP_KEY（在面板后台 → 设置页查看，不回显）：" SETUP_KEY
  echo
done

# 检查面板连通性
echo ''
log "正在连接面板 ${PANEL_URL} …"
if ! curl -fsS --connect-timeout 5 "${PANEL_URL}/api/csrf" >/dev/null 2>&1; then
  warn "面板连接失败，但继续执行（可能是 HTTPS / 网络问题）"
fi

# ── 第 2 步：节点信息 ──────────────────────────────────────

echo ''
echo -e "${CYAN}━━━ 第 2 步：节点信息 ━━━${NC}"
echo ''

# 自动检测公网 IP
SERVER_IP="${SERVER_IP:-}"
if [[ -z "$SERVER_IP" ]]; then
  SERVER_IP="$(curl -fsS --connect-timeout 5 ifconfig.me 2>/dev/null || \
                curl -fsS --connect-timeout 5 ipinfo.io/ip 2>/dev/null || \
                hostname -I 2>/dev/null | awk '{print $1}' || echo "")"
fi

while [[ -z "$NODE_NAME" ]]; do
  read -r -p "  节点名称（英文，如 hk-01、jp-tokyo-01）：" NODE_NAME
done

while [[ -z "$REGION" ]]; do
  read -r -p "  地区名称（如 香港、东京、洛杉矶）：" REGION
done

while [[ -z "$SERVER_IP" ]]; do
  read -r -p "  本机公网 IP：" SERVER_IP
done
echo -e "  → 公网 IP：${GREEN}${SERVER_IP}${NC}"

# ── 第 3 步：端口配置 ──────────────────────────────────────

echo ''
echo -e "${CYAN}━━━ 第 3 步：端口配置 ━━━${NC}"
echo ''

while [[ -z "$FRPS_BIND_PORT" ]] || ! [[ "$FRPS_BIND_PORT" =~ ^[0-9]+$ ]]; do
  read -r -p "  frps 通信端口 [7000]：" FRPS_BIND_PORT
  FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
done

while [[ -z "$FRPS_TOKEN" ]]; do
  read -r -s -p "  frps 鉴权 token（至少 6 位，不回显）：" FRPS_TOKEN
  echo
  if [[ ${#FRPS_TOKEN} -lt 6 ]]; then
    echo '  ❌ token 至少 6 位'
    FRPS_TOKEN=""
  fi
done

while [[ -z "$PORT_START" ]] || ! [[ "$PORT_START" =~ ^[0-9]+$ ]]; do
  read -r -p "  用户端口池起始 [20000]：" PORT_START
  PORT_START="${PORT_START:-20000}"
done

while [[ -z "$PORT_END" ]] || ! [[ "$PORT_END" =~ ^[0-9]+$ ]]; do
  read -r -p "  用户端口池结束 [20199]：" PORT_END
  PORT_END="${PORT_END:-20199}"
done

if [[ $PORT_END -le $PORT_START ]]; then
  PORT_END=$((PORT_START + 199))
  warn "端口池范围无效，已自动调整为 ${PORT_START}-${PORT_END}"
fi

PORT_COUNT=$((PORT_END - PORT_START + 1))
echo -e "  → 端口池：${PORT_START}-${PORT_END}（共 ${PORT_COUNT} 个）"

# ── 第 4 步：注册到面板 ────────────────────────────────────

echo ''
echo -e "${CYAN}━━━ 第 4 步：注册到面板 ━━━${NC}"
log "正在注册节点 ${NODE_NAME}（${REGION}）…"

API_RESP="$(curl -fsS --connect-timeout 10 -X POST "${PANEL_URL}/api/setup/register-node" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json, sys
json.dump({
    'setup_key': sys.argv[1],
    'name': sys.argv[2],
    'region': sys.argv[3],
    'server_addr': sys.argv[4],
    'server_port': int(sys.argv[5]),
    'auth_token': sys.argv[6],
    'port_start': int(sys.argv[7]),
    'port_end': int(sys.argv[8])
}, ensure_ascii=False)
" "$SETUP_KEY" "$NODE_NAME" "$REGION" "$SERVER_IP" "$FRPS_BIND_PORT" "$FRPS_TOKEN" "$PORT_START" "$PORT_END")")"

if echo "$API_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('ok') else 1)" 2>/dev/null; then
  log "面板注册成功！"
else
  echo ''
  err "面板返回错误：${API_RESP}"
fi

# ── 第 5 步：安装 frps ────────────────────────────────────

echo ''
echo -e "${CYAN}━━━ 第 5 步：安装 frps ━━━${NC}"

FRPS_DIR="/opt/frps-${NODE_NAME}"
mkdir -p "${FRPS_DIR}"

if [[ ! -f "${FRPS_DIR}/frps" ]]; then
  log "下载 frps ${FRP_VERSION} …"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) FRP_ARCH="amd64" ;;
    aarch64|arm64) FRP_ARCH="arm64" ;;
    *) err "不支持的 CPU 架构：$ARCH（仅支持 x86_64 和 arm64）" ;;
  esac
  TARBALL="frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz"
  URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${TARBALL}"
  TMPD="$(mktemp -d)"
  curl -fsSL -# "$URL" -o "${TMPD}/${TARBALL}"
  tar xzf "${TMPD}/${TARBALL}" -C "$TMPD"
  cp "${TMPD}/frp_${FRP_VERSION}_linux_${FRP_ARCH}/frps" "${FRPS_DIR}/frps"
  rm -rf "$TMPD"
  chmod +x "${FRPS_DIR}/frps"
  log "frps 安装完成"
else
  log "frps 已安装，跳过下载"
fi

# ── 生成配置 ────────────────────────────────────────────────

if [[ -z "$FRPS_DASHBOARD_PWD" ]]; then
  FRPS_DASHBOARD_PWD="$(openssl rand -base64 12 2>/dev/null || python3 -c "import secrets; print(secrets.token_urlsafe(12))")"
fi

# 从面板地址提取域名用于 httpPlugins
PANEL_HOST="${PANEL_URL#https://}"
PANEL_HOST="${PANEL_HOST#http://}"

cat > "${FRPS_DIR}/frps.toml" << EOF
# ───────────────────────────────────
# frp-manager-lite frps 节点：${NODE_NAME}
# 地区：${REGION}
# 生成时间：$(date '+%Y-%m-%d %H:%M:%S')
# ───────────────────────────────────

bindAddr = "0.0.0.0"
bindPort = ${FRPS_BIND_PORT}
kcpBindPort = ${FRPS_BIND_PORT}

auth.token = "${FRPS_TOKEN}"

# 回调面板验权
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "${PANEL_HOST}"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]

# 仪表盘（仅建议内网访问）
webServer.addr = "0.0.0.0"
webServer.port = ${FRPS_DASHBOARD_PORT}
webServer.user = "${FRPS_DASHBOARD_USER}"
webServer.password = "${FRPS_DASHBOARD_PWD}"
EOF

log "配置文件已生成：${FRPS_DIR}/frps.toml"

# ── systemd 服务 ────────────────────────────────────────────

SERVICE_NAME="frps-${NODE_NAME}"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=frps node ${NODE_NAME} (${REGION}) for frp-manager-lite
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

echo ''
log "等待 frps 启动…"
sleep 2
for _ in $(seq 1 10); do
  if ss -tlnp 2>/dev/null | grep -q ":${FRPS_BIND_PORT}" || netstat -tlnp 2>/dev/null | grep -q ":${FRPS_BIND_PORT}"; then
    break
  fi
  sleep 1
done

if ss -tlnp 2>/dev/null | grep -q ":${FRPS_BIND_PORT}" || netstat -tlnp 2>/dev/null | grep -q ":${FRPS_BIND_PORT}"; then
  log "frps 已启动 ✅"
else
  warn "frps 可能未成功启动，检查日志：journalctl -u ${SERVICE_NAME} -n 30"
fi

# ── 完成 ────────────────────────────────────────────────────

echo ''
echo -e "${GREEN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║   🎉 节点 ${NODE_NAME} 添加完成！  ║${NC}"
echo -e "${GREEN}  ╚══════════════════════════════════════╝${NC}"
echo ''
echo "  节点名称：    ${NODE_NAME}"
echo "  地区：        ${REGION}"
echo "  公网 IP：     ${SERVER_IP}"
echo "  frps 端口：   ${FRPS_BIND_PORT}"
echo "  端口池：      ${PORT_START} - ${PORT_END}（${PORT_COUNT} 个）"
echo "  仪表盘：      http://${SERVER_IP}:${FRPS_DASHBOARD_PORT}"
echo "  仪表盘用户：  ${FRPS_DASHBOARD_USER}"
echo "  仪表盘密码：  ${FRPS_DASHBOARD_PWD}"
echo ''
echo -e "${YELLOW}  ⚠️  防火墙提醒：请放行以下端口${NC}"
echo "     TCP ${FRPS_BIND_PORT}  — frps 通信"
echo "     TCP ${PORT_START}-${PORT_END}  — 用户隧道"
echo "     TCP ${FRPS_DASHBOARD_PORT}  — 仪表盘（建议仅内网）"
echo ''
echo "  管理命令："
echo "    systemctl start ${SERVICE_NAME}    启动"
echo "    systemctl stop ${SERVICE_NAME}     停止"
echo "    systemctl restart ${SERVICE_NAME}  重启"
echo "    systemctl status ${SERVICE_NAME}   状态"
echo "    journalctl -u ${SERVICE_NAME} -f   日志"
echo ''
