# 总部商品分发到分公司（product distribution to branches）

**Date**: 2026-09-28
**Status**: Implemented and verified (2026-09-28) — 商品分发的**分发副本**口径落地：`products_products.source_product_id` 一列（迁移审阅并应用）、`products.items.distribute` 一命令（幂等、白名单、变体按 code upsert、价格仅首次复制、SKU 冲突跳过、目标逐个校验可写组织集）、`POST /api/products/items/distribute` 一路由、商品列表**行操作 + 表头**两个入口共用一个对话框。总部 9 件商品已分发到俄罗斯/东南亚两个分公司，分公司行选品器随即可用。

## Implementation Status

Source doc: .ai/specs/2026-09-28-product-distribution-to-branches.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — 数据列 + 命令 + 路由 | verified | none | AC-PD-001…003 | `yarn generate`（路由与命令进生成物）、`yarn typecheck`、`npx eslint src/modules/products`、`npx jest src/modules/products`、`JWT_SECRET=… yarn mercato test:integration product-distribution`（**3 passed**） | 迁移审阅后应用；集成三例（幂等更新/价格不回写、sku_taken、越界 403 + 自身目标 400）全绿 |
| Phase 2 — 分发 UI | verified | Phase 1 | AC-PD-004, AC-PD-006 | 浏览器实测（对话框、目标组织、`New 9 · updated 0`）、`yarn ds:check`、`yarn lint` | 见 Journey J-PD-001 四步可复现；分公司行选品器可选到副本 |
| Phase 3 — 文档与状态 | verified | Phase 2 | AC-PD-005 | 本次变更内的文档 diff | README / org-model / 计划进度 / 状态板 / 本 spec 同步 |

### Evidence (2026-09-28)

- **迁移**：`Migration20260928080916_products.ts`（`add column source_product_id uuid null` + 外键 `on delete set null` + 索引 `(organization_id, tenant_id, source_product_id)`；down 对称），**业主确认后应用**到 dev 库；`\d products_products` 复核列/索引/外键齐全。
- **单元**：`lib/__tests__/distribution.test.ts` 6 例（白名单字段、**排除** `typeId`/`categoryId`/`catalogProductId`/`sourceProduct`/`notes`、可变值克隆、缺省归一、变体/价格映射）；`src/lib/orgs/__tests__/organizationOptions.test.ts` 5 例（组织树选项规则，与内部销售买方选择器共用）。
- **集成（ephemeral 全新库，真实 HTTP）**：`__integration__/product-distribution.spec.ts` **3 passed** —— ① 首次 `created:1`（字段/变体/价格齐全、`sourceProductId` 回指、`typeId`/`catalogProductId` 为 null），改来源名与价后重跑 `updated:1` 且行数不变、**价格保持分公司侧值**；② 目标自建同 SKU → `skipped: [{ sku, organizationId, reason: 'sku_taken' }]` 且对方行未被改动；③ 分公司令牌分发到上级组织 **403**、目标只有自身 **400**。
- **真机（dev 3000）**：UI 对话框分发 9 件 → `POST … 200`，结果 `New 9 · updated 0`；再分发 `organizationIds:[RU,SEA]` → `created:9, updated:9`（RU 走幂等更新、SEA 首建）；两分公司各 9 行、全部 `sourceProductId` 链接、价格随首次复制（如 `P4108` 的 `purchase/CNY/230.0000`）；**HQ 自身仍 9 行**（未自我复制）；`ru-operator` 在 `/backend/internal-sales/quotes/create` 的选品器搜 `P4108` 得到副本并带出 spec/SKU。
- **门禁**：`yarn generate` ✓、`yarn typecheck` ✓ 0 error、`yarn lint` 0 error、`yarn ds:check` ✓ 900 files、`yarn test` ✓ 全绿（含本切片新增用例）。
- **实施中的两处口径微调（相对初稿）**：① `isUndoable: false`——多目标 fan-out 的撤销与 `purchasing.supplier-products.promote-batch` 同口径（靠目标组织内删除；审计仍记录命令与载荷）；② 变体在重复分发时**按 `code` upsert、不删除**目标侧新增变体（初稿写「替换」，实施取更保守口径）。

> 本 spec 只处理 PRD Q5（「跨组织主数据分发：总部一份商品卖给所有分公司，是否要做分发/共享读？」）在
> **商品主数据**上的落地：把总部 `products` 主数据**分发（复制）**到各分公司组织，使分公司在**自己组织内**
> 拥有可售商品与价格（对外销售单据的行选品器因此可用）。决定由业主 2026-09-28 拍板：选「总部商品分发/共享读」
> 家族；本 spec 在家族内选**分发复制**并说明为何不选共享读（见 Design Decisions）。
> 关联：[`.ai/specs/2026-09-22-products-and-trade-docs.md`](2026-09-22-products-and-trade-docs.md)（商品主数据本体）、
> [`docs/dev/multi-company-org-model.md`](../../docs/dev/multi-company-org-model.md)（组织与角色矩阵）。

## TLDR

商品主数据是**组织级私有**：总部（广州凯翠国际贸易有限公司）的 9 件商品，俄罗斯/东南亚分公司组织里一件都没有，
所以分公司的新建报价/订单**行选品器是空的**。本 spec 新增一条**幂等的分发命令**：总部把选中的商品（含三档价格与变体）
复制进选中的下级组织，并在副本上留 `source_product_id` 回指来源；重复执行按来源**更新字段**而不是再复制一份，
分公司若已用同一 SKU 建了自己的档案则**跳过并报告原因**。UI 是商品列表上的「分发到分公司」（行操作 + 表头整单分发），
面向上有 `products.items.manage` 的总部用户。不新增业务表（只加一个可空列 + 外键 + 索引）、不做共享读路径、
不动 installed 模块与既有单据。

## Problem Statement

**现状（2026-09-28 实测）**：

- 总部组织有 9 件商品（`products_products`，含品牌/型号/三档价格/装箱与重量），两个分公司组织**均为 0 件**。
- `internal_sales` 的行选品器读 `GET /api/products/items`（**按所选组织收敛**，读范围只展开到**下级**组织，
  不向父组织回退）；分公司登录后在 `/backend/internal-sales/quotes/create` 选不到任何商品——
  实测（2026-09-28，`ru-operator@acme.com`）币种下拉 16 项可用、行选品器为空。
- 业务没有否决「分公司自建商品」，但同一批货由总部维持主数据、分公司只是销售主体；让分公司各自重录一遍
  必然漂移（SKU/规格/重量与总部不一致），也不是业主想要的（业主选「分发/共享读」）。
- `purchasing` 已有同形先例：供应商产品库 → 商品主数据的 `promote`/`sync-fields`（按 SKU 建/改、幂等、
  回报 `created/updated/skipped`）。本切片沿用该形状，不发明第三种同步语义。

## Overview and Success Measures

- **Primary outcome:** 总部在 `/backend/products/items` 点「分发到分公司」→ 选俄罗斯/东南亚 → 两边的行选品器立刻能选到
  同一批商品（SKU/名称/规格一致），价格取分发时的三档快照；重复分发不再增加行数，只更新字段。
- **Leading indicators:** 分发结果 `{ created, updated, skipped[] }` 的数字与列表行数一致；分公司 `GET /api/products/items`
  返回这些行；副本 `source_product_id` 指回总部行。
- **Baseline:** 分公司商品数 = 0（实测）；分公司报价单无法添加行。
- **Market / product reference:** ERP 的主数据分发（SAP 的 ALE/IDoc 分发、Odoo 的多公司共享产品）两种流派——
  **共享**（一条主数据多公司可见）与**分发副本**（各公司一份、可本地化）。采用分发副本；理由见 Design Decisions。

## Goals

- **REQ-PD-001** — `products_products` 新增可空列 `source_product_id`（uuid，外键 → `products_products.id`，
  `on delete set null`）+ 查询索引 `(organization_id, tenant_id, source_product_id)`；实体、校验器、列表/详情投影
  与快照序列化同步；迁移由 `yarn db:generate` 生成、人工审阅（仅 `add column` + 索引 + 外键，无 drop）。
- **REQ-PD-002** — 新命令 `products.items.distribute`（`products` 模块，`registerCommand` 注册）：
  - **来源** = `ctx.identifiers.organizationId`（当前所选组织，即总部）；**目标** = 入参 `organizationIds`，
    去重、剔除来源自身，且**每个目标必须落在 `ctx.organizationIds`（调用者可写组织集）内**，否则 403（fail-closed；
    `organizationIds` 为 null = 不受限角色，放行）。
  - **选择**：`productIds`（可空）给定则只分发这些（必须在来源组织内可见，否则 404/422）；不给定则分发来源组织
    **全部未删除**商品。
  - **复制字段（白名单）**：`sku / name / nameEn / brand / series / manufacturerModel / specSummary / barcode / unit /
    hsCode / cnCode / countryOfOriginCode / netWeight / grossWeight / volume / dimensions / cartonQuantity /
    batteryCapacityMah / batteryWh / containsLithiumBattery / certifications / status`。
    **不复制**：`typeId`/`categoryId`（组织级分类树，见非目标）、`catalogProductId`/`catalogSnapshot`（指向来源组织的
    官方目录行）、`notes`。
  - **变体**：来源商品的 `products_variants` 全量复制（`code/name/barcode/status/isDefault/attributes/sortOrder`），
    `product_id` 指向副本；**重复分发时按 `code` upsert，不删除目标侧新增的变体**；默认变体的部分唯一索引天然成立。
  - **价格**：**仅首次创建**时复制 `products_prices` 的全部档位（含 `minQuantity/currencyCode/unitPrice/startsAt/endsAt/isActive`）；
    **重复分发不回写价格**（分发后价格归分公司自管，避免覆盖分公司的对外销售价）。
  - **幂等/冲突**：目标组织里 `source_product_id` = 来源行 id 的行 → **更新**（白名单字段 + 变体按 code upsert，价格不动）；
    同 SKU 但无来源链接（分公司自建/他人分发）→ **跳过**该商品并回报 `{ sku, reason: 'sku_taken' }`；
    来源已删除的行不参与（全量模式）。
  - **副产物**：每条副本按既有 CRUD 形状发出 `products.item.created/updated` 事件、写索引（`productCrudIndexer`）；
    审计由命令通道记录（命令 id + 载荷 + 操作者）。命令 `isUndoable: false`（多目标 fan-out 与
    `purchasing.supplier-products.promote-batch` 同口径：撤销靠目标组织内删除副本，或改正来源后重发）。
- **REQ-PD-003** — 新路由 `POST /api/products/items/distribute`（`metadata: { POST: { requireAuth: true,
  requireFeatures: ['products.items.manage'] } }` + `openApi`）：入参 `{ productIds?: uuid[]（≤200）, organizationIds: uuid[]
  （1..50） }`；出参 `{ created: number, updated: number, skipped: Array<{ sku, organizationId, reason }> }`；
  目标不在可写组织集 → 403；`organizationIds` 为空/含来源自身 → 400/剔除后为空 400。
- **REQ-PD-004** — UI（`products` 列表 `/backend/products/items`）：行操作 + 表头动作各一个入口，共用一个对话框：
  1) 行操作「分发到分公司」= 该商品；2) 表头按钮「分发到分公司」= 当前组织全部在售商品；
  3) 对话框 = 目标组织多选（来源＝顶栏组织切换器 payload，取 `selectable` 且 ≠ 当前组织——与内部销售买方选择器同源同规则），
  提交 → 结果摘要（`created/updated/skipped` 计数 + 跳过原因列表）与 flash；组织集为空时对话框给出说明而不是空复选框。
  i18n：新增文案落 `src/modules/products/i18n/{zh,en}.json`（一条一种语言）。
  **可见性**：两个入口（以及新建/编辑/删除）只在调用者具备 `products.items.manage` 时渲染（`hasFeature(chrome payload)`，与 `purchasing` 供应商库同一写法；chrome payload 未就绪时不隐藏，避免闪现）；服务端仍是最终门禁。
- **REQ-PD-005** — 文档与状态：`src/modules/products/README.md`（分发一节 + 验证 + 回滚）、
  `docs/dev/multi-company-org-model.md`（「商品分发」从「待决定」改为「已实现」，并更新分公司可用性一段）、
  `docs/plans/cross-border-erp.md` 进度行、`docs/plans/README.md` 状态板、本 spec 的 Status/Changelog。

## Non-goals

- **不做共享读**（跨组织读父组织商品）：见 Design Decisions。
- **不分发分类/产品线**：副本的 `typeId`/`categoryId` 留空；分类树跨组织复制（`parent_id`/`tree_path`/`ancestor_ids` 重映射）
  单独立项。
- **不复制官方目录链接**（`catalogProductId` 指向来源组织的目录行）：分公司对外销售的履约不走本仓的
  `wms` 目录链（平台订单/3PL 是另一条链）；若未来分公司也要用官方目录链发货，单独立项。
- **不传播删除**：总部删除/停用一个商品不会自动删除/停用分公司副本（避免误删分公司在售行）；由操作员在分公司侧处理。
- **不做定时/事件驱动的自动同步**：分发是显式动作（可重复执行）；自动同步（订阅 `products.item.updated` 推送到已分发组织）
  留待业务确认节奏后单独立项。
- **不改** `products` 以外的模块；不加新的 ACL 功能位（复用 `products.items.manage`）；不改 `internal_sales` 的选品器。

## Proposed Solution

```text
总部 /backend/products/items
  ├─ 行操作「分发到分公司」/ 表头「分发到分公司」（全部在售）
  │     └─ 对话框：目标组织多选（组织切换器 payload − 当前组织）
  └─ POST /api/products/items/distribute { productIds?, organizationIds[] }
        └─ command products.items.distribute（来源 = 当前所选组织）
              └─ 每个目标组织：
                    ├─ 命中 source_product_id → 更新白名单字段 + 变体（价格不动）
                    ├─ 同 SKU 无来源链接      → skipped: sku_taken
                    └─ 都没有                → 新建副本（字段 + 变体 + 三档价格），写 source_product_id
        ← { created, updated, skipped[] }

分公司（俄罗斯/东南亚）：GET /api/products/items 由空变有 → internal_sales 行选品器可选
```

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| **分发副本**（复制进各分公司组织，留来源链接） | 维持「业务数据组织级私有、读只向下展开」的既有不变量（PRD D-1：分公司看不到上级）；分公司需要**自己的对外销售价**（三档价格挂在商品行上，见 `products_prices`） | **共享读**：一条主数据多组织可见（读路径向上回退或跨组织解析） | 会破坏可见性不变量（分公司将能读到上级组织的数据）；价格只有一个来源，分公司无法按市场定价；且读路径要横跨 `products`/`internal_sales`/`trade_docs` 多个消费点，风险面更大 |
| 来源链接存副本（`source_product_id`），不存来源侧 | 副本是「被分发出去的行」，链接在副本上；来源删除时 `set null` 不阻塞；查询索引支撑幂等查找 | 来源侧存 `distributed_to[]`（jsonb） | 多目标列表要读改写、并发易丢；jsonb 数组无法做唯一/索引；删除目标行时要清理来源 |
| 价格只随**首次**分发复制 | 分发后价格（尤其「对外销售价」）属分公司经营数据，重复分发覆盖会悄悄改价 | 每次分发回写价格 | 覆盖分公司自定价 = 静默改价，风险高 |
| SKU 冲突**跳过并报告**，不覆盖也不报错 | 分公司可能已自建同 SKU（Q5 的另一种走法）；静默覆盖会毁掉对方的行与引用，抛错会让整批失败 | 覆盖 / 整批失败 | 覆盖 = 数据事故；失败 = 一件冲突挡住其余 |
| 命令内以 `ctx.organizationIds` 校验目标 | 框架可信作用域（ACL 展开后的可写组织集），fail-closed；null = 不受限角色才放行 | 路由层校验后信任入参 | 命令是审计与撤销的单位，越权判定必须在命令内有一道 |
| 目标组织选项复用组织切换器 payload | 与内部销售买方选择器同源：总部只见下级、分公司看不到上级/同级；零新权限位 | 新造策略化「可分发组织」接口 | 重复实现既有可见性规则 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 来源商品 | 被分发的那一行（总部的 `products_products`） | `products` 模块 | — |
| 副本 | 目标组织里 `source_product_id` = 来源行 id 的商品行 | 同上 | 同 SKU 冲突 → `skipped: sku_taken` |
| 分发 | 把来源商品（字段白名单 + 变体 + 首次价格）幂等写入目标组织 | 本 spec | 目标不可写 → 403；来源行不可见 → 404 |
| 重复分发 | 命中 `source_product_id` → 更新字段与变体，不动价格 | 本 spec | — |
| 价格归属 | 首次分发复制；此后归目标组织自管 | 本 spec | 重复分发不覆盖 |
| 可写目标集 | `ctx.organizationIds`（ACL 展开）；null = 不受限 | 框架（`directory` scope） | 越界 → 403，不写入 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 总部商品维护者（当前 `admin`/`superadmin`；将来 `hq-sales`） | 发起分发；选择目标组织 | 目标 ∈ 自己可写的组织集（ACL 展开），来源 = 当前所选组织 | `products.items.manage` |
| 分公司业务员 | 读到自己组织的副本并在单据行中引用 | 本公司组织 | `products.items.view`（既有） |

- `tenantId`/来源 `organizationId` 一律取会话；目标组织虽来自入参，但**逐个**以 `ctx.organizationIds` 校验后才写。
- 无新功能位；安装层的 `products.items.manage` 与既有视图/管理动作共用。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 商品/价格/变体实体与命令 | extend（同模块新增命令） | app `products` | 同模块命令 + `registerCommand` | 主数据的所有者就是它；供应商→主数据的 `promote` 已证明「同模块复制」可行 |
| 组织可见性 | reuse | installed `directory` | 组织切换器 payload（前端）+ `ctx.organizationIds`（服务端） | 同一份 ACL 展开规则，不重造 |
| 单据行引用 | reuse | `internal_sales` / installed `sales` | 点查 `products.items` 选项源（不变） | 分发后行选品器自然可读，无需改选品器 |
| 事件/索引/审计/撤销 | reuse | 框架 | `productCrudEvents` / `productCrudIndexer` / `withAtomicFlush` / 命令 undo 快照 | 与同模块其它写路径同副作用，搜索与缓存无需额外处理 |
| 分发 UI | app-own | app `products` | `DataTable` 行操作/表头动作 + DS 对话框 | 列表已有行操作面，复用其交互与 token |

## Architecture and Data Flow

```text
[总部 UI] products 列表
   └─ 对话框（目标组织多选：组织切换器 payload，selectable ∧ ≠ 当前组织）
        └─ POST /api/products/items/distribute
             └─ commandBus.execute('products.items.distribute')
                  ├─ schema 校验 → 403（越界目标）/ 404（来源商品不可见）
                  ├─ 目标组织 × 商品 矩阵：
                  │     ├─ bySource(target, sourceId) → update（字段+变体）
                  │     ├─ bySku(target, sku) 命中非副本  → skipped
                  │     └─ else → create（字段+变体+价格），写 source_product_id
                  └─ 副作用：事件 / 索引 / 审计 / undo 快照（withAtomicFlush 包每个目标每件商品）
```

- **Module boundaries:** 分发是 `products` 模块内的写（跨组织，但同类实体）；不引入跨模块 ORM 关系。
- **Compatibility:** `products.items` 列表/详情新增一个可空字段（additive）；既有行 `source_product_id = null`；
  单据行的 `productId` 语义不变（副本就是普通商品行）。
- **Alternatives considered:** 共享读路径（见上表）；把分发做进 `purchasing` 的 `sync-fields`（错位：那是供应商库→主数据）。

## User Journeys

### Journey J-PD-001 — 总部把商品分发给俄罗斯分公司

1. 总部账号（`products.items.manage`）在 `/backend/products/items` 点表头「分发到分公司」。
2. 对话框列出「关联组织 − 当前组织」= 东南亚/俄罗斯；勾俄罗斯 → 确认。
3. 结果摘要 `created: 9, updated: 0, skipped: []`；俄罗斯分公司商品列表出现 9 行（SKU 与总部一致）。
4. 重复一次 → `created: 0, updated: 9, skipped: []`（不产生重复行；价格保持分公司当前值）。
5. 失败/拒绝：目标越界 → 403 且不写入；某 SKU 已被分公司自建 → 该 SKU 进 `skipped`，其余照常。

### Journey J-PD-002 — 分公司用副本开对外报价

1. `ru-operator` 打开 `/backend/internal-sales/quotes/create`。
2. 行选品器（`GET /api/products/items`，本组织）现在返回副本 → 选中 → 数量/单价 → 保存。
3. 保存后的行 `productId` 指向副本（无官方目录链接——见非目标），单据快照照常冻结。

## UI and Interaction Contracts

参考实现：`src/modules/products/components/ProductsTable.tsx`（`DataTable` + `RowActions` + 表头 `actions` 区）
与 `src/modules/internal_sales/components/InternalSalesForm.tsx` 的组织/买方选择器（同一份组织切换器 payload）。
`.ai/guides/backend-ui.md`：`DataTable` 拥有列表、`CrudForm` 拥有表单；对话框用 DS 原语；文案走 `t()`。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/products/items`（新增入口） | 行操作/表头动作「分发到分公司」→ 目标组织多选 → 提交 | 组织：`GET /api/directory/organization-switcher`；写：`POST /api/products/items/distribute` | 同页既有行操作（编辑/删除）；内部销售买方选择器（组织 payload） | `DataTable` + `RowActions` + `Button` + `Dialog`/`ConfirmDialog` 家族 + 多选复选框 | loading（提交中禁用）、empty（无可选组织 → 说明文案）、error（403/400 → 对话框内错误）、success（结果摘要 + flash）、部分成功（`skipped` 逐条列出） | REQ-PD-004 |

```text
┌ 分发到分公司 ─────────────────────────────┐
│ 目标组织（可多选）                          │
│  ☑ 俄罗斯 AB 有限公司                       │
│  ☐ 东南亚 AB 有限公司                       │
│ 说明：选中的组织会收到本组织全部在售商品      │
│       （行操作进入时为「仅该商品」）          │
│                        [取消]  [分发]      │
└──────────────────────────────────────────┘
  结果：新建 9 · 更新 0 · 跳过 0
```

- **Behavior:** 提交按钮在请求期间禁用（防重复提交）；结果含 `skipped` 时逐条展示 `SKU — 原因`；关闭对话框刷新列表（`useOrganizationScopeVersion` 之外的分发不改变当前列表，分公司侧可见）。
- **Responsive and accessibility:** 对话框内复选框整行可点、Esc 关闭、焦点入对话框；窄屏单列堆叠。
- **Localization:** `products.items.distribute.*` 键，zh/en 各写一种语言。
- **Design-system and theming:** DS `Button`/`Checkbox`/`Dialog`/`Alert`；语义 token；明暗两态沿用。

## Data Models

### `products_products`（新增一列）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `source_product_id` | uuid，可空 | 外键 → `products_products.id`（`on delete set null`）；索引 `(organization_id, tenant_id, source_product_id)` | 否 | 由 `products.items.distribute` 写入；分公司自建行为 null；不参与列表排序/搜索 |

- 迁移：`yarn db:generate` 生成，人工审阅（预期仅 `add column` + `create index` + `add constraint`），**应用前请业主确认**；
  snapshot 由生成器维护。与 REQ-PD-001 对应。
- 无新表；价格/变体沿用既有表与唯一键（`products_prices_key_uniq`、`products_variants_scope_code_uniq`、
  默认变体部分唯一索引）。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/products/items/distribute` | auth + `products.items.manage` | `{ productIds?: uuid[]（≤200）, organizationIds: uuid[]（1..50） }` | `200 { created, updated, skipped: [{ sku, organizationId, reason }] }`；每条副本发 `products.item.created/updated` | 400（空目标/超限）、403（目标不在可写集 / 缺功能位）、404（来源商品不可见） | REQ-PD-003 |
| command | `products.items.distribute` | 经路由 dispatcher；命令内再校验作用域 | 同上 | 同上 + 审计与 undo 快照 | 失败不写半份：按「目标 × 商品」原子 flush | REQ-PD-002 |

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| 分发创建副本 | `products.items.distribute` | `products` CRUD 事件消费者（缓存失效/订阅者） | `products.item.created` | 命令可重复执行；重复执行走更新路径不重复发 created |
| 分发更新副本 | 同上 | 同上 | `products.item.updated` | 同上 |
| 索引 | 同上 | `query_index` | 每个副本入索引 | 复用 `productCrudIndexer`；搜索收敛由既有机制处理 |

无新作业/通知；不做自动同步（非目标）。

## Security, Privacy, and Compliance

- **Authorization:** 入口 `products.items.manage`；命令内目标组织逐个对 `ctx.organizationIds` 校验（null 才放行全部）。
- **Tenant isolation:** 来源 = 会话所选组织。有 ACL 组织集的调用者：每个目标必须在该集内（否则 403）。无组织集的调用者
  （`ctx.organizationIds === null`）：每个目标必须**在本租户存在**（校验 `directory` 组织行、未删除，
  否则 403）——跨租户或凭空的组织 id 一律拒绝，绝不写悬空行。
- **Sensitive data:** 商品字段非加密列；无新增敏感字段；不写日志明细（命令只回报计数与 skip 原因）。
- **Abuse and failure modes:** 目标数量与商品数量上限（50 × 200）防批量放大；越权目标拒绝且**不部分写入**（校验先于写入）；
  重复提交幂等（更新路径）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-PD-001 | unit | — | 白名单映射函数（来源行 → 副本数据） | `typeId/categoryId/catalogProductId/notes` 不在副本数据；价格行映射保留档位/币种/起订量 | REQ-PD-002 |
| TEST-PD-002 | integration | ephemeral：总部组织 1 商品（2 变体 + 3 价格）+ 分公司组织 | 分发 → 再分发 → 改写来源字段再分发 | 首次 `created:1`；副本字段/变体/价格齐全且 `sourceProductId` 指向来源；二次 `updated:1` 且行数不变、价格不变；来源改名后副本跟随 | REQ-PD-001, REQ-PD-002 |
| TEST-PD-003 | integration | 分公司已存在同 SKU 自建行 | 分发同 SKU | `skipped: [{ sku, reason: 'sku_taken' }]`，分公司行未被改动，其余商品照常分发 | REQ-PD-002 |
| TEST-PD-004 | security | 分公司组织令牌 + 越界目标组织 id | 以分公司身份分发到总部/第三方组织 | 403（`products.items.manage` 不可写该组织 / 目标越界），无任何写入 | REQ-PD-002, REQ-PD-003 |
| TEST-PD-005 | UI（browser smoke） | 总部账号 + 9 商品 | 表头分发到俄罗斯 → 分公司列表与行选品器 | 结果摘要计数正确；`ru-operator` 行选品器出现副本；重复分发无新增行 | REQ-PD-004 |

## Implementation Phases

### Phase 1 — 数据列 + 命令 + 路由

- **Depends on:** none
- **Outcome:** API 可完成「分发 → 幂等重跑 → 冲突跳过」；数据形状与审计/撤销齐备。
- **Deliverables:** `src/modules/products/data/entities.ts`（`sourceProductId`）、`data/validators.ts`（如果有读写 schema 需要）、
  `commands/items.ts`（`products.items.distribute` + undo）、`api/items/distribute/route.ts` + openapi、
  `migrations/Migration*_products.ts`（生成+审阅）、`lib/distribution.ts`（白名单映射等纯函数）、
  `lib/__tests__/distribution.test.ts`、`__integration__/product-distribution.spec.ts`。
- **Requirements closed:** REQ-PD-001, REQ-PD-002, REQ-PD-003
- **Tests:** TEST-PD-001…TEST-PD-004
- **Validation:** `yarn generate`、`yarn typecheck`、`npx eslint src/modules/products`、`npx jest src/modules/products`、
  `JWT_SECRET=… yarn mercato test:integration product-distribution`
- **Exit gate:** 迁移只在审阅后应用；集成用例全绿；重复分发幂等、冲突跳过、越界 403 均有实测输出。

### Phase 2 — 分发 UI

- **Depends on:** Phase 1 exit gate
- **Outcome:** 业主在商品列表上完成分发，看到计数与跳过原因。
- **Deliverables:** `components/ProductsTable.tsx`（行操作 + 表头动作）、`components/DistributeProductsDialog.tsx`（组织多选 + 结果摘要）、
  `i18n/{zh,en}.json`、页面无新路由（沿用列表页）。
- **Requirements closed:** REQ-PD-004
- **Tests:** TEST-PD-005
- **Validation:** 浏览器实测（总部 → 分发 → 分公司侧核对）；`yarn ds:check`、`yarn lint`。
- **Exit gate:** 见 Journey J-PD-001 的四步全部可复现。

### Phase 3 — 文档与状态

- **Depends on:** Phase 2 exit gate
- **Deliverables:** `src/modules/products/README.md`（分发表 + 验证 + 回滚）、`docs/dev/multi-company-org-model.md`（Q5 落地说明、
  分公司可用性更新）、`docs/plans/cross-border-erp.md` 进度行、`docs/plans/README.md` 状态板、本 spec Status/Changelog。
- **Requirements closed:** REQ-PD-005
- **Exit gate:** 文档与树上实现一致，含可运行证据。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-PD-001 | 副本回指 | `products_products.source_product_id` + 迁移 | 1 | TEST-PD-002 | AC-PD-001 |
| REQ-PD-002 | J-PD-001 | `products.items.distribute` | 1 | TEST-PD-001…004 | AC-PD-002 |
| REQ-PD-003 | J-PD-001 | `POST /api/products/items/distribute` | 1 | TEST-PD-002…004 | AC-PD-003 |
| REQ-PD-004 | J-PD-001，商品列表 | UI 对话框 + i18n | 2 | TEST-PD-005 | AC-PD-004 |
| REQ-PD-005 | — | 文档 | 3 | — | AC-PD-005 |

## Rollout, Migration, and Rollback

- 迁移：新增可空列 + 外键 + 索引（additive，无回填、无数据改写）；审阅后应用；快照由生成器维护。
- 回滚：撤销命令删除本次新建的副本（或手工删除副本行）→ 移除 UI 入口 → 移除路由/命令 → 列可保留（只读冗余）或按迁移 down 移除。
- 分发不改变来源组织任何行；`internal_sales`/`sales` 无契约变化。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 副本与来源漂移（总部改名/改价后分公司不同步） | 分公司看到旧数据 | 显式重复分发（幂等更新字段；价格不回写是有意为之）；列表可见 `source_product_id` 来源标记（后续可加） | 需操作纪律；自动同步未做 |
| 分公司自建同 SKU 与分发冲突 | 该 SKU 分发被跳过 | `skipped` 明示原因，不覆盖、不中断 | 需人工取舍（改名或改用副本） |
| 误分发到不该给的组织 | 数据扩散 | 目标逐个对可写组织集校验（403）；UI 只列可见组织（总部见下级） | 不受限角色（superadmin）可见全部组织 |
| 一次分发过多商品 | 请求变慢 | 组织数 ≤50 与显式清单 ≤200 件由 schema 强制；**全量模式**以来源组织商品数为界（现实规模数十至数百件；逐件幂等——超时重跑即续传，不会重复建行） | 目录增长到上千件时需引入分批/作业化（未做） |
| 价格首次复制后不回写 | 总部调价不同步 | 文档明示「分发后价格归分公司」；需要总部控价时用共享读（已否决）或后续切片 | 业务需知晓该口径 |

## Acceptance Criteria

- [x] **AC-PD-001** — 副本行的 `source_product_id` 指向来源商品；来源删除后为 `null`；索引存在（迁移审阅记录 + `\d products_products` 复核）。
- [x] **AC-PD-002** — 首次分发 `created` 正确、副本字段/变体/价格齐全；重复分发 `updated` 且行数不变、价格不变；同 SKU 冲突进入 `skipped`。
- [x] **AC-PD-003** — 越界目标 403 且零写入；缺 `products.items.manage` 403；空目标 400。
- [x] **AC-PD-004** — 商品列表两个入口可用、对话框组织选择与结果摘要正确、i18n 双语键齐。
- [x] **AC-PD-005** — 文档/状态同步（products README、org-model、计划进度、状态板、本 spec）。
- [x] **AC-PD-006** — 分公司行选品器能选到副本（浏览器实测 + 集成）。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 根 `AGENTS.md`；`docs/dev/multi-company-org-model.md`、`.ai/guides/contracts.md`、`.ai/guides/backend-ui.md`、`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`（迁移 additive）、`om-spec-writing`、`om-module-scaffold`（api-and-domain/verification）、`om-backend-ui-design` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 一列 + 一命令 + 一路由 + 两入口对话框；traceability 表 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-PD-001/002 → Phase 1/2 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–3 |

Verdict: `Implemented`（Phase 1–3 已交付并验证；证据见 Implementation Status）

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-PD-001 | 分发目标是否也应支持「同级/上级」组织（例如分公司之间互发）？ | 业务 | no | 暂不做：UI 只列当前调用者可见组织，服务端按 `ctx.organizationIds` 放行；要放开是改 UI 选项集，不动命令 |
| Q-PD-002 | 自动同步（总部改价/改名 → 推送已分发组织）要不要做？ | 业务 | no | 暂不做（非目标）；先跑显式分发，业务确认节奏后再立项 |
| Q-PD-003 | 分类/产品线（`typeId`/`categoryId`）是否随分发复制？ | 业务 + 技术 | no | 本切片不复制（见非目标）；需要时以「按 code 找或建」规则单独立项 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | 初始版本：业主在「商品主数据怎么办」一问中选「总部商品分发/共享读」家族 → 本 spec 选定**分发副本**并记录否决共享读的理由；Phase 1–3、一列一命令一路由两入口。状态 `Ready for implementation`（迁移应用前请业主确认）。 |
| 2026-09-28 | **Phase 1–3 实现并验证 → `Implemented and verified`。** ① 迁移 `Migration20260928080916_products.ts` 审阅并经业主确认后应用；② `products.items.distribute` + `POST /api/products/items/distribute`；③ 商品列表行/表头两个分发入口 + 对话框（i18n zh/en）；④ 文档/状态收口。实施口径微调：`isUndoable: false`（同 `promote-batch`）、变体按 `code` upsert 不删除。证据：单元 11 例、集成 **3 passed**、真机 9 件分发到两分公司（幂等 `created:9/updated:9`）、分公司行选品器可选、门禁全绿。 |
| 2026-09-28 | **加固：不受限调用者的目标组织校验（同一次交付内）。** `ctx.organizationIds === null`（如 superadmin）此前直接信任入参目标——可能把副本写成挂在不存在的/其它租户组织 id 上的悬空行。命令现在对这类调用者逐个校验目标组织在**本租户**存在（`directory` 组织行、未删除），否则 403；集成用例补一条「凭空目标 id → 403」（重跑 3 passed）。同时把风险表「全量模式的上限」改为与实装一致（组织 ≤50、显式清单 ≤200 由 schema 强制；全量以来源组织商品数为界、逐件幂等可续传）。 |
