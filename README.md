# frp-manager-lite

多地区 frp 管理面板，支持实例售卖、套餐续费、工单客服、母鸡托管和平台收支记账。

## 快速部署

在 Debian/Ubuntu 服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/lite-install/main/deploy-image-production.sh | sudo bash
```

脚本会引导填写面板域名、管理员密码、frps 地址、端口池等信息，自动安装 Docker 和 frps，并生成 `/opt/frp-manager-lite/.env`。

部署完成后访问面板，输入卖方提供的软件授权码完成激活。

完整步骤见 [部署与使用文档](DEPLOY.md)。

## 功能

### 实例与套餐

- 多地区 frps 节点管理
- 一个账号可购买多个实例，隧道、端口、配置相互隔离
- 时间套餐 / 流量套餐 / 组合套餐
- 续费自动累加时长与实付金额
- 退订按剩余比例退款，10 分钟内且未产生流量可全额退

### 托管市场

- 四步托管向导：准则确认 → 母鸡信息 → 设置套餐 → 一键接入
- 每个母鸡独立部署令牌，接入后自动提交审核
- 管理员审核通过后节点与套餐一并上架
- 节点离线超阈值自动停售，恢复在线自动重新上架

### 工单与通知

- 故障工单、提现工单、托管申请三类工单
- 回复、发图、结束/撤销全部在工单内完成
- 站内通知、系统公告
- 用户可配置 21 种推送渠道，按事件订阅

### 财务

- 平台现金账、用户资金账、用户流水
- 收入 / 支出 / 冲正 / 事件四种方向
- 收益转余额、提现打款、提现手续费
- 供给方按服务进度结算，支持保证金

### 运维与安全

- 全量备份 / 恢复，支持 Cloudflare R2
- 节点健康巡检、frps 版本探测
- 移动端适配：抽屉导航、表格横向滚动
- 软件授权：机器指纹绑定 + 定期校验
- 浅色 / 深色 / 系统主题

## 功能模块

| 模块 | 说明 |
|---|---|
| 实例管理 | 购买、续费、退订；按实例隔离端口、隧道、配置 |
| 托管市场 | 提交母鸡、配置套餐、接入平台；管理员审核上架 |
| 工单体系 | 故障 / 提现 / 托管三类工单 |
| 收支表 | 平台资金流水，支持筛选、搜索、冲正 |
| 通知中心 | 站内通知、系统公告、自定义推送 |
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
| `FML_PROVIDER_COMMISSION` | `10` | 供给方保证金比例（%） |
| `FML_PROVIDER_SETTLE_DAYS` | `7` | 供给方结算周期（天） |
| `FML_HSTS_MAX_AGE` | `0` | HSTS 有效期秒数，HTTPS 稳定后开启 |
| `FML_NODE_HEALTH_SAMPLE_SECONDS` | `600` | 节点健康巡检间隔 |
| `FML_SETUP_KEY` | 空 | 添加 frps 节点的验证密钥 |

## 数据与备份

- 数据库：`/data/data.sqlite3`（Docker 卷 `frp-manager-lite-data`）
- 备份：管理端「设置 → 备份与恢复」下载全量 zip
- 恢复：上传 zip 并输入 `RESTORE` 确认
- 备份包含 SMTP、支付、R2 等密钥，请妥善保管

## 授权

授权方式以购买协议为准。
