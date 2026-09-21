# 架构与目录职责

## 适用范围

本仓的目录划分、模块启用方式、请求链路和生成物边界。框架内部实现不在本文范围，
需要时按根 `AGENTS.md` 的 `framework-context` 轴去查。

## 顶层目录

| 路径 | 职责 | 能不能手改 |
|---|---|---|
| `src/modules.ts` | **模块启用清单**（唯一权威）。加模块 = 加一行 | ✅ 手改 |
| `src/modules/<id>/` | app 自有模块：实体、路由、命令、页面、i18n | ✅ 手改 |
| `src/app/` | Next App Router 入口：layout、页面、`api/[...slug]` 分发 | ✅ 手改 |
| `src/di.ts` | app 级 DI registrar，**在所有模块 DI registrar 之后**执行 | ✅ 手改 |
| `src/bootstrap.ts` / `src/bootstrap-api.ts` | 页面运行时 / API 运行时的 bootstrap | ✅ 手改 |
| `src/bootstrap-common.ts` | 两个 bootstrap 共享的进程级注册（模块、实体、DI、注册表） | ✅ 手改 |
| `src/instrumentation.ts` | Next instrumentation：启动期守卫（如 JWT 密钥策略）、遥测 | ✅ 手改 |
| `src/official-modules.generated.ts` | 版本化的生成清单（要跟着仓库走） | ❌ 生成 |
| `.mercato/generated/**` | 生成物：模块注册表、实体、路由元数据、i18n 分片等 | ❌ 生成 |
| `node_modules/**` | 框架包 | ❌ 只读 |

`.mercato/` 不进 git（被忽略），`yarn generate` 可以重建；`src/official-modules.generated.ts`
是刻意的例外——它是版本化资产，`yarn clean-generated` 不该清掉它。

## 启用中的模块

`src/modules.ts` 当前启用 26 个，分三类：

- **平台基础（12）**：`auth`、`directory`、`configs`、`entities`、`query_index`、
  `api_docs`、`audit_logs`、`notifications`、`dashboards`、`attachments`（`@open-mercato/core`）、
  `events`（`@open-mercato/events`）、`search`（`@open-mercato/search`）
- **ERP 业务（7，`@open-mercato/core`）**：`catalog`、`customers`、`sales`、`wms`、
  `currencies`、`dictionaries`、`feature_toggles`——见
  [`.ai/specs/2026-09-21-erp-core-module-activation.md`](../../.ai/specs/2026-09-21-erp-core-module-activation.md)
- **app 自有（5）**：`currency_policy`、`scope_guards`、`purchasing`（供应商/采购单/阶段付款）、
  `cross_border`（发运/在途/出口单证）、`platform_ops`（平台渠道/订单镜像/结算/对账）——见
  [`business-architecture.md`](./business-architecture.md)；每个模块的实现契约、验证命令与回滚方式
  写在 `src/modules/<id>/README.md`
- **集成底座（2，`@open-mercato/core`）**：`integrations`（外部 id 映射与 provider 注册）、
  `data_sync`（流式导入导出运行、游标、进度）——Phase 4 传输层的接入点

注意：`src/modules/catalog|customers|sales|wms|currencies|dictionaries|feature_toggles/`
这些目录本身只放该模块的 `zh` 语言覆盖文件，模块代码仍在框架包里。

条件启用（默认关闭，靠 `.env` 打开）：`record_locks`、`system_status_overlays`、`sso`、
`security`、`agent_orchestrator`、`agent_examples`——都由
`OM_ENABLE_ENTERPRISE_MODULES*` 控制。

`src/modules/` 下存在但**未启用**的目录（`example`、`example_customers_sync`、
`agent_examples`、`ratelimit_probe`）不会被生成器扫描，其字典/路由都不会进产物。
判断一个模块是否真正生效，看 `src/modules.ts`，不要看目录是否存在。

## 请求链路

```
Next 请求
  → src/app/layout.tsx                根 layout：解析语言、挂 I18nProvider、AppProviders
  → bootstrap()（模块作用域调用）       createBootstrap(...) 注册模块/实体/DI
      → src/bootstrap-common.ts        进程级注册
      → src/di.ts register()           app 级 DI（在模块 DI 之后）
  → src/app/api/[...slug]/route.ts     API 统一分发（api-route-shards.generated）
  → makeCrudRoute / 命令 / 服务        业务实现
```

`src/di.ts` 的 `register()` 是**唯一**「在所有模块 DI registrar 之后」的钩子——
需要覆盖模块注册的东西（例如语言集 resolver）必须放这里，放在模块作用域会被模块覆盖。

## 生成物

`yarn generate` 产出（部分）：

| 产物 | 内容 |
|---|---|
| `modules.app.generated.ts` | 启用模块 + 其路由/事件/worker/实体 |
| `modules.i18n.<locale>.generated.ts` | 按语言切分的模块字典分片 |
| `modules.i18n.loaders.generated.ts` | 语言 → 分片的加载器（新增语言后必须重跑） |
| `api-route-shard.*.generated.ts` | API 路由分片 |
| `entities.generated.ts` / `entities.ids.generated.ts` | 实体注册表与 ID |
| `openapi.generated.json` | OpenAPI 文档 |

**哪些改动要重跑 `yarn generate`**：`src/modules.ts`、路由、页面、事件、组件、
widget、agent、tool、workflow、以及任何 `i18n/<locale>.json` 的新增/删除。

## 硬性约束

- 不跨模块用 ORM 关联——用 ID / 快照 / 事件 / enricher / extension / 可选 DI
- 不在模块之间直接 import 对方的实体
- 不改 `node_modules/`、`.mercato/generated/**`、已发布的迁移
- 实体放 `src/modules/<id>/data/entities.ts`；可编辑记录要有 `updated_at`/`updatedAt`，
  自定义 update/delete 客户端要带版本号并处理 409

## 验证方式

```bash
yarn generate && yarn typecheck
grep -n "id: '" src/modules.ts            # 与 .mercato/generated 里出现的一致
```

生成物与 `src/modules.ts` 不一致时，`yarn generate` 会重写；仍不一致说明模块包本身有问题。
