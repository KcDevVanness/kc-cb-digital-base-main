# 主机访问与可达性诊断

## 适用范围

部署主机的**公网地址契约**、从外网判断「服务器坏了还是域名/网络坏了」的方法，
以及 SSH 与 AWS 侧的访问方式。镜像构建、流水线、磁盘机制、数据搬迁见
[cicd.md](./cicd.md)；镜像运行时见 [runtime.md](./runtime.md)。

## 公网地址必须用 Elastic IP

### 为什么

EC2 实例**自动分配**的公网 IPv4 是临时的：实例 stop 时释放，start 时重新分配。
而改实例规格（t3.small → t3.large）**必须 stop/start**，所以每次改规格都会换地址。

实测（`aws cloudtrail lookup-events`，时间为 +08:00）：

| 时间 | 事件 | 实例公网 IPv4 |
|---|---|---|
| 09-23 18:18:55 | RunInstances（创建） | `16.162.187.109` |
| 09-24 10:50:02 → 11:00:23 | stop → start（改规格） | → `95.40.86.77` |
| 09-24 11:49:50 → 11:50:17 | stop → start | → `54.46.43.19` |
| 绑 EIP 后 | associate-address | → `18.163.244.11`，`54.46.43.19` 同时被释放 |

| | 自动分配公网 IPv4 | Elastic IP |
|---|---|---|
| 归属 | AWS 临时分配，不属你 | 账号下的静态地址 |
| stop / start | **会换** | 不变 |
| 改规格（必经 stop/start） | **会换** | 不变 |
| reboot | 不变 | 不变 |
| 被关联 EIP 时 | **被替换并释放** | — |

**两个踩过的坑：**

1. **DNS 指向自动分配的地址时，任何一次 stop/start 都会让域名指向一台不存在的机器。**
   现象是「网站突然打不开」，而服务器本身完全正常——排查方向很容易被带偏到应用或流水线上。
2. **关联 EIP 会立刻释放原来的自动分配地址。** 若此时正好有人把 DNS 改到那个地址，
   改完即失效。换地址的动作要与人（或自动化）读地址、写 DNS 的动作**串行**，不要并发。

### 现状

| 项 | 值 |
|---|---|
| 实例 | `i-056bebe0773cdd6bc`（Name `KC_DEV_SP_CB_Digital_Base`） |
| Elastic IP | `18.163.244.11`（AllocationId `eipalloc-067b8590fe4993461`） |
| 域名 | `dgital-base.kc-trade.cn`，A 记录指向该 EIP |
| 流水线目标 | 仓库 secret `DEPLOY_HOST` = 该 EIP |

**不要释放这个 EIP。** 释放后公网地址会回到「每次重启就换」的状态，域名与
`DEPLOY_HOST` 都要跟着改。

## 判断问题在哪一层

现象都是「打不开」，但可能出在域名、网络、主机、应用四层。按顺序收敛，
每步都从**外部观测点**取证据，不要只在本机 `ping`。

**1. DNS 是否指向当前实例地址**

```bash
dig +short dgital-base.kc-trade.cn A
aws ec2 describe-instances --profile kc-cb-digital --region ap-east-1 \
  --instance-ids i-056bebe0773cdd6bc \
  --query 'Reservations[].Instances[]|[0].{IP:PublicIpAddress,State:State.Name}'
```

两者不一致 → 问题在 DNS，服务器无关。

**2. 端口是否可达**（用 check-host.net 的 TCP 检查，多节点取样避免单点网络问题）

| 返回 | 含义 |
|---|---|
| `OPEN` | 包到达了主机 |
| `Connection refused` | 包到达主机但没人监听 → 安全组放行、服务没起 |
| `Connection timed out` | 安全组拦截，**或该地址已不属于这台机器** |

**3. HTTPS 与证书**

```bash
curl -sS -o /dev/null -w '%{http_code} tls=%{ssl_verify_result}\n' \
  https://dgital-base.kc-trade.cn/api/healthz
```

`tls=0` 表示证书链校验通过。

**4. 主机内部**

```bash
ssh -i <key> ubuntu@18.163.244.11 \
  'cd /opt/kc-cb-digital-base && docker compose -f docker-compose.deploy.yml ps'
```

**`ping` 不通不代表服务不可用**：大陆运营商普遍封境外 IP 的 ICMP，而安全组本身
放行全协议（`-1 / 0.0.0.0/0`）。判断可用性看 HTTP/HTTPS，不要看 ping。

## SSH 访问

```bash
ssh -i <key> ubuntu@18.163.244.11
```

两种「连不上」含义完全不同，别混为一谈：

| 现象 | 含义 |
|---|---|
| `Connection timed out` | 地址已不属于这台机器，或安全组拦截 |
| `kex_exchange_identification: Connection closed by remote host` | TCP 建立了但对端在 **banner 阶段**关闭。地址正确时通常是 sshd 源限流——**先停止重试**，密集重试会把惩罚窗口一直续上 |

## AWS 侧访问（用于检查与修复主机）

```bash
aws sts get-caller-identity --profile kc-cb-digital    # 账号 521816550438
```

profile 由 `aws login` 建立（浏览器登录）。凭据 **12 小时有效**，90 天内可免浏览器续期。
换账号要 `aws logout --all` 清缓存后重新 `aws login`——只重新 login 可能仍复用旧会话。

常用排查命令：

```bash
P="--profile kc-cb-digital --region ap-east-1"
aws ec2 describe-instances $P --instance-ids i-056bebe0773cdd6bc   # 当前地址、规格、状态
aws ec2 describe-addresses $P                                       # EIP 归属
aws ec2 describe-security-groups $P --group-ids sg-0f4d052b28dbb565c
aws cloudtrail lookup-events $P \
  --lookup-attributes AttributeKey=EventName,AttributeValue=StopInstances
```

**`cloudtrail lookup-events` 是还原「什么时候重启过、地址怎么变的」最直接的证据来源**，
排查这类「昨天还好今天打不开」的问题应当第一步就用它。

### Agent Toolkit

本机已按 AWS 官方说明配好 Agent Toolkit（`aws configure agent-toolkit`）：AWS skills 装在
`~/.claude/skills` 与 `~/.agents/skills`，`aws-mcp` 服务写进 Claude Code / Codex / OpenCode 的
MCP 配置。**MCP 条目必须带 `AWS_MCP_PROXY_PROFILES=kc-cb-digital`**（Claude/Codex 用 `env`，
OpenCode 用 `environment`）——生成的默认条目会回退到 `default` profile，而凭据不在那里，
表现为 MCP 启动即报 `-32602: Invalid request parameters("")`。

要接第二个账号：`aws login --profile <name>`，再把该 profile 追加到各配置文件里
`AWS_MCP_PROXY_PROFILES` 的空格分隔列表中，然后重启 AI 工具。

## 验证方式

```bash
# 1. 域名指向当前实例地址
[ "$(dig +short dgital-base.kc-trade.cn A)" = "18.163.244.11" ] && echo OK

# 2. 外部可达：用 check-host.net 的 HTTP 检查，至少 3 个不同国家/地区的节点返回 200

# 3. 证书链校验通过
curl -sS -o /dev/null -w '%{http_code} tls=%{ssl_verify_result}\n' \
  https://dgital-base.kc-trade.cn/api/healthz

# 4. 主机内部五容器 healthy
ssh -i <key> ubuntu@18.163.244.11 \
  'cd /opt/kc-cb-digital-base && docker compose -f docker-compose.deploy.yml ps'
```

## 相关

- 流水线、主机契约、磁盘机制、数据搬迁：[cicd.md](./cicd.md)
- 镜像构建与运行时契约：[runtime.md](./runtime.md)
