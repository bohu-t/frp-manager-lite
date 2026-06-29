# frp-manager-lite

轻量级 frp 多用户管理面板。Python 标准库实现，零第三方依赖。

**适用场景**：多地区 frps 节点管理、邀请码注册、每用户固定端口配额、一键下载 frpc 配置。

## 快速开始

### 推荐：预构建 Docker 镜像部署（不在用户服务器构建源码）

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/frp-manager-lite/main/scripts/install-image.sh | sudo bash
```

默认部署到 `/opt/frp-manager-lite`，镜像来自：

```text
ghcr.io/bohu-t/frp-manager-lite:latest
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
- 🔑 `license-authority/` — 独立的软件授权服务（可选）

## 项目结构

```
frp-manager-lite/
├── app.py              # 主服务（无依赖，纯标准库）
├── frontend/           # 前端（SaaS 风格 UI）
├── scripts/
│   ├── deploy-production.sh   # 一键部署脚本
│   └── add-frps-node.sh       # 一键添加 frps 节点
├── tools/
│   └── build-obfuscated.py    # 代码编译加密工具
├── license-authority/  # 独立鉴权服务（可选）
└── docker-compose.yml  # 开发环境
```

## 特性

- ✅ 一键部署（预构建 Docker 镜像 / Docker Compose）
- ✅ 多地区 frps 节点管理 + 一键添加
- ✅ 邀请码注册 + 端口配额
- ✅ 用户到期自动停用（所有节点即时生效）
- ✅ 一键下载 frpc.toml（零配置）
- ✅ 代码加密编译（生产环境保护）
- ✅ 软件授权激活（可选，卖部署版用）
- ✅ SaaS 风格管理后台（浅色/深色/系统三模式）

## 许可

MIT
