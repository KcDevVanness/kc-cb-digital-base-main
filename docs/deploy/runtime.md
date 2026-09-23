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
