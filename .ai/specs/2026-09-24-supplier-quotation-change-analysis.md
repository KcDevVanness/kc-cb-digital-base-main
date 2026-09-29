# 供应商报价变更分析（版本对比 + 货号价格时间线）

**Date**: 2026-09-24
**Status**: Implemented and verified (Phases 1–3, 2026-09-24) — Phase 4 (docs close-out) in flight

> **交付证据（2026-09-24）**：单元 `lib/__tests__/quoteChanges.test.ts`（规则层：键归一/精确金额/四分类/币种不同/链折叠/时间线）；集成 `__integration__/quote-changes.spec.ts`（三条接口走真实 HTTP：导入两版 CSV → 摘要 `added=1 removed=1 up=1 down=1 same=1`、首版 `base: null`、版本链、时间线涨跌与"最新版未报价"、跨组织 404 / 无权限 403；`yarn mercato test:integration quote-changes` → **3 passed**，全新库构建 + 真实 HTTP）；浏览器实测（详情页「与上一版对比」面板四类计数与 `旧→新` 数值、第一版空态、「变更」标签的版本表与差异表、差异行「时间线」弹窗）；顺带修掉 `source_file_name` 的 `workbook` 占位符缺陷（v3 导入实测记录 `quotation-v3.csv`）。门禁：`yarn generate` / `yarn typecheck` / `yarn lint`（0 error）/ `yarn ds:check`（709 files）/ `yarn test src/modules/sourcing`（10 suites / 60 tests）全绿，`yarn db:generate` 无迁移（本切片不建表）。

> 建立在 `2026-09-22-supplier-quotation-import.md`（报价单与 Excel 导入）之上，**不改它的既有契约**；
> 产品库归属见 `2026-09-22-supplier-product-library.md`（D4 移交 `purchasing`）。
> Open Questions 闸门已通过（Q-001…Q-004 的决议见下表），本文档即为实现契约。

## TLDR

把 `sourcing` 的报价存档从"一份一份看"变成"看变化"，三件事：

1. **版本对比** —— 任选一份报价单与它的上一版（同供应商 + 同版式）对比，输出「新增 / 消失 / 涨价 / 降价」四类清单，逐行给出旧价 → 新价、差额与涨跌幅。
2. **版本序列** —— 同一供应商 + 同一版式的历次报价按时间成链，每版显示相对前一版变了几项。
3. **货号价格时间线** —— 单个货号历次报价的单价/币种/MOQ 序列、首次与末次出现、是否已进产品库/商品档案。

纯只读投影：**不新增表、不新增迁移、不改任何既有路由契约**；权限沿用 `sourcing.quotes.view`。
页面层面把「供应商报价」改名为「供应商报价与变更」，用页内标签承载「报价单 / 变更」两个视图（路由不变）。

## Problem Statement

报价单模块今天只有一种"对照"：复核台每行与**商品档案当前成本价**的差额列
（`src/modules/sourcing/components/QuoteLinesGrid.tsx:409-435`，无匹配显示「未建档」）——
比的是"报价 vs 我方现有成本"，不是"这版 vs 上版"。

代码证据：`src/modules/sourcing` 全域搜 `compare|diff|previous|比价` 只命中列映射内部实现；没有对比路由、组件或 i18n 键。

数据证据（重置前的 dev 库）：

- 25 份报价 / 808 行 / 15 次 Excel 导入；`quote_date` 与 `valid_until` **填写 0 份**；808 行里仅 30 行被提升。
- 同一版式被反复导入（`5efe92ca` 7 次、`3f515897` 3 次、模板 `28480345` 4 次），全部集中在 09-22/23 两天。
- 跨版本比对的键必须**行内唯一**：用 `item_no` 会因变体行互相配对产生笛卡尔膨胀（同组数据 `changed` 从 `0` 变 `16` 的假象）。

受影响用户：采购员 —— 每次收到新版报价表，需要立刻知道"这版比上版多了什么、什么涨了、什么没了、要不要重新谈"。

## Overview and Success Measures

- **Primary outcome:** 导入一份新版报价表后 30 秒内看到与上一版的四类差异（新增/消失/涨/跌），不需要人工打开两份记录对照。
- **Leading indicators:** 对比接口调用次数 / 供应商；`item-timeline` 打开次数；被对比版本的 `promoted` 计数。
- **Baseline:** 0（能力不存在）。
- **Market / product reference:** 供应商价目表比价（Odoo `product.supplierinfo` 的 vendor price list 版本、SAP 采购信息记录的价格条件历史、Akeneo 导入版本对比）。采用：按"供应商货号"归一 + 逐版差异四分类 + 单货号价格序列。不做：自动接受新价、自动调价回写（那属于采购决策，不是视图）。

## Goals

- **REQ-001** — 任取一份报价单，与另一份（默认：链上前一版）对比，得到四类行：新增 / 消失 / 涨价 / 降价；另有持平、币种不一致、缺价三种显式状态。
- **REQ-002** — 每个变化行给出：货号、品名、`旧单价 → 新单价`、差额与涨跌幅、两版所属报价单号与日期、币种；**币种不一致不得静默相减**。
- **REQ-003** — 报价单详情页可直接进入「与上一版对比」，无上一版时给出明确空状态而不是空白表。
- **REQ-004** — 按供应商的版本序列：历次版本（版本号/日期/来源文件/行数/被提升行数/相对前一版四类计数），可从任一版进入差异明细。
- **REQ-005** — 差异清单支持"只看有变化的行"筛选与大表分页（`pageSize` ≤ 200，摘要统计覆盖全量而非当前页）。
- **REQ-006** — 单个货号的价格时间线：历次报价的单价（含币种、MOQ）、与上一次的涨跌、首次/末次出现、是否已进产品库、是否已建档为商品；范围默认同一供应商。
- **REQ-007** — 全部只读：不写任何表、不触发命令、不改变报价/产品库/商品契约；权限沿用 `sourcing.quotes.view`；作用域必须来自会话且 fail-closed。
- **REQ-008** — 顺带修一个既有缺陷：`parse`/`remap` 在报价单没有文件名时把字面量 `workbook` 写进 `source_file_name`（`commands/quotes.ts:449,550`），改为回退到附件的真实 `file_name`，让存档的文件名可作证据。

## Non-goals

- 跨币种换算比较（与既有非目标一致：报价币种单独存，不做自动汇率换算）；币种不一致只标注。
- 跨供应商横向比价（同一货品在多家供应商之间的对比）——另立切片。
- 自动调价/自动接受：对比结果是视图，写路径仍是既有的「提升所选为商品」与「建商品档案」。
- 变更通知/订阅、图表化趋势（先用表格承载）。
- 修改报价行的解析/映射逻辑、给报价行加新字段、改动已提升行的冻结规则。

## Proposed Solution

在 `sourcing` 内新增一层**只读变更投影**（`lib/quoteChanges.ts` 纯函数 + 两个只读查询助手），由三个只读 GET 接口暴露，
前端在两个已存在的位置消费它：报价单详情页（与上一版对比）与列表页的新「变更」标签（版本序列 + 逐版差异），
货号时间线以弹窗呈现。全部复用既有页面壳、`DataTable`、`Badge`、`MoneyAmount`、`apiCall`、`useT` 与设计令牌。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 报告只读投影，不落库 | 差异是"两份既有文档之间的关系"，落库会引入第二份真相与失效风暴 | 物化 `quote_change_snapshots` 表 | 需要失效/重算策略与迁移；无性能问题支撑（单文件 ≤ 数千行） |
| 行键 = 归一后的货号（`upper(trim(derived_sku ?? item_no))`），已进库的折到产品库 `supplier_sku` | 行内唯一（SKU 派生规则保证文件内唯一并给冲突加后缀）；已进库的靠库行锚定，供应商改大小写/空格仍能对上 | 用 `item_no` 做键 | 同一 `item_no` 下的变体行会互相配对，产生笛卡尔膨胀（实测 `changed` 0 → 16 假象） |
| 版本链 = 同供应商 + **同版式指纹**，状态取 `approved`/`archived`，**同日折叠取最新**，排序键 `quote_date ?? created_at` | 同一份文件在一次试用里被导入 4–7 次，不折叠就没有"版本"可言；归档版本仍是历史，必须留在链上 | 每次导入都算一版 / 只在 `approved` 里找 | 前者会把同一文件的重复导入显示成多个版本；后者丢失已归档历史 |
| 价格只比"报价 vs 报价"（同币种），另用一列显示我方商品当前成本价 | 报价可比性只在同一供应商同一货号同一币种内成立；成本价是参照不是结论 | 跨币种换算比较 | 需要汇率主数据与口径决策，超出本切片 |
| 变更计算放在 `lib/**` 的纯函数里，查询助手只做"取行" | 纯函数可被 jest 单测覆盖（先例 `export_finance/lib/fileRules.ts` + 其投影测试）；I/O 与规则分离 | 逻辑写进路由 | 不可测、且三处消费会各写一遍 |
| 复用 `sourcing.quotes.view`，不新增权限位 | 只读分析不扩大写权限面；新 feature 还要为既有租户跑 `auth sync-role-acls` | 新增 `sourcing.changes.view` | 无收益的运维成本 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 报价版本（version） | 一份**已确认或已归档**、未软删、至少 1 行的报价单；同一供应商 + 同一 `source_layout_signature` + 同一自然日只算一版（取最新导入），`signature` 为空的手工报价不参与版本链 | `sourcing_quotes` | 无匹配链 → 详情页空状态「该版式的第一版」 |
| 行键（item key） | `upper(trim(coalesce(nullif(derived_sku,''), item_no)))`；空键的行不参与对比并计入 `unmatched` | `sourcing_quote_lines` | 计入 `unmatched`，在摘要里可见 |
| 新增 / 消失 | 键只出现在 target / base 一侧 | 计算 | 单侧价格缺失时仍归入新增/消失，但其价格显示为空 |
| 涨价 / 降价 / 持平 | 键两侧都有价格且**币种相同**时按 `unit_cost`（单价 4 位标度，`PRICE_SCALE`；两侧按 scaled-int 精确比较，5–6 位历史值 HALF_UP 量化到 4 位后比较）比较；差额 = target − base，涨跌幅 = 差额 / base（base=0 时百分比为 null） | 计算 | 币种不同 → `currency_mismatch`（不算涨跌）；任一侧无价 → `no_price` |
| 我方成本价（参照列） | 该行键对应的产品档案 `purchase` 档当前有效价（经产品库行 `product_id` 或直接按 SKU 命中） | `products_prices` / `products_products` | 未建档 → 显示「未建档」，不参与分类 |
| 版本日期 | `quote_date` 填了就用它，否则用导入时间（`created_at`），界面注明口径 | `sourcing_quotes` | — |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 采购员 | 读版本链、版本差异、货号时间线 | 组织私有；`tenantId`/`organizationId` 来自会话，fail-closed | `sourcing.quotes.view` |
| 产品经理 | 同上（只读） | 同上 | 同上 |
| 未授权用户 | 403 | — | — |

可信作用域：三个路由都用 `resolveOrganizationScopeForRequest`（既有先例）解析请求作用域，查询助手只接受显式 `{ tenantId, organizationId }` 并逐表过滤；不接受请求体里的作用域。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 报价单与行 | reuse | `sourcing` | 本模块实体（读走实体管理器 / 只读投影） | 已有唯一真相 |
| 产品库行与价格 | reuse | `purchasing` | 只读投影（同 `purchasing/lib/quoteLineReads.ts` 的反向做法） | 归一锚点与"已进库/已建档"状态 |
| 商品档案与 `purchase` 价 | reuse | `products` | 只读投影（同 `sourcing/lib/productsReads.ts`） | 参照列 |
| 页面壳 / 表格 / 徽章 / 金额 / i18n / ACL | reuse | 平台 | `Page`/`PageBody`、`DataTable`、`StatusBadge`、`Badge`、`MoneyAmount`、`apiCall`、`useT` | 不造平行组件 |
| 版本链、差异分类、时间线规则 | app-own | `sourcing`（`lib/quoteChanges.ts`） | — | 无既有能力 |

## Architecture and Data Flow

```text
报价单详情页 ──┐
列表页「变更」标签 ──┼─► GET /api/sourcing/quote-changes            ─┐
货号时间线弹窗 ──┘   ├─► GET /api/sourcing/quote-changes/versions    ├─► lib/quoteChanges.ts（纯函数）
                     └─► GET /api/sourcing/item-timeline           ─┘        │
                                                                            ├─► sourcing_quotes / sourcing_quote_lines（本模块）
                                                                            ├─► purchasing_supplier_products / _prices（只读投影）
                                                                            └─► products_products / products_prices（只读投影）
```

- **Module boundaries:** 计算与查询都在 `sourcing`；跨模块只读投影不引用对方实体（仓库硬规则），写路径完全不变。
- **Extension points:** 页面层只改 `sourcing` 自有页面与其 `page.meta.ts`；不动安装模块。
- **Alternatives considered:** 把差异做成 `DataTable` 的行内展开 / 独立路由页——被否：版本对比天然属于"某两份文档之间"，放在详情页与列表标签里最贴近现有工作流。
- **Compatibility:** 路由、feature id、实体、既有响应字段一律不变；唯一"改名"是页面标题与导航文案（i18n 值），不影响深链。

## User Journeys

### Journey J-001 — 导入新版报价后立刻看差异

1. 采购员在「供应商报价与变更」页导入新版工作簿（既有流程：上传 → 解析 → 复核）。
2. 打开该报价单详情页 → 「与上一版对比」面板默认选中链上前一版。
3. 面板顶部显示 `新增 2 / 消失 1 / 涨价 3 / 降价 1`，下表逐行给出 `旧价 → 新价`、差额与涨跌幅，涨价红色、降价绿色（复用现有 delta 徽章语义）。
4. 取消勾选「只看有变化」后可见持平行；币种不同的行显示「币种不同」而不是数字差额。
5. 失败/边界：没有上一版 → 面板显示「这是该版式的第一版，导入下一版后这里会显示差异」；无权限 → 页面不渲染面板。

### Journey J-002 — 看这家供应商最近几版都变了什么

1. 采购员在列表页切到「变更」标签 → 选择供应商。
2. 版本表格按时间列出各版：版本号、日期、来源文件、行数、被提升数、`+新增 / −消失 / ↑涨 / ↓跌` 计数。
3. 点击某一版 → 下方差异表格切换到"该版 vs 其前一版"，可继续点进任一行的「价格时间线」。

### Journey J-003 — 盯住一个货号的历史价格

1. 从差异表或复核台的行操作打开「价格时间线」。
2. 弹窗列出该货号历次报价的单价/币种/MOQ 与每次涨跌，首行标「首次出现」，若该货号在最近一版已消失则标「本版未报」。
3. 同时显示是否已进产品库、是否已建档为商品（含商品 SKU 与我方当前成本价）。

## UI and Interaction Contracts

Reference pages inspected: `src/modules/sourcing/backend/sourcing/quotes/page.tsx`（列表壳）、`.../[id]/page.tsx`（详情壳）、
`components/QuotesTable.tsx`（`DataTable` 用法）、`components/QuoteLinesGrid.tsx`（delta 徽章与 `MoneyAmount` 用法）。
Guide: `.ai/guides/backend-ui.md` + `om-backend-ui-design/references/{page-and-navigation,crud-surfaces,quality-states}.md`。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/sourcing/quotes`（改名「供应商报价与变更」） | 标签「报价单」= 现有列表；标签「变更」= 供应商版本序列 + 选中版本的差异表 | `GET /api/sourcing/quote-changes/versions`、`GET /api/sourcing/quote-changes` | 本模块 `QuotesTable.tsx`；供应商选择器 `components/supplierOptions.ts` | `Page`、`PageBody`、`DataTable`、`Badge`、`Select`/`ComboboxInput` | loading / empty（该供应商还没有第二版）/ error / 权限受限 | REQ-004, REQ-005 |
| `/backend/sourcing/quotes/[id]`（详情） | 在既有复核面板下方新增「与上一版对比」面板：基准版本选择 + 摘要 + 差异表 + 行操作「价格时间线」 | `GET /api/sourcing/quote-changes?quoteId&baseQuoteId` | `QuoteReviewPanel.tsx` 的头部与查询写法 | `DataTable`、`Badge`、`MoneyAmount`、`Alert` | loading / empty（第一版）/ error / 只看变化筛选 / 分页 | REQ-001, REQ-002, REQ-003 |
| 货号时间线（弹窗，不新增路由） | 单货号历次报价序列 | `GET /api/sourcing/item-timeline?supplierId&sku` | 既有对话框用法（`useConfirmDialog` 之外的标准 Dialog 组件） | `DataTable`（或列表）、`Badge`、`MoneyAmount` | loading / empty / error | REQ-006 |

### `/backend/sourcing/quotes` — 标签结构

```text
┌──────────────────────────────────────────────────────────────┐
│ 供应商报价与变更                          [新建报价单]         │
│ [ 报价单 ] [ 变更 ]                                            │
├──────────────────────────────────────────────────────────────┤
│ 变更： [供应商 ▾]      口径：按日期（无报价日期时用导入时间）    │
│ ┌─ 版本 ───────────────────────────────────────────────────┐ │
│ │ 版本        日期     来源文件   行数 提升  +  −  ↑  ↓      │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 差异（选中版本 vs 其前一版）─────────────────────────────┐ │
│ │ ☑ 只看有变化  新增 2 · 消失 1 · 涨价 3 · 降价 1           │ │
│ │ 货号  品名  旧价 → 新价  差额  涨跌幅  状态  [时间线]      │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** 版本表按日期倒序、分页；点击行加载该版差异；「只看有变化」默认勾选；`pageSize ≤ 200`；差异表分页但摘要统计全量。
- **Responsive / a11y:** 窄屏下差异表横向滚动、摘要 chips 换行；面板标题用 `<h2>`；表格沿用 `DataTable` 的键盘与读屏契约；切换标签用 `role="tablist"`。
- **Localization:** 新键全部进 `src/modules/sourcing/i18n/{zh,en}.json`（一个键一种语言；`t()` 兜底用英文）。
- **Design-system:** 复用 `Badge` 的语义变体（涨价 `error`、降价 `success`，与 `QuoteLinesGrid` 一致）与语义令牌，不写死颜色。

### `/backend/sourcing/quotes/[id]` — 对比面板

```text
┌─ 与上一版对比 ────────────────────────────── [基准：SQ-2026-0001 ▾] ┐
│ 新增 2 · 消失 1 · 涨价 3 · 降价 1 · 持平 12    ☑ 只看有变化          │
│ 货号 | 品名 | 上一版 | 本版 | 差额 | 涨跌幅 | 我方成本价 | 操作       │
└──────────────────────────────────────────────────────────────────┘
```

- 无基准 → `Alert` 空心状态文案「这是该版式的第一版…」；基准候选 = 同供应商同版式的其它版本（按日期倒序，排除自身）。

## Data Models

N/A — 不新增实体、不新增列、不新增迁移。全部读既有表：
`sourcing_quotes`、`sourcing_quote_lines`（本模块）、`purchasing_supplier_products`、`purchasing_supplier_product_prices`、`products_products`、`products_prices`（只读投影）。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/sourcing/quote-changes` | auth + `sourcing.quotes.view` | `quoteId`(uuid, 必填), `baseQuoteId`(uuid, 可选), `onlyChanged`(可选), `page`, `pageSize`(≤200) | `{ target, base, summary, items, totalCount }` | 400 参数；403 无权限；404 报价单不在本组织；422 `quote_lines_unavailable`（任一版超过 2000 行） | REQ-001, REQ-002, REQ-005 |
| `GET` | `/api/sourcing/quote-changes/versions` | 同上 | `supplierId`(uuid, 必填), `signature`(可选), `page`, `pageSize`(≤100) | `{ items: [version + summary], totalCount }` | 400/403；链长上限 50 版（超出取最近 50 并在 `truncated: true` 标注） | REQ-004 |
| `GET` | `/api/sourcing/item-timeline` | 同上 | `supplierId`(uuid), `sku`(string, 归一后非空), `pageSize`(≤200) | `{ item, points, totalCount }` | 400/403 | REQ-006 |

- 三条都是**手写只读路由**（不是 `makeCrudRoute`：它们不是实体的列表/CRUD 面），导出 `metadata`（每方法 `requireAuth` + `requireFeatures`）与 `openApi`（`OpenApiRouteDoc`，`methods.GET` 形状），请求 Schema 用 zod 放在 `data/validators.ts`。认证**必须**用 `getAuthFromRequest(request)`（与 CRUD 工厂同一行：同时接受 Cookie 与 `Authorization: Bearer`）——只读 Cookie 会让集成 harness 的 Bearer 调用与任何 API-key 调用方得到 401（实测踩过，见 `.ai/lessons/hand-written-routes-must-resolve-auth-from-the-request.md`）。
- 作用域解析走既有 `resolveOrganizationScopeForRequest`；查询助手签名 `(em, scope, …)` 且每条查询都带 `tenant_id` + `organization_id`。
- 无并发语义（只读）；无命令、无事件、无索引、无缓存。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 只读能力，不产生事件/任务/通知。跨模块交互只有只读投影（见 Reuse and Ownership Map）。

## Security, Privacy, and Compliance

- **Authorization:** 三个路由 `requireFeatures: ['sourcing.quotes.view']`；页面 `page.meta.ts` 同样声明（保持服务端权威）。
- **Tenant isolation:** 作用域来自会话；`sourcing` 表按 `tenant_id`+`organization_id` 过滤，产品库/商品投影同样双列过滤；跨组织 id 一律 404。
- **Sensitive data:** 报价单价属商业敏感数据，但**不出网**（不像 AI 映射那条路径）；无新增外发通道。
- **Abuse / failure modes:** 参数上限（`pageSize ≤ 200`、行数上限 2000/版）防止用超大版式拖垮请求；只读接口无法被用来改数；无枚举放大（按 id 查询并作用域校验）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | 合成行/版本数据（`lib/__tests__/quoteChanges.test.ts`） | 归一化、链折叠、四分类、差额/百分比、币种不一致、缺价、`base=0` | 每类返回值与状态码正确；`item_no` 重复键不再产生膨胀 | REQ-001, REQ-002, REQ-004 |
| TEST-002 | integration | 两个 CSV 夹具（标准模板表头，价格不同）经 `/api/attachments` + `parse` 导入同一供应商；第二个 CSV 增 1 行、删 1 行、改 2 行价 | `GET /api/sourcing/quote-changes`（自动基准） | 摘要 = `{added:1, removed:1, priceUp:1, priceDown:1}`；行级 `old → new` 与 delta 正确；无基准时 `base=null` | REQ-001, REQ-002, REQ-003 |
| TEST-003 | integration | 上述两版 + 产品库/商品夹具 | `GET /api/sourcing/quote-changes/versions`、`GET /api/sourcing/item-timeline` | 链上 2 版且顺序正确；时间线点数为 2、涨跌标注正确；已进库/已建档标记正确 | REQ-004, REQ-006 |
| TEST-004 | security | 第二个组织 + 无 `sourcing.quotes.view` 的用户 | 三个接口的跨组织 id 与无权限访问 | 404 / 403，且响应不含他组织数据 | REQ-007 |
| TEST-005 | UI | 上述夹具 + 浏览器 | 详情页对比面板、变更标签、时间线弹窗；空状态、只看变化筛选、窄屏 | 面板渲染四类计数与 `旧→新` 数值；第一版空状态文案出现；无权限用户看不到面板 | REQ-003, REQ-005 |

## Implementation Phases

### Phase 1 — 计算核心 + 对比接口 + 详情页对比面板（J-001）

- **Depends on:** none
- **Outcome:** 打开任一份有前作的报价单，即可看到与上一版的四类差异；无前作时看到明确空状态。
- **Why this order / value delivered:** 这是整条价值主张最短路径，且下游（版本序列、时间线）复用同一套计算。
- **Deliverables:** `lib/quoteChanges.ts`（纯函数：键归一、链折叠、四分类、delta/百分比）；`lib/quoteScopedReads.ts`（本模块行的只读投影，必要时扩展现有 `productsReads`/新增 `supplierLibraryReads`）；`data/validators.ts` 三个请求 Schema；`api/quote-changes/route.ts`；`components/VersionComparePanel.tsx` + 挂载到 `backend/sourcing/quotes/[id]/page.tsx`；i18n 键；修 `commands/quotes.ts` 的 `workbook` 文件名回退。
- **Independent slices / estimated commits:** (a) 纯函数 + 单测；(b) 路由 + OpenAPI；(c) 面板 UI + i18n。三块按此顺序落地，前两块可并行。
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-008
- **Tests:** TEST-001, TEST-002, TEST-004(部分), TEST-005(部分)
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/sourcing`
- **Exit gate:** 浏览器实操：详情页面板显示四类计数与 `旧→新` 数值；无基准版本时显示空状态；单测与集成用例绿。

### Phase 2 — 「变更」标签：版本序列 + 逐版差异（J-002）

- **Depends on:** Phase 1 exit gate
- **Outcome:** 列表页「变更」标签可选供应商、看到版本序列与每版相对前一版的计数，点击查看差异明细。
- **Deliverables:** `api/quote-changes/versions/route.ts`；`components/QuoteChangesPanel.tsx`；列表页 `page.tsx` 的标签壳与 `page.meta.ts` 标题改名；i18n。
- **Requirements closed:** REQ-004, REQ-005
- **Tests:** TEST-003(部分), TEST-005
- **Validation:** 同上 + `yarn generate`
- **Exit gate:** 浏览器实操：切换标签、选供应商、看到版本表与差异表；窄屏与空状态正常。

### Phase 3 — 货号价格时间线（J-003）

- **Depends on:** Phase 2 exit gate
- **Outcome:** 从差异行点开「价格时间线」，看到该货号历次报价序列与首末出现标记。
- **Deliverables:** `api/item-timeline/route.ts`；`components/ItemTimelineDialog.tsx`；接线到差异表行操作；（可选）复核台行操作。
- **Requirements closed:** REQ-006
- **Tests:** TEST-003, TEST-005
- **Validation:** 同上
- **Exit gate:** 浏览器实操：弹窗序列数值与库/商品标记正确。

### Phase 4 — 文档与状态收尾

- **Depends on:** Phase 3 exit gate
- **Outcome:** 交付可复查：模块 README、计划进度、spec 状态与 Changelog、lesson 记录。
- **Deliverables:** `src/modules/sourcing/README.md`（surfaces 表 + 规则 + 验证命令）、`docs/plans/cross-border-erp.md` 进度行、`docs/plans/README.md` 状态板行、本 spec 的 Status/Changelog、`.ai/lessons/` 一条记录（跨版本比对的键必须行内唯一 + 版本链要折叠重复导入）。
- **Requirements closed:** —
- **Validation:** `node scripts/check-lessons.mjs`；文档链接自查。
- **Exit gate:** 上述文件更新完毕且与实现一致。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, 详情页面板 | `GET /api/sourcing/quote-changes` | 1 | TEST-001, TEST-002 | AC-001 |
| REQ-002 | J-001, 差异表 | 同上（行契约） | 1 | TEST-001, TEST-002 | AC-002 |
| REQ-003 | J-001, 空状态 | 同上（`base: null`） | 1 | TEST-002, TEST-005 | AC-003 |
| REQ-004 | J-002, 变更标签 | `GET /api/sourcing/quote-changes/versions` | 2 | TEST-003, TEST-005 | AC-004 |
| REQ-005 | J-002, 差异表筛选/分页 | 同上（`onlyChanged`/`page`） | 2 | TEST-005 | AC-005 |
| REQ-006 | J-003, 时间线弹窗 | `GET /api/sourcing/item-timeline` | 3 | TEST-003, TEST-005 | AC-006 |
| REQ-007 | 三个接口 | 作用域与 feature gate | 1–3 | TEST-004 | AC-007 |
| REQ-008 | 存档文件名 | `parse`/`remap` 回退到附件名 | 1 | TEST-001（单测）+ 手工核对 | AC-008 |

## Rollout, Migration, and Rollback

- **无迁移**：不生成、不应用任何迁移；`yarn db:generate` 应为空差异（若产生差异则说明越界）。
- **Deploy:** 随 `sourcing` 模块常规发布；无功能开关（只读、无写入风险）。
- **Rollback:** 删除新增的四个文件与三处接线（两个页面 + i18n 键）即可；无数据需要回滚。
- **Observability:** 失败路径沿用模块既有日志（`createLogger('sourcing')`），无新增指标要求。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 手工报价无版式指纹，无法进版本链 | 手工补录的报价看不到差异 | 界面在「变更」标签对无指纹版本显式说明；差异接口仍可按 `baseQuoteId` 手选任意两份 | 手工单之间的对比要手选 |
| 同日同版式折叠会掩盖"同一天的两版" | 少显示一个版本 | 版本表显示该版合并了几次导入（`collapsed` 计数）；仍可从报价单列表进入被折叠的记录对比 | 真·同日两版需要手选基准 |
| 币种不一致的版本无法给涨跌 | 少数场景无结论 | `currency_mismatch` 显式状态 + 不显示数字差额 | — |
| 大版式（数千行）对比耗时 | 请求变慢 | 上限 2000 行/版，超限 422；分页在服务端裁剪后再序列化 | 极少数超大表需拆分 |
| 折算到产品库锚点依赖库行存在 | 未进库货号只按货号文本匹配 | 差异行显示"已进库/未建档"，让口径可见 | 供应商改货号会显示为"消失 + 新增" |

## Acceptance Criteria

- [ ] **AC-001** — 在报价单详情页选中任一前一版，面板显示四类计数（新增/消失/涨/跌），计数与接口摘要一致（TEST-002）。
- [ ] **AC-002** — 差异表每行显示 `旧价 → 新价`、差额与涨跌幅；币种不一致的行显示「币种不同」且不给差额（TEST-001）。
- [ ] **AC-003** — 无前一版时面板显示空状态文案而不是空表（TEST-005）。
- [ ] **AC-004** — 「变更」标签选出供应商后，版本按日期倒序显示且每版带四类计数（TEST-003）。
- [ ] **AC-005** — 「只看有变化」筛选与分页在服务端生效，摘要统计覆盖全量（TEST-005）。
- [ ] **AC-006** — 货号时间线显示历次单价与涨跌，并标出首/末次出现与库/商品状态（TEST-003）。
- [ ] **AC-007** — 跨组织 id 返回 404、无权限用户 403，三个接口都不含他组织数据（TEST-004）。
- [ ] **AC-008** — `parse` 后 `source_file_name` 为附件真实文件名（不再是 `workbook`）。
- [ ] 每个后端界面都对照记录的 Open Mercato 参考页，使用规范外壳/组件、共享 API 助手、语义令牌，并覆盖 loading/empty/error/conflict/keyboard/a11y/responsive/light/dark。
- [ ] 每条受影响的 API 与 UI 路径都有自包含集成覆盖，且配置的校验门全绿。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 根 `AGENTS.md`；`.ai/guides/{contracts,backend-ui,spec-delivery}.md`；`om-spec-writing`、`om-module-scaffold`（含三份完整模块程序 + 一次性业务蓝图）、`om-backend-ui-design`；`BACKWARD_COMPATIBILITY.md`（新增路由为纯增量，不改既有契约） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 本文档 API/UI/Traceability 三表互相引用同一 Schema 与键定义 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001→Phase 1、J-002→Phase 2、J-003→Phase 3，各阶段自带验收 |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用 `DataTable`/`Badge`/`MoneyAmount`/`apiCall`/`useT`/既有页面壳；唯一自建是纯计算模块 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI 表列出参考页与组件；状态与令牌要求写在 UI/Interaction Contracts |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–4 每节均列 depends/outcome/deliverables/tests/validation/exit gate |

Verdict: **Ready for implementation**

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 菜单与入口形态 | 业主 | no | **已定（2026-09-24）**：把「供应商报价」改名「供应商报价与变更」，页内标签切换两个视图（路由不变） |
| Q-002 | "同一货品"的判定口径 | 业主 | no | **已定（2026-09-24）**：货号归一，已进产品库的折到 `supplier_sku` |
| Q-003 | 价格对比口径 | 业主 | no | **已定（2026-09-24）**：只比"报价 vs 报价"（同币种），另加一列我方商品当前成本价作参照 |
| Q-004 | "上一版"的判定与排序 | 业主 | no | **已定（2026-09-24）**：链上取前一版为默认基准、可手选；同日同版式折叠；排序按日期（无报价日期时用导入时间）并在界面注明 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | 金额口径统一：金额 2 位/单价 4 位，HALF_UP，引擎单点；金额列 numeric(18,2)、单价列 numeric(18,4)（见 [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](2026-09-28-money-scale-2dp-unification.md)）。本 spec：报价单价比对按 `PRICE_SCALE=4` 的 scaled-int 精确比较（不再浮点）；5–6 位历史价 HALF_UP 量化到 4 位后比较。 |
| 2026-09-24 | Initial draft（骨架 + Open Questions 闸门） |
| 2026-09-24 | 记录报价存档数据整理：软删 10 份草稿、回填 12 行文件名；沉淀两条设计约束（折叠重复导入、构造两版验收数据） |
| 2026-09-24 | 全库重置（`yarn mercato init --reinstall`）+ 重新导入两份真实报价（SQ-2026-0001 Petkit 69 行 / SQ-2026-0002 订单表 EXW 78 行），并恢复由报价提升的 7 个商品档案；清空 1.8 GB 孤儿附件。备份：`/tmp/kc-quote-backup/`（全库 SQL + 两份原始工作簿 + 提升清单）。未恢复：6 个由早期试跑改名产生的重复 SKU（`P4108-RX1XM` 等），原因见 Risks |
| 2026-09-24 | Q-001…Q-004 全部决议；补全 Architecture / API / UI / Phases / Traceability / Acceptance；Status → `Ready for implementation` |
| 2026-09-24 | 实现完成（Phases 1–3）：`lib/quoteChanges.ts` + `lib/quoteChangeReads.ts`、三条只读路由、`VersionComparePanel` / `QuoteChangesPanel` / `QuoteChangeTable` / `ItemTimelineDialog`、列表页双标签与标题改名、i18n zh+en、REQ-008 文件名修复、单元与集成覆盖；Status → `Implemented and verified` |
| 2026-09-24 | 数据整理收尾：全库重置 + 重新导入两份真实报价（SQ-2026-0001/0002，文件名已回填）+ 恢复 7 个由报价提升的商品；清空 1.8 GB 孤儿附件；实现期用的 CSV 夹具报价已软删 |
| 2026-09-24 | 集成套件跑绿：`yarn mercato test:integration quote-changes` → **3 passed**（TEST-002 对比与基准 / TEST-003 版本链与时间线 / TEST-004 跨组织 404 + 无权限 403，全新库）。过程中修掉一个真实缺陷：三条路由原先只认 Cookie，被 harness 的 Bearer 调用拒为 401 → 改用与 CRUD 工厂同一行的 `getAuthFromRequest(request)`（Cookie 与 Bearer 都认），并沉淀 lesson `hand-written-routes-must-resolve-auth-from-the-request` |
| 2026-09-28 | 菜单名再次调整（按 [`.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`](./2026-09-24-pi-ci-tax-invoice-documents.md) 的 N-3）：列表页标题与菜单项由「供应商报价与变更」改为「供应商报价单（SQ）」/ "Supplier quotations (SQ)"，`page.meta.ts` 的 `pageTitle`/breadcrumb 同步；**页内「变更」标签与三条只读接口不变** |
