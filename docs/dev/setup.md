# 本地开发环境搭建

## 适用范围

本仓（`kc-cb-digital-base-min`，Open Mercato `0.8.0` standalone app）的本地开发。
端口与容器名来自本机 `.env` 实测，其他环境可能不同。

## 前置

| 依赖 | 要求 | 出处 |
|---|---|---|
| Node | `>= 24` | `package.json` 的 `preinstall` 会硬性检查并退出 |
| Yarn | Corepack 管理 | `Dockerfile` 里用 `corepack enable` |
| Docker | 用于依赖服务 | `docker-compose.yml` |

## 依赖服务

`docker-compose.yml` 定义了 postgres / redis / meilisearch / localstack（后两者按 profile 或按需启动）。
本机当前只起了前两个，端口取自 `.env`：

| 服务 | 容器名（本机实测） | 端口 |
|---|---|---|
| PostgreSQL + pgvector | `kc-cb-digital-base-min-postgres-1` | `5532`（`POSTGRES_PORT`） |
| Redis | `kc-cb-digital-base-min-redis-1` | `6479`（`REDIS_PORT`） |

数据库连接串：`DATABASE_URL=postgres://postgres:postgres@localhost:5532/kc_cb_base_min`。

## 首次初始化

```bash
cp .env.example .env      # 然后按需改端口/密钥
yarn install
yarn initialize           # 建表 + 种子数据；演示账号邮箱会打印在终端，密码默认 secret
```

`.env` 里的 `JWT_SECRET=change-me-dev-secret` 是**占位值**：dev 能用，
生产启动会被 `src/instrumentation.ts` 的 `assertJwtSecretPolicy()` 直接 `exit(1)` 拒绝
（生成真值：`openssl rand -hex 32`）。见 [deploy/runtime.md](../deploy/runtime.md)。

## 日常命令

```bash
yarn dev          # dev supervisor：Next dev + MCP + 生成物热更新
yarn generate     # 改了 src/modules.ts / 路由 / 页面 / 事件 / 组件 / i18n 字典后必跑
yarn db:generate  # 改了实体后生成迁移，先 review SQL 再 apply
```

`yarn dev` 的端口行为：supervisor 默认要 `3000`；该端口被占用时（例如隔壁项目
`kc-cb-digital-base` 正在跑）它会把自己的 Next dev 落到 `3001`，并在启动日志里提示
"Another next dev server is already running"。以日志里打印的实际端口为准。

## 验证命令

提交前跑整套：

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build
```

**`yarn dev` 不做类型检查**——Turbopack dev 只转译，不改类型。`yarn build`
的 `Running TypeScript` 阶段才会跑 `tsc`。所以本地改动必须显式跑 `yarn typecheck`，
否则类型错误会一直潜伏到构建或 CI 才暴露（本仓出现过一次，见
[pitfalls](../pitfalls/README.md) 与 `.ai/lessons/agent-sandbox-sources-tsconfig.md`）。

## 验证方式

```bash
yarn dev                                     # 应打印实际监听端口且无 ⨯ 前缀的编译错误
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/healthz
```

## 相关

- 目录职责与请求链路：[architecture.md](./architecture.md)
- 多语言：[i18n.md](./i18n.md)
- dev 运行时诊断面板的坑：[../pitfalls/dev-runtime-stale-incident.md](../pitfalls/dev-runtime-stale-incident.md)
