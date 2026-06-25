# frp-manager-lite

轻量级 frp 多用户管理面板，Python 标准库实现，无 Docker、无第三方依赖。适合做多地区 frps 节点、邀请码注册、每用户固定端口配额的管理面板。

> 当前项目仍是轻量 MVP。正式运营前请务必配置 HTTPS、强管理员密码、备份、frps HTTP Plugin 鉴权、日志保留和投诉处理流程。

## 功能特性

- 前后端分离：后端 JSON API + 静态前端
- SQLite 持久化
- 管理员登录与用户管理
- 用户有效期、启用/停用、续期、重置密码、删除
- 注册密钥/邀请码注册
- 批量生成注册密钥
- 复制密钥、导出未使用可用密钥 CSV
- 多地区 frps 节点管理
- 每个节点独立：地区、节点名、frps 域名/地址、bindPort、token、端口池
- 用户注册时选择地区节点
- 用户只能使用所属节点分配给自己的端口
- 用户下载对应节点的 `frpc.toml`
- 管理员下载每个节点的 `frps.example.toml`
- CSRF 防护
- 登录/注册限速
- 颜色模式：跟随系统 / 深色 / 浅色
- 风控能力：协议白名单、按端口查用户、一键封禁、封禁原因、审计日志
- `/frp-plugin` 接口：用于 frps HTTP Plugin 做用户与端口二次鉴权

## 快速启动

```bash
python3 app.py
```

默认监听：

```text
http://127.0.0.1:8080
```

建议通过环境变量设置管理员密码和节点默认配置：

```bash
FML_HOST=0.0.0.0 \
FML_PORT=18081 \
FML_ADMIN_USER=admin \
FML_ADMIN_PASSWORD='CHANGE_THIS_STRONG_PASSWORD' \
FML_PORT_START=20000 \
FML_PORT_END=20199 \
FRP_SERVER_ADDR='frp.example.com' \
FRP_SERVER_PORT=7000 \
FRP_AUTH_TOKEN='CHANGE_THIS_FRPS_TOKEN' \
python3 app.py
```

> 生产环境必须修改 `FML_ADMIN_PASSWORD` 和 `FRP_AUTH_TOKEN`。

## 典型使用流程

1. 管理员登录面板
2. 添加地区节点，例如 `香港 / hk-1`、`日本 / jp-1`
3. 每个节点设置独立 frps 域名、端口、token、端口池
4. 批量生成注册密钥
5. 用户使用密钥注册并选择地区节点
6. 系统从该节点端口池分配端口给用户
7. 用户创建 TCP/UDP 隧道
8. 用户下载 `frpc.toml`
9. 用户本地运行：

```bash
frpc -c frpc.toml
```

## 多节点与域名迁移建议

节点的 `server_addr` 建议填写稳定域名，例如：

```text
hk.example.com
jp.example.com
us.example.com
```

用户下载的 `frpc.toml` 会写入这个域名。后期更换 VPS 时，优先保持以下内容不变：

- 节点域名
- frps bindPort
- frps token
- 用户端口池

然后只修改 DNS A/AAAA 记录到新 VPS。这样用户通常无需重新下载配置。

## 端口隔离原理

本项目使用“预分配端口”模式：

- 用户创建时，从所属节点端口池取出固定数量端口
- `ports` 表记录 `node_id + port + user_id`
- 用户只能在面板里选择自己名下端口
- 生成的 `frpc.toml` 只包含自己的隧道
- frps HTTP Plugin 可进一步阻止用户绕过面板抢占端口

仅靠面板限制不够，生产环境必须在 frps 上配置 HTTP Plugin。

## 风控建议

默认只允许：

```text
tcp
udp
```

普通用户不建议开放 `http` / `https` / 自定义域名代理，避免被用于违法网站。

后台提供：

- 按端口查询用户
- 一键封禁用户
- 封禁原因记录
- 审计日志

收到投诉时，可根据被投诉端口快速定位用户并封禁。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FML_HOST` | `127.0.0.1` | 面板监听地址 |
| `FML_PORT` | `8080` | 面板监听端口 |
| `FML_DB` | `./data.sqlite3` | SQLite 数据库路径 |
| `FML_ADMIN_USER` | `admin` | 初始管理员用户名 |
| `FML_ADMIN_PASSWORD` | `admin123` | 初始管理员密码，生产必须修改 |
| `FML_PORT_START` | `20000` | 默认节点端口池起始端口 |
| `FML_PORT_END` | `20199` | 默认节点端口池结束端口 |
| `FML_DEFAULT_MAX_PORTS` | `5` | 新用户默认端口数 |
| `FRP_SERVER_ADDR` | `YOUR_FRPS_IP_OR_DOMAIN` | 默认节点 frps 地址 |
| `FRP_SERVER_PORT` | `7000` | 默认节点 frps bindPort |
| `FRP_AUTH_TOKEN` | `CHANGE_ME_SHARED_FRPS_TOKEN` | 默认节点 frps token |

## 项目结构

```text
frp-manager-lite/
├── app.py
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── README.md
├── DEPLOY.md
└── .gitignore
```

## 部署

见 [DEPLOY.md](./DEPLOY.md)。
