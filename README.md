# frp-manager-lite

轻量级 frp 多用户管理面板。Python 标准库实现，零第三方依赖。

**适用场景**：多地区 frps 节点管理、邀请码注册、每用户固定端口配额、一键下载 frpc 配置。

## 快速开始

### 推荐：镜像版一键生产部署（面板 + frps + Nginx/HTTPS）

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/lite-install/main/deploy-image-production.sh | sudo bash
```

这个脚本会先询问面板域名/端口/管理员密码、frps 域名/端口/token/端口池等信息，统一生成 `/opt/frp-manager-lite/.env`，然后所有部署配置都从 `.env` 读取。它会安装 Docker、拉取预构建面板镜像、安装 frps 0.66、可选配置 Nginx 和 Let's Encrypt HTTPS。用户服务器不需要源码，也不需要本地构建镜像。HTTPS 端口默认 443；如果 443 被占用，脚本会让用户选择其它端口，例如 8443。

### 公开安装脚本仓库

源码仓库保持私有；公开一键安装脚本放在：

```text
https://github.com/bohu-t/lite-install
```

默认部署到 `/opt/frp-manager-lite`，镜像来自阿里云 ACR 公开仓库：

```text
registry.cn-hangzhou.aliyuncs.com/dxlx/frp-manager-lite:latest
```

升级：

```bash
cd /opt/frp-manager-lite
sudo docker compose pull
sudo docker compose up -d
```

### 源码部署/开发部署

```bash
git clone https://github.com/bohu-t/frp-manager-lite.git
cd frp-manager-lite
sudo bash scripts/deploy-production.sh
```

5 个问题答完即可访问面板。

## 文档

- 📖 [完整部署文档](DEPLOY.md) — 面板部署、添加 frps 节点、卖家日常操作、最终用户使用

## 项目结构

```
frp-manager-lite/
├── app.py              # 主服务（无依赖，纯标准库）
├── frontend/           # 前端（SaaS 风格 UI）
├── scripts/
│   ├── deploy-image-production.sh # 镜像版一键生产部署
│   ├── install-image.sh           # 仅部署面板镜像
│   ├── deploy-production.sh       # 源码/本地构建部署脚本
│   └── add-frps-node.sh           # 一键添加 frps 节点
├── tools/
│   └── build-obfuscated.py    # 代码编译加密工具
└── docker-compose.yml  # 开发环境
```

## 特性

- ✅ 一键部署（预构建 Docker 镜像 / Docker Compose）
- ✅ 多地区 frps 节点管理 + 一键添加
- ✅ 邀请码注册 + 端口配额
- ✅ 用户到期自动停用（所有节点即时生效）
- ✅ 一键下载 frpc.toml（零配置）
- ✅ 代码加密编译（生产环境保护）
- ✅ 服务器软件授权激活（向卖家的鉴权服务器激活 + 机器指纹绑定 + 定期静默校验，停用/解绑可下发）
- ✅ SaaS 风格管理后台（浅色/深色/系统三模式）

## 许可

MIT
