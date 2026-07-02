#!/usr/bin/env bash
set -Eeuo pipefail

# frp-manager-lite 一键生产部署脚本
# 自动安装 Docker、frps、Nginx、Let's Encrypt 并配置面板 + frps systemd 服务。
# 适用于 Debian/Ubuntu 服务器，root 执行：
#   sudo bash scripts/deploy-production.sh
# 非交互式示例：
#   PANEL_DOMAIN=panel.example.com FRPS_DOMAIN=frp.example.com \
#   FML_ADMIN_PASSWORD='请换成强密码' FRP_AUTH_TOKEN='请换成强token' \
#   bash scripts/deploy-production.sh

APP_NAME="frp-manager-lite"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Resolve project root — works even if script was copied elsewhere
if [[ -f "${SCRIPT_DIR}/../app.py" ]]; then
  PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
else
  # Copied into dist/obfuscated; walk up to find the real project root
  PROJECT_DIR="${SCRIPT_DIR}"
  while [[ ! -f "${PROJECT_DIR}/app.py" && "${PROJECT_DIR}" != "/" ]]; do
    PROJECT_DIR="$(dirname "${PROJECT_DIR}")"
  done
  if [[ ! -f "${PROJECT_DIR}/app.py" ]]; then
    echo "错误：找不到项目根目录（缺少 app.py），请在项目根目录下执行此脚本"
    exit 1
  fi
fi

FRP_STABLE_VERSION="${FRP_STABLE_VERSION:-0.66.0}"
FRP_VERSION="${FRP_VERSION:-}"
FRP_CHANNEL="${FRP_CHANNEL:-}"
FML_PUBLISH_PORT="${FML_PUBLISH_PORT:-18081}"
FML_ADMIN_USER="${FML_ADMIN_USER:-admin}"
FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
FRPS_PORT_START="${FRPS_PORT_START:-20000}"
FRPS_PORT_END="${FRPS_PORT_END:-20199}"
FRPS_WEB_PORT="${FRPS_WEB_PORT:-7500}"
INSTALL_NGINX="${INSTALL_NGINX:-auto}"      # auto|0|1
ENABLE_HTTPS="${ENABLE_HTTPS:-auto}"        # auto|0|1; 需要 PANEL_DOMAIN
ENABLE_UFW="${ENABLE_UFW:-0}"               # 默认 0，避免不小心锁 SSH
PANEL_DOMAIN="${PANEL_DOMAIN:-}"
FRPS_DOMAIN="${FRPS_DOMAIN:-}"
PANEL_PLUGIN_ADDR="${PANEL_PLUGIN_ADDR:-127.0.0.1:${FML_PUBLISH_PORT}}"
FML_PUBLISH_BIND="${FML_PUBLISH_BIND:-127.0.0.1}"

# --- 输出函数 ---
log()   { printf '\033[1;34m[部署]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "请用 root 执行，例如：sudo bash scripts/deploy-production.sh"
    exit 1
  fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    tr -dc 'A-Za-z0-9_=-' </dev/urandom | head -c 43
  fi
}

url_encode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

resolve_panel_plugin_path() {
  local node_id encoded_token
  node_id="$(curl -fsS --connect-timeout 5 "http://127.0.0.1:${FML_PUBLISH_PORT}/api/nodes" 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    nodes = data.get("nodes") or []
    default = next((n for n in nodes if n.get("name") == "default"), nodes[0] if nodes else {})
    print(default.get("id", ""))
except Exception:
    print("")
' 2>/dev/null || true)"
  encoded_token="$(url_encode "${FRP_AUTH_TOKEN}")"
  if [[ -n "${node_id}" ]]; then
    printf '/frp-plugin?node_id=%s&node_token=%s' "${node_id}" "${encoded_token}"
  else
    warn "未能从面板读取默认节点 ID，frps 插件路径暂用 /frp-plugin；单节点可用，多节点前请到面板下载对应 frps 配置替换"
    printf '/frp-plugin'
  fi
}

prompt_value() {
  local var_name="$1" prompt="$2" default_value="${3:-}"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    printf -v "${var_name}" '%s' "${default_value}"
    return 0
  fi
  local input
  if [[ -n "${default_value}" ]]; then
    read -r -p "${prompt} [${default_value}]: " input
    printf -v "${var_name}" '%s' "${input:-${default_value}}"
  else
    read -r -p "${prompt}: " input
    printf -v "${var_name}" '%s' "${input}"
  fi
}

prompt_secret() {
  local var_name="$1" prompt="$2"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then
    return 0
  fi
  local generated
  generated="$(random_secret)"
  if [[ ! -t 0 ]]; then
    printf -v "${var_name}" '%s' "${generated}"
    return 0
  fi
  local input
  read -r -s -p "${prompt} [直接回车自动生成]: " input
  printf '\n'
  printf -v "${var_name}" '%s' "${input:-${generated}}"
}

resolve_latest_frp_version() {
  local latest
  latest="$(curl -fsSL --connect-timeout 10 https://api.github.com/repos/fatedier/frp/releases/latest | python3 -c '
import json, sys
try:
    tag = json.load(sys.stdin).get("tag_name", "")
    print(tag[1:] if tag.startswith("v") else tag)
except Exception:
    sys.exit(1)
')" || { err "获取 frp 最新版失败，请检查网络或直接设置 FRP_VERSION"; exit 1; }
  [[ -n "$latest" ]] || { err "获取 frp 最新版失败：GitHub 返回为空"; exit 1; }
  printf '%s\n' "$latest"
}

select_frp_version() {
  if [[ -n "${FRP_VERSION:-}" ]]; then
    log "使用指定 frp 版本：${FRP_VERSION}"
    return 0
  fi

  local choice="${FRP_CHANNEL:-}"
  if [[ -z "$choice" ]]; then
    if [[ -t 0 ]]; then
      echo ''
      echo '请选择 frp 安装版本：'
      echo "  1) 稳定版 v${FRP_STABLE_VERSION}（推荐）"
      echo '  2) 最新版（自动读取 GitHub Releases）'
      read -r -p '请选择 [1/2，默认 1]: ' choice
      choice="${choice:-1}"
    else
      choice="stable"
    fi
  fi

  case "${choice,,}" in
    1|stable|stable版|稳定|稳定版)
      FRP_VERSION="$FRP_STABLE_VERSION"
      FRP_CHANNEL="stable"
      ;;
    2|latest|latest版|最新|最新版)
      FRP_VERSION="$(resolve_latest_frp_version)"
      FRP_CHANNEL="latest"
      ;;
    *)
      err "未知 frp 版本选项：${choice}（请输入 1/2、stable/latest，或直接设置 FRP_VERSION）"
      exit 1
      ;;
  esac
  log "frp 安装版本：${FRP_CHANNEL} → v${FRP_VERSION}"
}

require_supported_os() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      debian|ubuntu) return 0 ;;
    esac
  fi
  warn "本脚本在 Debian/Ubuntu 上测试过，当前系统可能不兼容，继续执行…"
}

# --- 安装步骤 ---

apt_install_base() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl tar gzip openssl lsb-release python3
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Compose 已安装：$(docker compose version --short 2>/dev/null || docker compose version)"
    return 0
  fi
  log "正在安装 Docker Engine 和 Compose 插件…"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  docker compose version
  log "Docker 安装完成"
}

build_obfuscated() {
  log "正在加密编译源码…"
  python3 "${PROJECT_DIR}/tools/build-obfuscated.py" --no-docker
  log "源码加密完成"
}

write_env_file() {
  local env_file="${PROJECT_DIR}/.env"
  if [[ -f "${env_file}" ]]; then
    local backup="${env_file}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -a "${env_file}" "${backup}"
    log "已备份原有 .env → ${backup}"
  fi

  cat > "${env_file}" <<ENV
# 由 scripts/deploy-production.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
FML_PUBLISH_BIND=${FML_PUBLISH_BIND}
FML_PUBLISH_PORT=${FML_PUBLISH_PORT}
FML_ADMIN_USER=${FML_ADMIN_USER}
FML_ADMIN_PASSWORD=${FML_ADMIN_PASSWORD}
FML_PORT_START=${FRPS_PORT_START}
FML_PORT_END=${FRPS_PORT_END}
FML_DEFAULT_MAX_PORTS=${FML_DEFAULT_MAX_PORTS:-5}
FML_SETUP_KEY=${FML_SETUP_KEY:-$(openssl rand -base64 24 2>/dev/null || python3 -c "import secrets; print(secrets.token_urlsafe(24))")}

FRP_SERVER_ADDR=${FRPS_DOMAIN}
FRP_SERVER_PORT=${FRPS_BIND_PORT}
FRP_AUTH_TOKEN=${FRP_AUTH_TOKEN}
ENV
  chmod 600 "${env_file}"
  log ".env 配置文件已写入"
  # Copy to obfuscated build directory so docker compose finds it
  mkdir -p "${PROJECT_DIR}/dist/obfuscated"
  cp -a "${env_file}" "${PROJECT_DIR}/dist/obfuscated/.env"
}

start_panel() {
  log "正在构建并启动 ${APP_NAME} 面板（加密版）…"
  (cd "${PROJECT_DIR}/dist/obfuscated" && docker compose up -d --build)
  log "等待面板健康检查就绪…"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${FML_PUBLISH_PORT}/api/nodes" >/dev/null 2>&1; then
      log "面板已就绪：http://127.0.0.1:${FML_PUBLISH_PORT}"
      return 0
    fi
    sleep 2
  done
  warn "面板 60 秒内未就绪，请检查：cd ${PROJECT_DIR}/dist/obfuscated && docker compose logs --tail=100"
}

detect_system_arch() {
  SYSTEM_ARCH="$(uname -m)"
  case "${SYSTEM_ARCH}" in
    x86_64|amd64) FRP_ARCH="amd64" ;;
    aarch64|arm64) FRP_ARCH="arm64" ;;
    armv7l|armv7*) FRP_ARCH="arm" ;;
    armv6l|armv6*) FRP_ARCH="arm" ;;
    i386|i686)     FRP_ARCH="386" ;;
    *) err "不支持的 CPU 架构：${SYSTEM_ARCH}"; exit 1 ;;
  esac
  log "系统架构检测通过：${SYSTEM_ARCH} → frp linux_${FRP_ARCH}"
}

frp_arch() {
  printf '%s\n' "${FRP_ARCH:?未检测系统架构}"
}

install_frps_binary() {
  local arch package url tmpdir
  arch="$(frp_arch)"
  package="frp_${FRP_VERSION}_linux_${arch}"
  url="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${package}.tar.gz"
  tmpdir="$(mktemp -d)"

  if command -v frps >/dev/null 2>&1 && frps --version 2>/dev/null | grep -qx "${FRP_VERSION}"; then
    log "frps ${FRP_VERSION} 已安装，跳过下载"
    rm -rf "${tmpdir}"
    return 0
  fi

  log "正在下载 frps ${FRP_VERSION} (${arch})…"
  curl -fL "${url}" -o "${tmpdir}/frp.tar.gz"
  tar -xzf "${tmpdir}/frp.tar.gz" -C "${tmpdir}"
  install -m 0755 "${tmpdir}/${package}/frps" /usr/local/bin/frps
  rm -rf "${tmpdir}"
  log "frps 安装完成：$(/usr/local/bin/frps --version 2>/dev/null | sed 's/^/frps /')"
}

write_frps_config() {
  mkdir -p /etc/frp
  if [[ -f /etc/frp/frps.toml ]]; then
    cp -a /etc/frp/frps.toml "/etc/frp/frps.toml.bak.$(date +%Y%m%d-%H%M%S)"
    log "已备份原有 /etc/frp/frps.toml"
  fi

  local plugin_path
  plugin_path="$(resolve_panel_plugin_path)"

  cat > /etc/frp/frps.toml <<TOML
# 由 frp-manager-lite scripts/deploy-production.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
# frp 0.66+
bindPort = ${FRPS_BIND_PORT}

auth.method = "token"
auth.token = "${FRP_AUTH_TOKEN}"

allowPorts = [
  { start = ${FRPS_PORT_START}, end = ${FRPS_PORT_END} }
]

# frp 0.66+ 传输层优化
transport.tcpMux = true
transport.maxPoolCount = 5

webServer.addr = "127.0.0.1"
webServer.port = ${FRPS_WEB_PORT}
webServer.user = "admin"
webServer.password = "${FRPS_WEB_PASSWORD}"

# Prometheus 监控指标
webServer.enablePrometheus = true

# 生产环境鉴权插件：校验用户状态、panelToken 和端口归属；多节点配置需使用带 node_id/node_token 的插件路径。
# 不配置此项，用户可以绕过面板手写 frpc.toml 抢占端口。
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "${PANEL_PLUGIN_ADDR}"
path = "${plugin_path}"
ops = ["Login", "NewProxy"]
TOML
  chmod 600 /etc/frp/frps.toml
  log "frps 配置已写入 /etc/frp/frps.toml"
}

install_frps_service() {
  cat > /etc/systemd/system/frps.service <<'SERVICE'
[Unit]
Description=frp server
Documentation=https://github.com/fatedier/frp
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE
  systemctl daemon-reload
  systemctl enable --now frps
  systemctl restart frps
  log "frps 服务已启动：$(systemctl is-active frps)"
}

install_nginx_if_requested() {
  local do_nginx="${INSTALL_NGINX}"
  if [[ "${do_nginx}" == "auto" ]]; then
    if [[ -n "${PANEL_DOMAIN}" ]]; then do_nginx="1"; else do_nginx="0"; fi
  fi
  [[ "${do_nginx}" == "1" ]] || return 0
  if [[ -z "${PANEL_DOMAIN}" ]]; then
    warn "INSTALL_NGINX=1 但未提供面板域名，跳过 Nginx"
    return 0
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y nginx
  cat > /etc/nginx/sites-available/frp-manager-lite <<NGINX
server {
    listen 80;
    server_name ${PANEL_DOMAIN};

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:${FML_PUBLISH_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  ln -sfn /etc/nginx/sites-available/frp-manager-lite /etc/nginx/sites-enabled/frp-manager-lite
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  log "Nginx 反向代理已配置 → ${PANEL_DOMAIN}"

  local do_https="${ENABLE_HTTPS}"
  if [[ "${do_https}" == "auto" ]]; then do_https="1"; fi
  if [[ "${do_https}" == "1" ]]; then
    apt-get install -y certbot python3-certbot-nginx
    log "正在为 ${PANEL_DOMAIN} 申请 Let's Encrypt 证书…"
    certbot --nginx -d "${PANEL_DOMAIN}" --non-interactive --agree-tos -m "admin@${PANEL_DOMAIN}" --redirect || \
      warn "证书申请失败，请确认 DNS 已指向本服务器，然后手动执行：certbot --nginx -d ${PANEL_DOMAIN}"
  fi
}

configure_ufw_if_requested() {
  [[ "${ENABLE_UFW}" == "1" ]] || return 0
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y ufw
  ufw allow OpenSSH || true
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow "${FRPS_BIND_PORT}/tcp"
  ufw allow "${FRPS_PORT_START}:${FRPS_PORT_END}/tcp"
  ufw allow "${FRPS_PORT_START}:${FRPS_PORT_END}/udp"
  ufw --force enable
  ufw status verbose
  log "防火墙已配置"
}

print_summary() {
  echo ''
  echo '========================================'
  echo '  部署完成！'
  echo '========================================'
  echo ''
  echo '【管理面板】'
  echo "  管理员账号：${FML_ADMIN_USER}"
  echo "  本机访问：  http://127.0.0.1:${FML_PUBLISH_PORT}"
  if [[ -n "${PANEL_DOMAIN}" ]]; then
    echo "  公网访问：  https://${PANEL_DOMAIN}"
  elif [[ "${FML_PUBLISH_BIND}" == "0.0.0.0" ]]; then
    local pub_ip
    pub_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || hostname -f)"
    echo "  公网访问：  http://${pub_ip}:${FML_PUBLISH_PORT}"
  fi
  echo ''
  echo '【frps】'
  echo "  配置文件：  /etc/frp/frps.toml"
  echo "  绑定地址：  ${FRPS_DOMAIN}:${FRPS_BIND_PORT}"
  echo "  端口池：    ${FRPS_PORT_START}-${FRPS_PORT_END}（TCP/UDP）"
  echo "  frps 面板： http://127.0.0.1:${FRPS_WEB_PORT}"
  echo ''
  echo '【常用命令】'
  echo "  面板日志：  cd ${PROJECT_DIR}/dist/obfuscated && docker compose logs -f"
  echo "  面板状态：  cd ${PROJECT_DIR}/dist/obfuscated && docker compose ps"
  echo "  frps 日志： journalctl -u frps -f"
  echo "  frps 状态： systemctl status frps"
  echo ''
  echo '【防火墙/安全组需放行】'
  echo "  ${FRPS_BIND_PORT}/tcp          （frps 入口）"
  echo "  ${FRPS_PORT_START}-${FRPS_PORT_END}/tcp  （用户隧道 TCP）"
  echo "  ${FRPS_PORT_START}-${FRPS_PORT_END}/udp  （用户隧道 UDP）"
  if [[ -n "${PANEL_DOMAIN}" ]]; then
    echo "  80/tcp + 443/tcp               （Nginx + HTTPS）"
  else
    echo "  ${FML_PUBLISH_PORT}/tcp                   （面板直连）"
  fi
  echo ''
  echo '【面板后台添加节点时填写】'
  echo "  frps 地址： ${FRPS_DOMAIN}"
  echo "  bindPort：  ${FRPS_BIND_PORT}"
  echo "  token：     与 .env 和 /etc/frp/frps.toml 中的 FRP_AUTH_TOKEN 一致"
  echo "  端口范围：  ${FRPS_PORT_START}-${FRPS_PORT_END}"
  echo ''
}

main() {
  need_root
  detect_system_arch
  select_frp_version
  require_supported_os
  cd "${PROJECT_DIR}"

  echo ''
  echo '========================================'
  echo '  frp-manager-lite 一键部署'
  echo '========================================'
  echo ''
  echo '接下来需要填写几项基本信息：'
  echo ''
  echo '  ① 面板域名 — 用于 Nginx 反代和 Let''s Encrypt HTTPS'
  echo '     留空则跳过 Nginx，面板直接监听 0.0.0.0:18081'
  echo '  ② frps 域名/IP — 用户 frpc 连接 frps 时用的地址'
  echo '     未填写时自动取面板域名或本机主机名'
  echo '  ③ 面板管理员密码 — 登录管理后台用的密码'
  echo '  ④ frps token — frps 的认证令牌，用户 frpc 也需要'
  echo '  ⑤ frps 面板密码 — frps 自带的 Web 仪表盘密码'
  echo ''
  echo '所有密码可直接回车随机生成，但请务必记下来！'
  echo ''

  prompt_value PANEL_DOMAIN "① 面板域名（留空跳过 Nginx/HTTPS）" "${PANEL_DOMAIN}"
  local detected_frps_domain="${FRPS_DOMAIN}"
  if [[ -z "${detected_frps_domain}" ]]; then
    detected_frps_domain="${PANEL_DOMAIN:-$(hostname -f 2>/dev/null || hostname)}"
  fi
  prompt_value FRPS_DOMAIN "② frps 域名或 IP（用户 frpc 填的地址）" "${detected_frps_domain}"

  # 自动决定绑定地址：没域名 → 直接暴露 0.0.0.0；有域名 → 仅本机 + Nginx 反代
  if [[ -z "${PANEL_DOMAIN}" ]]; then
    FML_PUBLISH_BIND="${FML_PUBLISH_BIND:-0.0.0.0}"
    log "未提供面板域名，面板将直接绑定 ${FML_PUBLISH_BIND}:${FML_PUBLISH_PORT}（外网可直接访问）"
  else
    FML_PUBLISH_BIND="${FML_PUBLISH_BIND:-127.0.0.1}"
  fi

  echo ''
  echo '密码输入时不会回显在屏幕上，直接回车则随机生成。'
  prompt_secret FML_ADMIN_PASSWORD "③ 面板管理员密码"
  prompt_secret FRP_AUTH_TOKEN "④ frps token"
  prompt_secret FRPS_WEB_PASSWORD "⑤ frps 仪表盘密码"
  echo ''

  log "开始安装基础依赖…"
  apt_install_base
  install_docker
  build_obfuscated
  write_env_file
  start_panel
  install_frps_binary
  write_frps_config
  install_frps_service
  install_nginx_if_requested
  configure_ufw_if_requested
  print_summary
}

main "$@"
