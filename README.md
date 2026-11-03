# frp-manager-lite

轻量级 frp 多用户管理面板。Python 标准库实现，零第三方依赖。

**适用场景**：多地区 frps 节点管理、实例售卖与续费、母鸡托管市场、工单客服、平台收支记账，按实例生成 frpc 配置。

## 快速开始

### 推荐：镜像版一键生产部署（面板 + frps + Nginx/HTTPS）

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/lite-install/main/deploy-image-production.sh | sudo bash
```

这个脚本会先询问面板域名/端口/管理员密码、frps 域名/端口/token/端口池等信息，统一生成 `/opt/frp-manager-lite/.env`，然后所有部署配置都从 `.env` 读取。它会安装 Docker、拉取预构建面板镜像、安装 frps 0.66、可选配置 Nginx 和 Let's Encrypt HTTPS。用户服务器不需要源码，也不需要本地构建镜像。HTTPS 端口默认 443；如果 443 被占用，脚本会让用户选择其它端口，例如 8443。

### 公开安装脚本仓库

源码仓库：https://github.com/bohu-t/frp-manager-lite；一键安装脚本放在：

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

- 📖 [完整部署文档](DEPLOY.md) — 面板部署、添加 frps 节点、管理员日常操作、用户侧使用

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

### 接入与实例

- ✅ 一键部署（预构建 Docker 镜像 / Docker Compose）
- ✅ 多地区 frps 节点管理，一键生成节点部署脚本
- ✅ 一个账号可购买多个实例，实例之间隧道、端口、配置完全隔离
- ✅ 按实例生成 frpc.toml 与部署脚本，在线配置草稿按实例独立保存
- ✅ 端口池按节点分配，退订立即回收，下一位用户可以马上使用
- ✅ 时间套餐 / 流量套餐 / 组合套餐，续费自动累加时长与实付金额
- ✅ 退订按「累计实付 × 剩余比例」退款，10 分钟内且未产生流量可全额退

### 托管（母鸡）

- ✅ 四步托管向导：准则确认 → 母鸡信息 → 设置套餐 → 一键接入脚本
- ✅ 每个母鸡独立部署令牌，接入后自动提交审核
- ✅ 管理员审核通过后节点与套餐一并上架
- ✅ 节点离线超阈值自动停售，恢复在线自动重新上架
- ✅ 托管申请本身即工单，审核过程可对话留痕

### 工单与通知

- ✅ 三类工单：故障工单、提现工单、托管申请
- ✅ 列表只做展示，所有操作在工单内部完成（回复、发图、结束/撤销）
- ✅ 状态按颜色区分：待处理琥珀 / 处理中蓝 / 已关闭绿 / 已拒绝红
- ✅ 站内通知中心：通知 + 系统公告双页签，查看后自动已读
- ✅ 系统通知固定模板（新工单、工单回复、提现申请、打款、驳回等）
- ✅ 普通用户可自建通知渠道（21 种：Bark、Telegram、钉钉、企业微信、Server 酱、WxPusher 等），按事件订阅

### 财务

- ✅ 统一收支流水表（`ledger`），收入 / 支出 / 冲正 / 事件四种方向
- ✅ 收益转余额只记事件不计收支；提现驳回记冲正抵扣支出
- ✅ 金额统一以元计，保留两位小数
- ✅ 供给方按服务进度结算，10% 留存保证金
- ✅ 提现走工单：管理员在工单内标记已打款或拒绝，处理完自动关单；提现手续费比例可在支付设置中配置

### 运维与安全

- ✅ 全量备份 / 恢复（zip：数据库快照 + SQL dump + 元信息 + 恢复说明），恢复前自动留底
- ✅ Cloudflare R2 备份上传
- ✅ 节点健康巡检、frps 版本探测（dashboard serverinfo）
- ✅ 移动端适配：侧栏抽屉导航、表格横向滚动
- ✅ 服务器软件授权激活（机器指纹绑定 + 定期静默校验）
- ✅ SaaS 风格管理后台（浅色/深色/系统三模式）

## 功能模块

| 模块 | 说明 |
|---|---|
| 实例管理 | 用户购买、续费、退订；按实例隔离端口、隧道、配置 |
| 托管市场 | 用户提交母鸡、配置套餐、接入平台；管理员审核上架 |
| 工单体系 | 故障 / 提现 / 托管三类工单，内部沟通与处理 |
| 收支表 | 平台资金流水，支持筛选、搜索、逐笔方向与冲正 |
| 通知中心 | 站内通知、系统公告、用户自定义推送渠道 |
| 节点运维 | 健康巡检、离线停售、版本探测、端口池管理 |
| 备份恢复 | 全量 zip 备份、R2 上传、一键恢复 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FML_HOST` / `FML_PORT` | `127.0.0.1` / `8080` | 面板监听地址与端口 |
| `FML_DB` | `data.sqlite3` | SQLite 数据库路径 |
| `FML_ADMIN_USER` / `FML_ADMIN_PASSWORD` | `admin` / `admin123` | 管理员账号，生产务必改密码 |
| `FML_OPEN_REGISTRATION` | `0` | `1` 开放邮箱验证码注册（需配 SMTP）；`0` 关闭自助注册，由管理员建号 |
| `FML_OPEN_REGISTRATION_EXPIRES_DAYS` | `30` | 开放注册用户的默认有效期天数 |
| `FML_DEFAULT_MAX_PORTS` | `10` | 新用户默认端口数 |
| `FML_PORT_START` / `FML_PORT_END` | `20000` / `20199` | 默认端口池范围 |
| `FML_ALLOW_MOCK_PAY` | `0` | `1` 开启测试支付（仅开发环境） |
| `FML_FULL_REFUND_MINUTES` | `10` | 全额退款窗口（分钟） |
| `FML_PLAN_GRACE_HOURS` | `0` | 套餐到期后端口保留小时数，`0` 立即回收 |
| `FML_NODE_OFFLINE_SUSPEND_HOURS` | `6` | 节点离线多久自动停售 |
| `FML_MAX_PLANS_PER_NODE` | `2` | 预留配置，当前版本未参与实例数量限制 |
| `FML_PROVIDER_COMMISSION` | `10` | 供给方保证金比例（%） |
| `FML_PROVIDER_SETTLE_DAYS` | `7` | 供给方结算周期（天） |
| `FML_HSTS_MAX_AGE` | `0` | HSTS 有效期秒数，HTTPS 稳定后开启 |
| `FML_NODE_HEALTH_SAMPLE_SECONDS` | `600` | 节点健康巡检间隔 |
| `FML_SETUP_KEY` | 空 | 一键添加 frps 节点的验证密钥 |

## 数据与备份

- 数据库：`/data/data.sqlite3`（Docker 卷 `frp-manager-lite-data`）
- 备份：管理端「设置 → 备份」可下载全量 zip（含 `data.sqlite3`、`dump.sql`、`metadata.json`、`RESTORE.md`）
- 恢复：上传 zip 并输入 `RESTORE` 确认，系统会自动把当前库另存到 `restore-backups/` 后再替换
- 注意：备份包含 SMTP、支付、R2、Bncr 等密钥，请勿外传

## 许可

MIT
