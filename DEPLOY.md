# frp-manager-lite 部署文档

本文档以 Ubuntu/Debian VPS 为例，说明如何部署面板和 frps 节点。

## 1. 准备环境

要求：

- Linux VPS
- Python 3.10+
- frp/frps 已下载或可自行安装
- 一个域名，推荐用于面板和各地区节点

检查 Python：

```bash
python3 --version
```

项目不需要 pip 安装依赖。

## 2. 获取代码

```bash
git clone https://github.com/YOUR_NAME/frp-manager-lite.git
cd frp-manager-lite
```

如果你通过压缩包上传，也进入项目目录即可。

## 3. 设置环境变量

生产环境不要使用默认密码。可以创建环境文件：

```bash
sudo mkdir -p /etc/frp-manager-lite
sudo nano /etc/frp-manager-lite/env
```

示例：

```bash
FML_HOST=127.0.0.1
FML_PORT=18081
FML_DB=/var/lib/frp-manager-lite/data.sqlite3
FML_ADMIN_USER=admin
FML_ADMIN_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
FML_PORT_START=20000
FML_PORT_END=20199
FML_DEFAULT_MAX_PORTS=5
FRP_SERVER_ADDR=hk.example.com
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=CHANGE_THIS_FRPS_TOKEN
```

创建数据目录：

```bash
sudo mkdir -p /var/lib/frp-manager-lite
sudo chown -R $USER:$USER /var/lib/frp-manager-lite
```

## 4. 直接测试运行

```bash
set -a
. /etc/frp-manager-lite/env
set +a
python3 app.py
```

如果 `FML_HOST=127.0.0.1`，只能本机访问。推荐生产环境通过 Nginx/Caddy 反代 HTTPS。

## 5. Docker Compose 部署

适合想快速上线、方便迁移和隔离运行环境的部署方式。

### 5.1 准备配置

```bash
cp .env.example .env
nano .env
```

至少修改：

```bash
FML_ADMIN_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
FRP_AUTH_TOKEN=CHANGE_THIS_FRPS_TOKEN
FRP_SERVER_ADDR=panel-or-frps.example.com
```

Compose 默认把容器端口 `8080` 发布到宿主机本地 `127.0.0.1:18081`：

```bash
FML_PUBLISH_PORT=18081
```

这样面板不会直接暴露公网，推荐由 Nginx/Caddy 反代 HTTPS。

### 5.2 启动

```bash
docker compose up -d --build
```

Dockerfile 默认使用固定基础镜像 `python:3.13.5-slim-bookworm`。如果你的部署环境需要 Python 3.11，可改用：

```bash
docker compose build --build-arg PYTHON_IMAGE=python:3.11.9-slim-bookworm
docker compose up -d
```

查看状态和日志：

```bash
docker compose ps
docker compose logs -f
```

访问：

```text
http://127.0.0.1:18081
```

### 5.3 数据持久化

Docker 部署时会自动设置：

```bash
FML_DB=/data/data.sqlite3
```

SQLite 数据保存在命名卷：

```text
frp-manager-lite-data
```

查看卷：

```bash
docker volume inspect frp-manager-lite_frp-manager-lite-data
```

备份数据库：

```bash
mkdir -p ./backup
docker compose exec frp-manager-lite python - <<'PY'
import sqlite3
src = sqlite3.connect('/data/data.sqlite3')
dst = sqlite3.connect('/data/backup.sqlite3')
src.backup(dst)
dst.close(); src.close()
PY
docker compose cp frp-manager-lite:/data/backup.sqlite3 ./backup/data-$(date +%F-%H%M%S).sqlite3
```

### 5.4 升级

升级前建议先备份数据库，然后：

```bash
git pull
docker compose up -d --build
```

### 5.5 生产注意事项

- `.env` 不要提交到 Git，里面包含管理员密码、frps token、R2 密钥等敏感信息。
- 默认 Compose 已设置非 root 用户、健康检查、日志轮转和 256M 内存限制。
- 如果你确实要直接公网暴露面板端口，把 `docker-compose.yml` 里的 `127.0.0.1:${FML_PUBLISH_PORT:-18081}:8080` 改为 `${FML_PUBLISH_PORT:-18081}:8080`，但更推荐保留本地绑定并走 HTTPS 反代。

## 6. systemd 服务

创建服务文件：

```bash
sudo nano /etc/systemd/system/frp-manager-lite.service
```

内容示例，注意把路径换成你的项目路径：

```ini
[Unit]
Description=frp-manager-lite
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/frp-manager-lite
EnvironmentFile=/etc/frp-manager-lite/env
ExecStart=/usr/bin/python3 /opt/frp-manager-lite/app.py
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

如果项目在 `/opt/frp-manager-lite`：

```bash
sudo mkdir -p /opt
sudo cp -r . /opt/frp-manager-lite
sudo chown -R www-data:www-data /opt/frp-manager-lite /var/lib/frp-manager-lite
sudo systemctl daemon-reload
sudo systemctl enable --now frp-manager-lite
sudo systemctl status frp-manager-lite
```

查看日志：

```bash
journalctl -u frp-manager-lite -f
```

## 7. Nginx 反向代理 HTTPS

推荐面板只监听本机：

```bash
FML_HOST=127.0.0.1
FML_PORT=18081
```

Nginx 示例：

```nginx
server {
    listen 80;
    server_name panel.example.com;

    location / {
        proxy_pass http://127.0.0.1:18081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

然后用 Certbot 或 acme.sh 配置 HTTPS。

## 8. frps 节点部署

每个地区节点建议使用稳定域名：

```text
hk.example.com
jp.example.com
us.example.com
```

后台新增节点时填写：

- 地区
- 节点名
- frps 域名/地址
- frps bindPort
- frps token
- 端口池范围

管理员后台可以下载该节点的 `frps.example.toml`。

核心配置示例：

```toml
bindPort = 7000
auth.method = "token"
auth.token = "CHANGE_THIS_FRPS_TOKEN"

allowPorts = [
  { start = 20000, end = 20199 }
]
```

`allowPorts` 很重要，它限制整个 frps 节点只能使用你的端口池。

## 9. 配置 frps HTTP Plugin

仅靠面板不能防止用户手写 `frpc.toml` 抢端口。生产环境建议启用 frps HTTP Plugin。

示例，具体字段请按你的 frp 版本文档调整：

```toml
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "panel.example.com:443"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]
```

如果 frp 版本支持 HTTPS 插件地址，请优先走 HTTPS。若 frps 和面板在同一内网，也可以使用内网地址。

面板 `/frp-plugin` 会校验：

- 用户是否存在、启用、未过期
- 用户 token 是否正确
- 用户使用的 remote_port 是否属于自己
- 协议是否在白名单内，默认只允许 TCP/UDP

## 10. 防滥用建议

默认不要开放 HTTP/HTTPS 代理给普通用户。推荐只允许：

```text
tcp
udp
```

后台风控功能：

- 按端口查询用户
- 查看端口相关审计日志
- 一键封禁用户
- 记录封禁原因

收到投诉时，根据被投诉的 `服务器IP:端口` 查询并封禁。

## 11. 备份与恢复

### 面板全量备份

管理员后台提供：

```text
全量备份
```

下载地址：

```text
/admin/backup/full.zip
```

ZIP 内包含：

- `data.sqlite3`：SQLite 完整数据库快照
- `dump.sql`：SQL 文本转储
- `metadata.json`：备份元信息
- `RESTORE.md`：恢复说明

这个备份包含用户 token、注册密钥、会话、审计日志等敏感数据，请妥善保存，不要公开。

### 上传到 Cloudflare R2

如果配置了 R2 环境变量，后台会显示：

```text
备份到 R2
```

需要配置：

```bash
R2_ACCOUNT_ID=你的 Cloudflare Account ID
R2_ACCESS_KEY_ID=R2 S3 API Access Key ID
R2_SECRET_ACCESS_KEY=R2 S3 API Secret Access Key
R2_BUCKET=你的 bucket 名称
R2_PREFIX=frp-manager-lite/backups
```

建议创建专用 R2 API Token / S3 凭证，只给目标 bucket 的对象写入权限。不要把 R2 密钥提交到 Git。

备份对象路径类似：

```text
frp-manager-lite/backups/frp-manager-lite-backup-20260625-230000.zip
```

### 命令行备份

需要重点备份：

```text
/var/lib/frp-manager-lite/data.sqlite3
/etc/frp-manager-lite/env
```

示例：

```bash
mkdir -p ~/backup/frp-manager-lite
cp /var/lib/frp-manager-lite/data.sqlite3 ~/backup/frp-manager-lite/data-$(date +%F).sqlite3
cp /etc/frp-manager-lite/env ~/backup/frp-manager-lite/env-$(date +%F)
```

### 恢复

```bash
sudo systemctl stop frp-manager-lite
cp /var/lib/frp-manager-lite/data.sqlite3 /var/lib/frp-manager-lite/data.sqlite3.bak.$(date +%F-%H%M%S)
cp data.sqlite3 /var/lib/frp-manager-lite/data.sqlite3
chown www-data:www-data /var/lib/frp-manager-lite/data.sqlite3
sudo systemctl start frp-manager-lite
```

如果 `FML_DB` 使用了其他路径，请复制到对应路径。

## 12. 升级

```bash
cd /opt/frp-manager-lite
git pull
sudo systemctl restart frp-manager-lite
```

升级前建议备份数据库。

## 13. 常见问题

### 用户能不能自己乱用端口？

面板层面不能选别人的端口；frps 层面需要 HTTP Plugin 才能防止用户绕过面板。

### 换 VPS 用户是否需要改配置？

如果用户 `frpc.toml` 里写的是域名，并且 bindPort/token/端口池不变，一般只需要改 DNS，用户无需改配置。

### 为什么不建议开放 HTTP/HTTPS？

HTTP/HTTPS 很容易被用于搭建公开网站，增加色情、赌博、钓鱼等违法内容风险。建议先只开放 TCP/UDP，域名绑定后续做审核制。
