# frp-manager-lite 部署文档

本文档说明如何把 frp-manager-lite 部署到生产服务器，并连接一个或多个 frps 节点。

推荐部署方式：**Docker Compose + Nginx/Caddy HTTPS 反向代理**。

> 生产环境不要使用默认密码、默认 frps token 或未加密 HTTP 暴露公网。上线前请确认 HTTPS、备份、frps HTTP Plugin 鉴权、投诉处理流程都已配置。

## 1. 部署架构

典型架构：

```text
用户浏览器 / frpc
        │
        ├── HTTPS → panel.example.com → Nginx/Caddy → frp-manager-lite:8080
        │
        └── frpc  → hk.example.com:7000 → frps 节点
                                      │
                                      └── HTTP Plugin → panel.example.com/frp-plugin
```

组件职责：

- **frp-manager-lite**：账号、注册密钥、节点、端口池、隧道配置、风控、备份、软件授权。
- **frps 节点**：实际承载 frp 流量，可多地区、多台 VPS。
- **Nginx/Caddy**：负责 HTTPS、域名、反向代理。
- **frps HTTP Plugin**：生产必配，用于阻止用户绕过面板手写 `frpc.toml` 抢端口或绕过授权。

## 2. 准备环境

服务器要求：

- Linux VPS，推荐 Ubuntu 22.04+/Debian 12+
- Docker + Docker Compose v2
- 一个面板域名，例如 `panel.example.com`
- 一个或多个 frps 节点域名，例如 `hk.example.com`、`jp.example.com`

检查 Docker：

```bash
docker --version
docker compose version
```

安装 Docker 可参考官方文档：<https://docs.docker.com/engine/install/>

## 3. 获取代码

```bash
git clone https://github.com/bohu-t/frp-manager-lite.git
cd frp-manager-lite
```

如果通过 GitHub Release / ZIP 上传，也进入解压后的项目目录即可。

## 4. Docker Compose 部署（推荐）

### 4.1 创建配置

```bash
cp .env.example .env
nano .env
```

至少修改以下项：

```bash
FML_ADMIN_USER=admin
FML_ADMIN_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
FRP_SERVER_ADDR=hk.example.com
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=CHANGE_THIS_FRPS_TOKEN
```

默认 Compose 将面板发布到宿主机本地：

```bash
FML_PUBLISH_PORT=18081
```

也就是：

```text
http://127.0.0.1:18081
```

这样面板不会直接暴露公网，后面用 Nginx/Caddy 反代 HTTPS。

### 4.2 启动

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f
```

首次启动会自动初始化 SQLite 数据库、默认管理员和默认节点。

### 4.3 数据持久化

Docker 部署默认设置：

```bash
FML_DB=/data/data.sqlite3
```

SQLite 数据存放在 Docker 命名卷：

```text
frp-manager-lite-data
```

查看卷：

```bash
docker volume inspect frp-manager-lite_frp-manager-lite-data
```

### 4.4 基础镜像

Dockerfile 默认使用：

```text
python:3.13.5-slim-bookworm
```

如果你的环境需要 Python 3.11，可改用：

```bash
docker compose build --build-arg PYTHON_IMAGE=python:3.11.9-slim-bookworm
docker compose up -d
```

## 5. Nginx HTTPS 反向代理

推荐保留 Compose 的本机绑定：

```yaml
ports:
  - "127.0.0.1:${FML_PUBLISH_PORT:-18081}:8080"
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

然后用 Certbot / acme.sh / 1Panel / 宝塔等方式签发 HTTPS。

如果你使用 Caddy：

```caddyfile
panel.example.com {
    reverse_proxy 127.0.0.1:18081
}
```

## 6. frps 节点部署

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

管理员后台可以下载对应节点的 `frps.example.toml`。

基础 frps 配置示例：

```toml
bindPort = 7000
auth.method = "token"
auth.token = "CHANGE_THIS_FRPS_TOKEN"

allowPorts = [
  { start = 20000, end = 20199 }
]
```

`allowPorts` 很重要，它限制 frps 节点只能使用你分配的端口池。

## 7. frps HTTP Plugin 鉴权（生产必配）

只靠面板限制不够，用户仍可能手写 `frpc.toml` 连接 frps。生产环境必须启用 frps HTTP Plugin。

示例，字段请按你的 frp 版本文档校准：

```toml
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "panel.example.com:443"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]
```

如果 frps 和面板在同一台机器或内网，也可以走内网地址：

```toml
[[httpPlugins]]
name = "frp-manager-lite-auth"
addr = "127.0.0.1:18081"
path = "/frp-plugin"
ops = ["Login", "NewProxy"]
```

面板 `/frp-plugin` 会校验：

- 用户是否存在、启用、未过期
- 用户 `panelToken` 是否正确
- 用户授权码 `licenseKey` 是否正确
- `machineId` 是否存在，首次鉴权会自动绑定机器
- 已绑定用户是否换机器使用
- TCP/UDP remote port 是否属于该用户

用户下载的 `frpc.toml` 会包含：

```toml
metadatas.panelToken = "..."
metadatas.licenseKey = "..."
metadatas.machineId = "CHANGE_ME_DEVICE_ID"
```

要求用户把 `CHANGE_ME_DEVICE_ID` 改成本机唯一标识，例如服务器主机名、设备序列号或随机 UUID。首次通过鉴权后会绑定该机器。

## 8. 协议与隧道类型

当前支持的 frp proxy type：

```text
tcp / udp / http / https / stcp / xtcp / tcpmux
```

规则：

- `tcp` / `udp`：必须选择已分配公网端口。
- `http` / `https` / `tcpmux`：使用自定义域名，不占用 remote port；需要 frps 配好对应 vhost/tcpmux 能力。
- `stcp` / `xtcp`：使用 `secretKey`，不占用 remote port。

生产风控建议：

- 普通用户优先只开放 TCP/UDP。
- HTTP/HTTPS/TCPMUX 容易被用于公开网站，建议审核制开放。
- 收到投诉时，用后台“风控”按端口查询用户并封禁。

## 9. 软件授权部署模式（可选）

面板支持“部署版软件授权码”，适合卖家给客户部署版面板授权。

### 9.1 授权服务器模式

在授权服务器 `.env` 中开启：

```bash
FML_LICENSE_AUTHORITY=1
FML_SOFTWARE_LICENSE_SECRET=CHANGE_THIS_LONG_RANDOM_SECRET
```

启动后，管理员后台会出现“部署版软件授权码”，可批量生成授权码发给客户。

### 9.2 客户部署版模式

客户部署的面板配置：

```bash
FML_LICENSE_SERVER_URL=https://license.example.com
FML_SOFTWARE_LICENSE_SECRET=CHANGE_THIS_LONG_RANDOM_SECRET
FML_SOFTWARE_LICENSE_REQUIRED=1
```

客户首次打开面板时输入授权码，系统会自动绑定当前服务器机器指纹。

注意：

- 授权服务器和客户部署版必须使用相同 `FML_SOFTWARE_LICENSE_SECRET`，否则签名校验失败。
- `FML_LICENSE_SERVER_URL` 配置后会自动要求软件授权。
- 授权码可在授权服务器后台停用或解绑。

## 10. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FML_HOST` | `127.0.0.1` / Docker 中 `0.0.0.0` | 面板监听地址 |
| `FML_PORT` | `8080` | 面板监听端口 |
| `FML_DB` | `./data.sqlite3` / Docker 中 `/data/data.sqlite3` | SQLite 数据库路径 |
| `FML_ADMIN_USER` | `admin` | 初始管理员用户名 |
| `FML_ADMIN_PASSWORD` | `admin123` | 初始管理员密码，生产必须修改 |
| `FML_PORT_START` | `20000` | 默认节点端口池起始端口 |
| `FML_PORT_END` | `20199` | 默认节点端口池结束端口 |
| `FML_DEFAULT_MAX_PORTS` | `5` | 新用户默认端口数 |
| `FRP_SERVER_ADDR` | `YOUR_FRPS_IP_OR_DOMAIN` | 默认节点 frps 地址 |
| `FRP_SERVER_PORT` | `7000` | 默认节点 frps bindPort |
| `FRP_AUTH_TOKEN` | `CHANGE_ME_SHARED_FRPS_TOKEN` | 默认节点 frps token |
| `FML_SOFTWARE_LICENSE_SECRET` | 空 | 软件授权签名密钥 |
| `FML_LICENSE_SERVER_URL` | 空 | 软件授权服务器地址 |
| `FML_LICENSE_AUTHORITY` | `0` | 是否作为授权码签发服务器 |
| `FML_SOFTWARE_LICENSE_REQUIRED` | `0` | 是否强制客户部署版激活授权 |
| `R2_ACCOUNT_ID` | 空 | Cloudflare R2 Account ID |
| `R2_ACCESS_KEY_ID` | 空 | R2 S3 API Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 空 | R2 S3 API Secret Access Key |
| `R2_BUCKET` | 空 | R2 bucket 名称 |
| `R2_PREFIX` | `frp-manager-lite/backups` | R2 备份对象前缀 |

## 11. 备份与恢复

### 11.1 后台全量备份

管理员后台提供“全量备份”，下载地址：

```text
/admin/backup/full.zip
```

ZIP 内包含：

- `data.sqlite3`：SQLite 完整数据库快照
- `dump.sql`：SQL 文本转储
- `metadata.json`：备份元信息
- `RESTORE.md`：恢复说明

备份包含用户 token、注册密钥、软件授权码、会话、审计日志等敏感数据，请妥善保存。

### 11.2 Docker 命令行备份

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

### 11.3 Docker 恢复

```bash
docker compose down
docker run --rm \
  -v frp-manager-lite_frp-manager-lite-data:/data \
  -v "$PWD:/restore" \
  alpine sh -c 'cp /data/data.sqlite3 /data/data.sqlite3.bak.$(date +%F-%H%M%S) 2>/dev/null || true; cp /restore/data.sqlite3 /data/data.sqlite3; chown 10001:10001 /data/data.sqlite3'
docker compose up -d
```

如果 Compose 项目名不同，卷名可能不是 `frp-manager-lite_frp-manager-lite-data`，可用 `docker volume ls` 查看。

### 11.4 上传到 Cloudflare R2

配置：

```bash
R2_ACCOUNT_ID=你的 Cloudflare Account ID
R2_ACCESS_KEY_ID=R2 S3 API Access Key ID
R2_SECRET_ACCESS_KEY=R2 S3 API Secret Access Key
R2_BUCKET=你的 bucket 名称
R2_PREFIX=frp-manager-lite/backups
```

后台会显示“备份到 R2”。建议创建专用 R2 S3 凭证，只给目标 bucket 的对象写入权限。

## 12. 升级

Docker 部署升级：

```bash
git pull
docker compose up -d --build
```

systemd/直接部署升级：

```bash
cd /opt/frp-manager-lite
git pull
sudo systemctl restart frp-manager-lite
```

升级前建议先下载一次全量备份。

## 13. 直接运行 / systemd 部署（可选）

如果不用 Docker，也可以直接运行。要求 Python 3.10+，无第三方依赖。

### 13.1 环境文件

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

数据目录：

```bash
sudo mkdir -p /var/lib/frp-manager-lite
sudo chown -R www-data:www-data /var/lib/frp-manager-lite
```

### 13.2 systemd 服务

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

启用：

```bash
sudo mkdir -p /opt
sudo cp -r . /opt/frp-manager-lite
sudo chown -R www-data:www-data /opt/frp-manager-lite /var/lib/frp-manager-lite
sudo systemctl daemon-reload
sudo systemctl enable --now frp-manager-lite
sudo systemctl status frp-manager-lite
```

日志：

```bash
journalctl -u frp-manager-lite -f
```

## 14. 常见问题

### 面板能不能直接暴露公网？

不建议。推荐只监听本机端口，通过 HTTPS 反代访问。

### 用户能不能自己乱用端口？

面板层面不能选别人的端口；frps 层面必须配置 HTTP Plugin 才能防止用户绕过面板。

### 换 VPS 用户是否需要改配置？

如果用户 `frpc.toml` 里写的是域名，并且 bindPort/token/端口池不变，一般只需要改 DNS，用户无需改配置。

### 为什么不建议开放 HTTP/HTTPS？

HTTP/HTTPS 很容易被用于搭建公开网站，增加色情、赌博、钓鱼等违法内容风险。建议审核制开放。

### `.env` 可以提交到 GitHub 吗？

不可以。`.env` 包含管理员密码、frps token、R2 密钥和授权密钥，必须只保存在部署服务器。仓库只提交 `.env.example`。
