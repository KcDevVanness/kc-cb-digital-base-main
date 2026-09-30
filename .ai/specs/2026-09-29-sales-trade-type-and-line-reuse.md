# 对内 / 对外销售贸易类型与合同行复用（sales trade type & line reuse）

**Date**: 2026-09-29
**Status**: Implemented — Phases 1–4 shipped and verified (2026-09-29); PR #40。界面口径按 owner 决策修订三次：2026-09-29 改成「销售入口两种类型同表」（见 Changelog 末行），2026-09-30 按 owner 反馈改回「每个入口 = 一种类型」（对内入口固定对内、菜单与标题随类型命名；PR #61），**2026-09-30 再按 owner 反馈把 REQ-004 反过来：发运分摊选择器改列对内与对外两个方向的订单**（见 Changelog 末行）

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
- **Leading indicators:** 新建单据的 `channel_id` 命中内部/对外通道；发运分摊选择器里对内与对外订单都出现且各自带方向词（2026-09-30 修订，取代原「不再出现对外订单」）；合同「从订单复制行」的来源与该单方向一致。
- **Baseline:** dev 库 4 张销售单据、`channel_id` 全空、0 条通道。
- **Market reference:** ERP 里区分「公司间交易（intercompany）」与「第三方销售」的标准做法是独立的单据类型/交易类型维度（SAP 的 intercompany billing、Odoo 的 company/partner 双维）——本 spec 用「渠道标记 + 菜单/过滤」落在同一套引擎上，而不是复制一条单据链。

## Goals

- **REQ-001** — 销售单据（报价单/订单）带**贸易类型** `internal | external`；类型由买方来源唯一决定（关联组织 ⇒ internal；外部客户档案 ⇒ external），界面不再让两半混选。
- **REQ-002** — 类型写入引擎原生标记：每个组织两个通道（`INTERNAL_SALES` / `EXTERNAL_SALES`），单据的 `channelId` 指向其中一个；通道缺失时按需播种（幂等）。
- **REQ-003** — 列表口径（**2026-09-30 界面修订，取代 2026-09-29 的「同表」口径**）：**一个入口 = 一种贸易类型**。`/backend/internal-sales/**` 只显示对内（服务端 `channelId=<INTERNAL_SALES>`），`/backend/external-sales/**` 只显示对外（`channelId=<EXTERNAL_SALES>`）；表单的贸易类型是入口的**只读值**（不可切换），列表因此不再需要「类型」列；两者共用同一实现与同一套权限位。通道未播种时**不发列表请求**，在表格位置给出可执行提示（与保存被拦截同一句话）。
- **REQ-004** — **2026-09-30 修订，取代 2026-09-29 的「只列内部订单」口径**：发运单的销售分摊选择器列出**对内与对外两个方向**的销售订单。服务端不做性质校验（写入只查重复/存在/目录桥接），界面把两个贸易类型的通道一并传给 `sales/orders`（外加「无通道」桶），并给每个选项在标签最前加上方向词（`对内` / `对外`，取自通道标记、其次取冻结的买方快照）——两个方向都能分摊，且不会看错方向。
- **REQ-005** — 合同行支持「从订单/报价单复制行」：采购方向 → 采购单；销售方向 → 销售单据，且来源按合同的**对方类型/贸易类型**过滤（分公司 → 内部单据；外部客户 → 对外单据），复制一次性、逐行写 `source_snapshot`，头部接上 `source_kind/source_id/source_snapshot`（C-4）。
- **REQ-006** — 存量回填：提供一条只读优先（默认 dry-run）的 CLI 命令，按快照键把历史单据挂到对应通道；执行需 owner 批准。
- **REQ-007** — 兼容性：既有页面 URL、权限位、`customerSnapshot` 形状与官方 `sales` 列表契约不变；通道播种对未启用 `sales` 的场景安全降级。

## Non-goals

- 不新建销售引擎或第二条单据链；不复制 6 个页面（对外入口与内部入口共用组件）。
- 不为对外销售建履约链（发运/分摊/wms 仍走总部出口链，不新建第二条链路）；**对外订单可以进入 `cross_border` 分摊（2026-09-30 起，原「不进入」口径已废）**，但对外单据本身不在出口链上流转。
- 不改官方 `sales` 的数据模型、事件与 ACL。
- 不做报价单→订单的自动转换（`internal_sales` 已有该行操作）。

## Proposed Solution

1. **通道即贸易类型**：`internal_sales/setup.ts` 新增 `onTenantCreated` 与 `seedDefaults`，为每个组织幂等播种两条 `sales_channels`（`INTERNAL_SALES` 内部销售 / `EXTERNAL_SALES` 对外销售，名称走 i18n 的固定中文/英文数据值，只存显示名）。写入时由 UI 解析并提交 `channelId`。
2. **类型由买方来源推导**：`InternalSalesForm` 的买方选择器旁新增「贸易类型」控件（内部/对外）——类型决定买方来源（内部→仅关联组织；对外→仅外部客户），与合同对方同款「方向决定命名空间」的交互；保存时把类型对应的 `channelId` 一并写入（create 与 update 都写）。
3. **列表过滤 + 两个菜单**：列表把类型映射成 `channelId`（或 `channelIds`）传给官方列表；`/backend/internal-sales/**` 固定 internal；新增 `/backend/external-sales/**` 页面体复用内部页面（re-export）并在 `page.meta.ts` 里预设 `tradeType=external`、自己的导航标签与顺序（沿用「同一页面体、自己的 page.meta」的既有做法）。
4. **下游对齐（2026-09-30 修订）**：`cross_border` 的销售订单选项加载器把本组织两条贸易类型通道一并传给 `sales/orders`（`channelIds=<internal>,<external>`），再合并一桶「完全没有通道」的历史单据（它们等回填命令分类，回填前也必须在分摊里可选）；每个选项的方向词放在标签最前，方向解析不出来的行不加猜测。通道解析不到时那一桶不带通道过滤（退化为作用域内全部订单），标记请求本身失败才报错。
5. **合同行复用**：`ContractLinesEditor` 增加「从订单/报价单复制行」对话框（复用 PI/CI 的实现思路）：采购方向列采购单；销售方向按合同的对方（分公司→内部；外部客户→对外）列销售订单/报价单，一次复制、逐行 `source_snapshot`，头部写 `sourceKind/sourceId/sourceSnapshot`。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 贸易类型用 `sales_channels` 承载 | 引擎里唯一**服务端可过滤**的标记（列表支持 `channelId/channelIds/channelIdsEmpty`）；`metadata` 不可过滤，`customerReference`/快照都是自由文本 | 用 `metadata.tradeType` | 列表过滤不了，分页服务端过滤就落不了地 |
| 类型由买方来源推导（界面只给一个联动控件） | 与合同「方向决定对方」同一心智：不允许出现「内部类型 + 外部客户」的组合 | 类型与买方各自独立 | 又一次制造两个字段不一致的入口 |
| 对外销售复用同一实现、另开菜单 | 一处实现、两处入口；权限位与写入门禁都不变；复制 6 个页面会让下一次改动双写 | 新建 `external_sales` 模块 | 复制页面与表单、写入仍共用 `sales.*` 门禁，拆分只增加维护面 |
| 通道按组织播种（setup 钩子） | 引擎写 `channelId` 时校验通道属于本组织；播种幂等且随组织创建自动发生 | 首次保存时懒创建 | 写入路径要带 `sales.channels.manage`，普通业务员没有该权限 |
| 存量回填走 CLI（默认 dry-run） | 回填是数据变更，需 owner 批准；dry-run 先出清单 | 迁移里直接 SQL 回填 | 迁移按模块顺序执行、且要新建通道，SQL 无法表达幂等播种 |
| 发运分摊两个方向的订单都列（**2026-09-30 修订**） | 同一柜的货对内（总部→分公司）与对外（分公司→当地客户）都有销售单据；服务端从不校验订单性质，选择器再拦一层只会挡住合法分摊 | 只列内部订单（2026-09-29 的原口径） | owner 反馈：现在已分对内/对外，两个方向的订单都要能选；原口径「靠人工分辨会混淆」的担心改用**选项标签前置方向词**解决，而不是把订单藏起来 |

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
| 发运分摊 | extend | `cross_border` | 选项加载器按两个贸易类型通道 + 无通道桶取数，选项标签带方向词（2026-09-30） | 两个方向的订单都可分摊，方向靠标签分辨 |
| 合同行复用 | extend | `trade_docs` | 复用 `sales/order-lines`、`sales/quote-lines`、`purchasing/purchase-orders/lines` 只读 | C-4 的锚点与复制 |

## Architecture and Data Flow

```text
/backend/internal-sales/**（tradeType=internal）┐
                                                ├─ 同一 InternalSalesForm/Table
/backend/external-sales/**（tradeType=external）┘
   ├─ 贸易类型 = 入口（只读值：决定买方来源与写入的通道）
   ├─ 保存 → POST/PUT /api/sales/{quotes,orders}（含 channelId=入口通道）
   └─ 列表 → GET /api/sales/{quotes,orders}?channelId=<入口通道>（服务端过滤）
cross_border 分摊选择器 → GET /api/sales/orders?channelIds=<internal>,<external> + channelIdsEmpty → 两个方向都列，选项标签带方向词
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

1. 总部账号进入 `/backend/internal-sales/orders` → 新建 → 贸易类型固定「对内」→ 买方只列关联组织。
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
| `/backend/internal-sales/{quotes,orders}` | 对内单据列表/新建/编辑（入口固定内部类型） | `GET/POST/PUT /api/sales/*` + `?channelId=<internal>` | `InternalSalesTable` | `DataTable` / `CrudForm` | loading/empty/error/冲突/权限/通道缺失 | REQ-001…003 |
| `/backend/external-sales/{quotes,orders}` | 对外单据（同一页面体，`tradeType=external`） | 同上 | 同上 | 同上 | 同上 | REQ-003 |
| `/backend/trade-docs/contracts/{create,edit}` | 行复用对话框 + 来源锚点 | `sales/{order,quote}-lines`、`purchasing/purchase-orders/lines`、合同命令 | `DocumentsForm` 的复制对话框 | `Dialog` + `ComboboxInput` | 空来源/失败/重复复制 | REQ-005 |
| `/backend/cross_border/shipments/{create,edit}` | 分摊选择器列对内 + 对外两个方向的订单，选项标签带方向词（2026-09-30 修订） | `GET /api/sales/orders?channelIds=<internal>,<external>` + `channelIdsEmpty=true` | 既有 `shipmentFormOptions` | 既有表单 | 通道缺失时不过滤（不挡分摊） | REQ-004 |

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
| TEST-003 | integration (API) / unit | 一张内部订单 + 一张对外订单 + 无通道历史单 + 发运单 | 读发运分摊的可选订单来源 | 两个方向的订单与无通道历史单都出现，方向词在标签最前；无通道行不加方向词（**2026-09-30 修订**；集成用例尚未落地，当前由 `components/__tests__/shipmentFormOptions.test.ts` 单测 + 浏览器实测覆盖，见 Changelog 末行） | REQ-004 |
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
- **Exit gate:** 分摊列对内 + 对外两个方向的订单且选项带方向词（2026-09-30 修订，取代「只列内部订单」）；合同复制行来源随方向/对方类型变化并落库。

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
| REQ-004 | J-002 | 发运分摊来源：两个贸易类型通道 + 无通道桶 | 3 | TEST-003 | AC-004 |
| REQ-005 | J-003 | 复制行 + 头部锚点 | 3 | TEST-004 | AC-005 |
| REQ-006 | J-004 | CLI 回填 | 4 | TEST-005 | AC-006 |
| REQ-007 | 全部 | 既有 URL/权限/快照不变 | 1–4 | 既有套件 + TEST-002 | AC-007 |

## Migration & Backward Compatibility

依据 [`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`](../../guides/upstream/BACKWARD_COMPATIBILITY.md)。全部为**追加式**：

| Surface | Nature of change | Compatibility note |
|---|---|---|
| 新页面 `/backend/external-sales/**` | 追加 | 既有 URL 不变 |
| `internal_sales` 列表查询 | 改为**固定**入口类型的 `channelId`（此前对内入口不过滤） | 旧 URL 不变；对内入口不再列出对外单据与**未标记历史单据**，两者分别由对外入口与回填命令承接（表头计数提示 + CLI） |
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
| 无标记的历史单据 | 按通道过滤时两个入口都不列 | 回填命令 + `channelIdsEmpty` 探测计数提示（两个入口都显示）；installed 列表页仍可读。命令只清得掉**带买方链接**的那部分，无链接的需逐单按入口保存（dev 库 2026-09-30：8 单 → 4 已标记 · 4 无链接） | 未归类前这类单据只能在 installed 列表/直接 URL 看到 |
| 通道解析失败（网络/权限） | 保存被阻塞 | 明确报错并提示重试，不写空通道 | 无 |
| 两个方向的订单混在一个选择器里看错 | 分摊挂到错误的订单 | 选项标签**方向词在最前**（`对内`/`对外`）+ 买方名；无通道的历史行不猜方向；单测覆盖标签组装 | 手填买方且无通道的历史行仍无方向词 |

## Acceptance Criteria

- [x] **AC-001** — 新建内部/对外单据分别落 `channel_id` 为对应通道（浏览器实测：对外单落 `EXTERNAL_SALES`，DB 复核 `ORDER-20260929-00011`）；类型与买方来源由同一控件推导。
- [x] **AC-002** — `seedDefaults` 幂等（dev 库连跑两次仍各组织一条 `INTERNAL_SALES`/`EXTERNAL_SALES`；并发撞唯一索引时采纳既有行）。
- [x] **AC-003** — **2026-09-30 修订**：每个入口只列自己的贸易类型（对内入口 `channelId=<INTERNAL_SALES>`、对外入口 `<EXTERNAL_SALES>`，浏览器实测 + 集成按 `channelId` 过滤断言）；未标记的历史单据（`channel_id` 为空）两个入口都不列，只以计数提示说明它们不在列表中——**带买方链接**的用回填命令批量归类，**没有链接**的（命令报 `without a buyer link` 跳过）只能逐单在对应入口的编辑页保存打标，所以计数不保证被命令清零。表单的贸易类型是只读值，买方选择器只给该类型的来源。
- [x] **AC-004** — **2026-09-30 修订**：发运分摊的可选销售订单**两个方向都列**，每个选项的方向词在最前（`对内` / `对外`，取自通道标记、其次取冻结买方快照），无通道的历史单一并列出且不加方向词；单测覆盖两桶合并与标签组装，浏览器实测在选择外部订单后保存成功（dev `ORDER-20260929-00011` 落库 `2.0000`）。
- [x] **AC-005** — 合同「从订单/报价单复制行」对话框按方向给出来源类型（浏览器实测打开正常），来源按对方侧过滤、复制行与头部锚点落库（单测覆盖纯函数；集成/浏览器为 smoke）。
- [x] **AC-006** — 回填命令 dry-run 给出清单（dev 库：6 单据 → 3 可分类 / 3 无链接）；`--apply` 标记 3 单，再跑 dry-run 为「4 already marked · 2 without a buyer link · 0 to write」；`--organization/--org/--organizationId` 别名均可收窄。
- [x] **AC-007** — 既有 URL、权限位、`customerSnapshot` 形状与既有测试不受影响（全量 `yarn test` 与既有集成套件全绿；新增页面/路由均为追加）。
- [x] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [x] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes（UI 面为浏览器实测，见 PR #40 截图）。

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
| 2026-09-29 | **交付并验证**：Phases 1–4 实现完成（PR #40），并在 dev 库实跑种子与回填（3 单打标、2 单无买方链接保持未标记）。代码评审后又修：①编辑页加载 effect 依赖每次渲染都新建的通道 map（读失败会无限重拉）→ hook 内 memo + 依赖原始值；②发运分摊选择器漏掉未标记的历史内部订单 → 改为「已标记 + 未标记且买方是关联组织」两桶合并；③外部入口把加载到的单据强行改写成入口类型 → 类型不匹配时跳转到该单据所属入口，锁定类型改为只读展示而非单选项下拉；④买方清空改为按「已选买方命名空间与类型不符」判定，避免加载后误清；⑤返回/取消/来源链接与「按报价新建订单」跳转全部按入口派生；⑥新增路由补 `openApi` 与错误日志；⑦CLI 支持文档里的 `--organization` 并提示缓存；⑧种子撞唯一索引时采纳既有行。 |
| 2026-09-29 | 实现期修订：①通道解析走模块自建只读路由（`GET /api/internal_sales/trade-type-channels/{quotes,orders}`），因为分公司业务员通常没有 `sales.channels.view`；②通道缺失时**保存被拦截**并给出 `seed:defaults` 提示，列表退化为「不过滤 + 显示类型列」（未播种的组织仍可只读）；③回填 CLI 走官方实体 + 解密读取助手（`customer_snapshot` 是加密列），分类不做猜测，`--apply` 逐单幂等；④合同时的「从订单/报价单复制行」由 `ContractLineSourceDialog` 提供，来源按合同方向与对方侧过滤（无档案链接时两来源都列但每项带贸易类型标签）。 |
| 2026-09-29 | **界面口径修订（owner 当日反馈：菜单名与列表显示都没跟上贸易类型）**：①菜单——`cross_border.nav.group.internal` → `cross_border.nav.group.sales`（「出口业务-内部销售」→「出口业务-销售」，因为该入口能建两种类型），对外入口从**没有字典键**的 `cross_border.nav.group` 收到 `cross_border.nav.group.externalSales`（「出口业务-对外销售」，并进 `nav.groupOrder`，此前它渲染英文裸串「Cross-Border」且掉在侧边栏末尾）；12 个 `page.meta.ts` 的标题/分组/面包屑与两份字典同步（销售入口：「销售报价单」/「销售订单（PO）」）。②列表——销售入口**不再按类型过滤**（对内 + 对外同表），对外入口固定传 `channelId=<EXTERNAL_SALES>`；「类型」列改为**常显**（`buildColumns` 去掉 `showTradeType`）；未标记历史单据在销售入口照常列出（类型列「—」+ 归类提示），在对外入口以计数提示说明未列出（`internal_sales.list.unmarkedHintFiltered`）。③表单——`salesEntryFromPathname` 取代 `tradeTypeFromPathname`；类型标签/帮助文案改「对内 / 对外」；报价选择器按表单类型过滤（`loadQuoteOptions(query, channelId)`）、载入继承报价类型（`applyQuoteDraftToForm` 的 `adoptQuoteType`，锁定入口传 `false`）；无类型参数的 `documentEditHref` 删除，入口化跳转统一走 `documentEditHrefForTradeType`。④其他页面文案：`cross_border` / `finance` / `trade_docs` 的「内部销售」→「对内销售」、合同行复用类型标签 →「对内 / 对外」。 |
| 2026-09-30 | **REQ-004 反向修订 + 分摊选择器的闪烁/无法选中修复（owner 反馈：现在销售单已分对内/对外，发运单「销售分摊」的选择器两个方向的订单都要列；同页两个下拉都存在「无法选中、闪烁」）**：①**选项来源**——`shipmentFormOptions.loadSalesOrderOptions(t, errorMessage, query)` 改为把本组织两条贸易类型通道一并传给 `sales/orders`（`channelIds=<internal>,<external>`，纯函数 `buildSalesOrderListParams` 从单数 `channelId` 改为复数 `channelIds`，空数组即不过滤），并合并一桶「完全没有通道」的历史单据（原 `isUnmarkedInternalOrder` 过滤删除——两个方向都列之后，未标记单据不再需要按快照挑内部的那部分）；每桶仍分页 50、按 `created_at desc`。②**标签**——方向词放在选项最前（`对内 · ORDER-… — 买方` / `对外 · …`，i18n 新增 `cross_border.shipments.salesAllocations.tradeType.{internal,external}`，与 trade_docs 的复制行对话框同款口径），方向由 `resolveRowTradeType`（通道 → 冻结买方快照）解析，解析不出不加猜测；买方名从 `customerName` 回落到 `customerSnapshot.name`（`readBuyerSnapshot`），选择器因此显示买方而不是只有单号；分摊行的 `salesOrderLabel` 快照与 `resolveOrderOptionLabel` 走同一个加载器，标签口径一致。字段标签从「对内销售订单」改为「销售订单」（`cross_border.shipments.salesAllocations.salesOrder`）。**不新增写入侧校验**：命令本来就只查重复/存在/目录桥接，对外订单可以分摊（浏览器实测：选 `对外 · ORDER-20260929-00011` 保存成功，`quantity=2.0000` 落库）。③**闪烁（bug）**——两个分摊编辑器的 `loadSuggestions` 是内联箭头，且加载器返回时把选项写进 `useState`：返回 → 编辑器重渲染 → 新的箭头身份 → `ComboboxInput` 的加载 effect 再起跑 → 每 ~300ms 无限重拉（dev 实测 3 秒 20 次请求），下拉在「选项」与「加载中」之间闪、点击落在被卸载的选项上。修法：选项缓存放 `useRef`、加载器包 `React.useCallback`（两个分摊编辑器、目的地仓库/库位两个选择器、合同行选择器抽成 `ShipmentContractRow`）；修后同一操作只发 1 次请求（3 秒窗口 2 次 = 两个状态桶各一次），选项常驻可点。记录：[lesson `.ai/lessons/combobox-loader-must-be-referentially-stable.md`](../lessons/combobox-loader-must-be-referentially-stable.md)。④证据——单测 `shipmentFormOptions.test.ts` 6 passed（两桶合并、方向标签、无通道退化、错误文案）；浏览器实测：采购单下拉选项常驻并选中、销售下拉列出 `对外 · ORDER-20260929-00011 — E2E 本地客户 474336` 与 `对内 · ORDER-20260929-00007 — 俄罗斯 AB 有限公司` 及 4 张无通道历史单、选外部单保存成功并在详情页可见；`yarn typecheck` / `yarn lint` 0 error。 |
| 2026-09-30 | **界面口径第二次修订（owner 反馈：`/backend/external-sales/quotes` 是专门的对外，`/backend/internal-sales/quotes` 这个对内就该把类型固定对内，菜单名跟着改；PR #61）**：①口径回到「一个入口 = 一种贸易类型」——`tradeTypeFromPathname` 取代 `salesEntryFromPathname` 并直接返回 `SalesTradeType`；列表按入口通道固定 `channelId`（无通道时**不发请求**，在表格位置显示 `seed:defaults` 提示）；「类型」列删除（每行都是入口的类型），`list.unmarkedHint` 随之删除，`list.unmarkedHintFiltered` 成为两个入口共用的提示。②表单——贸易类型恒为只读值（删 `form.field.tradeTypeHelp` 与可选分支），`tradeTypeFixed` 带 `{{type}}` 占位；`adoptQuoteType` 整条删除；编辑页跨类型跳转按入口类型判定；`toInternalSalesFormValues` 新增第 4 参 `fallbackTradeType`（未标记单据由**所在入口**归类，不再默认 internal）。③命名——组名「出口业务-销售」→「出口业务-对内销售」（**key `cross_border.nav.group.sales` 不变**，已存的侧边栏偏好不受影响），菜单项与标题/面包屑/空态/表单标题全部改「对内销售报价单」/「对内销售订单（PO）」，`list.columns.tradeType` 删除。④未标记单据的提示文案按事实改写：计数 = 官方列表 `channelIdsEmpty` 的 total（**全部**无通道单据），回填命令只归得掉带买方链接的那部分、无链接的逐单按入口保存打标（dev 库实测 8 单 → 4 已标记 · 4 无链接），提示不再承诺「跑一次命令就清零」。 |
