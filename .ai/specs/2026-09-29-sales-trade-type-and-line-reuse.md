# 对内 / 对外销售贸易类型与合同行复用（sales trade type & line reuse）

**Date**: 2026-09-29
**Status**: Ready for implementation

> Route: `module-data`（`internal_sales` 界面 + `cross_border` / `trade_docs` 消费方）+ `backend-ui`。
> 决策来源：owner 2026-09-29 对本调研第三点的答复——「一个实现 + 两种贸易类型 + 菜单/分组分开」。

## TLDR

给销售单据（报价单/订单）加一个**贸易类型**（内部＝总部→分公司；对外＝分公司→当地客户），写入时打上引擎原生、服务端可过滤的通道标记（`sales channel`），列表按类型过滤，并把这两类各自的**菜单入口**分开（`/backend/internal-sales/**` 与 `/backend/external-sales/**` 共用同一实现）。随后让**合同**的行复用对话框按合同方向与贸易类型挑选来源（采购→采购单；内部销售→内部销售单据；对外销售→对外销售单据），并把合同已有的 `source_kind/source_id` 锚点接上界面。

## Problem Statement

1. **同一个界面同时充当内部与对外**：`internal_sales` 的买方选择器既给「关联组织」（内部）也给「外部客户」（对外客户档案），列表不过滤，引擎里**没有任何标记**——只有快照键 `customer_snapshot.internalSales.{organizationId|partyId}` 能事后区分（`src/modules/internal_sales/lib/buyer.ts:84-99`）。操作员分不清一单是内部调拨还是对外销售，下游也分不清。
2. **下游按订单取数不看性质**：发运单的销售分摊选择器列出作用域内**所有**销售订单（`cross_border/components/shipmentFormOptions.ts:118-136`），`cross_border` 的写入校验只查重复/存在/目录桥接，不校验内部性（`commands/shipments.ts:188-230`）——总部发运可以把分公司对外的订单拉进分摊。
3. **合同的行复用缺失**：合同行只能从商品主数据选；PI/CI 才有「从订单复制行」对话框（读 `sales/order-lines`，**不区分**内部/对外）。合同的 `source_kind/source_id/source_snapshot` 只有 schema、没有界面（pi-ci spec 的 C-4 标为可选）。
4. **存量数据没有标记**：dev 库 3 张销售订单 / 1 张报价单全部 `channel_id is null`，0 条通道记录——回填是这次交付的一部分。

## Overview and Success Measures

- **Primary outcome:** 任何一张销售单据都能一眼看出（并被服务端筛出）它是内部调拨还是对外销售；合同的来源单据与贸易类型对得上。
- **Leading indicators:** 新建单据的 `channel_id` 命中内部/对外通道；发运分摊选择器里不再出现对外订单；合同「从订单复制行」的来源与该单方向一致。
- **Baseline:** dev 库 4 张销售单据、`channel_id` 全空、0 条通道。
- **Market reference:** ERP 里区分「公司间交易（intercompany）」与「第三方销售」的标准做法是独立的单据类型/交易类型维度（SAP 的 intercompany billing、Odoo 的 company/partner 双维）——本 spec 用「渠道标记 + 菜单/过滤」落在同一套引擎上，而不是复制一条单据链。

## Goals

- **REQ-001** — 销售单据（报价单/订单）带**贸易类型** `internal | external`；类型由买方来源唯一决定（关联组织 ⇒ internal；外部客户档案 ⇒ external），界面不再让两半混选。
- **REQ-002** — 类型写入引擎原生标记：每个组织两个通道（`INTERNAL_SALES` / `EXTERNAL_SALES`），单据的 `channelId` 指向其中一个；通道缺失时按需播种（幂等）。
- **REQ-003** — 列表按类型过滤：`/backend/internal-sales/**` 只显示内部；新增 `/backend/external-sales/**` 只显示对外；两者共用同一实现与同一套权限位。
- **REQ-004** — 发运单的销售分摊选择器只列**内部**销售订单；外部订单不能进出口分摊。
- **REQ-005** — 合同行支持「从订单/报价单复制行」：采购方向 → 采购单；销售方向 → 销售单据，且来源按合同的**对方类型/贸易类型**过滤（分公司 → 内部单据；外部客户 → 对外单据），复制一次性、逐行写 `source_snapshot`，头部接上 `source_kind/source_id/source_snapshot`（C-4）。
- **REQ-006** — 存量回填：提供一条只读优先（默认 dry-run）的 CLI 命令，按快照键把历史单据挂到对应通道；执行需 owner 批准。
- **REQ-007** — 兼容性：既有页面 URL、权限位、`customerSnapshot` 形状与官方 `sales` 列表契约不变；通道播种对未启用 `sales` 的场景安全降级。

## Non-goals

- 不新建销售引擎或第二条单据链；不复制 6 个页面（对外入口与内部入口共用组件）。
- 不为对外销售建履约链（发运/分摊/wms 只服务内部出口链）；对外订单不进入 `cross_border` 分摊。
- 不改官方 `sales` 的数据模型、事件与 ACL。
- 不做报价单→订单的自动转换（`internal_sales` 已有该行操作）。

## Proposed Solution

1. **通道即贸易类型**：`internal_sales/setup.ts` 新增 `onTenantCreated` 与 `seedDefaults`，为每个组织幂等播种两条 `sales_channels`（`INTERNAL_SALES` 内部销售 / `EXTERNAL_SALES` 对外销售，名称走 i18n 的固定中文/英文数据值，只存显示名）。写入时由 UI 解析并提交 `channelId`。
2. **类型由买方来源推导**：`InternalSalesForm` 的买方选择器旁新增「贸易类型」控件（内部/对外）——类型决定买方来源（内部→仅关联组织；对外→仅外部客户），与合同对方同款「方向决定命名空间」的交互；保存时把类型对应的 `channelId` 一并写入（create 与 update 都写）。
3. **列表过滤 + 两个菜单**：列表把类型映射成 `channelId`（或 `channelIds`）传给官方列表；`/backend/internal-sales/**` 固定 internal；新增 `/backend/external-sales/**` 页面体复用内部页面（re-export）并在 `page.meta.ts` 里预设 `tradeType=external`、自己的导航标签与顺序（沿用「同一页面体、自己的 page.meta」的既有做法）。
4. **下游对齐**：`cross_border` 的销售订单选项加载器把 `channelId` 固定为内部通道（读不到通道时回退为「按快照键过滤」并给出提示，不静默放行对外订单）。
5. **合同行复用**：`ContractLinesEditor` 增加「从订单/报价单复制行」对话框（复用 PI/CI 的实现思路）：采购方向列采购单；销售方向按合同的对方（分公司→内部；外部客户→对外）列销售订单/报价单，一次复制、逐行 `source_snapshot`，头部写 `sourceKind/sourceId/sourceSnapshot`。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 贸易类型用 `sales_channels` 承载 | 引擎里唯一**服务端可过滤**的标记（列表支持 `channelId/channelIds/channelIdsEmpty`）；`metadata` 不可过滤，`customerReference`/快照都是自由文本 | 用 `metadata.tradeType` | 列表过滤不了，分页服务端过滤就落不了地 |
| 类型由买方来源推导（界面只给一个联动控件） | 与合同「方向决定对方」同一心智：不允许出现「内部类型 + 外部客户」的组合 | 类型与买方各自独立 | 又一次制造两个字段不一致的入口 |
| 对外销售复用同一实现、另开菜单 | 一处实现、两处入口；权限位与写入门禁都不变；复制 6 个页面会让下一次改动双写 | 新建 `external_sales` 模块 | 复制页面与表单、写入仍共用 `sales.*` 门禁，拆分只增加维护面 |
| 通道按组织播种（setup 钩子） | 引擎写 `channelId` 时校验通道属于本组织；播种幂等且随组织创建自动发生 | 首次保存时懒创建 | 写入路径要带 `sales.channels.manage`，普通业务员没有该权限 |
| 存量回填走 CLI（默认 dry-run） | 回填是数据变更，需 owner 批准；dry-run 先出清单 | 迁移里直接 SQL 回填 | 迁移按模块顺序执行、且要新建通道，SQL 无法表达幂等播种 |
| 发运分摊只列内部订单 | 出口链的上游就是内部销售；对外订单在分公司本地履约 | 两个都列、靠人工分辨 | 正是 owner 说的「混淆」 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 贸易类型 tradeType | `internal`（总部→分公司）\| `external`（分公司→当地客户） | `internal_sales` 界面 + 通道标记 | 与买方来源不一致 → 表单拒绝 |
| 通道标记 | 每组织一条 `INTERNAL_SALES`、一条 `EXTERNAL_SALES`（`sales_channels.code`），单据 `channel_id` 指向其一 | installed `sales` | 通道解析失败 → 保存前提示，不静默写空 |
| 内部销售单据 | 买方是关联组织（组织树内），`customerSnapshot.internalSales.organizationId` | installed `sales` | 只出现在内部入口与内部过滤 |
| 对外销售单据 | 买方是外部客户档案（`parties`，角色 `buyer`），`customerSnapshot.internalSales.partyId` | installed `sales` | 只出现在对外入口与对外过滤 |
| 合同来源单据 | 采购→采购单；销售→（分公司）内部销售单据 /（外部客户）对外销售单据；一次性复制 | `trade_docs` | 来源与方向不符 → 选择器不提供 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 总部业务员 | 建/改内部销售单据；合同复用内部单据行 | 写＝当前组织 | `sales.quotes.manage` / `sales.orders.manage`（既有） |
| 分公司业务员 | 建/改对外销售单据（自己的客户） | 写＝本公司组织；买方来源天然只有本公司客户 | 同上 + `parties.manage`（建客户） |
| 采购员 | 合同复用采购单行 | 写＝当前组织 | `trade_docs.contracts.manage`（既有） |

`tenantId`/`organizationId` 一律来自会话；通道按组织解析，不跨组织复用。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 销售单据引擎 | reuse | installed `sales` | `channelId` + 既有 CRUD | 单据链、编号、状态机都不重写 |
| 贸易类型界面 | extend | `internal_sales`（app-owned UI） | 同一实现对两个入口 | 不复制页面 |
| 通道播种 | extend | `internal_sales/setup.ts` | `seedDefaults` / `onTenantCreated` | 引擎写校验要求通道先存在 |
| 发运分摊 | extend | `cross_border` | 选项加载器过滤 | 出口链只吃内部订单 |
| 合同行复用 | extend | `trade_docs` | 复用 `sales/order-lines`、`sales/quote-lines`、`purchasing/purchase-orders/lines` 只读 | C-4 的锚点与复制 |

## Architecture and Data Flow

```text
/backend/internal-sales/**（tradeType=internal）┐
                                                ├─ 同一 InternalSalesForm/Table
/backend/external-sales/**（tradeType=external）┘
   ├─ 贸易类型控件（推导买方来源）
   ├─ 保存 → POST/PUT /api/sales/{quotes,orders}（含 channelId=对应通道）
   └─ 列表 → GET /api/sales/{quotes,orders}?channelId=…（服务端过滤）
cross_border 分摊选择器 → GET /api/sales/orders?channelId=<internal> → 只列内部订单
trade_docs 合同行 → 「从订单/报价单复制行」→ 按方向/对方类型选来源 → 追加行 + 头部锚点
internal_sales CLI → 回填命令（dry-run 默认）
```

- **Module boundaries:** 贸易类型是界面概念 + 引擎标记；不新增实体（通道是 installed 表）。
- **Extension points:** 复用既有页面体的 re-export 模式（`backend/dictionaries` 的先例）与 `page.meta.ts` 预设。
- **Compatibility:** 既有 URL/权限/快照形状不变；新页面为纯追加。

## User Journeys

### Journey J-001 — 分公司做对外销售

1. 分公司账号进入 `/backend/external-sales/orders` → 「新建」。
2. 贸易类型固定「对外」；买方选择器只列本公司的外部客户（可「新增客户」）。
3. 保存 → 单据落 `channelId=EXTERNAL_SALES`；列表（对外入口）显示该单；内部入口看不到它。

### Journey J-002 — 总部做内部销售

1. 总部账号进入 `/backend/internal-sales/orders` → 新建 → 贸易类型「内部」→ 买方只列关联组织。
2. 保存 → `channelId=INTERNAL_SALES`；发运单分摊选择器能看到它。

### Journey J-003 — 合同复用销售单据的行

1. 合同（销售方向，对方=分公司）→ 明细区「从订单/报价单复制行」。
2. 来源列表只列内部销售订单/报价单；选中 → 追加行并冻结 `source_snapshot`；头部记 `sourceKind/sourceId/sourceSnapshot`。
3. 若对方是外部客户 → 来源列表只列对外单据。

### Journey J-004 — 回填历史单据

1. 运维跑 `yarn mercato internal_sales backfill-trade-type`（dry-run）→ 输出待回填清单（按快照键判定）。
2. owner 批准后加 `--apply` → 逐单写入 `channelId`，逐行报告跳过原因（无快照/通道缺失）。

## UI and Interaction Contracts

参照页面：`internal_sales` 自己的 `InternalSalesForm`/`InternalSalesTable`（贸易类型控件与买方选择器同组），契约与 PI/CI 的「从订单复制行」对话框一致（`trade_docs/components/DocumentsForm.tsx`）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/internal-sales/{quotes,orders}` | 内部单据列表/新建/编辑 | `GET/POST/PUT /api/sales/*` + `?channelId=` | `InternalSalesTable` | `DataTable` / `CrudForm` | loading/empty/error/冲突/权限 | REQ-001…003 |
| `/backend/external-sales/{quotes,orders}` | 对外单据（同一页面体，`tradeType=external`） | 同上 | 同上 | 同上 | 同上 | REQ-003 |
| `/backend/trade-docs/contracts/{create,edit}` | 行复用对话框 + 来源锚点 | `sales/{order,quote}-lines`、`purchasing/purchase-orders/lines`、合同命令 | `DocumentsForm` 的复制对话框 | `Dialog` + `ComboboxInput` | 空来源/失败/重复复制 | REQ-005 |
| `/backend/cross_border/shipments/{create,edit}` | 分摊选择器只列内部订单 | `GET /api/sales/orders?channelId=<internal>` | 既有 `shipmentFormOptions` | 既有表单 | 通道缺失提示 | REQ-004 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 总部业务员 | 出口业务 → 内部销售报价/订单 → 购销合同 … | 无新增 | 登录 → 内部销售订单 → 新建（≤3 步） |
| 分公司业务员 | 出口业务 → 对外销售报价/订单（其组织视角下内部入口自然为空） | 无新增 | 登录 → 对外销售订单 → 新建 |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 贸易类型 + 买方 | 无选项时给出来源说明（内部=组织树无下级；对外=本公司暂无客户，给「新增客户」） | 窄屏单列 | Tab：贸易类型 → 买方；对话框 Cmd/Ctrl+Enter/Esc |
| 从订单/报价单复制行 | 无来源单据时提示「该类型下没有可复制的单据」 | 单列对话框 | 同上 |

## Data Models

**无新实体。** 追加的数据是 installed `sales_channels` 的行（每组织两条，`code` 固定值 `INTERNAL_SALES` / `EXTERNAL_SALES`，`name` 为单一语言的显示名）与既有 `sales_orders.channel_id` / `sales_quotes.channel_id` 的写入。`sales_channels.code` 没有唯一约束 → 播种前按 `(tenant, organization, code)` 查询、幂等写入。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET/POST` | `/api/sales/channels`（既有） | `sales.channels.view/manage` | 播种时创建通道 | 201 | 幂等：先查后建 | REQ-002 |
| `POST/PUT` | `/api/sales/{quotes,orders}`（既有） | 既有 `sales.*.manage` | 追加 `channelId` | 既有 | 通道不属于本组织 → 400（引擎校验） | REQ-001/002 |
| `GET` | `/api/sales/{quotes,orders}?channelId=`（既有） | 既有 | — | 既有 | — | REQ-003/004 |
| CLI | `internal_sales backfill-trade-type`（新） | CLI | `--apply`（默认 dry-run）、可选 `--organization` | 逐单报告 | 无通道 → 跳过并计数 | REQ-006 |
| commands | `trade_docs.contracts.{create,update}`（既有） | 既有 | 追加来源锚点载荷 | 既有 | 既有 | REQ-005 |

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| 通道播种 | `internal_sales` setup（`seedDefaults`/`onTenantCreated`） | installed `sales` | 每个组织两条通道 | 幂等（先查后建）；`seed:defaults --module internal_sales` 可重跑 |
| 回填命令 | CLI | installed `sales` | 写 `channel_id` | dry-run 默认；逐单幂等；报告 skipped 原因 |

## Security, Privacy, and Compliance

- **Authorization:** 不新增功能位；写入仍由 `sales.*.manage` 门禁，通道播种只写 installed `sales_channels`（由 CLI/setup 以系统身份执行，不经用户权限）。
- **Tenant isolation:** 通道按 `(tenant, organization)` 解析与写入；列表过滤用引擎的 `channelId` 参数（服务端作用域内）。
- **Sensitive data:** 无新增敏感字段；回填报告不打印客户名称以外的业务数据。
- **Abuse:** 通道缺失时保存给出明确错误，不回退写入「无通道」的单据（否则过滤会漏单）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | 一租户一组织 | 跑 `seedDefaults` 两次 | 两条通道、第二次幂等（仍两条） | REQ-002 |
| TEST-002 | integration (API) | 同上 | 建内部订单（含 `channelId`）→ 按 `channelId` 过滤列表 → 建对外订单 → 两种过滤 | 各自只返回自己的单据；不带过滤时两者都在 | REQ-001/003 |
| TEST-003 | integration (API) | 一张内部订单 + 一张对外订单 + 发运单 | 读发运分摊的可选订单来源 | 只出现内部订单 | REQ-004 |
| TEST-004 | integration (API) | 合同（销售，对方=分公司 / 外部客户；采购） | 复制行对话框的数据来源 | 来源分别只有内部单据 / 对外单据 / 采购单；复制后行与头部锚点落库 | REQ-005 |
| TEST-005 | unit (CLI) | 快照两种形状的假数据 | dry-run 与 apply | 分类正确、无快照的跳过并计数 | REQ-006 |

## Implementation Phases

### Phase 1 — 贸易类型：通道播种 + 推导 + 过滤（含列表徽标）

- **Depends on:** none
- **Outcome:** 新单据带通道标记；内部入口只显示内部单据。
- **Deliverables:** `internal_sales/setup.ts`（种子）、`lib/tradeType.ts`（类型常量、通道代码、按买方推导、通道解析）、`InternalSalesForm`（类型控件 + 写入 `channelId`）、`InternalSalesTable`（按类型过滤 + 类型列）、i18n。
- **Requirements closed:** REQ-001, REQ-002, REQ-003（内部侧）
- **Tests:** TEST-001, TEST-002
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/internal_sales` + 定点集成
- **Exit gate:** 内部入口只列内部单据；保存的单据 `channel_id` 正确；种子可重跑。

### Phase 2 — 对外入口（同一实现，自己的菜单）

- **Depends on:** Phase 1
- **Deliverables:** `/backend/external-sales/{quotes,orders}`（`page.tsx` re-export + `page.meta.ts` 预设 `tradeType=external`）、`InternalSalesForm/Table` 接受预设、i18n。
- **Requirements closed:** REQ-003（对外侧）
- **Tests:** TEST-002（对外入口）
- **Exit gate:** 对外入口只列对外单据；两个入口共用同一实现（无复制页面体）。

### Phase 3 — 下游对齐与合同行复用

- **Depends on:** Phase 1
- **Deliverables:** `cross_border` 分摊选项过滤 + 通道缺失提示；合同明细的「从订单/报价单复制行」对话框 + 来源锚点写入与回显；i18n。
- **Requirements closed:** REQ-004, REQ-005
- **Tests:** TEST-003, TEST-004
- **Exit gate:** 分摊只列内部订单；合同复制行来源随方向/对方类型变化并落库。

### Phase 4 — 回填命令与文档

- **Depends on:** Phase 1–3
- **Deliverables:** CLI `internal_sales backfill-trade-type`、README/计划/spec 更新。
- **Requirements closed:** REQ-006, REQ-007
- **Tests:** TEST-005
- **Exit gate:** dry-run 输出可核对清单；apply 逐单幂等。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001/J-002 | 单据 `channelId` + 类型控件 | 1 | TEST-002 | AC-001 |
| REQ-002 | 规划 | 通道播种 | 1 | TEST-001 | AC-002 |
| REQ-003 | J-001/J-002 | 列表 `channelId` 过滤 + 两个入口 | 1/2 | TEST-002 | AC-003 |
| REQ-004 | J-002 | 发运分摊来源过滤 | 3 | TEST-003 | AC-004 |
| REQ-005 | J-003 | 复制行 + 头部锚点 | 3 | TEST-004 | AC-005 |
| REQ-006 | J-004 | CLI 回填 | 4 | TEST-005 | AC-006 |
| REQ-007 | 全部 | 既有 URL/权限/快照不变 | 1–4 | 既有套件 + TEST-002 | AC-007 |

## Migration & Backward Compatibility

依据 [`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`](../../guides/upstream/BACKWARD_COMPATIBILITY.md)。全部为**追加式**：

| Surface | Nature of change | Compatibility note |
|---|---|---|
| 新页面 `/backend/external-sales/**` | 追加 | 既有 URL 不变 |
| `internal_sales` 列表查询 | 追加 `tradeType` 预设（页面级） | 直接访问旧 URL 时默认 internal（与今天「只放内部」的心智一致；对外入口补上后不再混列） |
| 单据写入 | 追加 `channelId` | 不写通道的既有调用方（演示脚本、集成测试）行为不变：单据无通道，列表按 `channelIdsEmpty` 仍可列出 |
| `cross_border` 分摊来源 | 收紧为内部通道；**无通道的历史订单**按快照键判定内部 | 无标记的历史内部订单仍可用（回填后判据统一） |
| DB schema | 无新表/列（写 installed `sales_channels` 行） | 种子与回填都是数据操作，`--apply` 需批准 |

## Rollout, Migration, and Rollback

- 种子：`yarn mercato seed:defaults --module internal_sales`（幂等）生成两通道；新组织随 `onTenantCreated` 自动获得。
- 回填：`yarn mercato internal_sales backfill-trade-type`（dry-run）→ 批准后 `--apply`。
- 回滚：页面入口删除即回到今天的单入口；已写入的 `channel_id` 无副作用（官方列表默认不按它过滤）；种子通道可手工停用（`isActive=false`）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 用通道承载「贸易类型」会与真实销售渠道语义重叠 | 未来的渠道分析要排除这两个「伪渠道」 | 代码固定 `INTERNAL_SALES`/`EXTERNAL_SALES`，README 与 spec 写明用途；渠道页可见可停用 | 语义债，需在渠道报表里显式排除 |
| 无标记的历史单据 | 按通道过滤时消失 | 回填命令 + `channelIdsEmpty` 过滤兜底 | 未回填前外部入口看不到老单据 |
| 通道解析失败（网络/权限） | 保存被阻塞 | 明确报错并提示重试，不写空通道 | 无 |
| 对外订单误入发运分摊 | 出口链数据污染 | 选择器过滤 + 集成测试；写入侧仍由人工选择 | 无标记的历史订单依赖回填 |

## Acceptance Criteria

- [ ] **AC-001** — 新建内部/对外单据分别落 `channel_id` 为对应通道；类型与买方来源不可能不一致。
- [ ] **AC-002** — `seedDefaults` 幂等：两次执行仍两条通道。
- [ ] **AC-003** — 内部入口不含对外单据，对外入口不含内部单据（服务端过滤）。
- [ ] **AC-004** — 发运分摊的可选销售订单只有内部单据。
- [ ] **AC-005** — 合同「从订单/报价单复制行」的来源随方向/对方类型变化，复制行与头部锚点落库并可回显。
- [ ] **AC-006** — 回填命令 dry-run 给出清单、apply 幂等、无通道时跳过并计数。
- [ ] **AC-007** — 既有 URL、权限位、`customerSnapshot` 形状与既有测试不受影响。
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`、`om-module-scaffold`（+api-and-domain/verification）、`om-backend-ui-design`、`.ai/guides/{contracts,backend-ui}.md`、BC 指南 |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无新实体；通道是 installed 表的数据行 |
| Every workflow completes end to end without a catch-all integration phase | pass | 四个 phase 各自闭环 |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用官方通道/列表过滤、既有页面体 re-export |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 见 UI 表 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | 见 Phase 1–4 |

Verdict: **Ready for implementation**。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 对外销售是否需要自己的价格档默认（`export`）？ | 业务 | no | 本轮默认：对外单据的价格档按商品主数据手动选；默认值单独立项 |
| Q-002 | 渠道页是否要隐藏这两条「伪渠道」？ | 业务 | no | 本轮不隐藏（渠道页本就 navHidden），README 说明用途 |
| Q-003 | 回填的批准与执行窗口？ | owner | yes（执行前） | 命令默认 dry-run；`--apply` 前需 owner 批准 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-29 | Initial draft（依据 owner 2026-09-29 决策：一个实现 + 两种贸易类型 + 菜单/分组分开；下游对齐与合同行复用一并纳入） |
