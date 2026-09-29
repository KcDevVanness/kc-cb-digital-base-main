# 合同为主体的出口单据关联（发运单 / 装箱单（PL）/ PI / CI）

**Date**: 2026-09-29
**Status**: Phase 1 与 Phase 2 **均已实现并验证（2026-09-29）**；AC-001…AC-009 全部满足，见 Changelog 的证据行

> 业务口径（2026-09-29，业务确认）：出口业务以**购销合同**为主体——发运单、装箱单（PL）、形式发票（PI）、
> 商业发票（CI）都关联购销合同；一张主合同可产生**多张发运单、多张装箱单**；四类单据在编辑明细时都支持
> 「选择关联合同 → 自动带出合同商品列表快速关联」，且带出的明细**可编辑、留弹性**。
> 合同同时关联**采购单与销售单**（对内销售 / 对外销售两种销售单据都要挂上；
> 对外销售单据是另一条在途需求，本规格用可扩展的订单关联表承接，见 Q-004）。

## TLDR

给四类出口单据补上对购销合同的关联，并把**合同行的商品列表**变成各单据明细的快速引用来源：
发运单 ↔ 合同用 M:N 关联表（拼柜可混多张合同）；PI/CI 增加「所属合同」引用（保留现有来源锚点与 CI 的
发运单汇总）；装箱单从「单号 + 附件」升级为**带可编辑明细**的单据（自己的 create/detail/edit 页）；
合同与**采购单 / 销售单**建立 1:N 订单关联；合同详情成为枢纽（关联单据区块 + 带 `?contractId=` 的新建入口）。
复用既有能力：`GET /api/trade_docs/contracts/lines`、发运单分摊与单证命令、`DataTable`/`CrudForm`/共享 API helper。

## Problem Statement

现状（代码级证据）：

| # | 事实 | 证据 |
|---|---|---|
| P-1 | 合同是一张**基本孤立的台账**：`source_kind/source_id` 是单值「合同 → 订单」且**界面没有入口**；唯一消费方是订单档案只读投影 | `trade_docs/data/entities.ts:72-79`、`data/validators.ts:149`、`components/ContractForm.tsx`（无 source 字段）、`export_finance/lib/fileRules.ts:387` |
| P-2 | 发运单**没有合同列**：只有采购分摊（采购单行）与销售分摊（内部销售订单行） | `cross_border/data/entities.ts:15-103`；全模块 grep `contract` 无业务命中 |
| P-3 | 装箱单（PL）是发运单的一类出口单证，**只有单号/签发日/附件/备注，没有商品明细** | `cross_border/data/entities.ts:252-303`、`/backend/cross_border/packing-lists`（2026-09-29 新台账，登记走对话框） |
| P-4 | PI/CI 的来源枚举 `{sales_order, purchase_order, shipment, manual}` **没有 contract**；行编辑只有「从订单复制行」 | `trade_docs/data/validators.ts:121`、`components/DocumentsForm.tsx:365-367` |
| P-5 | 合同详情只有金额/行/税务发票/附件区，**看不到也创建不了发运单/PL/PI/CI** | `components/ContractDetail.tsx:687-722` |

结论：业务口径的「1 张主合同 → N 张发运单 / N 张装箱单」在当前数据模型里**表达不出来**，
单据之间没有任何可导航的关联，明细录入一遍遍重搜商品。

## Overview and Success Measures

- **Primary outcome:** 在合同详情页能看到并创建它名下的发运单/装箱单/PI/CI/订单；四类单据的明细都能
  一次点击从合同商品行生成（可改）；「合同 → 发运单」「合同 → 装箱单」都是 1:N（且发运单可挂多张合同）。
  可量化：从合同详情出发 3 次点击内到达任一子单据的新建页并带着 `?contractId=` 预填；
  一张 20 行合同的 PI/CI/PL/分摊明细不再需要 20 次商品搜索。
- **Leading indicators:** 带合同引用的新单据数；「从合同引用商品行」的使用次数；合同详情关联区块的点击；
  无合同引用的新发运单/PI/CI 占比（应下降，但不强制）。
- **Baseline:** 合同关联数为 0（`cross_border` 无合同列、`trade_docs_documents` 无合同列）；
  装箱单明细行为 0（表不存在）。
- **Market / product reference:** 主流外贸 ERP（ERPNext / Odoo / 孚盟等）的合同-单据模型：合同为主档，
  发运/装箱/发票挂合同并可多张；明细行从合同行复制、允许逐行改量改价。本规格采纳「主档 + 子单据 + 行级复制、
  一次性不自动同步」；不采纳「子单据数量与合同强校验/自动联动」（此业务要留弹性）。

## Goals

- **REQ-001** — 发运单与购销合同建立 **M:N 关联**（可空、可多张、含合同号/方向快照）；发运单表单可选合同、
  详情可见并可跳转，发运单列表可按合同筛选；合同详情能列出其全部发运单。
- **REQ-002** — 装箱单拥有**可编辑的结构化明细行**（商品快照 + 数量 + 箱数 + 毛重 + 净重 + 体积 + 备注，
  全部可空可改），随单证命令整体替换；仅 `packing_list` 类型可带明细。
- **REQ-003** — 装箱单交付完整 CRUD 页面（台账列表 + 新建 + 详情 + 编辑），登记不再只有对话框一条路；
  台账仍跨发运单列出全部 PL，并显示合同与明细行数。
- **REQ-004** — 四类单据（发运单分摊、装箱单明细、PI/CI 明细）都提供**「从合同引用商品行」**：
  选合同 → 读合同行 → 生成可编辑明细/分摊行；已存在的行可继续手工增删改（弹性），重建不产生重复。
- **REQ-005** — PI/CI 增加**「所属合同」引用**（可空、含合同号快照），列表可按合同筛选、详情/表单可见可换绑；
  CI 仍可用发运单做行汇总，两者互不替代。
- **REQ-006** — 购销合同与**订单**建立 1:N 关联：采购单、内部销售订单两类先行（对外销售订单值预留，
  等该能力落地后接入），成套替换语义、近作废状态可维护、快照防漂移。
- **REQ-007** — 合同详情页成为枢纽：新增「订单 / 发运单 / 装箱单 / 形式发票 / 商业发票」关联区块
  （列表 + 新建入口，新建带 `?contractId=` 预填），与现有税务发票区同构。
- **REQ-008** — 订单档案的 KC 销售合同口径在合同改走订单关联表后**不回归**：只读投影同时认
  合同↔订单关联表与历史 `source_kind/source_id`。
- **REQ-009** — 菜单与文档收口：「出口业务」组按**组名前缀**拆成四个组——
  `出口业务-内部销售`（内部销售报价/订单）、`出口业务-购销合同`（购销合同）、`出口业务-发运`（发运单/装箱单）、
  `出口业务-单证`（形式发票/商业发票）；组顺序在 `src/modules.ts` 的 `nav.groupOrder` 声明一次；
  `docs/dev/business-architecture.md`、两份模块 README 与计划进度表同步。

## Non-goals

- 不改发运单分摊的锚点与校验（仍锚采购单行/销售订单行；超发 422、收货回写、catalog 变体桥接都不动）。
- 不做合同金额/数量的联动校验（明细复制是**一次性**的；不自动同步、不自动重算、不做差额预警）。
- 不给 PL/PI/CI/发运单新增权限位，不新增角色名判断。
- 不迁移既有数据（新列/新表全部可空/新增；历史行语义不变）。
- 不做菜单组层级（平台主侧边栏只有「组 → 条目 → 条目子项（一层，URL 前缀推导）」，组不能嵌套；
  详见 Q-005 的结论）——用**组名前缀拆组**代替；不做跨模块 URL 迁移。
- 不实现「对外销售单据」本身（另一条需求；本规格只把订单关联的 `order_kind` 留出 `external_sales_order`）。

## Proposed Solution

1. **发运单 ↔ 合同（M:N）**：新表 `cross_border_shipment_contracts`，写路径并入既有
   `cross_border.shipments.create/update`（`contracts[]` 整体替换语义，与分摊同构），服务端解析并冻结
   `contractNumber`/`contractDirection` 快照；列表新增 `contractId` 过滤，详情新增只读读缝。
2. **PI/CI ↔ 合同**：`trade_docs_documents` 追加 `contract_id` + `contract_snapshot`（**独立于**
   `source_kind/source_id`，不替换现有锚点），列表新增 `contractId` 过滤。
3. **装箱单升级为带明细的单据**：新表 `cross_border_export_document_lines`（仅 `packing_list` 使用），
   写路径并入既有 `cross_border.documents.create/update`（`lines[]` 整体替换）；新增
   `/backend/cross_border/packing-lists/{create,[id],[id]/edit}` 页面，台账保留、登记对话框退役。
4. **合同 ↔ 订单**：新表 `trade_docs_contract_orders`（`order_kind ∈ purchase_order |
   internal_sales_order | external_sales_order`），单写者命令 `trade_docs.contracts.orders.replace`
   （非作废合同可改，审计 + 乐观锁）；`export_finance` 订单档案只读投影增补「按关联表找 KC 合同」的兼容读。
5. **快速引用（四类单据）**：明细编辑器统一加「从合同引用商品行」——
   - PI/CI：追加可编辑行，行级 `source_snapshot` 记录合同行来源；
   - PL：追加可编辑行，数量从合同行带出、箱数与重量体积从商品主数据（单件值 × 数量）预填；
   - 发运单分摊：列出合同行，按商品在**本次发运单已选订单行**里匹配，匹配到的可一键生成分摊行，
     匹配不到的给出提示（引导在下方按采购单/销售订单添加），全部仍可手工调整。
6. **枢纽与导航**：合同详情加「关联单据」区块（发运单/PL/PI/CI 列表 + `?contractId=` 新建入口，
   与现有税务发票区同构）；合同 → 订单用详情页的「订单关联」对话框管理；
   **菜单不做层级**（平台不支持组嵌套），改用**组名前缀划分**：把「出口业务」拆成
   `出口业务-内部销售` / `出口业务-购销合同` / `出口业务-发运` / `出口业务-单证` 四个组（新 group key +
   `nav.groupOrder` 一次声明），用组名读出一层"伪层级"。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 发运单 ↔ 合同用 **M:N 关联表**（不是发运单上的单值列） | 拼柜可混多张合同（业务 2026-09-29 确认）；合同可被多张发运单引用 | 发运单加 `contract_id` 单值列 | 单值表达不了混柜；以后改关联表要迁移回填 |
| 合同关联**不强制**（可空） | 不破坏既有草稿流程与历史行；稳定后可再收紧 | 新建发运单/PI/CI 必须选合同 | 会卡住先做单后补合同的实际流程；收紧是独立决定 |
| 合同关联与既有**来源锚点并存**（`source_kind/source_id` 不动） | 来源是「从哪张订单开的」（PI 从订单、CI 从发运单），合同是「属于哪张合同」；两者语义不同 | 把 `contract` 加进来源枚举 | 单选锚点二选一，CI 会丢掉发运单汇总锚点；且改枚举会动既有语义面 |
| 装箱单明细**挂出口单证行**（`document_id` 子表），只允许 `packing_list` | 与单证同一事务、同一命令；其它单证类型不受影响 | 新建独立 `packing_lists` 实体族 | 号码/签发日/附件/命令/台账都要重建，等于第二套单证 |
| 装箱单交付**独立页面**（create/detail/edit），登记对话框退役 | 明细行是表格型编辑，对话框载不动；`.ai/guides/backend-ui.md` 要求 list/create/view/edit 连成一体 | 保留对话框内嵌行编辑器 | 行数一多不可用；两条写入路径会漂移 |
| 合同 ↔ 订单用**单写者命令** `contracts.orders.replace`，不并入 `contracts.create/update` | 合同签发后仍要补挂订单（合同先签、订单后下）；单一写入者好测、好审计 | 订单关联随合同 create/update（仅 draft 可写） | 签发后再也挂不上订单；两条写路径语义分叉 |
| 快速引用一律**一次性复制**、逐行记 `source_snapshot`，不做实时同步 | 与既有「从订单复制行」「CI 从发运单汇总」同口径；业务要「可编辑、留弹性」 | 触发式实时重算 | 会覆盖人工改动；跨单据事务与失败语义复杂 |
| 发运单快速引用按**本次发运单已选订单行**匹配商品 | 业务选定（Q-002）；不依赖合同↔订单关联的完整性，先可用 | 从合同关联订单行匹配 | 需要合同 ↔ 订单关联覆盖齐全，且仍可能一商品多行 |
| 合同详情的订单关联**只在详情页对话框**管理 | 合同表单已很长；详情页创建后即到，一次点击即挂 | 合同 create 表单内置订单编辑器 | 表单复杂度与校验面翻倍，收益只是少一次点击 |
| 菜单：**不新增层级**，改用**组名前缀**拆组 | 平台主侧边栏只有「组 → 条目 → 条目子项」一层，组不可嵌套（Q-005）；业务 2026-09-29 拍板以组名前缀划分 | 新建一个「合同」子组；把子单据收进合同页 | 子组仍是独立组、无父子语义（与拆组同效但命名不清）；收进详情页会让跨合同的列表/筛选无入口 |
| 装箱单关联合同**经发运单推导**，不新增列 | 单一真相源：PL 属于发运单，发运单属于合同；避免第二份关联 | PL 自己存 `contract_id` | 双份关联会漂移 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 关联合同（发运单） | 0..N 张 `trade_docs_contracts`，整体替换；同一发运单内同一合同只出现一次；快照冻结合同号/方向 | `cross_border_shipment_contracts` | 跨组织/不存在 → 404/422；重复 → 422（唯一键兜底） |
| 所属合同（PI/CI） | 0..1 张合同（可空、可换绑），独立于 `source_kind/source_id` | `trade_docs_documents.contract_id` | 跨组织/不存在 → 404/422 |
| 装箱单明细 | 行级：商品快照 + 数量 + 箱数 + 毛重 + 净重 + 体积 + 备注，全部可空；随单证整体替换；行号 1..n 由命令分配 | `cross_border_export_document_lines` | 非 `packing_list` 传明细 → 422；行顺序即列表顺序 |
| 合同订单关联 | 0..N 条 `(order_kind, order_id)`，快照冻结单号/对方/日期；成套替换；同一 `(合同, kind, 订单)` 唯一 | `trade_docs_contract_orders` | 重复 → 422；作废合同写入 → 422 |
| 快速引用 | 一次性把合同行复制成目标单据的可编辑明细/分摊候选；逐行记 `source_snapshot`；**不自动同步** | 目标单据自己的行表 | 合同行不存在 → 该行跳过并提示；重跑 = 重新复制（不追加重复） |
| 合同方向 | `purchase`（对供应商）| `sales`（对买方/分公司，含对内/对外销售场景） | `trade_docs_contracts.direction` | — |
| 单据方向与合同方向 | 不强制一致（一张发运单可同时挂采购合同与销售合同）；选择器不按方向过滤 | — | — |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 总部单证/业务 | 维护发运单合同关联、登记/编辑装箱单及其明细、PI/CI 关联合同、合同订单关联与枢纽查看 | 当前选定组织；读展开到下级 | 既有：`cross_border.shipments.view\|manage`、`cross_border.documents.manage`、`trade_docs.contracts.view\|manage`、`trade_docs.documents.view\|manage` |
| 总部财务 | 只读查看合同枢纽与单据 | 同上 | 只读位 |

- `tenantId`/`organizationId` 一律从会话取（`resolveOrganizationScopeForRequest`），**fail-closed**；
  新表读写都带作用域过滤，跨组织 id → 404。
- 不新增功能位、不做角色名判断；新页面在各 `page.meta.ts` 声明与命令一致的既有功能位。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 发运单合同关联表 + 命令并入 | extend | `cross_border` | 同模块实体 + 既有 `shipments.create/update` | 关联随发运单同一事务落库，与分摊同构 |
| 装箱单明细行 | extend | `cross_border` | 同模块实体 + 既有 `documents.create/update` | 与单证同事务；不新造单证族 |
| PI/CI 合同列 | extend | `trade_docs` | 同模块实体 + 既有 `documents.*` | 文档已在 `trade_docs`，跨模块写入没有理由 |
| 合同订单关联 | extend | `trade_docs` | 同模块实体 + 新命令 `contracts.orders.replace` | 合同是聚合根；订单只存标量 id + 快照 |
| 合同行读接口 | reuse | `trade_docs` `GET /api/trade_docs/contracts/lines` | 只读 HTTP（跨模块不走 ORM） | 快速引用的数据源已存在 |
| 发运单/PL 列表的 `contractId` 过滤 | extend | `cross_border` | 既有 `makeCrudRoute` 列表 schema | 枢纽与深链需要 |
| 合同详情枢纽的只读聚合 | extend | `trade_docs` 页面 + 跨模块 HTTP 列表接口 | `GET /api/cross_border/shipments?contractId=`、`…/shipments/documents?contractId=` | 页面层聚合，不新增跨模块读缝代码 |
| 订单档案 KC 口径 | extend | `export_finance` | 只读 Kysely 增读关联表 | 保持既有投影不回归 |
| 附件/编号/字典/组件 | reuse | `attachments`、既有编号口径、`dictionaries`、`DataTable`/`CrudForm` | 与既有页面一致 | 平台能力已覆盖 |

### 扩展面（extension surface）追踪

| 新增/变更面 | 需求 | 参考能力（capabilityId）与参考文件 | 阶段 | 测试 | 机制分类 |
|---|---|---|---|---|---|
| `cross_border` 新实体（2 张表） | REQ-001/002 | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-101 | emitted-example |
| `cross_border` 校验器扩展 | REQ-001/002 | `data.validators` → `src/modules/example/data/validators.ts` | 1 | TEST-101/102 | emitted-example |
| 迁移（加表/加列） | REQ-001/002/005/006 | `data.migrations` → `src/modules/example/migrations/Migration20251030150038.ts` | 1/2 | TEST-901 | emitted-example |
| 命令载荷扩展（existing commands） | REQ-001/002 | `commands.write` → `src/modules/example/commands/todos.ts` | 1 | TEST-101/102 | emitted-example |
| 新命令 `trade_docs.contracts.orders.replace` | REQ-006 | `commands.write` → `src/modules/example/commands/todos.ts` | 2 | TEST-201 | emitted-example |
| CRUD 列表过滤（`contractId`） | REQ-001/003/005 | `api.crud-factory` → `src/modules/example/api/customer-priorities/route.ts` | 1/2 | TEST-101/201 | emitted-example |
| 自定义动作路由（orders replace + 读缝） | REQ-006 | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 2 | TEST-201 | emitted-example |
| 新页面（PL create/detail/edit） | REQ-003 | `ui.form-create` → `src/modules/example/components/TodoForm.tsx`（+ `ui.form-edit`、`ui.page-shell`） | 1 | TEST-401 | emitted-example |
| i18n 文案（两模块 zh/en） | REQ-001…009 | `module.i18n-catalogs` → `src/modules/example/i18n/en.json` | 1/2 | TEST-401 | emitted-example |
| 事件（复用既有 + 新增 1 个） | REQ-006 | `events.typed-definitions` → `src/modules/example/events.ts` | 2 | TEST-201 | emitted-example |
| ACL | 无变化（复用既有功能位） | `module.acl-features` → `src/modules/example/acl.ts` | — | TEST-102/202 | framework-only |

## Architecture and Data Flow

```text
合同详情（trade_docs 页面）
  ├─ 订单关联对话框 → PUT /api/trade_docs/contracts/orders → trade_docs_contract_orders
  ├─ 发运单区块 ← GET /api/cross_border/shipments?contractId=…   （cross_border 只读列表）
  ├─ 装箱单区块 ← GET /api/cross_border/shipments/documents?contractId=…
  ├─ PI/CI 区块 ← GET /api/trade_docs/documents?contractId=…&kind=…
  └─ 新建入口 → /backend/cross_border/shipments/create?contractId=…
               /backend/trade-docs/{proformas,commercial-invoices}/create?contractId=…

发运单表单 → cross_border.shipments.create/update
  ├─ contractIds[] → cross_border_shipment_contracts（整体替换 + 快照）
  └─ 「从合同引用商品」← GET /api/trade_docs/contracts/lines?contractId=
        → 在已选订单行里按商品匹配 → 填充分摊行（仍可改）

装箱单页面 → cross_border.documents.create/update
  ├─ lines[] → cross_border_export_document_lines（整体替换；仅 packing_list）
  └─ 「从合同引用商品」← 同上；重量/体积从 products 单件值 × 数量预填

PI/CI 表单 → trade_docs.documents.create/update（contract_id + 快照）
  └─ 「从合同引用商品行」← 同上，追加可编辑行（行级 source_snapshot）

订单档案（export_finance 只读投影）→ 合同选择：trade_docs_contract_orders ∪ 历史 source_*
```

- **Module boundaries:** 关联表都落在「拥有主档」的模块里（发运单关联在 `cross_border`、合同/订单关联在
  `trade_docs`）；跨模块只存标量 id + 快照，读一律走对方的 HTTP 列表接口或本模块的 scoped 只读投影。
- **Extension points:** 无页面覆盖/注入需求；PL 页面走模块 `backend/**` 自动发现。
- **Alternatives considered:** 把 PL 做成 `cross_border` 新实体族（否决：单证能力重复）；
  合同详情用 UMES 注入 widget 读发运单（不必要：同页只读区块即可）。
- **Compatibility:** 既有 API/表/事件 ID 只增不改；`source_kind/source_id` 语义不变；PL 台账 URL 不变；
  既有集成测试（发运/单证/购销合同/PI/CI）必须保持绿。

## User Journeys

### Journey J-001 — 从合同建一张发运单并挂上合同

1. 业务在 `/backend/trade-docs/contracts/[id]` 看到「发运单」区块，点「新建发运单」（带 `?contractId=`）。
2. 发运单表单的「关联合同」已预选该合同；按既有流程选采购单行分摊，「从合同引用商品」列出合同行、
   在已选订单行里按商品匹配，一键生成分摊行。
3. 保存 → 发运单详情显示关联合同并可跳回合同；合同详情区块立即出现这张发运单。
4. 失败路径：合同与当前组织不符 → 404；重复合同 → 422；无匹配订单行的合同行 → 提示且不生成分摊。

### Journey J-002 — 为一张发运单登记装箱单（带明细）并引用合同商品

1. 业务在发运单详情「单证区」或 PL 台账点「新建装箱单」→ `/backend/cross_border/packing-lists/create`。
2. 选发运单（必填）、装箱单号、签发日；点「从合同引用商品行」，选该发运单的关联合同，
   合同行追加为可编辑明细（数量带出、箱数/毛重/净重/体积按商品主数据预填）。
3. 调整行、上传文件，保存 → 台账可见该行（含合同号与明细行数），详情可继续编辑。
4. 失败路径：发运单已取消 → 422；非 `packing_list` 传明细 → 422；重复行提示但不重复写入。

### Journey J-003 — 合同枢纽：把已签合同挂上订单

1. 财务/业务在合同详情点「管理订单关联」，搜索并勾选采购单 / 内部销售订单（对外销售单据接入后同）。
2. 保存（成套替换）→ 区块按类型分组显示；订单编号可点（跳对应模块页面）。
3. 失败路径：合同已作废 → 422；跨组织订单 → 404；陈旧版本 → 409。

## UI and Interaction Contracts

参考页面：`/backend/trade-docs/contracts`（合同列表/详情）与 `/backend/cross_border/packing-lists` 台账、
`/backend/trade-docs/proformas`（明细复制对话框）；实现前按 `.ai/guides/backend-ui.md` 与 `om-backend-ui-design` 落地。
表格用 `DataTable`，表单用 `CrudForm`，读取用 `fetchCrudList`/`apiCall`，对话框用既有 `Select`/`ComboboxInput`/`useConfirmDialog`。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/cross_border/shipments/create`、`/[id]/edit` | 新增「关联合同」区块（多选行 + 移除） | `GET /api/trade_docs/contracts`（选择器）、`POST/PUT /api/cross_border/shipments` | 自身分摊行编辑器 | `CrudForm`、`ComboboxInput`、`Button` | loading/empty/error/conflict/permission | REQ-001/004 |
| `/backend/cross_border/shipments/[id]` | 新增「关联合同」展示 + 「从合同引用商品」入口（分摊编辑器内） | `GET /api/cross_border/shipments/contracts?shipmentId=`、`GET /api/trade_docs/contracts/lines` | 自身分摊区 | `DataTable`(embedded)、`SectionHeader` | 同上 | REQ-001/004 |
| `/backend/cross_border/packing-lists` | 台账加「合同」「明细行数」列；「登记」改为跳新建页 | `GET /api/cross_border/shipments/documents?docType=packing_list` | 自身 | `DataTable`、`StatusBadge` | 同上 | REQ-003 |
| `/backend/cross_border/packing-lists/create`、`/[id]/edit` | 装箱单表单：发运单/单号/签发日/文件/备注 + 明细行编辑器 + 「从合同引用商品行」 | `POST/PUT /api/cross_border/shipments/documents`、`GET /api/trade_docs/contracts/lines` | `DocumentsForm`（PI/CI 行编辑器） | `CrudForm`、行内栅格 | 同上 + 保存后回台账 | REQ-002/003/004 |
| `/backend/cross_border/packing-lists/[id]` | 详情：头 + 明细表 + 文件预览 + 编辑入口 | `GET …/documents?id=` | `ContractDetail` 区块 | `Page`、`PageBody`、`DataTable` | 同上 | REQ-003 |
| `/backend/trade-docs/proformas/*`、`/commercial-invoices/*` | 表单加「所属合同」选择器；行编辑器加「从合同引用商品行」；详情显示合同链接 | `GET /api/trade_docs/contracts`（选择器）、`…/contracts/lines`、`documents.*` | 自身 | `CrudForm`、`Select` | 同上 | REQ-004/005 |
| `/backend/trade-docs/contracts/[id]` | 新增「订单/发运单/装箱单/形式发票/商业发票」区块 + 「管理订单关联」对话框；新建入口带 `?contractId=` | 见 Architecture 数据流 | 自身「税务发票」区块 | `Page`、`SectionHeader`、`DataTable`、对话框 | 同上 | REQ-006/007 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 出口单证/业务 | 出口业务-内部销售：内部销售报价(300) → 内部销售订单(310) ｜ 出口业务-购销合同：购销合同(320) ｜ 出口业务-发运：发运单(340) → 装箱单(345) ｜ 出口业务-单证：形式发票(350) → 商业发票(360) | 无新增 | 合同列表 → 详情 → 新建子单据（≤3 次点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 合同详情关联区块（4 个） | 各区块空态一句说明 + 「新建…」按钮 | 单列优先，窄屏区块纵向堆叠 | 区块内链接可 Tab 到；新建为普通链接 |
| 发运单「关联合同」区块 | 空态提示「可关联多张合同」+ 选择器 | 行在窄屏折行，数量输入保持 8ch | 选择器 Esc 关闭、Enter 选中 |
| PL 明细编辑器 | 空态提示「添加一行或从合同引用商品行」 | 容器查询栅格，窄屏单列 | 行删除按钮有 aria-label；保存 Ctrl/Cmd+Enter |

### `/backend/cross_border/packing-lists/create` — 装箱单新建

```text
┌────────────────────────────────────────────────────────────┐
│ 新建装箱单                                    [保存]        │
│ 发运单* [选择器]  单号 [ ]  签发日 [日期]  备注 [ ]  文件 [上传/预览] │
├────────────────────────────────────────────────────────────┤
│ 明细  [从合同引用商品行]                                     │
│ 商品 | 数量 | 箱数 | 毛重 | 净重 | 体积 | 备注 | [删除]      │
│ …行…                                                       │
├────────────────────────────────────────────────────────────┤
│ [取消] [保存]                                               │
└────────────────────────────────────────────────────────────┘
```

- **Behavior:** 发运单必填（沿用单证命令校验）；明细可空；保存整体替换明细；冲突 409 提示重试；
  文件上传失败不丢已填内容。
- **Responsive and accessibility:** 窄屏明细行改卡片式；所有输入有 `FieldLabel`；删除有确认与 aria-label。
- **Localization:** 新增 key 落 `cross_border/i18n/{zh,en}.json`、`trade_docs/i18n/{zh,en}.json`；动态值为单号/行数。
- **Design-system and theming:** 语义 token 与既有页面一致；暗色、窄屏、键盘实测。

## Data Models

### `cross_border_shipment_contracts`（新）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid PK | — | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | 组合索引 | no | 会话作用域 |
| `shipment_id` | uuid, required | FK → `cross_border_shipments`，cascade | no | 随发运单删除 |
| `contract_id` | uuid, required | 索引 `(organization_id, tenant_id, contract_id)` | no | 只存标量 id（跨模块） |
| `contract_number` / `contract_direction` | text / text, nullable | — | no | 写入时快照；合同改名/换向不回写 |
| `created_at` | timestamp | — | no | 整体替换即重建 |

唯一键 `(shipment_id, contract_id)`。

### `cross_border_export_document_lines`（新）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` / `tenant_id` / `organization_id` | uuid | 组合索引 | no | — |
| `document_id` | uuid, required | FK → `cross_border_export_documents`，cascade | no | 仅 `packing_list` 允许写入 |
| `line_number` | integer, required | 唯一 `(document_id, line_number)` | no | 命令按 1..n 分配 |
| `product_id` | uuid, nullable | 索引 | no | 自建商品 id（标量） |
| `product_snapshot` | jsonb, nullable | — | no | 商品名/SKU/单位等展示快照 |
| `name` / `sku` / `unit` | text, nullable | — | no | 允许纯手填行 |
| `quantity` | numeric(18,4), nullable | — | no | ≥0；允许空（先登记后补） |
| `cartons` | numeric(18,0), nullable | — | no | ≥0 整数 |
| `gross_weight` / `net_weight` | numeric(18,4), nullable | — | no | ≥0；单件值 × 数量预填，可改 |
| `volume` | numeric(18,0), nullable | — | no | cm³，同 `products.volume` 口径 |
| `source_snapshot` | jsonb, nullable | — | no | 合同行来源 `{kind:'contract_line', contractId, lineId, number, copiedAt}` 或手工 |
| `note` | text, nullable | — | no | ≤500 |
| `created_at` / `updated_at` | timestamp | — | no | 随头整体替换 |

### `trade_docs_documents`（追加列）

| Field | Type / nullability | Notes |
|---|---|---|
| `contract_id` | uuid, nullable | 所属合同（跨模块只存标量） |
| `contract_snapshot` | jsonb, nullable | `{id, number, direction, counterpartyName?}`；换合同重写 |

### `trade_docs_contract_orders`（新）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` / `tenant_id` / `organization_id` | uuid | 组合索引 | no | — |
| `contract_id` | uuid, required | FK → `trade_docs_contracts`，cascade | no | 随合同删除 |
| `order_kind` | text, required | 唯一 `(contract_id, order_kind, order_id)`；索引 | no | `purchase_order` / `internal_sales_order` / `external_sales_order`（预留） |
| `order_id` | uuid, required | 索引 `(organization_id, tenant_id, order_id)` | no | 跨模块标量 |
| `order_snapshot` | jsonb, nullable | — | no | `{number, counterpartyName?, orderedAt?}` |
| `created_at` / `updated_at` | timestamp | — | no | 整体替换（删旧建新） |

迁移：两个模块各自 `yarn db:generate` 生成**只增**迁移（新表 + 两列），审阅后由业主批准应用；无数据回填。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/cross_border/shipments` | `cross_border.shipments.manage` | + `contracts?: {contractId}[]`（≤50，可空） | 201 + 既有 `cross_border.shipment.created` | 合同不存在/跨组织 404/422；重复 422 | REQ-001 |
| `PUT` | `/api/cross_border/shipments/[id]` | 同上 | 同上（缺省=不动；`[]`=清空） | 200 + 既有 `…updated` | 409（乐观锁） | REQ-001 |
| `GET` | `/api/cross_border/shipments?contractId=` | `cross_border.shipments.view` | 新增 `contractId` 过滤 | `{items,total,…}`（含 `contracts[]` 快照） | 401/403 | REQ-001/007 |
| `GET` | `/api/cross_border/shipments/contracts?shipmentId=` | 同上 | 只读读缝 | `{items}` | 401/403 | REQ-001 |
| `POST`/`PUT` | `/api/cross_border/shipments/documents` | `cross_border.documents.manage` | + `lines?: lineInput[]`（仅 `packing_list`） | 200/201 + 既有事件 | 非 PL 传行 422；409 | REQ-002/004 |
| `GET` | `/api/cross_border/shipments/documents?contractId=` | `cross_border.shipments.view` | 新增 `contractId` 过滤（经发运单关联） | `{items}`（含行数） | 401/403 | REQ-003 |
| `POST`/`PUT` | `/api/trade_docs/documents` | `trade_docs.documents.manage` | + `contractId?`（服务端解析快照） | 既有事件 | 404/422/409 | REQ-005 |
| `GET` | `/api/trade_docs/documents?contractId=` | `trade_docs.documents.view` | 新增过滤 | `{items}` | 401/403 | REQ-005/007 |
| `PUT` | `/api/trade_docs/contracts/orders` → `trade_docs.contracts.orders.replace` | `trade_docs.contracts.manage` | `{contractId, orders: {orderKind, orderId}[]}`（≤200） | 200 + `trade_docs.contract.orders.updated` | 作废合同 422；跨组织 404；重复 422；409（合同版本） | REQ-006 |
| `GET` | `/api/trade_docs/contracts/orders?contractId=` | `trade_docs.contracts.view` | 只读 | `{items}` | 401/403 | REQ-006/007 |

路由一律 `makeCrudRoute`（列表/CRUD）或 guarded command route（动作面），per-method `metadata` + 独立 `openApi`；
新动作路由 entityId 沿用 `trade_docs:trade_docs_contract*` / `cross_border:cross_border_*` 既有写法。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| 发运单保存（含合同/分摊变化） | `cross_border.shipments.*` | 打开的发运单列表/详情（广播） | 缓存失效（见下） | 既有事务语义 |
| 装箱单保存（含明细） | `cross_border.documents.*` | PL 台账/详情 | 缓存失效 | 整体替换；重复保存不产生重复行 |
| PI/CI 保存（含合同） | `trade_docs.documents.*` | PI/CI 列表/详情 | 缓存失效 | 既有语义 |
| 合同订单关联替换 | `trade_docs.contracts.orders.replace` | 合同详情/订单档案（后续） | 200 + `trade_docs.contract.orders.updated`（新事件，`clientBroadcast`） | 审计带前后集合；409 版本冲突 |

缓存失效：`cross_border/lib/cacheInvalidation.ts` 追加 `cross_border.shipment.contract`、`cross_border.document.line`；
`trade_docs/lib/cacheInvalidation.ts` 在合同族里追加 `trade_docs.contract.order`。
无定时任务/通知/队列新增。

## Security, Privacy, and Compliance

- **Authorization:** 复用既有功能位（无新增）；新页面 `page.meta.ts` 与命令门禁一致；不用角色名判断。
- **Tenant isolation:** 新表带 `tenant_id`/`organization_id`；读展开到下级、写只作用当前组织；fail-closed。
- **Sensitive data:** 新字段不含加密列（合同号/商品名/重量体积均为业务非敏感）；不引入新的银行/个人信息。
- **Abuse and failure modes:** 跨组织 id 404；重复关联 422（唯一键兜底）；超长/越界输入 400；
  作废合同写订单关联 422；幂等由整体替换语义保证。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-101 | integration | 租户 + 组织 + 2 张合同（purchase/sales）+ 采购单/销售订单 | 建发运单挂 2 张合同 → 改挂 1 张 → 列表按 `contractId` 过滤 → 读读缝 | 201/200；快照冻结；重复 422；跨组织 404 | REQ-001 |
| TEST-102 | integration | 1 张发运单 + 1 张合同（含 3 行） | 建 PL（带 2 行明细）→ 改行 → 非 PL 单证传明细 | 201/200；行数/行号/字段持久化；非 PL 422；删单证级联删行 | REQ-002/003 |
| TEST-201 | integration | 合同（draft/issued/closed）+ 采购单 + 内部销售订单 | `contracts.orders.replace` 三次（增/换/清空）→ 读列表 → 作废合同再写 | 200；唯一约束；作废 422；事件与审计存在 | REQ-006 |
| TEST-202 | integration | 2 张合同 + 2 张 PI/CI + 1 张发运单 | PI/CI 关联合同 → 列表按 `contractId` 过滤 → 合同详情四区块只读聚合 | 201/200；快照与筛选正确；跨组织 404 | REQ-005/007 |
| TEST-203 | unit | 合同 + 已确认发票 + 关联表行 | 订单档案 KC 选择：关联表命中 / 仅 legacy `source_*` / 都没有 | 三态结果逐条断言（不回归） | REQ-008 |
| TEST-401 | UI | 上述数据 + superadmin | PL 三页 + 发运单合同区 + 合同枢纽 + PI/CI 合同选择器（亮/暗、窄屏） | 六态可用、键盘可达、无裸 `<table>`/`fetch` | REQ-001…007 |
| TEST-901 | migration | 工作树库 | `yarn db:generate` → 审阅 → 应用 | 只含新增表/两列；无残留 diff | REQ-001…006 |

## Implementation Phases

> 并行约束：`trade_docs` 正被 `feat/counterparty-linkage` 单元占用（2026-09-29 14:49 仍在改），
> **Phase 2 必须等它合并进 `dev` 后开工**；Phase 1 只动 `cross_border`，可立即开始。

### Phase 1 — `cross_border`：发运单关联合同 + 装箱单明细与快速引用

- **Depends on:** none
- **Outcome:** 发运单可挂多张合同（表单/详情/筛选）；装箱单可用独立页面登记带明细的单据，明细可从合同商品行生成。
- **Why this order / value delivered:** 不依赖 `trade_docs` 的代码改动（只读它的既有接口），先交付「合同 → 发运单/装箱单」这半边。
- **Deliverables:** `cross_border/data/entities.ts`（2 表）、`data/validators.ts`（`contracts[]`/`lines[]`）、
  `commands/shipments.ts`、`commands/documents.ts`、`api/shipments/**`（`contractId` 过滤 + 读缝）、
  `api/shipments/documents/**`（`contractId` 过滤）、`lib/cacheInvalidation.ts`、`components/ShipmentForm.tsx`/
  `ShipmentDetail.tsx`、新 `components/PackingListForm.tsx`/`PackingListDetail.tsx`/`packingLists*`、
  `backend/cross_border/packing-lists/{create,[id],[id]/edit}` + `page.meta.ts`、i18n zh/en、迁移、模块 README、集成测试。
- **Independent slices / estimated commits:** ①实体+校验+命令+路由（1 commit）；②页面与快速引用（1 commit）；
  ③迁移 + README/i18n + 集成测试（1 commit）。
- **Requirements closed:** REQ-001、REQ-002、REQ-003、REQ-004（发运单/PL 部分）
- **Tests:** TEST-101、TEST-102、TEST-401（cross_border 部分）、TEST-901
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`；
  `yarn mercato test:integration cross-border`；浏览器实测（亮/暗、窄屏、键盘）。
- **Exit gate:** 两张合同挂一柜可存可读可筛；PL 页面建/查/改/删带明细；四类明细行可从合同行生成并编辑；
  既有发运/单证集成套件保持绿。

### Phase 2 — `trade_docs`：PI/CI 合同引用 + 合同订单关联 + 合同枢纽 + 订单档案兼容

- **Depends on:** Phase 1 exit gate；`feat/counterparty-linkage` 合并进 `dev`（同模块互斥）
- **Outcome:** PI/CI 可关联合同并从合同行生成明细；合同可挂订单；合同详情成为枢纽；订单档案口径不回归。
- **Why this order / value delivered:** 合同侧是「主体」体验的落点，且必须避开在飞的同模块单元。
- **Deliverables:** `trade_docs/data/entities.ts`（`contract_id`/`contract_snapshot` + `trade_docs_contract_orders`）、
  `data/validators.ts`、`commands/documents.ts`、新 `commands/contractOrders.ts`、`api/documents/**`（筛选）、
  新 `api/contracts/orders/route.ts`、`events.ts`、`lib/cacheInvalidation.ts`、`components/DocumentsForm.tsx`（合同选择器 +
  从合同引用行）、`ContractDetail.tsx`（四区块 + 订单对话框）、`export_finance/lib/fileRules.ts`（兼容读）、
  菜单四组拆分（page.meta group key + `src/modules.ts` 的 `nav.groupOrder` + i18n）、迁移、两份 README、
  `docs/dev/business-architecture.md`、计划进度表、集成测试。
- **Independent slices / estimated commits:** ①实体/迁移/命令/路由（1 commit）；②PI/CI 表单与行引用（1 commit）；
  ③合同枢纽 + 订单对话框 + 菜单四组拆分 + 文档（1 commit）；④export_finance 兼容读 + 集成测试（1 commit）。
- **Requirements closed:** REQ-004（PI/CI 部分）、REQ-005、REQ-006、REQ-007、REQ-008、REQ-009
- **Tests:** TEST-201、TEST-202、TEST-203、TEST-401（trade_docs 部分）、TEST-901
- **Validation:** 同 Phase 1 + `yarn mercato test:integration trade-docs` / `export-finance`
- **Exit gate:** 合同详情四个区块可见可跳，新建带 `?contractId=` 预填；PI/CI 合同筛选与换绑可用；
  订单关联在已签发合同上可维护；订单档案 KC 三态测试全绿；门禁全绿。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001、发运单表单/详情 | `cross_border_shipment_contracts`、`shipments.create/update`、`GET …?contractId=` | 1 | TEST-101 | AC-001 |
| REQ-002 | J-002、PL 表单/详情 | `cross_border_export_document_lines`、`documents.create/update` | 1 | TEST-102 | AC-002 |
| REQ-003 | J-002、PL 台账/三页 | 同上 + `GET …/documents?contractId=` | 1 | TEST-102、TEST-401 | AC-003 |
| REQ-004 | J-001/J-002、各明细编辑器 | `GET /api/trade_docs/contracts/lines` | 1（发运单/PL）、2（PI/CI） | TEST-101/102/202、TEST-401 | AC-004 |
| REQ-005 | PI/CI 表单/详情 | `trade_docs_documents.contract_id` + 筛选 | 2 | TEST-202 | AC-005 |
| REQ-006 | J-003、合同详情 | `trade_docs_contract_orders`、`contracts.orders.replace`、`trade_docs.contract.orders.updated` | 2 | TEST-201 | AC-006 |
| REQ-007 | J-001…003、合同详情 | 四个跨模块只读列表 + `?contractId=` 预填 | 2 | TEST-202、TEST-401 | AC-007 |
| REQ-008 | 订单档案 | `export_finance/lib/fileRules.ts` 兼容读 | 2 | TEST-203 | AC-008 |
| REQ-009 | 菜单/文档 | 四个组 key + `nav.groupOrder`（一次声明）+ README/业务架构/计划表 | 1（发运/内部销售页）+ 2（合同/单证页） | TEST-401 | AC-009 |

## Rollout, Migration, and Rollback

- 迁移只增（4 张新表 + 2 列）；生成后审阅 SQL，应用需业主批准；共享开发库只做增量，不重建。
- 上线顺序：Phase 1 → 观察 → Phase 2；两阶段都可独立回滚（回滚 = revert 提交 + 不应用新迁移；
  已应用的迁移保留（仓内无 down），新表/新列留空不影响旧代码）。
- 不新增加功能开关；旧页面/旧入口在 Phase 内保持可用：PL 台账 URL、`cross_border.documents.*` 与
  `trade_docs.documents.*` 的命令 ID 与既有必需载荷都不变（只新增可选 `lines`/`contracts`/`contractId`），
  既有链接不失效；PL 登记对话框在 Phase 1 内退役、其能力并入新页面。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 与在飞单元 `feat/counterparty-linkage` 同改 `trade_docs` | 合并冲突/覆盖 | 本规格 Phase 2 等其合并后再开工；先做 Phase 1；开工前重跑 `git worktree list` + `gh pr list` | 对方延误会推迟 Phase 2（不阻塞 Phase 1） |
| 装箱单从「无明细」变「有明细」 | 既有台账/命令调用方 | 明细可选（不传=不动）；仅 `packing_list` 允许；既有集成测试保持绿 | 旧调用方若发送未知字段仍会 400（校验器拒绝未知键的行为不变） |
| 快速引用的「按商品匹配」可能多行/零行 | 分摊选错行或漏分摊 | 匹配到多行时让用户挑；零行时给提示且不自动生成；一切仍可手改 | 商品目录链接缺失的行仍要人工处理 |
| 合同关联不强制 | 数据上仍会有无合同单据 | 列表页显式列「合同」列 + 筛选项，让缺失可见 | 业务纪律问题，非技术可解 |
| 合同↔订单关联是第二份关系（既有 `source_*` 仍在） | 双写口径漂移 | 订单档案兼容读（TEST-203）；文档写明 `source_*` 仅历史读 | 旧字段长期保留（不迁移） |
| 合同枢纽的跨模块列表聚合 | 页面变慢/权限泄漏 | 只经对方 scoped 列表接口（分页 + 过滤）；区块按权限位隐藏 | 跨模块页速受对方接口影响 |

## Acceptance Criteria

- [x] **AC-001** — 一张发运单可挂多张合同并在详情/列表可见，按合同筛选返回正确集合；跨组织合同被拒。
- [x] **AC-002** — 装箱单可存多条明细（含箱数/毛重/净重/体积），编辑整体替换，非 PL 单证传明细被拒。
- [x] **AC-003** — PL 台账列出全部 PL 并显示合同与行数；新建/详情/编辑三页可用（亮/暗/窄屏/键盘）。
- [x] **AC-004** — 四类单据都能「从合同引用商品行」生成可编辑明细/分摊；重复执行不产生重复行。
- [x] **AC-005** — PI/CI 可关联/换绑合同，列表可按合同筛选，详情显示合同链接。
- [x] **AC-006** — 合同可挂采购单/内部销售订单（成套替换），已签发合同可维护，作废合同被拒。
- [x] **AC-007** — 合同详情四区块可见、可跳、可带 `?contractId=` 新建。
- [x] **AC-008** — 订单档案 KC 口径在关联表命中 / legacy 命中 / 都无三种情况下都有测试断言。
- [x] **AC-009** — 出口业务拆成四个带前缀的组（内部销售/购销合同/发运/单证），组内条目与顺序符合 REQ-009；README/业务架构/计划表同步。
- [ ] Every listed backend surface matches its recorded reference and uses canonical shell/components, shared
      API helpers, semantic tokens, and complete loading/empty/error/conflict/keyboard/a11y/responsive/light/dark states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 仓库根 `AGENTS.md`、`.ai/guides/{backend-ui,spec-delivery,framework-contracts}.md`、`om-spec-writing`；实现阶段再加 `om-module-scaffold`/`om-backend-ui-design` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 需求追踪表逐行对应 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…003 各自落在 Phase 1/2 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse 表；无自定义组件族 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI 表 + 参考页面 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–2 |

Verdict: **Passed — Phase 1 与 Phase 2 实现完成、门禁全绿、真机（API + 浏览器）与集成测试均有可重跑证据（见 Changelog）。**
遗留（非本规格验收项，已在 Q-004 记录）：对外销售单据（`external_sales_order`）本身仍属另一条需求，选择器已给出未接入提示。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 装箱单明细字段口径 | 业务 | yes | **已决 2026-09-29**：完整口径（商品/数量/箱数/毛重/净重/体积/备注，全部可空可改） |
| Q-002 | 发运单「引用合同商品」如何落分摊 | 业务 | yes | **已决 2026-09-29**：从本次发运单已选订单行按商品匹配，匹配不到给提示 + 手工挑选 |
| Q-003 | 合同 ↔ 订单关联是否一并补 | 业务+技术 | yes | **已决 2026-09-29**：要做——关联采购单与销售单（对内 / 对外销售单据都要挂；见 Q-004） |
| Q-004 | 「对外销售单据」的另一条需求细节（本仓暂无 spec/实现） | 业务 | no | 待其落地后把 `order_kind='external_sales_order'` 接上选择器；本规格已预留该值，不需要再加表 |
| Q-005 | 菜单能否加一个层级 | 业务 | no | **已决 2026-09-29**：主侧边栏只有「组 → 条目 → 条目子项（一层，URL 前缀推导）」，组不可嵌套；改为**组名前缀拆组**（出口业务-内部销售/购销合同/发运/单证，REQ-009） |
| Q-006 | 单据上的合同关联是否必填 | 业务 | no | 先可空（不强制）；稳定后可另立收紧决定 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-29 | 骨架：问题陈述 + 方案轮廓 + 3 个阻塞 Open Questions。 |
| 2026-09-29 | 菜单口径按业主指示改为**组名前缀拆组**（出口业务-内部销售/购销合同/发运/单证），替代原「合同置顶」；REQ-009/AC-009/导航契约同步。 |
| 2026-09-29 | **Phase 1 实现并验证**（`cross_border`）：合同关联表 + 装箱单明细表（迁移只增、已应用）、命令/路由/筛选/缓存失效、发运单「关联合同」UI、装箱单三页 + 明细编辑器、四处「从合同引用商品」中的三处（发运单两个分摊 + 装箱单明细）、菜单拆四组。证据：`yarn generate/typecheck/lint` 绿（0 error）；单元 2 suites/16 tests；集成 `__integration__/shipment-contracts.spec.ts` **3 passed**（TEST-101/102/103）；真机 API 冒烟（合同链接 11/11、装箱单明细 11/11）；浏览器实测 PL 三页 + 快速引用对话框 + 发运单分摊引用对话框 + 侧边栏四组。 |
| 2026-09-29 | Open Questions 全部关闭（Q-001 完整 PL 口径；Q-002 按已选订单行匹配；Q-003 合同↔订单关联要做）→ 填全 spec：数据模型（2+2 张表、2 列）、API/命令、UI 契约、阶段 1/2（Phase 2 等 `feat/counterparty-linkage` 合并）、测试与验收。 |
| 2026-09-29 | **Phase 2 实现并验证**（`trade_docs` + `export_finance` 兼容读 + `cross_border` 入口预填）：`trade_docs_contract_orders` + 单写者命令 `trade_docs.contracts.orders.replace`（成套替换、快照、作废 422、乐观锁 409、审计 + `trade_docs.contract.orders.updated`）、`trade_docs_documents.contract_id/contract_snapshot` 与 `?contractId=` 筛选、合同详情五个关联区块 + 订单关联对话框、PI/CI 表单合同字段与「从合同引用商品行」、单据详情合同链接、发运单/装箱单新建页 `?contractId=` 预填（发运单预填合同行并解析合同号，装箱单把发运单选择器收窄到该合同且唯一候选时预选）、`export_finance.selectKcContract` 兼容读关联表与历史锚点。证据：`yarn generate` ✓ ｜ `yarn typecheck` ✓ 0 error ｜ `yarn lint` ✓ 0 error（8 既有 warning）｜ `yarn ds:check` ✓ 956 files ｜ `yarn test` ✓ 61 suites / 516 tests ｜ `yarn build` ✓（rebase 后 27.1s）；集成（同一轮）`trade_docs/__integration__/contract-orders.spec.ts` **5 passed**（TEST-201/202）+ `cross_border/…/shipment-contracts.spec.ts` **3 passed** + `finance/…/finance-flow.spec.ts` **1 passed**，既有 `trade_docs/__integration__` 全套 **41 passed**（冷启动首轮两处 `beforeAll` 20s 超时，热身后重跑 12 passed —— 环境冷启动，非用例失败）；单元 TEST-203 新增 4 例（关联表命中 / 仅 legacy / 都没有 / 作废与跨单排除，`orderFileProjection.test.ts` 45→49 passed）；真机 API 冒烟（替换/读回/重复 422/未知订单 422/未知合同 404/作废 422/版本 409/清空、单据合同引用与解绑、订单档案 KC 金额）；浏览器实测（合同枢纽五区块与新建入口、订单关联对话框增删存、作废合同隐藏管理入口、PI 表单合同预填与「从合同引用商品行」、PI 详情合同链接、PI 台账合同筛选 chip、发运单与装箱单新建页预填与收窄）。 |
