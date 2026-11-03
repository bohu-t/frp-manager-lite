# frp-manager-lite 部署文档

> 适用于面板 v2.1.x。界面以实际部署版本为准；旧文档里的「运维入口」「卖家/买家」「注册密钥」等说法已不再适用（注册密钥已移除）。

## 架构概述

```
管理员服务器（面板 + frps）                用户服务器（frpc）
┌──────────────────────┐                ┌──────────────────┐
│ frp-manager-lite     │  ──frps──►     │ frpc             │
│ 面板 / 套餐 / 工单    │  ◄─插件回调──  │ 用户隧道客户端     │
│ + frps（首个节点）    │                └──────────────────┘
└──────────┬───────────┘
           ├── 自营 frps 节点（香港 / 东京 / 洛杉矶…）
           └── 托管 frps 节点（用户提交的「母鸡」）
```

- **面板**：管理员部署，负责用户、实例、套餐、工单、收支和节点管理。
- **frps**：一个面板可以管理多个节点；节点分「自营」和「托管」两种归属。
- **frpc**：最终用户在自己机器上运行，配置由面板按实例生成。

## 一、部署面板

支持两种方式，任选其一。都需要一台 Debian/Ubuntu 服务器和 root 权限。

### 方式 A：预构建镜像（推荐，不需要源码）

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/lite-install/main/deploy-image-production.sh | sudo bash
```

脚本会依次询问：

| 步骤 | 说明 | 默认 |
|---|---|---|
| ① 面板域名 | 留空则不装 Nginx/HTTPS，面板直接监听端口 | 空 |
| ② 面板映射端口 | 容器对外端口 | 18081 |
| ③ 面板 HTTPS 端口 | 仅填了域名时询问，443 被占用可填 8443 | 443 |
| ④ frps 域名/IP | 用户 frpc 连接的地址 | 面板域名或公网 IP |
| ⑤ frps 入口端口 | bindPort | 7000 |
| ⑥⑦ 端口池起止 | 用户隧道端口范围 | 20000 / 20199 |
| ⑧ frps 仪表盘端口 | 节点 dashboard 本地端口 | 7500 |
| ⑨ 管理员用户名 | 登录面板用 | admin |
| ⑩⑪⑫ 密码/token | 管理员密码、frps token、仪表盘密码 | 回车自动生成 |

脚本会自动安装 Docker、拉取预构建镜像、安装 frps、写入 `/opt/frp-manager-lite/.env`，并按需配置 Nginx + Let's Encrypt HTTPS 和 UFW。

### 方式 B：源码部署

```bash
git clone https://github.com/bohu-t/frp-manager-lite.git
cd frp-manager-lite
sudo bash scripts/deploy-production.sh
```

交互式输入 5 项：

| 步骤 | 说明 |
|---|---|
| ① 面板域名 | 留空则跳过 Nginx/HTTPS，面板直接监听 `0.0.0.0:18081` |
| ② frps 域名/IP | 用户 frpc 连接地址 |
| ③ 管理员密码 | 不回显，回车随机生成 |
| ④ frps token | 不回显，回车随机生成 |
| ⑤ frps 仪表盘密码 | 不回显，回车随机生成 |

脚本会安装依赖和 Docker，把 `app.py` 混淆打包到 `dist/obfuscated/`，构建并启动面板，同时在本机安装第一个 frps（systemd 服务名 `frps`，配置 `/etc/frp/frps.toml`）。

> 源码部署的面板实际运行目录是 `dist/obfuscated/`，Compose 项目名也是 `obfuscated`；数据卷名与镜像部署不同，备份时不要照抄路径。

### 首次访问与软件授权

面板启动后第一次打开会进入**软件授权激活页**，输入授权码即可。授权服务器地址已内置，不需要填写。

- 授权码与当前机器指纹绑定，授权文件默认保存在数据目录 `software-license.json`。
- 同一台机器重装、保留数据卷时无需重新激活。
- 激活后每 12 小时静默校验一次；卖家后台停用、解绑或改期会下发到面板。
- 连续 7 天连不上授权服务器才会按失效处理（宽限期内不影响使用）。
- 未激活时管理员后台和配置下载会被拦截。

可选环境变量：

```bash
FML_LICENSE_FILE=/data/software-license.json   # 授权文件位置
FML_LICENSE_CHECK_HOURS=12                     # 校验间隔
FML_LICENSE_GRACE_DAYS=7                       # 离线宽限天数
```

### 环境变量参考

镜像部署的配置在 `/opt/frp-manager-lite/.env`；源码部署在仓库根目录 `.env`，并同步到 `dist/obfuscated/.env`。

```bash
# ---- 面板 ----
FML_PUBLISH_BIND=127.0.0.1       # 面板对外监听地址，一般交给 Nginx 反代
FML_PUBLISH_PORT=18081           # 面板映射端口
FML_ADMIN_USER=admin
FML_ADMIN_PASSWORD=***           # 生产务必修改
FML_HSTS_MAX_AGE=0               # HSTS 秒数，HTTPS 稳定后再开，例如 63072000

# ---- 注册与配额 ----
FML_OPEN_REGISTRATION=0          # 1=邮箱验证码自助注册（需先配 SMTP）；0=关闭，由管理员建号
FML_OPEN_REGISTRATION_EXPIRES_DAYS=30   # 开放注册用户的默认有效期
FML_OPEN_REGISTRATION_MAX_PORTS=0       # 开放注册用户的默认端口数，0=用全局默认
FML_DEFAULT_MAX_PORTS=10         # 新用户默认端口数
FML_PORT_START=20000             # 默认端口池起始
FML_PORT_END=20199               # 默认端口池结束

# ---- 计费与退款 ----
FML_ALLOW_MOCK_PAY=0             # 1=开启测试支付，仅开发环境
FML_FULL_REFUND_MINUTES=10       # 全额退款窗口
FML_PLAN_GRACE_HOURS=0           # 套餐到期后端口保留小时数，0=立即回收
FML_PROVIDER_COMMISSION=10       # 供给方保证金比例（%）
FML_PROVIDER_SETTLE_DAYS=7       # 供给方结算周期（天）

# ---- 节点 ----
FML_SETUP_KEY=***                # 一键添加节点的验证密钥；面板生成脚本时会自动带上
FML_NODE_OFFLINE_SUSPEND_HOURS=6 # 节点离线多久自动停售
FML_NODE_HEALTH_SAMPLE_SECONDS=600  # 健康巡检间隔
FRP_SERVER_ADDR=frp.example.com  # frps 地址
FRP_SERVER_PORT=7000             # frps 端口
FRP_AUTH_TOKEN=***               # frps token

# ---- 版本更新提醒（可选）----
FML_UPDATE_CHECK_HOURS=8
FML_UPDATE_URL=
FML_UPDATE_VERSION_REPO=bohu-t/lite-install
FML_UPDATE_LINK=
```

> `FML_MAX_PLANS_PER_NODE` 仍会被部署脚本写入，但当前版本没有参与实例数量限制，不要依赖它。

### 升级面板

**镜像部署：**

```bash
cd /opt/frp-manager-lite
cp .env .env.bak-$(date +%F-%H%M%S)
docker compose pull
docker compose up -d
```

**源码部署：**

```bash
cd /path/to/frp-manager-lite
git pull
cp .env .env.bak-$(date +%F-%H%M%S)
python3 tools/build-obfuscated.py --no-docker
cp -a .env dist/obfuscated/.env
cd dist/obfuscated
docker compose up -d --build
```

升级前先在面板「设置 → 备份与恢复」下载一份全量 zip；它会包含数据库、密钥和恢复说明。

## 二、添加 frps 节点

管理员登录 → 侧边栏「新增节点」→ 填写表单 → 点「创建节点」。注意：这一步**不会立刻创建节点**，而是生成一条带当前面板地址、`SETUP_KEY` 和节点参数的一键命令。把命令复制到新 VPS 上以 root 执行，节点才会真正接入。

**表单字段**

| 字段 | 说明 |
|---|---|
| 地区 | 展示在用户侧的地区分组，例如 河南 / 香港 / 美国 |
| 节点名 | 字母、数字、下划线、短横线，1-40 位，不能重名 |
| frps 域名/地址 | 用户 frpc 连接的地址，建议用域名，换机器只改 DNS |
| frps bindPort | 默认 7000 |
| frps token | 自动生成，至少 6 位，可点「重新生成」 |
| 带宽（Mbps） | 0 表示不限 |
| 月流量上限（GB） | 0 表示不限；达到上限后该节点不能新建隧道 |
| 服务器到期时间 | 可留空；托管套餐时长不能超过剩余天数 |
| frps 版本 | 可留空；dashboard 可访问时会自动刷新 |
| 端口起始/结束 | 默认 20000/20199，单节点最多约 2 万个 |
| frp 版本 | 稳定版（0.66.0）/ 最新版 / 自定义版本 |
| 备注 | 展示给用户的线路或合规提示 |

**脚本会完成：**

1. 向面板注册节点（带上 dashboard 地址、账号和随机密码）
2. 下载安装 frps，写入 `/opt/frps-<节点名>/frps.toml`
3. 注册 systemd 服务 `frps-<节点名>` 并开机自启
4. 安装端口限速同步定时器 `fml-port-rate-limit-<节点名>`
5. 执行完成后节点出现在「新增节点」页下方的节点列表，认证正常即可售卖

**节点列表操作**

- 「归属」列区分「自营」和「托管·用户名」
- 「版本」优先从节点 dashboard 的 `/api/serverinfo` 读取，读不到时可手动编辑
- 支持编辑、停用/启用、下载 frps 配置模板、删除
- **停用节点会立即按剩余价值退款并回收该节点下的套餐**；删除前必须先清空该节点的用户和隧道

## 三、管理员日常操作

侧边栏结构：

```
运行总览 / 用户管理 / 新增节点 / 套餐 / 订单收支（订单、收支表）
技术支持（故障工单、提现工单、托管申请）
节点健康 / 映射监控 / 风控审计 / 平台维护 / 设置
```

### 3.1 运行总览

- 端口使用率每 10 秒自动刷新，统计已分配端口和真实隧道占用
- 收支分析折线图，可切换今天 / 7 天 / 30 天 / 90 天
- 节点在线数、用户数、快捷操作入口

### 3.2 用户管理

**创建用户**：用户名、初始密码、邮箱、接入节点、端口数量、今日流量上限、速率策略、有效期天数。

**用户列表**：

- 按用户名/ID、接入节点、状态（正常/停用/到期）筛选
- 操作：停用/启用、流量限制、重置密码、重置令牌、调余额、设邮箱、删除
- 停用用户后，所有节点会通过 `/frp-plugin` 回调即时拒绝其连接

### 3.3 套餐管理

新增/编辑套餐：名称、价格（元）、适用节点、计费方式（时间/流量）、有效期天数（表单上限 30 天）、端口数、流量额度、速率、排序、备注、公平使用说明。

保存即上架；列表里可编辑、临时下架、删除。

### 3.4 订单与收支表

- **订单**：按状态、类型、关键字筛选，查看支付与开通情况；待支付订单可手动开通。
- **收支表**：三本账切换
  - **平台现金账**：在线充值（收入）、提现打款（支出）
  - **用户资金账**：余额到账、密钥兑换、退订退款、节点故障退款、提现退回（增加）；套餐消费、提现申请（减少）；供应商结算、保证金留存、收益转余额（事件，不计总额）
  - **用户流水**：按用户查看余额明细
  - 方向分为收入 / 支出 / 冲正 / 事件；支持近 7 / 30 / 90 天或全部、类型、单号/用户/备注搜索

### 3.5 技术支持

三类工单共用一套详情页，列表只做展示，操作全部在工单内部完成：

| 工单 | 管理员操作 |
|---|---|
| 故障工单 | 回复、发图、结束工单 |
| 提现工单 | 已打款 / 拒绝、回复、结束（处理完自动关单） |
| 托管申请 | 通过审核 / 拒绝 / 拉黑、回复 |

状态颜色：待处理琥珀、处理中蓝、已关闭绿、已拒绝红。

### 3.6 节点运维

- **节点健康**：节点总数、认证正常/异常、端口池汇总；逐节点显示 bind/auth 连通性、延迟、端口使用、带宽、dashboard 接入状态
- **映射监控**：读取各节点 frps dashboard，汇总今日入/出流量、当前连接，支持按用户筛选和分页
- **风控审计**：按公网端口定位用户并封禁；下方是最近 80 条关键操作和风控事件

> 映射监控和 frps 版本探测依赖节点 dashboard。节点脚本默认把 dashboard 监听在 `0.0.0.0:7500`，请用安全组/防火墙只放行面板 IP。

### 3.7 平台维护

- **系统公告**：发布时可选「系统公告」（公告页签）或「通知」（推送到用户通知列表）；列表可下架
- **充值密钥**：按面额、数量、有效期批量生成；列表可启用/停用/删除；用户在「账单与充值」兑换

### 3.8 设置

支付设置（支付宝/微信、回调地址、退订手续费）、邮件（SMTP）、Bncr 企微群通知、备份与恢复、Cloudflare R2、系统信息。

## 四、用户侧操作

### 4.1 注册与登录

- `FML_OPEN_REGISTRATION=1`：用户名 + 密码 + 邮箱验证码自助注册；必须先配置 SMTP，配好后推荐使用这一模式。
- `FML_OPEN_REGISTRATION=0`（代码默认）：关闭自助注册，注册页显示「注册已关闭」，由管理员在「用户管理 → 创建用户」直接开通。
- 忘记密码：输入用户名，获取邮箱验证码后重置。

### 4.2 新建实例

侧边栏「新建实例」，五步：

1. **选择地区**：搜索、价格区间、排序；地区卡片显示自营数量、节点数、起售价
2. **选择实例**：节点卡片显示 frps 版本、上架天数、最大续期时间、月流量限制、备注；在线/维护中/流量用尽
3. **选择配置**：时间套餐 / 流量套餐 / 组合套餐，显示库存
4. **实例配置**：端口已按套餐预分配；填写隧道名称、协议、本地地址、本地端口、公网端口，最多 `min(20, 套餐端口数)` 条
5. **支付开通**：右侧订单摘要显示时长、端口、流量、隧道数、应付金额，点「立即创建」完成开通

### 4.3 我的实例

按地区分组展示实例卡片，包含状态、实例说明、端口、流量、带宽/月流量、接入地址、frps 版本、续费价格、自动延期、到期时间。

点进实例详情：

- 隧道列表：映射状态、今日流量、复制公网地址
- 操作：新建隧道、下载配置、在线配置、延期、自动延期开关、退订
- 「下载配置 / 在线配置」只包含当前实例的隧道，不会混入同节点其他实例
- 退订按「累计实付 × 剩余比例 ×（1 − 手续费）」退款；10 分钟内且未产生流量可全额退

### 4.4 账单、个人中心与技术支持

- **账单与充值**：余额、在线充值（管理员配置支付渠道后才显示）、充值密钥兑换、最近 100 条交易
- **个人中心**：邮箱、收款信息（方式/账号/姓名/收款码，提现到外部账户前必填）、通知设置
- **通知设置**：21 种推送渠道（Bark、Telegram、钉钉、企业微信、Server 酱、WxPusher 等），订阅实例到期、流量即将用尽、节点状态变化三类事件；站内通知始终保留
- **技术支持**：故障工单、提现工单；提现可选择转入余额或提现到收款账户
- 修改密码在右上角账号菜单里

### 4.5 frpc 使用

实例详情 → 「下载配置」：

- `frpc.toml`：只包含当前实例的隧道，覆盖客户端配置后重启 frpc 即可
- `deploy-frpc.sh`：在 Linux 客户端上一键安装 frpc、写入配置并注册服务

手动安装：

```bash
# 1. 下载 frpc（版本以面板显示为准，默认 0.66.0）
wget https://github.com/fatedier/frp/releases/download/v0.66.0/frp_0.66.0_linux_amd64.tar.gz
tar xzf frp_*.tar.gz
sudo cp frp_*/frpc /usr/local/bin/

# 2. 从实例页下载 frpc.toml
# 3. 运行
frpc -c frpc.toml
```

Windows 用户下载对应的 `frp_*_windows_amd64.zip`，把 `frpc.exe` 和面板生成的 `frpc.toml` 放在同一目录，运行 `frpc.exe -c frpc.toml` 即可。

## 五、软件授权

软件授权由**授权服务器**统一签发与校验；本仓库只包含客户端校验逻辑，授权服务由卖家独立部署。

1. 向卖家索取**软件授权码**（不需要授权服务器地址）。
2. 首次打开面板时在激活页填入，授权码自动绑定当前机器指纹。
3. 授权文件默认保存在数据目录，同机重装且保留数据卷时自动复用。
4. 面板每 12 小时静默校验一次；停用、解绑、改期会下发。
5. 连不上授权服务器时有 7 天宽限期，超过才失效。

```bash
FML_LICENSE_FILE=/data/software-license.json
FML_LICENSE_CHECK_HOURS=12
FML_LICENSE_GRACE_DAYS=7
```

## 六、常用命令

**镜像部署（/opt/frp-manager-lite）**

```bash
cd /opt/frp-manager-lite
docker compose ps
docker compose logs -f --tail=100
docker compose restart
docker compose pull && docker compose up -d
```

**源码部署（dist/obfuscated）**

```bash
cd /path/to/frp-manager-lite/dist/obfuscated
docker compose ps
docker compose logs -f --tail=100
docker compose restart
```

**备份数据库（WAL 模式下建议用在线备份）**

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

**frps 服务**

```bash
# 面板机自带的第一个节点
systemctl status frps
systemctl restart frps
journalctl -u frps -f

# 通过「新增节点」脚本安装的节点
systemctl status frps-<节点名>
systemctl restart frps-<节点名>
journalctl -u frps-<节点名> -f
```

## 七、安全建议

- 生产必须修改 `FML_ADMIN_PASSWORD`，不要保留默认的 `admin123`
- 关闭测试支付：`FML_ALLOW_MOCK_PAY=0`
- 不开放自助注册时保持 `FML_OPEN_REGISTRATION=0`，用管理员建号
- 面板只监听 `127.0.0.1`，由 Nginx 反代并配置 HTTPS；HTTPS 稳定后再开 `FML_HSTS_MAX_AGE`
- 防火墙只放行：80/443、frps bindPort、端口池 TCP/UDP；节点 dashboard 7500 只放行面板 IP
- 定期备份数据库和 `.env`，并把备份放到面板机器之外
- 备份 zip 含 SMTP、支付、R2、Bncr 等密钥，禁止外传
- `FML_SETUP_KEY` 等同于节点接入凭证，不要泄露

## 八、托管市场（母鸡）

用户可以把闲置服务器接入平台，由平台统一售卖套餐。

**用户侧四步向导**（面板 → 托管申请 → 添加母鸡）：

1. **托管准则**：弹窗展示规则，点「同意并继续」
2. **母鸡信息**：名称、地区、公网地址、frps 端口、端口池、带宽、月流量、服务器到期时间（必填且晚于明天）、备注
3. **设置套餐**：名称、价格、计费方式、有效期（≤30 天）、流量额度、端口数
4. **接入平台**：生成带专属部署令牌的一键脚本，在母鸡机器上执行

执行脚本后母鸡自动注册并提交审核；管理员在「技术支持 → 托管申请」点进工单，查看信息后「通过审核」，节点和该节点下的套餐会一并上架。拒绝或拉黑会关闭工单；拉黑还会停用节点并退款。

**托管申请页**有四个页签：我的节点、我的套餐、收益、申请记录。

**自动规则**

- 母鸡连续离线超过 `FML_NODE_OFFLINE_SUSPEND_HOURS`（默认 6 小时）自动停售，恢复在线自动重新上架
- 节点到期后不能再上架托管套餐；托管套餐时长不能超过节点剩余天数
- 供给方收益按服务进度结算，`FML_PROVIDER_COMMISSION`（默认 10%）留存为保证金

## 九、工单体系

三类工单共用一套详情页，列表只做展示，操作全部在工单内部：

| 工单 | 用户操作 | 管理员操作 |
|---|---|---|
| 故障工单 | 提交、回复、发图、撤销 | 回复、发图、结束工单 |
| 提现工单 | 申请提现、回复、撤销 | 已打款 / 拒绝、回复、结束 |
| 托管申请 | 提交母鸡、回复 | 通过 / 拒绝 / 拉黑、回复 |

- 状态颜色：待处理琥珀、处理中蓝、已关闭绿、已拒绝红
- 提现单处理完（打款或拒绝）后工单自动关闭
- 用户撤销提现工单会自动取消提现，金额退回收益池

## 十、收支与财务

面板「订单收支 → 收支表」记录平台资金流水，金额统一以**元**计，保留两位小数。

| 方向 | 含义 | 计入收支 |
|---|---|---|
| 收入 | 在线充值到账 | 是 |
| 支出 | 提现打款 | 是 |
| 冲正 | 提现驳回 / 撤销 | 抵扣支出，不算收入 |
| 事件 | 收益转余额、供应商结算、保证金留存 | 否，内部划转 |

- 退款金额 = 累计实付 × 剩余比例 ×（1 − 手续费）；10 分钟内且未产生流量全额退
- 续费会累加实付金额和时长/流量
- 供给方按服务进度结算，保证金比例由 `FML_PROVIDER_COMMISSION` 控制

## 十一、企业微信群通知（Bncr）

可选功能，把节点离线、新工单、工单超时推送到企微群，并 @ 对应供货商。面向内部运维和供货商，普通用户仍使用站内通知和自建推送渠道。

**面板侧**：设置 → Bncr 企微群通知，填写启用开关、插件地址、访问 Token、平台（默认 `wecomLong`）、群 chatid，可发送测试。

**Bncr 侧**：部署 `frp-manager-lite-hook.js` 插件，配置面板地址、Token、监听端口（默认 9099）、企业 ID / 应用 Secret、托管群 chatid。

群 chatid 可在群里 @机器人 发送「企业微信ID」获取。

## 十二、备份与恢复

- **下载备份**：设置 → 备份与恢复 → 下载全量备份（zip 内含 `data.sqlite3`、`dump.sql`、`metadata.json`、`RESTORE.md`）
- **上传恢复**：选择 zip，输入 `RESTORE` 确认；系统会先把当前库另存到 `restore-backups/before-restore-*.zip` 再替换
- **R2 备份**：配置 Cloudflare R2 后可一键上传到对象存储
- 备份包含 SMTP、支付、R2、Bncr 等密钥，请妥善保管

## 十三、移动端

- 侧栏在移动端收起为抽屉，左下角悬浮按钮打开
- 表格在卡片内横向滚动，页面本身不会横向溢出
- 通知铃铛固定在右下角
