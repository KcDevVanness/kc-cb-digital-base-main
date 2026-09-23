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
是刻意的例外——它是**版本化**生成物（随仓库提交），来源是 `official-modules.json`
（+ `official-modules.local.json` 覆盖），不要手工编辑，也不要当成可丢弃的生成物删掉。

## 启用中的模块

`src/modules.ts` 当前启用 32 个 = 官方 21 + app 自有 11：

- **平台基础（12，官方）**：`auth`、`directory`、`configs`、`entities`、`query_index`、
  `api_docs`、`audit_logs`、`notifications`、`dashboards`、`attachments`（`@open-mercato/core`）、
  `events`（`@open-mercato/events`）、`search`（`@open-mercato/search`）
- **ERP 业务（7，官方 `@open-mercato/core`）**：`catalog`、`customers`、`sales`、`wms`、
  `currencies`、`dictionaries`、`feature_toggles`——见
  [`.ai/specs/2026-09-21-erp-core-module-activation.md`](../../.ai/specs/2026-09-21-erp-core-module-activation.md)
- **集成底座（2，官方 `@open-mercato/core`）**：`integrations`（外部 id 映射与 provider 注册）、
  `data_sync`（流式导入导出运行、游标、进度）——Phase 4 传输层的接入点
- **app 自有（11，`from: '@app'`）**：`products`（产品主数据：类型/类目/商品/三档价）、
  `purchasing`（供应商/采购单/阶段付款）、`sourcing`（供应商报价与导入映射）、
  `trade_docs`（采购销售合同、进出口发票）、`cross_border`（发运/在途/出口单证）、
  `export_finance`（收汇按订单 / 出口退税按柜 + 订单档案与柜档案只读投影）、
  `internal_sales`（对分公司内部销售的自建界面，引擎仍是官方 `sales`）、
  `parties`（交易对手方主数据：买方/分公司/服务方 + 银行信息）、
  `platform_ops`（平台渠道/订单镜像/结算/对账）、`currency_policy`（汇率主数据与币种字典对账，
  无页面）、`scope_guards`（auth 管理命令越权写入拦截，无页面）——见
  [`business-architecture.md`](./business-architecture.md)；每个模块的实现契约、验证命令与回滚方式
  写在 `src/modules/<id>/README.md`

官方模块的后台页面清单按模块生成在 `.ai/guides/modules/<id>/backend-pages.md`；侧边栏入口来自
这些页面 metadata 的 `pageGroup`/`pageOrder`（`pageContext: 'settings'` 的落在 Settings 面板），
所以隐藏官方 UI = 覆盖页面路由清单，而不是改框架代码。

### 官方 UI 的隐藏策略

app 自建了业务面（`products`/`purchasing`/`trade_docs`/`platform_ops`/`cross_border`/`sourcing`/`export_finance`/`internal_sales`/`parties`），
所以安装的 ERP 业务模块**保持启用**（实体、命令、事件、API、ACL 是数据层，继续被自建模块使用），
只隐藏它们自带的 admin UI。写法在 `src/modules.ts` 的 `entry.overrides.routes.pages`：

- `{ metadata: { navHidden: true } }` —— 所有页面（列表/索引/配置页，以及 create/detail/edit 表单页）：
  页面仍可 URL 直达，但从主导航、Settings 面板、profile 菜单全部消失（`buildAdminNav` 在建条目时
  先跳过 `navHidden`，再按 `pageContext` 分组）。覆盖 metadata 是增量的，原有 `title`/`group`/`icon` 保留。
- 不用 `null`。`null` 会把路由清单条目整条摘除，URL 直接 404。这些 URL 是**仍在启用的**子系统的
  深链目标：官方通知类型（`sales.order.created`/`sales.quote.created` → `/backend/sales/orders|quotes/{id}`、
  `catalog.product.low_stock` → `/backend/catalog/products/{id}`、`customers.deal.won|lost`、
  `wms.inventory.low_stock` → `/backend/sales/orders/{id}`）、仍可访问的官方列表的行内链、
  message-object href、catalog search presenter。通知的 `linkHref` 在创建时就冻结成行数据，
  所以摘除路由会让**已经存在**的通知点开即 404，改通知类型也救不回来——只能让 URL 继续可解析。

已按此策略隐藏的模块：`catalog`（8 个产品/类目页 + `config/catalog` 配置页）、`customers`、`sales`、`wms`、`currencies`、
`feature_toggles`（全部 `navHidden`）。隐藏只作用于导航：模块的 API/命令/实体/ACL
不受影响，页面自身的 `requireFeatures` 也照旧生效，改回一行即恢复。

`config/catalog` 是 2026-09-23 追加的一项（业主口径：Settings 面板条目太多）：页面只维护
catalog 价格类型与欧盟单位价展示开关，本部署没有自有面读它（价格词表在 `products_prices.price_tier`，
`purchasing`/`sourcing` 用自己的 `supplier_cost`/`company_offer` 码，`catalog_price_kinds` 为空表），
但 catalog 搜索 presenter 会把 `catalog:catalog_price_kind` 的结果链到该 URL，所以仍走 `navHidden` 而不是 `null`。

**唯一的例外是 `dictionaries`**：字典库的页面体是 app 自建的
（`src/modules/dictionaries/backend/config/dictionaries/page.tsx` 遮蔽包内同名文件），而 app 的主数据下拉
（币种、单位、国家/地区、港口、承运人、付款方式、运输方式、平台、报价分类）都读它维护的词表，所以
`/backend/config/dictionaries` **不隐藏**（`src/modules.ts` 里 `{ id: 'dictionaries', from: '@open-mercato/core' }`，
落到 Settings 的「Module Configs」分组，门禁仍是包内 `page.meta.ts` 的 `dictionaries.view` + `dictionaries.manage`）。
页面按组织展示与写入：选中具体组织只能改该组织的字典（上级组织的行标「继承」且只读），「所有组织」下整页只读
（该状态下 API 会把写落到账号归属组织）。契约、机制与回滚见
[`src/modules/dictionaries/README.md`](../../src/modules/dictionaries/README.md)。

坑：顶层 `overrides.pages` **不是**合法 domain。dispatcher 只遍历固定的 `DOMAIN_KEYS`
（`ai`/`routes`/`events`/`workers`/`widgets`/`notifications`/`interceptors`/`commandInterceptors`/
`enrichers`/`guards`/`cli`/`setup`/`acl`/`di`/`encryption`/`nav`），未知键既不生效也不告警——
页面路由必须写在 `routes.pages` 下，key 是页面 pathname。

注意：`src/modules/auth|catalog|customers|sales|wms|currencies|feature_toggles|configs|directory|entities|query_index|attachments|dashboards|notifications|audit_logs|search/`
这些目录本身只放该模块的 `zh` 语言覆盖文件，模块代码仍在框架包里（`api_docs`、`events`、
`integrations`、`data_sync` 目前还没有覆盖层）。**`dictionaries` 是唯一例外**：除语言覆盖外还放自建的页面体
（`backend/config/dictionaries/page.tsx`）与 `page.meta.ts` 转出（见上）。

条件启用（默认关闭，靠 `.env` 打开）：`record_locks`、`system_status_overlays`、`sso`、
`security`、`agent_orchestrator`、`agent_examples`——都由
`OM_ENABLE_ENTERPRISE_MODULES*` 控制。

`src/modules/` 下存在但**未启用**的目录（`example`、`example_customers_sync`、
`agent_examples`、`ratelimit_probe`）不会被生成器扫描，其字典/路由都不会进产物。
判断一个模块是否真正生效，看 `src/modules.ts`，不要看目录是否存在。

## 顶栏与通知面板

顶栏外壳是 `src/components/BackendHeaderChrome.tsx`（铃铛按 `notifications.view` 功能位决定是否渲染），
`src/components/NotificationBellWrapper.tsx` 把 `@open-mercato/ui` 的 `NotificationBell` 接进来
（同时注入 `customRenderers`）。通知条目有两条点进去的路径：

| 入口 | 行为 |
|---|---|
| 条目本体 | 标为已读 + 打开 `linkHref`（通知创建时冻结的深链），任何时候都可用 |
| 条目里的动作按钮（查看订单 / 查看报价 / …） | POST `/api/notifications/{id}/action`，服务端返回 `href` 后跳转 |

动作是**一次性**的：同一个动作再次执行，服务端答 `409 Notification action already executed`，响应里不带
`href`。而上游给 `sales.order.created`、`sales.quote.created`、`wms.inventory.low_stock`、
`wms.inventory.reservation_shortfall` 写的 renderer **只在动作响应里有 `href` 时才跳转**，并且无论
`status` 都继续画按钮——于是第一次点击能跳，之后每次点击都是死点击（只弹"执行操作失败"）。

`src/components/notifications/navigatingActionRenderers.tsx` 用 renderer 包装（props transform：不改上游
文件、不复制 UI）把这四个类型的点击钉在 `linkHref` 上：宿主动作照常执行（首次记录 `action_taken`），
重复点击即使 409 也照样打开单据。

**以后新增 renderer 类型的判断**：动作是"打开文档"（没有 `commandId`）就一并包进来；动作是真实决策
（有 `commandId`）的类型**不要**包——重复点击必须保留服务端的拒绝语义。

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
widget、agent、tool、workflow、以及**模块级**字典 `src/modules/<id>/i18n/<locale>.json` 的新增/删除
（生成器按磁盘上存在的语言文件切分片）。app 级字典 `src/i18n/<locale>.json` 不经过生成器，改它不用重跑
（见 [i18n.md](./i18n.md)）。

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
