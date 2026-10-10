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

`docker-compose.yml` 定义了 postgres / redis / meilisearch / minio（后两者按 profile 或按需启动；
minio 是 S3 兼容的附件彩排端点，见 [`../deploy/storage.md`](../deploy/storage.md)）。
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

### 商品单一存储改造后的开发库重建（2026-10-10）

「catalog 单一商品存储」改造（[spec](../../.ai/specs/2026-10-10-catalog-single-store.md)）**不写数据迁移**：
`products_products` / `products_variants` / `products_prices` / `products_types` / `products_categories`
五表与 `product_codes` 的规则/台账两表由新迁移**删除**，SKU 与商品数据重建在官方 `catalog` 表上。
开发库按「重建」处理：

```bash
# 1) 应用/删除表结构（迁移由 yarn db:generate 生成并审阅后应用；见 docs/dev/parallel-development.md 的库分配）
yarn db:migrate
# 2) 装载业务自定义字段（product_erp 字段集，catalog 商品/变体上）
yarn mercato entities install
# 3) 重新播种字典（品牌/类别）与其它 seed
yarn mercato seed:defaults --module product_codes
# 4) 单位词表（`supplier_product_unit` 的 11 个海关常用码 + catalog `unit` 字典缺的三个码）
yarn mercato seed:defaults --module products
```

历史商品数据不迁移：需要演示数据时按新流程重新建档（供应商产品库「建商品档案」或自有商品库新建）。

## 演示账号

| 账号 | 角色 | 密码 |
|---|---|---|
| `superadmin@acme.com` | superadmin | `$OM_INIT_SUPERADMIN_PASSWORD`（本机写在 `.env`，不入版本库） |
| `admin@acme.com` | admin | `secret` |
| `employee@acme.com` | employee | `secret` |

这三个账号是多个组件写死的开发约定，改掉就会一起失联：dev supervisor 的登录预热
（`scripts/dev-runtime.mjs` 的 `resolveWarmupCredentials`）、框架集成测试
（`@open-mercato/core/helpers/integration/auth.ts`）、`yarn mercato init` 的种子、
`.ai/skills/om-prepare-test-env`。**要保的不是某个固定字符串，而是"值一致"**：superadmin 的值取自
`OM_INIT_SUPERADMIN_EMAIL` / `OM_INIT_SUPERADMIN_PASSWORD`（这两个键没设时退回
`superadmin@acme.com` / `secret`），admin / employee 固定 `secret`。只改数据库、或只改 `.env`
的一边，都会让预热和集成 helper 401。

改 superadmin 密码时**两边一起改**：

```bash
# 1) 写库：当前策略（≥8 位 + 至少一个数字，见 docs/deploy/runtime.md）会拒绝 `secret` 这类值，
#    需临时放开策略
OM_PASSWORD_MIN_LENGTH=6 OM_PASSWORD_REQUIRE_DIGIT=false OM_PASSWORD_REQUIRE_UPPERCASE=false \
  OM_PASSWORD_REQUIRE_SPECIAL=false \
  yarn mercato auth set-password --email superadmin@acme.com --password '<新值>'
# 2) 让消费方跟着走：把 .env 里的 OM_INIT_SUPERADMIN_PASSWORD 改成同一个值，再重启 yarn dev
```

冒烟测试尽量别动这些账号：`admin@acme.com` / `secret` 一般就够；要测"改密码"这个流程请用 `ru-*` 测试账号。
`set-password` 直写 `users.password_hash`，不经过命令通道——`action_logs` 里查不到这次改动。
规则记录：[demo-credentials-must-survive-smoke-tests.md](../../.ai/lessons/demo-credentials-must-survive-smoke-tests.md)。

自查登录：`POST /api/auth/login` 只吃 **form-urlencoded**（`email`/`password`/可选 `tenantId`），
JSON 体会被解析成空表单并返回 400：

```bash
curl -s -X POST http://localhost:3100/api/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=admin@acme.com' --data-urlencode 'password=secret'
```

（`superadmin@acme.com` 的密码取自 `.env` 的 `OM_INIT_SUPERADMIN_PASSWORD`，不是固定串——见上表；这里用密码固定为 `secret` 的 `admin@acme.com`。）

## 日常命令

```bash
yarn dev          # dev supervisor：Next dev + MCP + 生成物热更新
yarn generate     # 改了 src/modules.ts / 路由 / 页面 / 事件 / 组件 / i18n 字典后必跑
yarn db:generate  # 改了实体后生成迁移，先 review SQL 再 apply
                  # 商品单一存储改造会生成 drop products_* 与 product_codes 规则/台账表的迁移，按「无 back-compat」直接应用
```

`yarn dev` 的端口：Next dev 的对外基址由 `.env` 的 `APP_URL` 决定（本机端口分配块里是
`http://localhost:3100`），启动日志打印的 `Local:` 行与 `.mercato/dev-runtime-status.json`
的 `upstream.publicUrl` 是权威值；配置的端口被占用时运行时会落到一个空闲端口并把实际端口打进日志，
**以日志为准，不要照抄旧文档里的端口**。生产/其他环境同理：`APP_URL` 必须与实际访问地址一致，
否则同源检查（`shared:origin-check`）会拒绝浏览器请求——本机实测过 `APP_URL=3100` 但访问 `3000`
时 `POST /api/auth/session/refresh` 被拒（日志 WARN，`allowedOrigins=["http://localhost:3100"]`）。
端口块见本机 `.env` 顶部的 `PROJECT-LOCAL PORT ALLOCATION` 注释（`.env.example` 不含此块）与 [`parallel-development.md`](./parallel-development.md)。

**发信（邮件）**：本仓 dev 没有配置发信 provider，平台的 `sendEmail` 会抛 `EMAIL_TRANSPORT_NOT_CONFIGURED`。
而引擎的报价发出路由（`POST /api/sales/quotes/send`）**先提交状态再发信**，于是「状态已变 `sent`、界面报失败」同时出现。
本地联调请在该工作树的 `.env` 里设 `OM_DISABLE_EMAIL_DELIVERY=true`（`sendEmail` 直接返回，不外发）；
想连接受链接一起验证可再加 `OM_TEST_MODE=true`，每封邮件（含链接）会追加到 `/tmp/open-mercato-email-capture.jsonl`。
**生产不要设这两个变量**（`.env.example` 里同样有注释）。

## 验证命令

提交前跑整套：

```bash
yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build
```

`node scripts/check-lessons.mjs` 是 app 与 harness 共用的门禁（校验 `.ai/lessons/`），`.ai/agentic.config.json` 与 `.github/workflows/validate.yml` 都跑它。

**`yarn dev` 不做类型检查**——Turbopack dev 只转译，不改类型。`yarn build`
的 `Running TypeScript` 阶段才会跑 `tsc`。所以本地改动必须显式跑 `yarn typecheck`，
否则类型错误会一直潜伏到构建或 CI 才暴露（本仓出现过一次，见
[pitfalls](../pitfalls/README.md) 与 `.ai/lessons/agent-sandbox-sources-tsconfig.md`）。

## 验证方式

```bash
yarn dev                                     # 应打印实际监听端口且无 ⨯ 前缀的编译错误
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/api/healthz   # 端口用日志 Local: 行的
```

## 相关

- 目录职责与请求链路：[architecture.md](./architecture.md)
- 多语言：[i18n.md](./i18n.md)
- dev 运行时诊断面板的坑：[../pitfalls/dev-runtime-stale-incident.md](../pitfalls/dev-runtime-stale-incident.md)
