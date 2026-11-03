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

生产配置统一在 `/opt/frp-manager-lite/.env`，改完执行 `docker compose up -d` 生效。

```bash
# ---- 面板 ----
FML_PUBLISH_BIND=127.0.0.1       # 面板对外监听地址（一般交给 Nginx 反代）
FML_PUBLISH_PORT=18081           # 面板映射端口
FML_ADMIN_USER=admin             # 管理员用户名
FML_ADMIN_PASSWORD=***           # 管理员密码（生产务必修改）
FML_HSTS_MAX_AGE=0               # HSTS 秒数，HTTPS 稳定后再开，例如 63072000

# ---- 注册与配额 ----
FML_OPEN_REGISTRATION=1          # 1=邮箱验证码注册；0=邀请密钥注册
FML_OPEN_REGISTRATION_EXPIRES_DAYS=30   # 开放注册用户默认有效期
FML_OPEN_REGISTRATION_MAX_PORTS=0       # 开放注册用户默认端口数，0=用全局默认
FML_DEFAULT_MAX_PORTS=10         # 新用户默认端口数
FML_PORT_START=20000             # 默认端口池起始
FML_PORT_END=20199               # 默认端口池结束
FML_MAX_PLANS_PER_NODE=2         # 单节点每人最大实例数

# ---- 计费与退款 ----
FML_ALLOW_MOCK_PAY=0             # 1=开启测试支付（仅开发）
FML_FULL_REFUND_MINUTES=10       # 全额退款窗口
FML_PLAN_GRACE_HOURS=0           # 套餐到期后端口保留小时数，0=立即回收
FML_PROVIDER_COMMISSION=10       # 供给方保证金比例（%）
FML_PROVIDER_SETTLE_DAYS=7       # 供给方结算周期（天）

# ---- 节点 ----
FML_SETUP_KEY=***                # 一键添加 frps 节点的验证密钥
FML_NODE_OFFLINE_SUSPEND_HOURS=6 # 节点离线多久自动停售
FML_NODE_HEALTH_SAMPLE_SECONDS=600  # 健康巡检间隔
FRP_SERVER_ADDR=frp.example.com  # frps 地址
FRP_SERVER_PORT=7000             # frps 端口
FRP_AUTH_TOKEN=***               # frps token

# ---- 软件授权（由卖家签发）----
FML_LICENSE_FILE=/data/software-license.json
FML_LICENSE_CHECK_HOURS=12
FML_LICENSE_GRACE_DAYS=7

# ---- 版本更新提醒（可选）----
FML_UPDATE_CHECK_HOURS=8
FML_UPDATE_URL=
FML_UPDATE_VERSION_REPO=bohu-t/lite-install
FML_UPDATE_LINK=
```

### 升级面板

镜像版部署直接替换镜像标签，源码部署重新构建：

```bash
cd /opt/frp-manager-lite
cp .env .env.bak-$(date +%F-%H%M%S)          # 先备份配置
sudo docker compose pull && sudo docker compose up -d   # 镜像版
# 或：sudo docker compose up -d --build                 # 源码版
```

升级前建议在面板「设置 → 备份」下载一份全量 zip，或直接备份数据卷：

```bash
sudo cp -a /var/lib/docker/volumes/frp-manager-lite_frp-manager-lite-data/_data/data.sqlite3 \
        /root/backups/data-$(date +%F-%H%M%S).sqlite3
```

## 二、添加 frps 节点

在新 VPS 上运行，全程交互，零环境变量：

```bash
curl -fsSL https://raw.githubusercontent.com/bohu-t/frp-manager-lite/main/scripts/add-frps-node.sh -o add-frps-node.sh
bash add-frps-node.sh
```

**需要准备**：
1. 从面板后台 → 仪表盘 → 运维入口 → 复制 `FML_SETUP_KEY`
2. 新 VPS 已开放对应端口（防火墙 / 安全组）

脚本自动完成：
- 向面板注册节点
- 下载安装 frps
- 生成配置文件
- 创建 systemd 服务并启动

## 三、卖家日常操作

### 3.1 激活软件授权（首次）

部署后访问面板，输入卖家给你的鉴权服务器地址和软件授权码完成激活。激活会在部署机器上生成本地授权文件（默认随数据目录保存，或由 `FML_LICENSE_FILE` 指定），并与当前机器指纹绑定；**同机器重装无需重新鉴权**。

激活后面板会**定期向鉴权服务器静默校验**（默认 12 小时）：卖家后台停用/解绑/调整有效期会下发到面板；连不上授权服务器时有 7 天宽限期（详见 [五、软件授权](#五软件授权由卖家签发)）。

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

[[proxies]]
name = "my_web"
type = "tcp"
localIP = "127.0.0.1"
localPort = 80
remotePort = 20000
```

## 五、软件授权（由卖家签发）

软件授权由**卖家的鉴权服务器**统一签发与校验，源码里**不包含**鉴权服务实现：

1. 向卖家索取：**鉴权服务器地址** + **软件授权码**。
2. 面板首次打开时填入完成激活（授权码绑定本机指纹，同机器重装自动复用）。
3. 激活后面板会**定期静默校验**（默认 12 小时）；卖家后台停用/解绑/改期会下发到面板。
   连不上授权服务器时默认有 **7 天宽限期**，超过才失效。

可选 `.env`：

```bash
# 可选：指定本地授权文件位置，建议放到持久化数据目录
FML_LICENSE_FILE=/var/lib/frp-manager-lite/software-license.json
# 可选：心跳间隔与离线宽限
FML_LICENSE_CHECK_HOURS=12
FML_LICENSE_GRACE_DAYS=7
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
   - 反代需透传 `X-Forwarded-Proto: https`，面板据此自动给 Cookie 加 `Secure`
   - 确认 HTTPS 稳定后，可设置 `FML_HSTS_MAX_AGE=63072000` 开启 HSTS（一旦下发，浏览器在该时长内强制 HTTPS，撤回需等待过期）
2. `FML_SETUP_KEY` 部署后不要泄露
3. frps 仪表盘建议仅监听 127.0.0.1
4. 定期备份 `dist/obfuscated/` 目录下的 `.env` 和 Docker volume 数据

## 八、托管市场（母鸡）

用户可以把闲置服务器接入平台，由平台统一售卖套餐。

**用户侧四步向导**（面板 → 托管申请 → 添加母鸡）：

1. **托管准则**：弹窗展示规则，点「同意并继续」
2. **母鸡信息**：名称、地区、公网地址、frps 端口、端口池、带宽、月流量、服务器到期时间
3. **设置套餐**：名称、价格、计费方式（时间/流量）、端口数
4. **接入平台**：生成带专属部署令牌的一键脚本，在母鸡机器上执行

执行脚本后母鸡自动注册并提交审核，管理员在「技术支持 → 托管申请」点进工单查看信息并「通过审核」，节点与该节点下的套餐会一并上架。

**自动规则**

- 母鸡连续离线超过 `FML_NODE_OFFLINE_SUSPEND_HOURS`（默认 6 小时）自动停售，恢复在线自动重新上架
- 节点 `expires_at` 到期后不能再上架新套餐（套餐时长不得超过节点剩余天数）
- 用户提交托管前需完成企业微信绑定（若启用群通知）

## 九、工单体系

三类工单共用一套详情页，列表只做展示，操作全部在工单内部：

| 工单 | 用户操作 | 管理员操作 |
|---|---|---|
| 故障工单 | 提交、回复、发图、撤销 | 回复、结束工单 |
| 提现工单 | 申请提现、回复、撤销 | 已打款 / 拒绝、回复、结束 |
| 托管申请 | 提交母鸡、回复 | 通过 / 拒绝 / 拉黑、回复 |

- 状态颜色：待处理琥珀、处理中蓝、已关闭绿、已拒绝红
- 提现单处理完（打款或拒绝）后工单自动关闭
- 用户撤销提现工单会自动取消提现并把积分退回收益池
- 查看工单或列表后，相关站内通知自动标记已读

## 十、收支与财务

面板「订单收支 → 收支表」记录平台资金流水：

| 方向 | 含义 | 计入收支 |
|---|---|---|
| 收入 | 充值、套餐销售、保证金留存 | 是 |
| 支出 | 退款、供应商结算、提现打款 | 是 |
| 冲正 | 提现驳回 / 撤销 | 抵扣支出，不算收入 |
| 事件 | 收益转余额（内部划转） | 否 |

- 汇率固定 **1 积分 = 1 元**，积分保留两位小数
- 退款金额 = 累计实付 × 剩余比例 ×（1 − 手续费），续费会累加实付与时长
- 供给方按服务进度结算：90% 到账，10% 留存保证金

## 十一、企业微信群通知（Bncr）

可选功能，把节点离线、新工单、工单超时推送到企微群并 @对应供货商。

**面板侧**：设置 → Bncr 企微群通知，填写插件地址、Token、平台名、群 chatid。

**Bncr 侧**：部署 `frp-manager-lite-hook.js` 插件，配置面板地址、Token、监听端口（默认 9099）、企业 ID / 应用 Secret、托管群 chatid。

**绑定流程**：用户加入企业 → 打开机器人单聊发送绑定码 → 插件回调面板完成绑定并拉入托管群。

## 十二、备份与恢复

- **下载备份**：设置 → 备份与恢复 → 下载全量备份（zip 内含 `data.sqlite3`、`dump.sql`、`metadata.json`、`RESTORE.md`）
- **上传恢复**：选择 zip，输入 `RESTORE` 确认；系统会先把当前库另存到 `restore-backups/before-restore-*.zip` 再替换
- **R2 备份**：配置 Cloudflare R2 后可一键上传到对象存储
- 备份包含 SMTP、支付、R2、Bncr 等密钥，请妥善保管

## 十三、移动端

- 侧栏在移动端收起为抽屉，左下角悬浮按钮打开
- 表格在卡片内横向滚动，页面本身不会横向溢出
- 通知铃铛固定在右下角

