#!/usr/bin/env bash
set -Eeuo pipefail

# frp-manager-lite 预构建镜像生产部署脚本
# 功能：安装 Docker、拉取 GHCR 面板镜像、安装 frps、可选安装 Nginx + HTTPS。
# 不会在用户服务器构建镜像，也不需要源码仓库。
#
# 快速使用：
#   curl -fsSL https://raw.githubusercontent.com/bohu-t/frp-manager-lite/main/scripts/deploy-image-production.sh | sudo bash
#
# 非交互示例：
#   PANEL_DOMAIN=panel.example.com FRPS_DOMAIN=frp.example.com \
#   FML_ADMIN_PASSWORD='change-me' FRP_AUTH_TOKEN='change-me-token' \
#   sudo -E bash scripts/deploy-image-production.sh

APP_NAME="frp-manager-lite"
APP_DIR="${APP_DIR:-/opt/frp-manager-lite}"
IMAGE="${IMAGE:-ghcr.io/bohu-t/frp-manager-lite:latest}"
FRP_VERSION="${FRP_VERSION:-0.66.0}"

FML_PUBLISH_PORT="${FML_PUBLISH_PORT:-18081}"
FML_ADMIN_USER="${FML_ADMIN_USER:-admin}"
FML_DEFAULT_MAX_PORTS="${FML_DEFAULT_MAX_PORTS:-5}"

FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
FRPS_PORT_START="${FRPS_PORT_START:-20000}"
FRPS_PORT_END="${FRPS_PORT_END:-20199}"
FRPS_WEB_PORT="${FRPS_WEB_PORT:-7500}"

PANEL_DOMAIN="${PANEL_DOMAIN:-}"
FRPS_DOMAIN="${FRPS_DOMAIN:-}"
INSTALL_NGINX="${INSTALL_NGINX:-auto}"      # auto|0|1
ENABLE_HTTPS="${ENABLE_HTTPS:-auto}"        # auto|0|1
ENABLE_UFW="${ENABLE_UFW:-0}"               # 默认关闭，避免锁 SSH
FML_PUBLISH_BIND="${FML_PUBLISH_BIND:-}"     # 未填则根据是否有 PANEL_DOMAIN 自动决定
PANEL_PLUGIN_ADDR="${PANEL_PLUGIN_ADDR:-127.0.0.1:${FML_PUBLISH_PORT}}"

log()   { printf '\033[1;34m[部署]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "请用 root 执行，例如：sudo bash scripts/deploy-image-production.sh"
    exit 1
  fi
}

require_supported_os() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      debian|ubuntu) return 0 ;;
    esac
  fi
  warn "本脚本主要在 Debian/Ubuntu 测试，当前系统可能不兼容，继续执行…"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    set +o pipefail
    local v
    v="$(LC_ALL=C tr -dc 'A-Za-z0-9_=-' </dev/urandom | head -c 43)"
    set -o pipefail
    printf '%s' "$v"
  fi
}

prompt_value() {
  local var_name="$1" prompt="$2" default_value="${3:-}"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then return 0; fi
  if [[ ! -t 0 ]]; then printf -v "${var_name}" '%s' "${default_value}"; return 0; fi
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
  if [[ -n "${current}" ]]; then return 0; fi
  local generated input
  generated="$(random_secret)"
  if [[ ! -t 0 ]]; then printf -v "${var_name}" '%s' "${generated}"; return 0; fi
  read -r -s -p "${prompt} [直接回车自动生成]: " input
  printf '\n'
  printf -v "${var_name}" '%s' "${input:-${generated}}"
}

apt_install_base() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl tar gzip openssl lsb-release
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
}

maybe_ghcr_login() {
  if [[ -n "${GHCR_TOKEN:-}" ]]; then
    log "检测到 GHCR_TOKEN，正在登录 ghcr.io…"
    echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER:-${GITHUB_ACTOR:-token}}" --password-stdin
  fi
}

write_panel_files() {
  mkdir -p "${APP_DIR}"
  cd "${APP_DIR}"

  if [[ -f .env ]]; then
    cp -a .env ".env.bak.$(date +%Y%m%d-%H%M%S)"
    log "已备份原有 ${APP_DIR}/.env"
  fi

  cat > .env <<ENV
# 由 scripts/deploy-image-production.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
FML_PUBLISH_BIND=${FML_PUBLISH_BIND}
FML_PUBLISH_PORT=${FML_PUBLISH_PORT}
FML_ADMIN_USER=${FML_ADMIN_USER}
FML_ADMIN_PASSWORD=${FML_ADMIN_PASSWORD}
FML_PORT_START=${FRPS_PORT_START}
FML_PORT_END=${FRPS_PORT_END}
FML_DEFAULT_MAX_PORTS=${FML_DEFAULT_MAX_PORTS}
FML_SETUP_KEY=${FML_SETUP_KEY:-$(random_secret)}

FRP_SERVER_ADDR=${FRPS_DOMAIN}
FRP_SERVER_PORT=${FRPS_BIND_PORT}
FRP_AUTH_TOKEN=${FRP_AUTH_TOKEN}
ENV
  chmod 600 .env

  cat > docker-compose.yml <<EOF
services:
  frp-manager-lite:
    image: ${IMAGE}
    pull_policy: always
    container_name: frp-manager-lite
    restart: unless-stopped
    env_file:
      - path: .env
        required: false
    environment:
      FML_HOST: 0.0.0.0
      FML_PORT: 8080
      FML_DB: /data/data.sqlite3
    ports:
      - "\${FML_PUBLISH_BIND:-127.0.0.1}:\${FML_PUBLISH_PORT:-18081}:8080"
    volumes:
      - frp-manager-lite-data:/data
      - /etc/machine-id:/host/machine-id:ro
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/nodes', timeout=3).read()"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          memory: 256M

volumes:
  frp-manager-lite-data:
EOF
}

start_panel() {
  log "正在拉取并启动面板镜像：${IMAGE}"
  cd "${APP_DIR}"
  docker compose pull
  docker compose up -d
  log "等待面板健康检查就绪…"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${FML_PUBLISH_PORT}/api/nodes" >/dev/null 2>&1; then
      log "面板已就绪：http://127.0.0.1:${FML_PUBLISH_PORT}"
      return 0
    fi
    sleep 2
  done
  warn "面板 60 秒内未就绪，请检查：cd ${APP_DIR} && docker compose logs --tail=100"
}

frp_arch() {
  local machine
  machine="$(uname -m)"
  case "${machine}" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    armv7l|armv7*) echo "arm" ;;
    i386|i686) echo "386" ;;
    *) err "不支持的 CPU 架构：${machine}"; exit 1 ;;
  esac
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

  cat > /etc/frp/frps.toml <<TOML
# 由 frp-manager-lite deploy-image-production.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
# frp 0.66+
bindPort = ${FRPS_BIND_PORT}

auth.method = "token"
auth.token = "${FRP_AUTH_TOKEN}"

allowPorts = [
  { start = ${FRPS_PORT_START}, end = ${FRPS_PORT_END} }
]

transport.tcpMux = true
transport.maxPoolCount = 5

webServer.addr = "127.0.0.1"
webServer.port = ${FRPS_WEB_PORT}
webServer.user = "admin"
webServer.password = "${FRPS_WEB_PASSWORD}"

enablePrometheus = true

[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "${PANEL_PLUGIN_ADDR}"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]
TOML
  chmod 600 /etc/frp/frps.toml
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
    warn "INSTALL_NGINX=1 但未提供 PANEL_DOMAIN，跳过 Nginx"
    return 0
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y nginx
  if [[ -f /etc/nginx/sites-available/frp-manager-lite ]]; then
    cp -a /etc/nginx/sites-available/frp-manager-lite "/etc/nginx/sites-available/frp-manager-lite.bak.$(date +%Y%m%d-%H%M%S)"
  fi
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
}

print_summary() {
  echo ''
  echo '========================================'
  echo '  部署完成！'
  echo '========================================'
  echo ''
  echo '【管理面板】'
  echo "  目录：      ${APP_DIR}"
  echo "  镜像：      ${IMAGE}"
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
  echo "  地址：      ${FRPS_DOMAIN}:${FRPS_BIND_PORT}"
  echo "  端口池：    ${FRPS_PORT_START}-${FRPS_PORT_END}（TCP/UDP）"
  echo "  frps 面板： http://127.0.0.1:${FRPS_WEB_PORT}"
  echo ''
  echo '【常用命令】'
  echo "  面板升级：  cd ${APP_DIR} && docker compose pull && docker compose up -d"
  echo "  面板日志：  cd ${APP_DIR} && docker compose logs -f"
  echo "  frps 日志： journalctl -u frps -f"
  echo "  frps 重启： systemctl restart frps"
  echo ''
  echo '【防火墙/安全组需放行】'
  echo "  ${FRPS_BIND_PORT}/tcp"
  echo "  ${FRPS_PORT_START}-${FRPS_PORT_END}/tcp"
  echo "  ${FRPS_PORT_START}-${FRPS_PORT_END}/udp"
  if [[ -n "${PANEL_DOMAIN}" ]]; then
    echo "  80/tcp + 443/tcp"
  else
    echo "  ${FML_PUBLISH_PORT}/tcp"
  fi
  echo ''
}

main() {
  need_root
  require_supported_os

  echo ''
  echo '========================================'
  echo '  frp-manager-lite 镜像版一键生产部署'
  echo '========================================'
  echo ''

  prompt_value PANEL_DOMAIN "① 面板域名（留空则不装 Nginx/HTTPS，面板直连端口）" "${PANEL_DOMAIN}"
  local detected_frps_domain="${FRPS_DOMAIN}"
  if [[ -z "${detected_frps_domain}" ]]; then
    detected_frps_domain="${PANEL_DOMAIN:-$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || hostname -f 2>/dev/null || hostname)}"
  fi
  prompt_value FRPS_DOMAIN "② frps 域名或 IP（用户 frpc 连接地址）" "${detected_frps_domain}"

  if [[ -z "${FML_PUBLISH_BIND}" ]]; then
    if [[ -z "${PANEL_DOMAIN}" ]]; then FML_PUBLISH_BIND="0.0.0.0"; else FML_PUBLISH_BIND="127.0.0.1"; fi
  fi

  echo ''
  echo '密码输入时不会回显。直接回车会自动生成。'
  prompt_secret FML_ADMIN_PASSWORD "③ 面板管理员密码"
  prompt_secret FRP_AUTH_TOKEN "④ frps token"
  prompt_secret FRPS_WEB_PASSWORD "⑤ frps 仪表盘密码"
  echo ''

  log "开始安装基础依赖…"
  apt_install_base
  install_docker
  maybe_ghcr_login
  write_panel_files
  start_panel
  install_frps_binary
  write_frps_config
  install_frps_service
  install_nginx_if_requested
  configure_ufw_if_requested
  print_summary
}

main "$@"
