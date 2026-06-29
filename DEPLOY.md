# frp-manager-lite 部署文档

## 架构概述

```
卖家 VPS（面板）                   买家 VPS（frpc）
┌─────────────────┐              ┌─────────────────┐
│ frp-manager-lite │  ──frps──►  │ frpc            │
│ (面板)           │  ◄─callback │ (用户隧道客户端)  │
│ + frps          │              └─────────────────┘
└─────────────────┘
        │
        ├── frps 节点 1（香港）
        ├── frps 节点 2（东京）
        └── frps 节点 3（洛杉矶）
```

- **面板**：卖家部署，管理用户、隧道、端口
- **frps**：一个面板可管多个 frps 节点（跨地区）
- **frpc**：最终用户下载配置，在自己的机器上运行

## 一、一键部署面板

在一台 Debian/Ubuntu 服务器上，root 执行：

```bash
git clone https://github.com/bohu-t/frp-manager-lite.git
cd frp-manager-lite
sudo bash scripts/deploy-production.sh
```

交互式输入 5 项：

| 步骤 | 说明 | 示例 |
|------|------|------|
| ① 面板域名 | 面板访问地址 | panel.example.com |
| ② frps 域名 | frps 公网地址 | frp.example.com |
| ③ 管理员密码 | 不回显 | ******** |
| ④ frps token | frps 鉴权 token | ******** |
| ⑤ 仪表盘密码 | frps 原生仪表盘 | ******** |

**完成后的产物**：
- 面板：`https://panel.example.com`
- frps 第一个节点：自动启动
- 加密编译的 Docker 镜像

### 环境变量参考

部署后在 `dist/obfuscated/.env` 中可修改配置：

```bash
FML_PUBLISH_BIND=127.0.0.1     # 监听地址
FML_PUBLISH_PORT=18081          # 监听端口
FML_ADMIN_USER=admin            # 管理员用户名
FML_ADMIN_PASSWORD=***          # 管理员密码
FML_PORT_START=20000            # 端口池起始
FML_PORT_END=20199              # 端口池结束
FML_DEFAULT_MAX_PORTS=5         # 新用户默认端口数
FML_SETUP_KEY=***               # 添加 frps 节点的密钥
FRP_SERVER_ADDR=frp.example.com # frps 地址
FRP_SERVER_PORT=7000            # frps 端口
FRP_AUTH_TOKEN=***              # frps token
```

## 二、添加 frps 节点

在新 VPS 上运行，全程交互，零环境变量：

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/frp-manager-lite/main/scripts/add-frps-node.sh -o add-frps-node.sh
bash add-frps-node.sh
```

**需要准备**：
1. 从面板后台 → 设置页 → 复制 `FML_SETUP_KEY`
2. 新 VPS 已开放对应端口（防火墙 / 安全组）

脚本自动完成：
- 向面板注册节点
- 下载安装 frps
- 生成配置文件
- 创建 systemd 服务并启动

## 三、卖家日常操作

### 3.1 激活软件授权（首次）

部署后访问面板，输入卖家给你的鉴权地址和授权码。只激活一次，之后永久免检。

### 3.2 创建注册密钥

面板后台 → 注册密钥 → 新建：
- **密钥**：自动生成，发给用户
- **端口配额**：每个用户拿到几个端口
- **有效期**：密钥本身的有效期

### 3.3 用户注册

用户拿到邀请码后访问面板自行注册，选择地区节点。

### 3.4 用户配置隧道

1. 用户登录面板 → 添加代理隧道
2. 用户下载 `frpc.toml`（自动生成，无需修改）
3. 用户在自己机器上运行 `frpc -c frpc.toml`

### 3.5 用户管理

面板后台 → 用户列表：
- 查看端口/隧道使用情况
- 续期/停用/删除用户
- 停用用户后，所有 frps 节点即时拒绝该用户连接（通过 `/frp-plugin` 回调面板验权）

## 四、最终用户操作

用户拿到注册密钥后：

```bash
# 1. 注册账号（浏览器访问面板）

# 2. 下载 frps（首次）
wget https://github.com/fatedier/frp/releases/download/v0.66.0/frp_0.66.0_linux_amd64.tar.gz
tar xzf frp_*.tar.gz
sudo cp frp_*/frpc /usr/local/bin/

# 3. 下载配置（面板 → 下载 frpc.toml）
# 4. 运行
frpc -c frpc.toml
```

frpc.toml 配置示例：

```toml
serverAddr = "frp.example.com"
serverPort = 7000

auth.token = "VGp..."
user = "myuser"
metadatas.panelToken = "dHNR..."
metadatas.licenseKey = "LIC-..."

[[proxies]]
name = "my_web"
type = "tcp"
localIP = "127.0.0.1"
localPort = 80
remotePort = 20000
```

## 五、鉴权服务（可选）

如果你需要卖部署版授权码给其他卖家，部署独立的鉴权服务：

```bash
cd license-authority
export LCA_LICENSE_SECRET="$(openssl rand -base64 32)"
export LCA_API_KEY="$(openssl rand -base64 24)"
export LCA_PORT=8200
python3 server.py
```

然后在面板 `.env` 中配置：

```bash
FML_SOFTWARE_LICENSE_SERVER_URL=https://license.example.com
```

## 六、常用命令

```bash
# 面板管理
cd /root/frp-manager-lite/dist/obfuscated
docker compose ps            # 查看状态
docker compose logs -f       # 查看日志
docker compose restart       # 重启
docker compose down && docker compose up -d --build  # 更新重构建

# frps 节点管理
systemctl status frps-*      # 查看所有节点
systemctl restart frps-hk-01 # 重启某个节点
journalctl -u frps-hk-01 -f  # 查看节点日志

# 更新面板
cd /root/frp-manager-lite
git pull
python3 tools/build-obfuscated.py --no-docker
cp .env dist/obfuscated/.env
cd dist/obfuscated && docker compose down && docker compose up -d --build
```

## 七、安全建议

1. 面板必须挂 HTTPS（Nginx/Caddy 反代 + Let's Encrypt）
2. `FML_SETUP_KEY` 部署后不要泄露
3. frps 仪表盘建议仅监听 127.0.0.1
4. 定期备份 `dist/obfuscated/` 目录下的 `.env` 和 Docker volume 数据
