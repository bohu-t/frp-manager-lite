# 鉴权服务器 (License Authority)

给 frp-manager-lite 客户签发和验证软件授权码的独立服务。

## 快速开始

```bash
cd license-authority

# 1. 配置密钥
export LCA_LICENSE_SECRET=$(openssl rand -base64 32)   # 授权签名密钥
export LCA_API_KEY=$(openssl rand -base64 24)           # 管理 API 密钥
export LCA_PORT=8200

# 2. 启动
python3 server.py
```

打开 `http://服务器IP:8200`，先在设置页填入 `LCA_API_KEY`，即可生成授权码。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LCA_HOST` | `127.0.0.1` | 监听地址 |
| `LCA_PORT` | `8200` | 监听端口 |
| `LCA_API_KEY` | 空 | 管理接口 API Key（不设置则管理接口无保护） |
| `LCA_LICENSE_SECRET` | 空 | 授权签名密钥，**必须与客户面板的 `FML_SOFTWARE_LICENSE_SECRET` 一致** |
| `LCA_ALLOWED_APPS` | `frp-manager-lite` | 允许激活的应用名（逗号分隔） |
| `LCA_DB` | `license.sqlite3` | 数据库路径 |
| `LCA_MAX_KEYS_PER_REQUEST` | `100` | 单次批量生成上限 |

## API

### 公共接口

`POST /api/license/activate` — 客户面板激活时调用

```json
{"license_key": "FMLD-XXX", "machine_id": "abc123...", "app": "frp-manager-lite"}
```

### 管理接口（需 Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/stats` | 统计概览 |
| `GET` | `/api/admin/keys` | 授权码列表 |
| `POST` | `/api/admin/keys/generate` | 批量生成授权码 |
| `POST` | `/api/admin/keys/toggle` | 启用/停用授权码 |
| `POST` | `/api/admin/keys/unbind` | 解绑机器 |

## 生产部署

建议用 Nginx 反代 + Let's Encrypt：

```nginx
server {
    listen 443 ssl;
    server_name license.example.com;

    ssl_certificate     /etc/letsencrypt/live/license.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/license.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 客户面板配置

客户部署 frp-manager-lite 后，在激活页填入：

- **鉴权服务器地址**：`https://license.example.com`
- **软件授权码**：卖家生成的 `FMLD-XXX`

或在客户面板 `.env` 中预设：

```bash
FML_SOFTWARE_LICENSE_REQUIRED=1
FML_SOFTWARE_LICENSE_SERVER_URL=https://license.example.com
FML_SOFTWARE_LICENSE_SECRET=与 LCA_LICENSE_SECRET 一致
```
