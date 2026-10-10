# Single Product Store on the Official Catalog — Cut, Merge, Rebuild

**Date**: 2026-10-10
**Status**: Ready for implementation (Phase 1) — owner approved the option set on 2026-10-10; Phase 0 (baseline docs) rides this PR

> 本规格取代 / 修订：`.ai/specs/2026-09-22-products-and-trade-docs.md`（自建主数据的决定）、
> `.ai/specs/2026-09-22-product-variants.md`（变体归属 + 推迟的 wms round）、
> `.ai/specs/2026-09-23-product-taxonomy-consolidation.md`（分类法收敛）、
> `.ai/specs/2026-09-24-supplier-product-code-rules.md` + `2026-09-24-supplier-code-issuance.md`（编码规则 → 停用待重做）、
> `.ai/specs/2026-09-22-supplier-product-library.md`（关联章节）、
> `.ai/specs/2026-09-28-product-distribution-to-branches.md`（分发 → 在 catalog 上重造）。
> `src/modules/products/README.md` 记载的「官方链切到本模块」计划作废（方向相反）。
> 被取代的规格顶部一律加 superseded 标注（照 `.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md` 的做法）。

## TLDR

把商品数据收敛到**一个存储**：官方 `catalog`（product / variant / price / category + 自定义字段）。
自建表族 `products_products` / `products_types` / `products_categories` / `products_variants` / `products_prices`
退役；`purchasing_supplier_products` 保留但只装**供应商方向**的字段，指针改指 `catalog_product_id`；
`product_codes` 的自动编码机制停用，**SKU 全部手填**（保留组织内唯一 + 旧码别名兜底）。
UI 两套全部自绘：供应商产品库保持现版式，自有商品库按同一版式重建、只显示业务字段白名单。
执行顺序：**先砍 → 再合并 → 后重做**（SKU 发号重做另立切片）。开发期无历史包袱：不写迁移脚本，开发库重建。

## Problem Statement

1. **同一件货要建两次档。** 发运/收货要求「官方目录商品 + 默认变体」，而建档动作只发生在自建主数据里；目录行靠三条人工路产生（隐藏页 `/backend/catalog/products/create`、手工调 API、镜像回填），`promote` 不建目录行（`src/modules/products/README.md:121-125`）。
2. **主数据被拆在两张表 + 两套变体。** 身份/分类/三档价在 `products_products` 等表，变体与库存落点在 catalog（`.ai/specs/2026-09-22-product-variants.md` Problem 1–3）。
3. **分类法三套词表重叠。** 产品线（`products_types`）模块外无读者、采用率 1/20；自建品类树被报价工作簿 section 横幅自动建（`src/modules/sourcing/lib/promotion.ts:210-224`）；字典 `product_category` 身兼两职（SKU 码段 + 单据「订单描述」）（`.ai/specs/2026-09-23-product-taxonomy-consolidation.md` Problem 3–4）。
4. **字段与 UI 不匹配业务。** owner 2026-10-10 现场判断：`/backend/purchasing/supplier-products` 的字段与流程贴合业务；`/backend/products/items` 大量不符。
5. **编码发号是可选加速器。** 生成后可手改（面板变「沿用旧码」），写路径不读 `rule.enforce`（`src/modules/purchasing/README.md:182`）——手填一直是一等路径。
6. **方向双挂。** 自建主数据与官方 registry 同时存在、靠人工镜像连接，是当前最贵的状态。

## Overview and Success Measures

- **Primary outcome:** 一次建档（供应商侧或自有侧）= 一条 catalog 商品 + 一个默认启用变体；采购单行、发运分摊、收货、合同/发票、RU 映射、财务读缝全部直读 catalog，无桥接层。
- **Leading indicators:** `products_*` 表族从 `src/modules.ts` 与迁移链中消失；`grep products_products src/` 只剩测试或零命中；供应商库指针字段名 = `catalog_product_id`。
- **Baseline:** 现状 2 套主数据 + 2 套变体 + 3 套分类词表 + 1 套发号机制。
- **Market / product reference:** 平台自身的设计（catalog 把变体/价格/选项模板/分类都做成独立表；product/variant/price 均支持自定义字段）——采用「一个身份表 + 按方向分表」；拒绝「把供应商关系塞进商品自定义字段」（丢唯一键/索引/ACL/软删占码）。

## Goals

- **REQ-001** — 商品身份、变体、价格、分类以官方 `catalog` 为唯一存储；`products_products` / `products_types` / `products_categories` / `products_variants` / `products_prices` 的表、命令、路由、页面、事件、ACL 全部删除；不写迁移脚本，开发库重建。
- **REQ-002** — `purchasing_supplier_products` 保留为供应商方向的记录：字段组 = 供应商标识（id + 快照）、供应商货号（唯一键含软删）、原始货号、供货价 + 折扣、MOQ、报价来源、候选/正式状态、**供应商表原文组**（原始品名/规格/G.W./N.W./体积/装箱/尺寸）；`product_id` 改为 `catalog_product_id`。
- **REQ-003** — 供应商侧「建商品档案」= 一次动作产生 catalog 商品 + 默认启用变体（按 SKU 幂等），回填 `catalog_product_id`；不写官方代码，只经 catalog 命令/API。
- **REQ-004** — 自有商品建档 = 自绘页面写 catalog（商品 + 变体 + 价格 + 分类 + 自定义字段），与 REQ-003 共用同一段写入。
- **REQ-005** — 三档价落 catalog：`catalog_price_kinds`（purchase / internal / export，tenant 级码表）× 币种 × `min_quantity`/`max_quantity`，挂商品级；整组替换（消失的行停用不删）；**不保留有效期窗口**。
- **REQ-006** — SKU 全部手填：唯一性 = 组织内唯一（含软删占码）；保留 `product_codes_aliases` 旧码别名（单据上的旧码可搜到）；发号规则表、发号台账、`product_brand` 码表、生成/拆解 API、编码面板全部删除；品牌改自由文本。
- **REQ-007** — 单据引用商品统一为 catalog 商品 id + 冻结快照（采购行、发运分摊、销售行、合同/发票行、装箱单行）；改名/删除不改历史。
- **REQ-008** — 发运分摊与收货的变体解析直读 catalog（去掉经 `products_products` 的一跳）；无变体仍 422，报错文案指向新路径。
- **REQ-009** — `ru_sync` SKU 映射 `map_status='mapped'` 的断言目标改 `catalog_products`；草稿采购单按映射生成（`productId` = catalog 商品 id）。
- **REQ-010** — `finance` 读缝（`peerReads` / `dueReminders`）与 `order_hub` / `boss_cockpit` 的展示来源直读 catalog；成本价读 catalog 的 purchase 档价格。
- **REQ-011** — 分发副本保留并在 catalog 上重造：目标组织建商品副本 + 变体，价格仅首次复制，来源标记（原 `source_product_id` 语义）；幂等、越界 403。
- **REQ-012** — 两页 UI：供应商产品库保持现版式（字段组随 REQ-002 调整）；自有商品库按同一版式重建，只显示白名单字段；官方 catalog 的多余字段（compliance/excise/年龄限制/URL 等）在任一 UI 不可见、不可写。
- **REQ-013** — 权限：页面/API 闸门仍用 app feature（`purchasing.supplier-products.view|manage|promote`、`products.items.view|manage` 语义改为「商品档案」）；不把 `catalog.products.manage` 直接发给业务角色；供应商库与商品库的写权限边界不变（能改商品 ≠ 能改供应商货号/供货价）。
- **REQ-014** — 公司订单为根的链路与非根链路不改；根单三类子单的商品引用随 REQ-007 改指。
- **REQ-015** — 文档重写：`docs/dev/business-architecture.md` 重写、`docs/dev/business-conventions.md` 新建（业主约定清单）、PRD / plans / 模块 README / lessons 复审；被推翻的 spec 打 superseded。
- **REQ-016** — Linear 同步：`docs/**` 变更后跑 `node scripts/linear-sync/sync.mjs --apply`；收尾 `--audit`；需求 ID / 章节标题尽量不动（同步不删除，改 ID 会产生孤儿 issue，需列清单人工处理）。

## Non-goals

- 不写历史数据迁移脚本；不保留旧表旧列旧数据（开发库重建）。
- 不修改官方 `catalog` 代码；其保留契约（`.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md` 的 preserved-contract register：路由 / 24 命令 / 18 事件 / wms 的 `POST|PUT /api/catalog/{products,variants}` 拦截器桥）不得破坏。
- 不在本规格内重做 SKU 自动编码（另立切片，见 Phase 4）。
- 不做 eject；不改 `sales` / `wms` 对 catalog 的既有引用。
- 不做自有线的非采购入库（自产/委外仍走采购单，工厂 = 供应商）。

## Proposed Solution

**先砍**：删除自建主数据表族与其全部读写面；`product_codes` 发号机制停用删除；分类法收敛为 catalog 分类树（可选、不强制、**砍掉报价 section 自动建品类**）。
**再合并**：catalog 成为唯一身份与库存落点；供应商库只留供应商方向 + 指针；建档 = 一次产生 catalog 商品 + 默认变体；全部下游直读 catalog。
**后重做**：SKU 发号（另立切片）；若需要，价格有效期与品类自动化再按需重建。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 单一存储 = 官方 `catalog` | 库存/收货/变体天然对齐（catalog 变体是唯一入账单位），消掉镜像与双变体表；平台自身就把变体/价格/分类分表 | 自建主数据 + 自动镜像 catalog | 仍是双挂：两套身份、两套变体、两处字段的家 |
| 供应商产品库保留为独立表 | 键是（供应商 × 货号）、候选货先于商品存在、采购 ACL 与读取面隔离；官方 registry 不该被候选货污染 | 供应商字段塞进 catalog 自定义字段 | 自定义字段没有唯一键/索引/服务端过滤/模块 ACL/软删占码 |
| 字段按「谁在读」分级 | 被单据/投影/编码读的必须结构化；其余手填最省 | 全部结构化 / 全部自由文本 | 全结构化 = 当前重复；全文本打断订单描述等现有读者 |
| 两套 UI 自绘 | 业务字段集与流程不来自官方页面 | 官方页面 + 少量覆盖 | 官方字段集与流程不符业务（Problem 4） |
| 砍掉报价 section → 品类自动建树 | 供应商文档结构不应决定我方分类 | 重做自动建树 | 无业务驱动的自动化；需要时人工建 |
| 价格档位用 catalog price kinds | 官方支持 kind × 币种 × 起订量、可挂商品级 | 自建价格表 | 重复建设；商品级价格 catalog 原生支持 |
| 保留旧码别名表 | 手填 SKU 后，单据上的旧码必须可搜到 | 一并砍掉 | 搜索断链，单据对不上货 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 商品（our product） | 一件可售/可入库的货，catalog 商品 + 至少一个启用变体 | `catalog_products` / `catalog_product_variants` | 无变体 → 不可发运/收货（422） |
| 供应商货品 | 某供应商卖的一件货：供应商 × 货号，候选期即存在 | `purchasing_supplier_products` | 货号重复（含软删）→ 409 |
| 建档 | 供应商行 → catalog 商品 + 默认变体 + 指针；幂等（已建档 skipped） | 本规格 REQ-003 | 失败逐行隔离，可重试 |
| 三档价 | purchase / internal / export，各含币种与起订量台阶；整组替换、消失即停用 | catalog 价格 + price kinds | 币种不在字典 → 400 |
| SKU | 我方编码，组织内唯一、含软删永久占用；手填；旧码登记别名 | catalog 商品/变体的 `sku` + `product_codes_aliases` | 重复 → 409；改码后旧码仍可搜 |
| 订单为根 | 公司订单是唯一订单入口；三类子单关联式挂载；下游按子单并集只读 | `order_hub`（已交付） | 旧 URL 经关联表解析，解析不到显示未关联 |
| 快照 | 单据引用商品存 id + 冻结快照，改名不改历史 | 各单据模块 | — |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 采购员 | 供应商库维护、建档、批量建档 | 所选组织 | `purchasing.supplier-products.view|manage|promote` |
| 商品管理员 | 自有商品建档、价格、变体、分发 | 所选组织（分发校验目标组织写权限） | `products.items.view|manage`（语义改为商品档案） |
| 财务 | 读损益/SKU 毛利/成本 | 所选组织 | `finance.profit.view` 等既有 |
| 只读角色 | 看列表/详情 | 所选组织 | `*.view` |

可信 `tenantId`/`organizationId` 一律取自会话上下文；缺组织 fail closed（沿用各模块 `ensureScope`）。catalog 写入经 peer 命令，命令自身的权限与作用域校验照旧生效。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 商品身份 / 变体 / 价格 / 分类 | reuse | installed `catalog` | 命令 `catalog.products.*` / `catalog.variants.*` / `catalog.prices.*` / `catalog.priceKinds.*` / `catalog.categories.*` | 库存与官方链的既有落点；避免第二身份 |
| 业务字段（申报要素 / 装箱数 / 重量体积 / 尺寸 / 图片） | extend | installed `catalog` | 自定义字段（product/variant/price 均支持）+ 附件绑定 `catalog:catalog_product` | 官方字段不覆盖业务字段集 |
| 供应商方向记录 | app-own | `purchasing`（保留） | 标量指针 `catalog_product_id` + 快照 | 键与生命周期不属于商品 registry |
| 编码发号 | app-own（停用） | `product_codes`（保留别名表，其余删除） | — | 手填为一等路径 |
| 旧码别名 | app-own | `product_codes_aliases` | 搜索投影 | 单据旧码仍需可搜 |
| 分发副本 | app-own | `products`（保留命令壳，写 catalog） | catalog 命令 + 目标组织 | 已交付能力，不能丢 |

## Architecture and Data Flow

```text
供应商报价（sourcing, 保留）
   └─ 加入产品库 → purchasing_supplier_products（供应商方向字段 + 报价来源）
                    └─ 建商品档案（promote）→ catalog 商品 + 默认变体（+ 指针回填）
自有商品（页面） ───────────────────────→ catalog 商品 + 变体 + 三档价 + 分类
采购单行 ── 解析 ──→ catalog 商品 + 默认变体（快照冻结）
发运分摊 ── 锚采购单行 ──→ catalog 变体（收货变体级，wms.inventory.receive）
合同 / 发票 / 装箱单 ──→ catalog 商品 id + 快照
对内/对外销售行 ──→ catalog 商品 id + 变体桥 + 快照
公司订单（根，已交付）── 关联三类子单 ──→ 下游并集只读
RU 平台 ── ru_sync sku_map ──→ catalog 商品
财务读缝 ──→ catalog（价格档 = price kind）
```

- **Module boundaries:** catalog 是官方模块（不改）；`purchasing` 拥有供应商方向记录与建档入口；`products` 只保留 app 侧页面/命令壳（自有商品库、分发），写路径经 catalog 命令；其余模块只读 catalog 的 id/快照。
- **Extension points:** 自定义字段（UMES）、附件绑定、peer 命令；不修改安装层页面或实体。
- **Compatibility:** 保留 catalog 的 preserved-contract register；`sales`/`wms` 不动。

## User Journeys

### Journey J-001 — 供应商行建档并下单

1. 采购员在产品库编辑行（供应商方向字段），点「建商品档案」。
2. 系统在 catalog 建商品（sku = 我方 SKU、中英名、单位）+ 默认启用变体，回填指针；价格档写 purchase（折后价）。
3. 采购单行选择该行 → 保存草稿解析出 catalog 商品与变体（快照冻结）→ 下单。
4. 失败：SKU 被软删商品占用 → 409/422 可读文案；catalog 写入失败逐行隔离、可重试，不留半写。

### Journey J-002 — 自有商品建档并分发

1. 商品管理员在自有商品库新建（采购页同版式 + 三档价 + 变体 + 分类）。
2. 保存 = catalog 商品 + 变体 + 价格整组 + 自定义字段。
3. 行操作「分发到分公司」→ 目标组织建副本 + 变体（价格仅首次复制），来源标记；越界 403 零写入。

### Journey J-003 — 发运与收货

1. 发运单分摊引用采购单行（catalog 商品/变体直读），超发 422、无变体 422。
2. 收货经 `wms.inventory.receive`（catalog 变体），库存余额与到岸成本照旧。

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/purchasing/supplier-products`（保持） | 供应商产品库列表/新建/编辑；Excel 导入；建档/批量建档；关联（收敛为指向 catalog） | `purchasing_supplier_products` API + catalog 命令（promote） | 自身（现状） | `Page` `PageBody` `DataTable` `CrudForm` | loading/empty/error/conflict/permission | REQ-002, REQ-003, REQ-012 |
| `/backend/products/items`（重建） | 自有商品库：列表/新建/编辑（版式对齐采购页：商品标识 → 商品 SKU 与品牌 → 照片 → 海关与单位 → 价格 → 装箱重量体积 → 产品尺寸 → 状态）+ 分发 | catalog 命令 | `/backend/purchasing/supplier-products`（同版式） | `Page` `PageBody` `DataTable` `CrudForm` + 自绘分组 | 同上 + 键盘提交 | REQ-004, REQ-005, REQ-011, REQ-012 |
| 分类维护（若保留） | 复用 catalog 分类（官方页 `navHidden`）或本 app 薄包装页 | catalog 命令 | catalog 官方页 | `Page` `PageBody` `DataTable` | 同上 | REQ-001 |

字段白名单（自有商品库）：SKU、中英文名、品牌/系列/型号（自由文本）、HS、申报要素、单位、装箱数、单件毛重/净重、体积、产品尺寸、图片、分类（可选）、状态、三档价、变体。官方多余字段不渲染。

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 采购员 | 公司订单 → 采购 → 供应商产品库 | — | 产品库列表 → 编辑/建档 |
| 商品管理员 | 基础数据 → 商品主数据 | — | 商品列表 → 新建/编辑 → 分发 |

## Data Models

### 被删除（REQ-001）

| 对象 | 内容 |
|---|---|
| `products_products` | 表 + `/api/products/items`、`/prices`、`/variants/options` + `/backend/products/items` 页 + `products.items.*` 命令与事件 |
| `products_types` / `products_categories` / `products_variants` / `products_prices` | 表 + 命令 + 路由 + 页面 + 事件 + ACL（`products.types.*` / `products.categories.*` / `products.prices.*`） |
| `product_codes` 机制 | 规则表、发号台账、`product_brand` 码表、生成/拆解 API、编码面板；**保留** `product_codes_aliases` |
| 分类页 | `/backend/products/taxonomy`、`/types`、`/categories` 及 create/edit 子页 |

### 字段的家（REQ-002 / REQ-005 / REQ-006 / REQ-012）

| 字段 | 家 | 形态 |
|---|---|---|
| SKU / 中英文名 / 单位 / 状态 | catalog 商品/变体 | 原生字段（`sku`/`title`/`default_unit`/`is_active`） |
| HS / 申报要素 / 装箱数 / 重量体积 / 产品尺寸 | catalog 商品 | 原生覆盖不到的用自定义字段（逐字段核对官方字段后定） |
| 品牌 / 系列 / 型号 | catalog 商品 | 自定义字段，自由文本 |
| 图片 | 附件 | 绑定 `catalog:catalog_product` |
| 三档价 | catalog 价格 | price kind × 币种 × 起订量，商品级 |
| 变体 | catalog 变体 | `sku`/`is_default`/`is_active` + 自定义字段 |
| 分类 | catalog 分类 | 层级树（可选、不自动建） |
| 供应商货号 / 原始货号 / 供货价 + 折扣 / MOQ / 报价来源 / 候选状态 / 供应商表原文组 | `purchasing_supplier_products` | 供应商方向 |
| 旧码别名 | `product_codes_aliases` | 薄表 |

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| command | `purchasing.supplier-products.promote`（改造） | `purchasing.supplier-products.promote` | `{ id }` | `{ catalogProductId, action: created\|updated\|skipped }` | 409 SKU 占用、422 商品已删、逐行隔离 | REQ-003 |
| command | `purchasing.supplier-products.promote-batch`（改造） | 同上 | `{ ids[] ≤100 }` | `{ created, updated, skipped, failed[] }` | 同上 | REQ-003 |
| command | `products.items.create/update/delete`（改造：写 catalog） | `products.items.manage` | 表单载荷（含变体/价格整组） | catalog 商品 id | 409 唯一、409 乐观锁 | REQ-004, REQ-005 |
| command | `products.items.distribute`（改造：catalog 副本） | `products.items.manage` | `{ productIds?, organizationIds[1..50] }` | `{ created, updated, skipped[] }` | 403 越界零写入 | REQ-011 |
| command | `ru_sync.sku-map.update`（改断言表） | `ru_sync.view` 写面 | `{ ruSku, status, productId }` | `{ ok }` | 404 目标不可见 | REQ-009 |
| route | `/api/products/*` | 由 catalog 版重写 | — | — | — | REQ-004 |

所有路由仍用 `makeCrudRoute`（或带守卫的命令路由）+ 每方法 `metadata`；写路径走命令、作用域取自会话、可编辑记录带乐观锁（409）。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `catalog.product.*` / `catalog.variant.*` | installed catalog | 本 app 的索引/缓存失效（新增订阅，或改用命令返回） | 列表/选择器刷新 | 官方事件照旧；app 侧订阅按需 |
| `purchasing.supplier_product.*` | `purchasing` | 现有订阅方 | 不变 | 保留 |
| 建档 / 分发 | 命令 | 索引桥 | 列表可见 | 失败重试（逐行隔离） |

`products.item.*` / `products.prices.updated` 等事件随表删除；替换方为 catalog 事件或命令返回（实现时列明每个订阅方的处置）。

## Security, Privacy, and Compliance

- **Authorization:** 页面/API 闸门用 app feature（REQ-013）；catalog 命令自身的校验照旧；不新增角色名判断。
- **Tenant isolation:** 所有读写沿用会话作用域；跨组织读取 404、越界写 403 且零写入（沿用现有测试口径）。
- **Sensitive data:** 无新增 PII；供应商银行等既有加密面不动。
- **Abuse and failure modes:** SKU 唯一性（含软删）；重复建档幂等；catalog 写入失败不留半写（先建商品再建变体，失败补偿/重试可读）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | 供应商 + 产品库行 | promote（一次、二次） | 一次 = catalog 商品 + 默认变体 + 指针；二次 skipped 且计数不变 | REQ-003 |
| TEST-002 | integration | 采购单 + 行 | 行解析/保存草稿/发运分摊/收货 | 直读 catalog；无变体 422；超发 422 | REQ-007, REQ-008 |
| TEST-003 | integration | 合同/发票/装箱单/RU 映射/财务 | 建单 + 读缝 | id+快照口径；`ru_sync_sku_map` 指向 catalog；毛利 join 通 | REQ-007, REQ-009, REQ-010 |
| TEST-004 | security | 两个组织 + 缺权限角色 | 跨组织读写、无 feature 调用 | 404/403 且零写入 | REQ-013 |
| TEST-005 | UI | 自有商品页 | 新建/编辑/冲突/窄屏/暗色/键盘 | 白名单字段齐全、官方字段不可见 | REQ-012 |
| TEST-006 | integration | 两个组织 | 分发（catalog 副本） | 副本 + 变体 + 来源标记；幂等；价格仅首次复制 | REQ-011 |
| TEST-007 | integration | 历史旧码 + 手填 SKU | 搜索、唯一性 | 旧码命中；重复 409；软删占码 | REQ-006 |

## Implementation Phases

### Phase 0 — 基准（本 PR）

- **Depends on:** none
- **Outcome:** 本规格 + 重写的 `docs/dev/business-architecture.md` + 新建 `docs/dev/business-conventions.md` + 索引更新
- **Deliverables:** 三份文档；Linear 未同步（Phase 3 统一）
- **Requirements closed:** REQ-015（文档部分）
- **Validation:** 文档一致性人工评审；`node scripts/check-lessons.mjs`（若触及 lessons）
- **Exit gate:** 决策表/字段落位表/约定清单可被后续 Phase 直接引用

### Phase 1 — 砍 + 合并（数据与读写路径）

- **Depends on:** Phase 0
- **Outcome:** 一次建档即产 catalog 商品 + 变体；全部下游直读 catalog；开发库重建后链路可跑
- **Deliverables:** 删除表族与读写面；供应商库字段组重定义；promote/建档改造；采购行解析、发运分摊/收货、合同/发票、internal_sales、ru_sync、finance、order_hub/boss_cockpit 改指向；分发重造；测试重写
- **Requirements closed:** REQ-001…REQ-011, REQ-013, REQ-014
- **Tests:** TEST-001…TEST-004, TEST-006, TEST-007
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；`yarn test:integration:ephemeral`；FLOW-G1
- **Exit gate:** 全新库上 FLOW-G1 绿；浏览器冒烟：建档→下单→发运→收货；`grep -r products_products src` 无生产代码命中

### Phase 2 — 两页 UI

- **Depends on:** Phase 1
- **Outcome:** 自有商品页与采购页同版式、字段白名单生效
- **Deliverables:** 页面/分组/字段白名单；供应商产品库页适配
- **Requirements closed:** REQ-012
- **Tests:** TEST-005
- **Validation:** 浏览器冒烟（浅/深色、窄屏、键盘、错误态）
- **Exit gate:** 两页字段集与约定清单一致

### Phase 3 — 文档收尾 + Linear

- **Depends on:** Phase 1、Phase 2
- **Outcome:** 模块 README / PRD / 状态板 / lessons 与新逻辑一致；Linear 镜像同步
- **Deliverables:** D 组文档；superseded 标注；Linear dry-run/apply/audit 记录 + 孤儿清单
- **Requirements closed:** REQ-015, REQ-016
- **Validation:** `node scripts/linear-sync/sync.mjs --docs-root <main>` → `--apply` → `--audit`
- **Exit gate:** dry-run 数量与状态分布核对；审计父子关系通过；孤儿 issue 清单交 owner

### Phase 4 — SKU 发号重做（另立切片）

- **Depends on:** Phase 1
- **Outcome:** 按新字段口径重做编码生成（本规格不含）
- **Non-goal of this spec**

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | 全局 | 表族删除 | Phase 1 | TEST-002, TEST-007 | AC-001 |
| REQ-002 | 产品库页 | `purchasing_supplier_products` | Phase 1 | TEST-001 | AC-002 |
| REQ-003 | J-001 | `…promote` | Phase 1 | TEST-001 | AC-003 |
| REQ-004 | J-002 | `products.items.*` | Phase 1 | TEST-005 | AC-004 |
| REQ-005 | J-002 | catalog 价格 | Phase 1 | TEST-005 | AC-005 |
| REQ-006 | 产品库/商品页 | `sku` + 别名表 | Phase 1 | TEST-007 | AC-006 |
| REQ-007 | J-001/J-003 | 各单据行 | Phase 1 | TEST-002, TEST-003 | AC-007 |
| REQ-008 | J-003 | 分摊/收货 | Phase 1 | TEST-002 | AC-008 |
| REQ-009 | RU 页 | `ru_sync.sku-map.update` | Phase 1 | TEST-003 | AC-009 |
| REQ-010 | 财务页 | 读缝 | Phase 1 | TEST-003 | AC-010 |
| REQ-011 | J-002 | `products.items.distribute` | Phase 1 | TEST-006 | AC-011 |
| REQ-012 | 两页 UI | 页面契约 | Phase 2 | TEST-005 | AC-012 |
| REQ-013 | 全局 | ACL | Phase 1 | TEST-004 | AC-013 |
| REQ-014 | 公司订单 | `order_hub` | Phase 1 | TEST-002 | AC-014 |
| REQ-015 | 文档 | — | Phase 0/3 | 评审 | AC-015 |
| REQ-016 | Linear | `scripts/linear-sync` | Phase 3 | dry-run/audit | AC-016 |

## Rollout, Migration, and Rollback

- **重建开发库**：删除表族的迁移不写；由 owner 批准后重建（`yarn db:*`）。
- **种子**：catalog price kinds（purchase/internal/export）由 app `setup.ts` 幂等播种（tenant 级）。
- **开关**：不需要 feature flag（开发期一次性切换）。
- **回滚**：还原分支 + 重建库；无数据兼容负担。
- **可观测**：命令审计（建档/分发/价格替换）照旧。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 业务主数据寄存在上游表 | 平台升级影响主数据 | 只用官方命令/API；保留契约 register 作回归清单 | 上游行为变化需跟随 |
| 砍掉仍有读者的东西 | 静默断链 | 逐项列读者（Problem 3–5）后再删；测试兜底 | 未列出的读者 |
| catalog 自定义字段能力边界 | 字段装不下需回退 | 逐字段核对（Phase 1 第一切片） | 需少量 app 薄表 |
| SKU 手填失去发号台账 | 唯一性/占码靠人工 | 唯一校验 + 别名表 + 测试 | 人工纪律缺口 |
| catalog 写入无事务覆盖跨模块 | 半写 | 先商品后变体、失败可重试与隔离 | 极端中断需人工补偿 |

## Acceptance Criteria

- [ ] **AC-001** — `products_*` 表族与其路由/页面/命令/事件消失；开发库重建后系统可启动。
- [ ] **AC-002** — 供应商库行只含供应商方向字段 + `catalog_product_id`；唯一键仍（供应商 × 货号，含软删）。
- [ ] **AC-003** — 建档一次产生 catalog 商品 + 默认启用变体；重复建档 skipped。
- [ ] **AC-004** — 自有商品建档写出 catalog 商品/变体/价格/分类/自定义字段。
- [ ] **AC-005** — 三档价 = price kind × 币种 × 起订量；整组替换、消失停用。
- [ ] **AC-006** — 手填 SKU 组织内唯一（含软删）；旧码可搜。
- [ ] **AC-007** — 单据引用 = catalog id + 快照；改名不改历史。
- [ ] **AC-008** — 发运/收货直读 catalog 变体；无变体 422。
- [ ] **AC-009** — RU 映射指向 catalog 商品；草稿采购单按映射生成。
- [ ] **AC-010** — 财务读缝与到期提醒直读 catalog。
- [ ] **AC-011** — 分发副本在 catalog 上幂等、越界 403。
- [ ] **AC-012** — 自有商品页与采购页同版式，字段白名单生效，官方字段不可见。
- [ ] **AC-013** — 权限边界不变（商品 ≠ 供应商库）。
- [ ] **AC-014** — 公司订单链路不变，根单子单引用改指 catalog。
- [ ] **AC-015** — 基准文档与约定清单落档，被推翻的 spec 标注 superseded。
- [ ] **AC-016** — Linear 同步 dry-run/apply/audit 通过，孤儿清单交付。
- [ ] Every listed backend surface matches its recorded reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | AGENTS.md；spec-delivery；om-spec-writing |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability 表 16 行 |
| Every workflow completes end to end without a catch-all integration phase | pass | Phase 1–3 各有验收；无 polish 桶 |
| Platform-native reuse and extension points were chosen before custom code | pass | catalog 命令 + UMES + 附件 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 两页 UI 表 + 白名单 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 0–3 |

Verdict: `Ready for implementation`（Phase 1 起）— 依赖 owner 的开工指令。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q1 | 拆分：一份 spec 覆盖砍+合并+UI，SKU 发号另立 | owner | no | 2026-10-10 采纳推荐（A） |
| Q2 | 非原生字段 = catalog 自定义字段 + 手填 | owner | no | 2026-10-10 采纳推荐（A） |
| Q3 | 品类 = catalog 分类树（可选）+ 砍自动建树 | owner | no | 2026-10-10 采纳推荐（A） |
| Q4 | 订单描述保留 `product_category` 字典 | owner | no | 2026-10-10 采纳推荐（A） |
| Q5 | SKU 全手填；发号器停用 | owner | no | 2026-10-10 采纳推荐（A） |
| Q6 | 供应商表原文组保留 | owner | no | 2026-10-10 采纳推荐（A） |
| Q7 | 自产/委外仍走采购单 | owner | no | 2026-10-10 采纳推荐（A） |
| Q8 | 三档价落 catalog price kinds；**有效期窗口保留**（catalog 价格原生带 `starts_at`/`ends_at`，实现时发现不必砍；"消失的行"用 `ends_at=now` 关窗而不是删除） | owner | no | 2026-10-10 采纳推荐（A），并在 Phase 1 实现时按原生字段修正 |
| Q-新1 | 分发副本保留并重造 | owner | no | 2026-10-10 采纳推荐（A） |
| Q-新2 | 权限沿用 app feature 闸门 | owner | no | 2026-10-10 采纳推荐（A） |
| Q-新3 | 报价 section → 品类自动建树砍掉 | owner | no | 2026-10-10 采纳推荐（A） |
| Q-新4 | 旧码别名表保留 | owner | no | 2026-10-10 采纳推荐（A） |
| Q-新5 | 先落 Phase 0 基准文档 | owner | no | 2026-10-10 采纳推荐（A） |
| Q-新6 | Linear：每阶段 apply + 收尾 audit | owner | no | 2026-10-10 采纳推荐（A） |

## Changelog

| Date | Change |
|---|---|
| 2026-10-10 | Initial spec — owner approved the option set; Phase 0 (baseline docs) in the same PR |
