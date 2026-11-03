# frp-manager-lite 部署与使用文档

本文档说明面板部署、节点接入、管理员和用户日常使用。

## 一、部署前准备

- 一台 Debian/Ubuntu 服务器，root 权限
- 一个已解析到服务器的域名（面板用）
- 放行端口：80/443、frps 入口端口（默认 7000）、用户端口池（默认 20000-20199）TCP/UDP
- 如果面板和第一个 frps 部署在同一台机器，上述端口在同一台服务器放行即可

## 二、部署面板

在服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/lite-install/main/deploy-image-production.sh | sudo bash
```

脚本会依次询问：

| 步骤 | 说明 | 默认 |
|---|---|---|
| ① 面板域名 | 留空则不装 Nginx/HTTPS，面板直接监听端口 | 空 |
| ② 面板映射端口 | 容器对外端口 | 18081 |
| ③ 面板 HTTPS 端口 | 仅填域名时询问，443 被占用可填 8443 | 443 |
| ④ frps 域名/IP | 用户 frpc 连接的地址 | 面板域名或公网 IP |
| ⑤ frps 入口端口 | bindPort | 7000 |
| ⑥⑦ 端口池起止 | 用户隧道端口范围 | 20000 / 20199 |
| ⑧ frps 仪表盘端口 | 节点 dashboard 端口 | 7500 |
| ⑨ 管理员用户名 | 登录面板用 | admin |
| ⑩⑪⑫ 密码/token | 管理员密码、frps token、仪表盘密码 | 回车自动生成 |

脚本会安装 Docker、拉取面板镜像、安装 frps，并写入 `/opt/frp-manager-lite/.env`；填了域名时会配置 Nginx 和 Let's Encrypt HTTPS。

完成后访问面板地址，第一次打开会要求输入**软件授权码**。授权码由卖方提供，输入后完成激活；授权码绑定当前机器，保留数据卷重装无需重复激活。

### 可选配置

面板配置在 `/opt/frp-manager-lite/.env`，修改后执行：

```bash
cd /opt/frp-manager-lite
docker compose up -d
```

常用配置：

```bash
FML_PUBLISH_BIND=127.0.0.1       # 面板监听地址，一般交给 Nginx 反代
FML_PUBLISH_PORT=18081
FML_ADMIN_USER=admin
FML_ADMIN_PASSWORD=***           # 生产务必修改
FML_HSTS_MAX_AGE=0               # HTTPS 稳定后再开，例如 63072000

FML_OPEN_REGISTRATION=1          # 1=邮箱验证码注册（需先配 SMTP）；0=管理员建号
FML_OPEN_REGISTRATION_EXPIRES_DAYS=30
FML_DEFAULT_MAX_PORTS=10
FML_PORT_START=20000
FML_PORT_END=20199

FML_ALLOW_MOCK_PAY=0
FML_FULL_REFUND_MINUTES=10
FML_PLAN_GRACE_HOURS=0
FML_PROVIDER_COMMISSION=10
FML_PROVIDER_SETTLE_DAYS=7

FML_SETUP_KEY=***                # 添加节点用，面板生成脚本时自动带上
FML_NODE_OFFLINE_SUSPEND_HOURS=6
FML_NODE_HEALTH_SAMPLE_SECONDS=600
FRP_SERVER_ADDR=frp.example.com
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=***
```

### 升级面板

```bash
cd /opt/frp-manager-lite
cp .env .env.bak-$(date +%F-%H%M%S)
docker compose pull
docker compose up -d
```

升级前建议在面板「设置 → 备份与恢复」下载一份全量备份。

## 三、添加 frps 节点

管理员登录 → 侧边栏「新增节点」→ 填写表单 → 点「创建节点」。

这一步不会立刻创建节点，而是生成一条一键命令。把命令复制到新 VPS 上以 root 执行，节点才会接入面板。

**表单字段**

| 字段 | 说明 |
|---|---|
| 地区 | 例如 河南 / 香港 / 美国 |
| 节点名 | 字母、数字、下划线、短横线，1-40 位 |
| frps 域名/地址 | 用户 frpc 连接的地址，建议用域名 |
| frps bindPort | 默认 7000 |
| frps token | 自动生成，至少 6 位 |
| 带宽（Mbps） | 0 表示不限 |
| 月流量上限（GB） | 0 表示不限 |
| 服务器到期时间 | 可留空 |
| frps 版本 | 可留空，能连 dashboard 时自动读取 |
| 端口起始/结束 | 默认 20000/20199，单节点最多约 2 万个 |
| frp 版本 | 稳定版 / 最新版 / 自定义 |
| 备注 | 展示给用户的线路或合规提示 |

脚本会在新节点上安装 frps、写入配置、注册 systemd 服务，并把节点注册到面板。完成后节点出现在「新增节点」页下方列表，状态正常即可使用。

**节点列表操作**

- 编辑、停用/启用、下载 frps 配置、删除
- 停用节点会按剩余价值退款并回收该节点下的套餐
- 删除前需要先清空该节点的用户和隧道

## 四、管理员使用

侧边栏结构：

```
运行总览 / 用户管理 / 新增节点 / 套餐 / 订单收支（订单、收支表）
技术支持（故障工单、提现工单、托管申请）
节点健康 / 映射监控 / 风控审计 / 平台维护 / 设置
```

### 4.1 运行总览

- 端口使用率每 10 秒刷新
- 收支分析，可切换今天 / 7 天 / 30 天 / 90 天
- 节点在线数、用户数和快捷操作

### 4.2 用户管理

创建用户：用户名、初始密码、邮箱、接入节点、端口数量、今日流量上限、速率策略、有效期天数。

用户列表支持按用户名/ID、节点、状态筛选；操作包括停用/启用、流量限制、重置密码、重置令牌、调余额、设邮箱、删除。

### 4.3 套餐管理

新增/编辑套餐：名称、价格、适用节点、计费方式、有效期、端口数、流量额度、速率、排序、备注、公平使用说明。

保存即上架；列表里可编辑、下架、删除。

### 4.4 订单与收支表

- **订单**：按状态、类型、关键字筛选；待支付订单可手动开通
- **收支表**：平台现金账、用户资金账、用户流水三本账；支持时间范围、类型、单号/用户/备注搜索

### 4.5 技术支持

| 工单 | 管理员操作 |
|---|---|
| 故障工单 | 回复、发图、结束工单 |
| 提现工单 | 已打款 / 拒绝、回复、结束 |
| 托管申请 | 通过审核 / 拒绝 / 拉黑、回复 |

### 4.6 节点运维

- **节点健康**：连通性、延迟、端口使用、带宽、dashboard 状态
- **映射监控**：隧道实时状态、今日流量、连接数
- **风控审计**：按公网端口定位用户并封禁；查看审计日志

### 4.7 平台维护

- 系统公告：发布「系统公告」或「通知」
- 充值密钥：批量生成、启用/停用、删除

### 4.8 设置

支付设置（支付宝/微信、回调地址、退订手续费、提现手续费）、邮件（SMTP）、通知设置、备份与恢复、Cloudflare R2、系统信息。

## 五、用户使用

### 5.1 注册与登录

- 开放注册时：用户名 + 密码 + 邮箱验证码注册
- 关闭开放注册时：由管理员创建账号
- 忘记密码：用户名 + 邮箱验证码重置

### 5.2 新建实例

侧边栏「新建实例」，五步：

1. 选择地区
2. 选择实例
3. 选择配置（时间 / 流量 / 组合套餐）
4. 实例配置（填写隧道名称、协议、本地地址、本地端口、公网端口）
5. 支付开通

右侧订单摘要会显示时长、端口、流量、隧道数和应付金额。

### 5.3 我的实例

点进实例可以：

- 查看隧道状态、今日流量、复制公网地址
- 新建隧道、下载配置、在线配置
- 延期、开启自动延期、退订

下载的 `frpc.toml` 只包含当前实例的隧道。

### 5.4 frpc 使用

实例详情 →「下载配置」：

- `frpc.toml`：覆盖客户端配置后重启 frpc
- `deploy-frpc.sh`：Linux 上一键安装并启动 frpc

手动安装：

```bash
wget https://github.com/fatedier/frp/releases/download/v0.66.0/frp_0.66.0_linux_amd64.tar.gz
tar xzf frp_*.tar.gz
sudo cp frp_*/frpc /usr/local/bin/
frpc -c frpc.toml
```

Windows 用户下载对应的 `frp_*_windows_amd64.zip`，把 `frpc.exe` 和 `frpc.toml` 放在同一目录运行即可。

### 5.5 账单、个人中心与工单

- 账单与充值：余额、在线充值、充值密钥兑换、交易记录
- 个人中心：邮箱、收款信息、通知设置
- 技术支持：故障工单、提现工单
- 提现到外部账户前，需要先配置收款信息和收款码

## 六、托管市场（母鸡）

用户可以把闲置服务器接入平台。

**四步向导**：托管准则 → 母鸡信息 → 设置套餐 → 接入平台。

执行接入脚本后，母鸡自动注册并提交审核。管理员在「技术支持 → 托管申请」里审核，通过后节点和套餐一并上架。

托管申请页有四个页签：我的节点、我的套餐、收益、申请记录。

## 七、工单体系

| 工单 | 用户操作 | 管理员操作 |
|---|---|---|
| 故障工单 | 提交、回复、发图、撤销 | 回复、发图、结束工单 |
| 提现工单 | 申请提现、回复、撤销 | 已打款 / 拒绝、回复、结束 |
| 托管申请 | 提交母鸡、回复 | 通过 / 拒绝 / 拉黑、回复 |

提现单处理完会自动关闭工单；用户撤销提现工单会取消提现并把金额退回收益池。

## 八、收支与财务

面板「订单收支 → 收支表」记录平台资金流水，金额以元计，保留两位小数。

- 收入：在线充值到账
- 支出：提现打款
- 冲正：提现驳回 / 撤销
- 事件：收益转余额、供应商结算、保证金留存

退款按「累计实付 × 剩余比例 ×（1 − 退订手续费）」计算；外部提现实付 = 提现金额 − 提现手续费。

## 九、通知设置

管理员：设置 → 通知设置，可开启通知、设置冷却时间、选择节点异常/恢复场景，选择通知渠道并填写参数，支持发送测试通知。

用户：个人中心 → 通知设置，选择推送渠道和订阅事件（实例到期、流量即将用尽、节点状态变化）；站内通知始终保留。

## 十、备份与恢复

- **下载备份**：设置 → 备份与恢复 → 下载全量备份
- **上传恢复**：选择 zip，输入 `RESTORE` 确认
- **R2 备份**：配置 Cloudflare R2 后可一键上传

备份包含 SMTP、支付、R2 等密钥，请妥善保管。

## 十一、常用命令

```bash
cd /opt/frp-manager-lite
docker compose ps
docker compose logs -f --tail=100
docker compose restart
docker compose pull && docker compose up -d
```

数据备份：

```bash
mkdir -p /root/backups
docker exec -i frp-manager-lite python - <<'PY'
import sqlite3
src = sqlite3.connect('/data/data.sqlite3')
dst = sqlite3.connect('/data/backup-tmp.sqlite3')
src.backup(dst)
dst.close(); src.close()
PY
docker cp frp-manager-lite:/data/backup-tmp.sqlite3 /root/backups/data-$(date +%F-%H%M%S).sqlite3
docker exec frp-manager-lite rm -f /data/backup-tmp.sqlite3
```

frps 服务：

```bash
# 面板机自带的第一个节点
systemctl status frps
journalctl -u frps -f

# 通过「新增节点」安装的节点
systemctl status frps-<节点名>
journalctl -u frps-<节点名> -f
```

## 十二、安全建议

- 修改默认管理员密码
- 关闭测试支付：`FML_ALLOW_MOCK_PAY=0`
- 面板只监听 `127.0.0.1`，由 Nginx 反代并配置 HTTPS
- 防火墙只放行 80/443、frps 入口端口、端口池 TCP/UDP
- 节点 dashboard 7500 只放行面板 IP
- 定期备份数据库和 `.env`，并放到面板机器之外
- 备份含各类密钥，禁止外传

## 十三、移动端

- 侧栏在移动端为抽屉，左下角按钮打开
- 表格在卡片内横向滚动
- 通知铃铛固定在右下角
