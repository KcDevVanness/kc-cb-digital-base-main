# 构建与运行时

## 适用范围

本仓的镜像构建、启动入口、Railway / Docker Compose / AWS 三种部署形态、以及生产启动守卫。
具体云账号、域名、密钥值不在本文范围；`production` 分支的发布流水线与主机契约见
[cicd.md](./cicd.md)。

## 镜像构建（`Dockerfile`）

三个阶段，都是 `node:24-alpine`：

| 阶段 | 关键动作 | 产出 |
|---|---|---|
| `builder` | `yarn install` → `yarn generate` → `NODE_ENV=production yarn build` | `.mercato/next`（Next 构建产物） |
| `dev` | 只装依赖，`CMD` 走 `docker/scripts/dev-entrypoint.sh` | 容器内跑 dev（`EXPOSE 3000 4101`） |
| `runner` | `yarn workspaces focus --all --production`，从 builder 拷 `.mercato/next`、`src`、`scripts`、`public`、`types`、配置 | 生产镜像，`CMD ["yarn","start"]` |

runner 阶段的**层纪律**（改动前请先读这段，否则镜像会膨胀到 8.6 GB）：

- `omuser` 在装依赖**之前**创建，`chown` 与 `yarn cache clean` 与 `yarn workspaces focus`
  写在**同一条 RUN** 里。拆成后面的独立 RUN 会各留下一整份副本：实测
  `RUN adduser ... && chown -R omuser:omuser /app` 单独成层时占 **2.51 GB**
  （写时复制把整个 node_modules 又抄了一遍），残留的 Yarn 全局缓存占 **1.3 GB**
- 后续 `COPY --from=builder` 一律带 `--chown=omuser:omuser`，不要再补 `chown -R`
- 净效果：`/app` 实际内容 2.3 GB，镜像 8.6 GB → 约 4.8 GB

要点：

- runner 以非 root 用户 `omuser`（uid `1001`）运行
- **构建期参数**（改动需重新构建，不是运行时可变）：
  - `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` —— 烤进前端的协作文档 ws 地址，不设则文档退化为单人编辑
  - `INSTALL_CHROMIUM=1` —— 装上 Chromium 以支持 Documents 的 PDF 导出；**不装则 PDF 导出返回 503**
  - `CONTAINER_PORT`（默认 `3000`）、`DOCUMENTS_COLLAB_PORT`（默认 `4101`）
  - `OPEN_MERCATO_DOCKER_REGISTRY_HOST` —— 构建时把 `.yarnrc.yml` 里的 `localhost` 仓库地址改写到宿主
- runner 里**没有** devDependencies，也没有 `.env`：所有运行时配置必须由环境变量注入

## 启动入口

| 场景 | 命令 | 做什么 |
|---|---|---|
| 生产（通用） | `yarn start` → `yarn mercato server start` | 起 Next 生产服务 |
| Railway（Web） | `sh ./scripts/railway-start.sh` | 设 `CACHE_STRATEGY=redis`、`QUEUE_STRATEGY=async` → 跑 `docker/scripts/init-or-migrate.sh` → `.mercato/generated` 缺失则 `yarn generate` → `yarn start` |
| Railway（Worker） | `sh ./scripts/railway-worker.sh` | 同上，但 `AUTO_SPAWN_WORKERS=false`，最后 `yarn mercato queue worker --all` |
| Docker Compose（全栈） | `docker-compose.fullapp.yml` 的 app 服务 | `init-or-migrate.sh` → `yarn start` |
| AWS（`production` 分支） | `docker-compose.deploy.yml` 的 app 服务 | 同上，但 `image:` 来自 GHCR，主机不构建 |

Web 与 Worker 用**同一个镜像**，只有启动命令不同。Worker 必须显式关掉自动拉起（两个
环境变量都要设，框架里两份都读），否则会与独立 Worker 抢队列。

## 健康检查

`GET /api/healthz` —— 探测 database 与 redis，单次探测 1.5s 超时。
`railway.toml` 用它做 healthcheck（`healthcheckTimeout = 60`，失败重启最多 3 次）。

## 环境变量契约

runner 镜像里没有 `.env`，缺配置的表现是启动失败或功能静默降级。

| 变量 | 作用 | 备注 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | 必需；镜像用 pgvector（`pgvector/pgvector:pg17-trixie`） |
| `REDIS_URL` / `CACHE_REDIS_URL` | 缓存与队列后端 | Railway 脚本把 `REDIS_URL` 兜底成 `CACHE_REDIS_URL` |
| `CACHE_STRATEGY` / `QUEUE_STRATEGY` | 缓存/队列实现 | Railway 脚本默认设为 `redis` / `async` |
| `JWT_SECRET` | 会话签名 | **生产启动硬校验**，见下 |
| `APP_URL` | 对外基址，用于邮件、onboarding 回跳 | 必须与实际访问地址一致 |
| `TENANT_DATA_ENCRYPTION` 等 | 租户字段级加密 | fullapp compose 里默认 `true`；生产用真实密钥，勿用示例值 |
| `OM_PASSWORD_*`（4 个） | 账号密码规则：创建用户 / 修改密码 / 重置密码 / `auth set-password` 共用 | 本仓库设为 **≥8 位 + 至少一个数字**，见下 |

### 密码策略：`OM_PASSWORD_*`

`OM_PASSWORD_MIN_LENGTH`、`OM_PASSWORD_REQUIRE_DIGIT`、`OM_PASSWORD_REQUIRE_UPPERCASE`、
`OM_PASSWORD_REQUIRE_SPECIAL` 是**唯一**的策略来源（`@open-mercato/shared/lib/auth/passwordPolicy`）：
服务端（API 路由、命令、CLI）与浏览器（创建用户 / 修改密码 / 重置密码表单的提示与预校验）读同一组值。

- 本仓库（`.env`、模板 `.env.example`）：`MIN_LENGTH=8`、`REQUIRE_DIGIT=true`、
  `REQUIRE_UPPERCASE=false`、`REQUIRE_SPECIAL=false` —— **8 位以上且含数字即通过**，大小写与特殊字符不限。
- 另一个要记住的边界：安装版策略**没有"必须含字母"这个开关**，所以纯数字的 8 位密码也会通过；
  要强制含字母得再加一层校验（目前没做）。
- 浏览器侧：根 layout 读取这 4 个键 → 交给 `AppProviders` → 由 `src/lib/password-policy-env.ts` 写进浏览器的
  `process.env`。**必须绕这一手**：Next 只在客户端包里内联**静态** `process.env.KEY` 读取，而安装版表单是
  动态取键（`env[rawKey]`）——`NEXT_PUBLIC_*` 和 `next.config.ts` 的 `env:` 块都到不了那里。漏掉这一步时表单会
  退回框架默认规则（6 位 + 数字 + 大写 + 特殊字符），把服务端本来会接受的密码拦在浏览器里。
- 值是按请求从服务端下发的，不是构建期内联的：改 `.env` 后**重启 dev server 或应用进程即可，无需重新构建**。
  容器镜像在没有 `.env` 的情况下构建也不影响——浏览器拿到的仍是运行时那份策略。
- 演示账号的密码值（`secret`）本身不满足当前策略，写库时需临时放开策略，见
  [`docs/dev/setup.md`](../dev/setup.md) 与
  [demo-credentials-must-survive-smoke-tests.md](../../.ai/lessons/demo-credentials-must-survive-smoke-tests.md)。

### 启动守卫：`JWT_SECRET`

`src/instrumentation.ts` 在 `NEXT_RUNTIME=nodejs` 且非 build 阶段时调用
`assertJwtSecretPolicy()`。命中占位/过短/缺失的密钥时：

- 打印原因到 **stderr**
- 直接 `process.exit(1)`

之所以是 `exit` 而不是抛错：Next 会把 instrumentation 的异常记成 unhandled rejection
后继续服务，编排系统会把它当健康实例，永远不会回滚。

实测（`JWT_SECRET=change-me-dev-secret` 起生产服务）：

```
[auth.jwt] Refusing to run in production with an unsafe signing secret: JWT_SECRET is set to a
placeholder value published in this repository's examples, so anyone can forge tokens for this
deployment. Generate a real one with `openssl rand -hex 32`.
→ 进程退出码 1
```

`.env` 里的 `change-me-dev-secret` 只能用于 dev。

## 数据库迁移

- Compose 与 Railway 路径都会先跑 `docker/scripts/init-or-migrate.sh`（首次初始化或迁移）
- CLI 路径：`yarn db:generate` 生成 → **先 review 生成的 SQL 与 snapshot** → `yarn db:migrate`
- 迁移是向前-only 的；不要为了验证去迁移，验证用 `yarn test:integration:ephemeral`

## 验证方式

```bash
# 生产镜像能起来（本地用真密钥，不要写进 .env）
JWT_SECRET=$(openssl rand -hex 32) npx next start -p 3200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3200/api/healthz   # 期望 200

# 启动守卫确实生效（期望进程退出码 1）
JWT_SECRET=change-me-dev-secret npx next start -p 3201; echo "exit=$?"
```

## 相关

- 本地环境（依赖服务、初始化、命令）：[../dev/setup.md](../dev/setup.md)
- 目录与生成物边界：[../dev/architecture.md](../dev/architecture.md)
