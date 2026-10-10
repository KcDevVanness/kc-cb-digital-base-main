# CI/CD 与 AWS 部署

## 适用范围

`production` 分支的发布流水线、镜像产物、AWS 部署主机的目录与 `.env` 契约、TLS 入口、回滚方式。
云账号、安全组、密钥值不在本文范围。

## 分支模型

| 分支 | 作用 | 触发什么 |
|---|---|---|
| `dev` | 集成分支（单元 PR 的落点） | `guard-tree.yml`；`validate.yml` 照常上报但按 scope 跳过整套命令（base 是集成分支）——见下方「门禁覆盖」 |
| `main` | 发布主线（只收 `dev → main` 波次 PR） | `validate.yml` 全套（base `main` 的 PR 与 `main` 的推送）、`guard-tree.yml` |
| `feat/*` | 特性分支 | 开 PR 时跑 `validate.yml`（同上，按 scope 判定是否真跑命令） |
| `production` | **发布分支，唯一会部署的分支** | `deploy.yml`（构建镜像 → 部署到 AWS）；base `production` 的 PR 跑 `validate.yml` 全套 |
| 任意 PR 目标 | 所有分支 | `guard-tree.yml`（`scripts/guards/guard-tree.mjs`，拒收丢失仓库的树） |

### 门禁覆盖（2026-09-30 起）

`validate.yml` 的**触发**仍然覆盖所有 PR（必需检查必须上报，否则 PR 会永久卡在
"Expected — Waiting"），但**是否真跑命令**由 `scope` job 决定：

- base 是 `main` / `production`（波次 PR、生产同步 PR）→ 跑全套（再按 docs/部署侧白名单跳过）；
- base 是集成分支（`dev`，以及堆叠在别的单元分支上的子 PR）→ `needed=false`，两个 job skipped，
  汇总 job 秒级报绿。**这类 PR 的实际验证是作者本地的 `validation.commands`**——`om-auto-create-pr`
  第 8 步与 `AGENTS.md` 的 Validation 一节都要求它，CI 只是转发结论，不再复跑；
- 推送 `main` → 跑全套（波次落地后的复核）。

代价是显式的：单元 PR 合进 `dev` 时 CI 不再证明它绿，红要等到 `dev → main` 的波次 PR（或 `main`
推送）才暴露；换来的是单元 PR 的合并不再等 3 分钟。判定逻辑与拒绝条件见
`.ai/lessons/gate-must-cover-every-pr-target.md`。

部署不是「合并到 main 的副作用」：把某个提交提升到生产是一次显式的动作——日常走**从 `production`
切出的同步分支 → PR（base `production`）→ squash 合并**（PR #19/#22 的形状），合并即触发部署；
`git push origin main:production` 只是管理员应急通道（`production` 与 `main` 同保护、
`enforce_admins=false`，推送会被 bypass 并在远端留下记录）。这样 main 上的
验证失败或半成品提交不会自动上线。

## 流水线（`.github/workflows/deploy.yml`）

```
push production ─┬─ build  ── docker build --target runner --platform linux/arm64 ──▶ ghcr.io/kcdevvanness/kc-cb-digital-base-main:<sha>
                 │                                            ghcr.io/kcdevvanness/kc-cb-digital-base-main:production
                 └─ deploy ── ssh ──▶ 主机 git fetch + checkout <sha>（无需 docker login：包可公开拉取）
                                      docker compose -f docker-compose.deploy.yml pull app
                                      docker compose -f docker-compose.deploy.yml up -d
                                      curl 127.0.0.1:$APP_PORT/api/healthz 等到 200
```

**构建为什么在 CI 而不在主机上**：`yarn build` 用 `--max-old-space-size=8192`，
而部署主机是 1 GiB 内存的 `t4g.micro`。在主机上构建会长时间占满 CPU 并需要数 GB 堆内存，
所以主机只做三件事——
拉代码、拉镜像、起容器。

**镜像平台（2026-10-10 起）**：主机是 aarch64（t4g 家族），流水线只构建 `linux/arm64`，
build job 跑在 `ubuntu-24.04-arm`（公共仓库免费的**原生** arm64 runner；在 amd64 runner 上
用 QEMU 模拟 arm64 会让这个体量的 Next.js 构建慢数倍）。换回 x86 实例时，把
`platforms` 与 `runs-on` 一起改回，否则 `up -d` 会以 `exec format error` 失败——
旧实例上的 amd64 镜像在新主机上跑不起来，就是这个原因。

**GHCR 鉴权**：该 package 目前**公开可拉取**，主机 `pull` 不需要凭据，部署脚本里没有
`docker login`（早期曾用当次运行的 `GITHUB_TOKEN` 登录，token 随运行过期后反而让后续
pull 报 `denied`，故已移除）。若将来把 package 改为私有，主机需要一份**长期凭据**，
而不是这个 job 的 token。

- 镜像标签用 **commit SHA**（不可变），`deploy` 阶段传的就是这个 tag，不是 `latest`
- `concurrency: deploy-production` 且 `cancel-in-progress: false`：正在跑的部署必须跑完，
  否则会停在 `up -d` 中间
- 构建缓存走 GitHub Actions cache（`type=gha`），首次构建后重复构建显著变快
- **只改部署侧文件时跳过构建**：`build` 阶段先 `git diff` 本次推送范围，若改动全部落在
  `.github/`、`docs/`、`*.md`、`.gitignore`、`docker-compose.deploy.yml`、`docker/caddy/`、`scripts/deploy/`
  之内，就复用已有的 `:production` 镜像，省掉约 11 分钟。判定是**白名单**（不在名单里就重建），
  所以新增源码目录只会多花时间，不会上线过期镜像。跳过构建时 `deploy` 仍会跑，
  因为 compose 与 Caddyfile 的改动需要被应用

## 主机契约

| 项 | 值 |
|---|---|
| 主机 | `t4g.micro`（2 vCPU / **1 GiB**，aarch64，Amazon Linux 2023），60 GB gp3 根卷；SSH 用户 `ec2-user`（沿用 `KC_DEV_SP_CB_Digital_Base` key pair） |
| 目录 | `/opt/kc-cb-digital-base`（`APP_DIR`） |
| compose 文件 | `docker-compose.deploy.yml`（与 `fullapp` 的区别：`image:` 取代 `build:`，多一个 `caddy`） |
| `.env` | `/opt/kc-cb-digital-base/.env`，**不在 git 里**，由 `bootstrap-host.sh` 首次生成（或手工按下方清单创建） |
| 公网地址 | **Elastic IP `18.163.244.11`，不要释放**——自动分配的公网 IPv4 每次 stop/start 都会换，域名与 `DEPLOY_HOST` 会同时失效。见 [host-access.md](./host-access.md) |
| 对外端口 | `80` / `443` 由 `caddy` 容器占用并终结 TLS |
| app 端口 | `APP_PORT`（`3000`），只绑 `127.0.0.1`——给部署健康探针和排障用，不对公网 |
| 部署脚本 | `scripts/deploy/deploy.sh`，由 CI 通过 `ssh ... bash -s` 用 stdin 灌入 |

脚本走 stdin 而不是「先 checkout 再执行」：要部署的版本正是脚本自己 fetch 下来的，
先 checkout 才能拿到脚本会构成先有鸡还是先有蛋。**代价：脚本自身就是 stdin。** 脚本里
任何读 stdin 的命令都会把剩余脚本吃掉，bash 随即在该命令处遇到 EOF、整段以 0 退出——
2026-10-10 实测确认：`compose exec -T caddy caddy reload`（默认附加 stdin）就这样静默跳过
了它后面的全部内容（健康闸门、磁盘回收、`compose ps`），旧主机上的历次部署同样如此。
修复是给该命令加 `< /dev/null`；往脚本里加新命令时留意同一类陷阱。

`.env` 里**必须**有的项：

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
JWT_SECRET=$(openssl rand -hex 32)     # 生产启动硬校验，占位值直接 exit 1
AUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
TENANT_DATA_ENCRYPTION_FALLBACK_KEY=<32+ 字符随机串>
LOOKUP_HASH_PEPPER=<随机串>
MEILISEARCH_MASTER_KEY=<随机串>
APP_DOMAIN=<公网主机名>                 # Caddy 就为这个名字申请证书
APP_URL=https://<APP_DOMAIN>           # 必须与实际访问地址一致
APP_PORT=3000
OM_INIT_SUPERADMIN_EMAIL / OM_INIT_SUPERADMIN_PASSWORD
```

改公网域名用 `set-domain.sh <domain>`（见下），不要手工改 `.env`：它会同时更新
`APP_DOMAIN` / `APP_URL` / `APP_PORT` 并留一份备份。

## TLS 与 Secure cookie

**这个应用在生产形态下不能跑纯 HTTP。** 框架里 cookie 的标志位是硬编码的：

```js
secure: process.env.NODE_ENV === "production"   // @open-mercato/core .../auth/api/login
```

runner 镜像的 `NODE_ENV=production` 烤死在 `Dockerfile` 里，没有 env 开关。浏览器会拒绝在
`http://` 上保存带 `Secure` 的 cookie，于是登录接口返回 200、浏览器却拿不到会话，表现为
「登录成功但立刻掉线」。所以公网入口必须是 HTTPS，`caddy` 容器就是为此存在的。

- Caddy 自动申请/续期 Let's Encrypt 证书（TLS-ALPN-01，回退 HTTP-01），并做 HTTP→HTTPS 跳转
- `caddy_data` 卷存证书和 ACME 账号密钥，**别删**，否则重新签发会消耗 Let's Encrypt 配额
- Caddyfile 里**故意没有 `encode`**：它的 response writer 会破坏 SSE 流
  （[caddyserver/caddy#6293](https://github.com/caddyserver/caddy/issues/6293)），
  而这个应用的助手回复是流式的。`reverse_proxy` 自身对 `text/event-stream` 会即时 flush
- 证书申请依赖 DNS：`APP_DOMAIN` 的 A 记录必须先指向本机，否则 ACME 挑战失败，
  部署健康闸门会跟着失败——这是有意的，绿灯就等于域名真的解析过来了

## 首次部署前置

主机上（一次性，之后由流水线接管）：

一条命令（幂等，可重跑）：`APP_DOMAIN=<域名> bash scripts/deploy/bootstrap-host.sh`。它做的事：

1. 加 8 GB `/swapfile` 并 `vm.swappiness=10`。EC2 默认无 swap；1 GiB 内存的宿主机稳态下
   就会把大半个工作集压在 swap 里——t3.small（2 GB）时代的实测是稳态 1.5 GB、
   索引重建顶到 2 GB，内存减半后只会更多
2. 装 Docker：Amazon Linux 2023 官方源有 `docker`（25.x）但**没有 compose 插件包**，
   所以 engine 走 `dnf`、compose 走其 GitHub release 的 CLI 插件二进制；
   Ubuntu 26.04（`resolute`）官方源里**没有** `docker.io`，走 Docker 官方 apt 源。
   两条路径脚本按发行版自动选择
3. `git clone` 仓库到 `/opt/kc-cb-digital-base`（AL2023 基础镜像不含 git，脚本会先装）
4. 生成 `.env` 与 `.admin-credentials`（`APP_DOMAIN` 的 A 记录必须先指向本机）
5. 仓库 secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`（私钥全文；AL2023 的
   用户是 `ec2-user`，Ubuntu 镜像上才是 `ubuntu`）

换公网域名：

```bash
ssh -i <key> ec2-user@<host> 'bash -s' < scripts/deploy/set-domain.sh app.example.com
# 然后推 production 让容器按新域名重建
```

`set-domain.sh` 只改公网相关的三行，**不重新生成密钥**——数据库已经用当前的
`POSTGRES_PASSWORD` 初始化过了，整体重生成会把应用锁在自己的数据外面。

## 磁盘机制（28 GB 根卷）

镜像本身就是最大的一块，所以机制分两层：**让镜像小**，和**不让旧镜像堆积**。

**1. 镜像大小** —— 见 [runtime.md](./runtime.md) 的「runner 阶段的层纪律」，当前约 4.8 GB。
改 runner 阶段时不要把 `yarn cache clean` 和 `chown` 拆成独立的 RUN，否则立刻涨回 8.6 GB。

**2. 部署脚本的磁盘动作**（`scripts/deploy/deploy.sh`，顺序即机制）：

| 时机 | 动作 | 为什么 |
|---|---|---|
| 拉取前 | `docker image prune -af` | 清掉被取代的旧镜像。运行中容器的镜像被引用、**不会被删**，所以拉取失败仍留有回滚目标 |
| 拉取前 | 空间预检 | 以当前镜像大小 ×1.15 估算需求，不够就直接失败。填满根卷会连带把 Postgres 拖死，比部署失败更糟 |
| 启动后 | `docker image prune -af` | 此时被替换的镜像已无容器引用，回收它 |
| 结束 | 打印 `df -h /` | 每次部署都留下磁盘证据 |

**刻意不保留上一版镜像做回滚**：28 GB 装不下「两份镜像 + 一份正在拉取的新镜像」。
回滚靠重新拉取对应 SHA 的镜像，而不是靠本地缓存。

**3. 容器日志上限** —— `docker-compose.deploy.yml` 里所有服务都设了
`json-file` + `max-size=10m` + `max-file=3`（每容器上限 30 MB）。默认驱动**没有上限**，
而这个应用日志量不小，长期运行会慢慢吃满卷。

**4. 数据面** —— Postgres / Redis / Meilisearch 都在命名卷里。`docker image prune` 和
不带 `--volumes` 的 `docker system prune` 都不会碰它们。**永远不要加 `--volumes`。**

## 用另一个环境的数据替换线上库（review 用）

**前提：线上部署的必须是数据来源的那条分支。** dump 里带着源应用所有模块的表，部署一个更小的
应用，那些数据就没有界面可达——实测（2026-09-24）`main` 是 48 张框架表 / 9 个模块，
`feat/cross-border-erp` 是 195 张表 / 27 个模块。此后 `main` 的启用模块已增至 **39 个**
（`.mercato/generated/enabled-module-ids.generated.ts`），框架表数也随模块增长，这两个数字
只是那次实测的快照。

**必须对齐加密密钥。** 加密列与带 pepper 的查找哈希只有在
`TENANT_DATA_ENCRYPTION_FALLBACK_KEY` / `LOOKUP_HASH_PEPPER` 与源环境一致时才读得出来。

```bash
# 1. 源环境导出
docker exec <postgres容器> pg_dump -U postgres -Fc <db> > local-db.dump

# 2. 传到主机
scp local-db.dump ec2-user@<host>:/tmp/local-db.dump

# 3. 对齐密钥（走文件传递，值不进 argv、不进 shell history）
scp align-secrets.txt ec2-user@<host>:/tmp/ && \
ssh ec2-user@<host> 'bash scripts/deploy/align-secrets.sh /tmp/align-secrets.txt'

# 4. 替换数据库：自动做安全备份 → 停 app → DROP/CREATE 库 → 还原 → 起 app
ssh ec2-user@<host> 'bash scripts/deploy/restore-db-from-dump.sh /tmp/local-db.dump'
```

附件字节不在库里，要单独搬：

```bash
# macOS 的 bsdtar 会把扩展属性写成 ._* 实体文件，必须关掉，否则会多出成百个孤儿文件
COPYFILE_DISABLE=1 tar cf - -C <源>/storage attachments \
  | ssh <host> 'docker run --rm -i -v kc-cb-digital-base_attachments_storage:/dest redis:7-alpine tar xf - -C /dest'
```

搬完核对：文件数与路径清单 md5 应与源一致。

```bash
find attachments -type f ! -name '._*' | sort | md5sum     # 源
sudo find /var/lib/docker/volumes/kc-cb-digital-base_attachments_storage/_data \
  -type f ! -name '._*' | sed 's|.*/_data/||' | sort | md5sum   # 主机，应相同
```

**孤儿文件会被判为不一致**：`storage_ops audit` 的 C-7 要求磁盘与表严格对应，
`._*` 这类文件必须在搬完后删除。

**恢复后大概率要重设管理员密码。** 源环境 `.env` 里的 `OM_INIT_SUPERADMIN_PASSWORD`
常常已不是当前密码（本地跑久了会被改过），拿它登录会得到 401：

```bash
ssh ec2-user@<host> "cd /opt/kc-cb-digital-base && \
  docker compose -f docker-compose.deploy.yml exec -T app \
  sh -lc \"yarn mercato auth set-password --email superadmin@acme.com --password '<新值>'\""
```

这条命令本身就是**对齐是否成功的判据**：它按 email 解析账号，只有
`email_hash` 命中才会成功。而 `email_hash` 的命中取决于 pepper——
`resolveLookupPepper()` 依次读 `LOOKUP_HASH_PEPPER` →
`TENANT_DATA_ENCRYPTION_FALLBACK_KEY` → `TENANT_DATA_ENCRYPTION_KEY`，
取第一个非空值；查找时会同时尝试「带 pepper 的 v2 哈希」和「无 pepper 的 legacy 哈希」
两个候选。要确认对齐结果，可以比对应用算出的哈希与库里的值：

```bash
docker compose exec -T app node -e \
  "import('@open-mercato/core/modules/auth/lib/emailHash').then(m=>console.log(m.emailHashLookupValues('superadmin@acme.com')))"
docker compose exec -T postgres psql -U postgres -d open-mercato -tAc "select email_hash from users"
```

密码策略**默认只要求至少一个数字**（长度取 `OM_PASSWORD_MIN_LENGTH`，默认 8）；
大写字母与特殊字符分别由 `OM_PASSWORD_REQUIRE_UPPERCASE` / `OM_PASSWORD_REQUIRE_SPECIAL`
控制，本仓库（`.env.example`）两者均为 `false`。

**恢复后索引要重建**：Meilisearch 的索引在它自己的卷里，不随数据库一起搬，
不重建则搜索为空（Postgres 侧的 query index 是随库恢复的，列表页正常）。

```bash
docker compose exec -T app sh -lc "yarn mercato query_index reindex"
docker compose exec -T app sh -lc "yarn mercato search reindex"
```

两条管线实测表现不同，动手前先看这张表：

| 命令 | 实测结果 |
|---|---|
| `search reindex` | **正常完成**（39/39 实体，约 3 秒）。它重建的是**向量**索引，而向量检索需要 embeddings 提供方凭据；未配 `OPENAI_API_KEY` 之类时 `/api/search/index` 返回 503 `Vector search is unavailable`，属预期降级 |
| `query_index reindex` | **会卡死**。实测在含 `integrations` 数据的库上，enricher `integrations.external-id-mapping` 向 uuid 列传了空串（`invalid input syntax for type uuid: ""`），随后任务全部停在 `reindexing` 不再推进——`entity_index_jobs` 行数翻倍而计数不变、CPU 掉到 3%、日志无新行 |

`query_index` 卡死是**应用侧 bug，不是部署或资源问题**：本地库同样有 160 行卡在
`reindexing`，把机器从 2 GB 升到 8 GB 后现象不变。在它修好之前不要把
`query_index reindex` 放进部署流程；Postgres 侧的索引随库恢复，列表与详情页照常可用。

**安全边界**：本地库的 `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` 常常就是 `.env.example` 里那个
**公开占位值**。对齐密钥等于让 review 环境也用这个公开值——**该环境因此不能承载真实敏感数据**。
review 结束后应换回独立密钥并重新初始化。

## 回滚

镜像按 SHA 打标签，回滚 = 把 `production` 指回上一个好提交：

```bash
git push --force origin <good-sha>:production
```

流水线会用那个 SHA 重建镜像并部署（构建缓存命中，通常几分钟）。**数据库迁移是向前-only 的**，
涉及迁移的回滚不能只回退代码。

`production` 从 2026-09-29 起与 `main` 同保护（要求 PR、要求 `validate` + `guard-tree` 通过、要求线性
历史、禁止 force push 与删除分支、必需评审数 0、`enforce_admins=false`），所以上面的 force push
回滚仍由**仓库管理员绕过执行**；非管理员回滚要走 PR（把 `<good-sha>` 作为分支推上去、开 PR 到
`production`，`validate` + `guard-tree` 绿后 squash 合并）。两条路都会在远端留下记录。

## 已知取舍

- 主机对外**只开 HTTPS**。Caddy 未配 HSTS，也没配 `encode`（理由见上）；需要的话在
  `docker/caddy/Caddyfile` 里加，但改完要验证流式接口没被破坏。
- `INSTALL_CHROMIUM=0`：镜像不含 Chromium，Documents 的 PDF 导出返回 503。
  需要时给 `docker/build-push-action` 加 `build-args: INSTALL_CHROMIUM=1`，镜像增大约 400 MB。
- `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` 未设置：文档退化为单人编辑，不跑 `documents-collab` sidecar。
- 内存调优写在 `docker-compose.deploy.yml` 里，当前按 **t4g.micro（2 vCPU / 1 GiB）** 取值：
  server 堆 `--max-old-space-size=512`（`NODE_OPTIONS`）；**init 阶段单独一个更大的堆**
  `INIT_NODE_OPTIONS=--max-old-space-size=2048`——init 一次加载全部模块，实测 384 会在
  `Bootstrapping application...` 阶段 V8 OOM，所以容器命令按阶段给不同上限；
  `DB_POOL_MAX=5`、`shared_buffers=128MB`、redis `maxmemory=128mb`、
  Meilisearch `MEILI_MAX_INDEXING_MEMORY=268435456`（256 MiB，compose 给的是字节）。
  **换实例规格必须同步调这些值**：调小了 V8 会在内存还有余量时先撞堆上限，
  调大了则会让 app 和 Postgres 互相抢内存。`.env` 里的同名变量会覆盖 compose 默认值，
  所以两处都要改
- 邮件、AI、向量检索都需要额外凭据（`RESEND_API_KEY` / `OPENAI_API_KEY` 等），当前未配，
  相关功能静默关闭。

## 验证方式

```bash
# 流水线状态
gh run list --repo KcDevVanness/kc-cb-digital-base-main --workflow deploy

# 主机上：容器与健康检查
ssh -i <key> ec2-user@<host> 'cd /opt/kc-cb-digital-base && docker compose -f docker-compose.deploy.yml ps'
ssh -i <key> ec2-user@<host> 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/healthz'  # 期望 200

# 公网入口（证书 + 反代 + 应用链路）
curl -s -o /dev/null -w '%{http_code}\n' https://<APP_DOMAIN>/api/healthz   # 期望 200
curl -sI https://<APP_DOMAIN>/ | head -1                                     # 期望 HTTP/2 200

# 登录确实能保持会话：看 Set-Cookie 带 Secure，且走的是 https
curl -sS -D - -o /dev/null -X POST https://<APP_DOMAIN>/api/auth/login \
  --data-urlencode "email=<admin>" --data-urlencode "password=<pw>" | grep -i set-cookie

# 部署的确实是目标提交
ssh -i <key> ec2-user@<host> 'git -C /opt/kc-cb-digital-base log --oneline -1'
```

注意 `/api/auth/login` 只接受 **form-urlencoded**（框架用 `req.formData()` 解析），
发 JSON 会被当成空表单并返回 `400 Invalid email or password`。

## 相关

- 镜像构建与运行时契约：[runtime.md](./runtime.md)
- 本地环境：[../dev/setup.md](../dev/setup.md)
