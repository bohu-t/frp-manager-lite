#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/frp-manager-lite}"
COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
IMAGE="${IMAGE:-ghcr.io/bohu-t/frp-manager-lite:latest}"
PUBLISH_BIND="${FML_PUBLISH_BIND:-127.0.0.1}"
PUBLISH_PORT="${FML_PUBLISH_PORT:-18081}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1"
    echo "请先安装 Docker 和 Docker Compose 插件。"
    exit 1
  }
}

rand_alnum() {
  local n="${1:-24}"
  set +o pipefail
  local v
  v="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$n")"
  set -o pipefail
  printf '%s' "$v"
}

need_cmd docker
if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 Docker Compose 插件：docker compose"
  exit 1
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  cat > .env <<EOF
# 面板监听到宿主机的地址。默认只监听本机，建议由 nginx/caddy 反代。
FML_PUBLISH_BIND=${PUBLISH_BIND}
FML_PUBLISH_PORT=${PUBLISH_PORT}

# 首次启动默认管理员；生产请改强密码。
FML_ADMIN_USER=admin
FML_ADMIN_PASSWORD=$(rand_alnum 20)

# frps 全局 token，需和 frps.toml 的 auth.token 一致。
FRP_AUTH_TOKEN=$(rand_alnum 24)

# 端口池默认范围。
FML_PORT_START=20000
FML_PORT_END=20199
EOF
  chmod 600 .env
  echo "已生成 ${APP_DIR}/.env，请保存里面的管理员密码。"
else
  echo "检测到现有 .env，保持不覆盖。"
fi

cat > "$COMPOSE_FILE" <<EOF
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

docker compose pull
docker compose up -d

echo
echo "frp-manager-lite 已启动。"
echo "目录：${APP_DIR}"
echo "访问： http://${PUBLISH_BIND}:${PUBLISH_PORT}"
echo
echo "管理员信息："
grep -E '^(FML_ADMIN_USER|FML_ADMIN_PASSWORD)=' .env
