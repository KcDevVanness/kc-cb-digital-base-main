# 内部销售买方选择：关联组织 + 外部客户（internal-sales buyer linkage）

**Date**: 2026-09-28
**Status**: Implemented and verified (2026-09-28) — `internal_sales` 买方字段改为「关联组织 + 外部客户」合并选择器：选项来自顶栏组织切换器 payload（域内可见性 fail-closed）与 `parties` 主数据（`/api/parties/options` 新增可选 `roles` 过滤），选中回填买方名称，链接冻结在 `customerSnapshot.internalSales.{organizationId|partyId}`，本模块不再读 `customers/companies`。无新表/无迁移/无新权限位。

## Implementation Status

Source doc: .ai/specs/2026-09-28-internal-sales-buyer-linkage.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — `/api/parties/options` 的 `roles` 过滤 | verified | none | AC-IB-004 | `yarn typecheck`、改动文件 eslint、`yarn mercato test:integration parties`（**10 passed**，含新增用例）、curl 组合过滤 | `roles=buyer` 只回买方类；未知角色 400；无参对照不变 |
| Phase 2 — 表单买方选择器 + 单据快照 | verified | Phase 1 | AC-IB-001…003、005…007 | `npx jest src/modules/internal_sales`（**18 passed**）、`yarn test`（38 suites / 320）、浏览器实测（新建/编辑/清空/分公司上下文） | 两个来源可选、名称回填、快照写入与回显、清空为 `null` |
| Phase 3 — 文档与状态收口 | verified | Phase 2 | AC-IB-008 | 本次变更内的文档 diff | README / business-architecture / 计划进度 / 状态板 / 本 spec 同步 |

### Evidence (2026-09-28)

- **单元**：`src/modules/internal_sales/lib/__tests__/buyer.test.ts` **13 passed** + `src/lib/orgs/__tests__/organizationOptions.test.ts` **5 passed**（合计 **18**；值协议往返、快照编解码与「清空 vs 省略」语义、组织选项装配与 fail-closed、`roles`/`organizationId`/`search` 的 URL 构造、`findOrganizationName`）。
- **集成（ephemeral 全新库，真实 HTTP）**：`src/modules/parties/__integration__/parties.spec.ts` **10 passed**，新增用例 `filters the option source by role and rejects an unknown role`（买方类入、银行类出、未知角色 400、无参对照仍列出银行类）。
- **真机（dev 3000，superadmin）**：新建报价选「关联组织：俄罗斯 AB 有限公司」→ 买方名称自动回填 → 保存 → 编辑页回显同一标签；`GET /api/sales/quotes` 回读快照为 `{ name, customer.displayName, internalSales.organizationId }`（`customerEntityId: null`）。切到「外部客户：ABC-001 — ABC GmbH」→ 名称回填档案名 → 保存 → 快照 `internalSales.partyId`。清空选择器与名称保存 → 快照为 `null`。银行类档案不出现在买方选项里（`roles` 过滤在真机生效）。**补充实测（2026-09-28）**：外部客户可在选择器里**按 code 服务端搜索**（输入 `E2E-REHYD` → 命中「External customer: E2E-REHYD-1 — Rehyd probe customer」）；带 `partyId` 的单据**重新打开编辑页会回显同一标签**（`resolveLabel` 走 `GET /api/parties/{id}`），名称字段同回显；探针（档案 + 单据）已删。
- **fail-closed 真机旁证**：仅被授予分公司组织的账号，其切换器 payload 为「父组织 `selectable:false` + 自身 `selectable`」（curl）；同一账号打开新建页时买方下拉**零选项**（浏览器实测），父组织从未作为内部买方出现。
- **门禁**：`yarn generate` ✓（生成物不变；OpenAPI 打包仍回退静态抽取，既有问题）｜`yarn typecheck` ✓ 0 error｜`yarn lint` 0 error（8 既有 warning）｜`yarn ds:check` ✓ 750 files｜`yarn test` ✓ 38 suites / 320 tests｜`node scripts/check-lessons.mjs` ✓。
- **未能覆盖**：本机 dev 运行期间 Turbopack 出现过自愈式内部错误（与并行会话的持续文件改动叠加），个别浏览器重试因此失败；上列真机证据取自重试成功轮次，逻辑侧另有单元与 ephemeral 集成覆盖。

> 本 spec 只处理 `internal_sales` 表单的**买方字段**：把「买方（分公司/客户）」下拉从 installed
> `customers/companies` 换成**关联组织（集团组织树）** + **外部客户（自建 `parties`）**两个来源，
> 买方名称从所选记录自动带出，并把「买方是哪个组织/哪个对手方」作为**快照**写进单据。
> 属于 [`.ai/specs/2026-09-22-products-and-trade-docs.md`](2026-09-22-products-and-trade-docs.md) Phase 6（`internal_sales`）
> 的买方字段修正；决定记录原本挂在 `docs/dev/business-architecture.md` 的待决行（「内部销售表单的对方选择器…切换与否则由
> `internal_sales` 的 spec 决定」），本 spec 就是那份决定。

## TLDR

`internal_sales` 的报价/订单表单只有一个买方字段对（`customerEntityId` 下拉 + `customerName` 自由文本）：
下拉读 installed CRM 的 `GET /api/customers/companies`（本部署该表**零数据**，下拉永远为空），名字靠手打。
而业务上的「买方」是**集团内的关联组织**——广州主体（广州凯翠国际贸易有限公司）卖给俄罗斯主体（俄罗斯 AB 有限公司）、
后续的东南亚主体；这些主体在系统里是 `directory` 的**组织**，不是 CRM 客户档案。分公司自身做**对外**贸易时，
买方才是外部客户（自建 `parties` 主数据，角色 `buyer`/`branch`）。

本 spec 把买方字段改成**一个可搜索选择器 + 名称回填**：选项 = 「关联组织：<组织名>」（来源：顶栏组织切换器的
同一份 payload，即调用者可见的组织集，排除当前组织与非可选节点）+「外部客户：<CODE — name>」（来源：
`GET /api/parties/options`，新增可选 `roles` 过滤）；选中即回填买方名称；单据写入
`customerSnapshot = { name, customer.displayName, internalSales: { organizationId | partyId } }`。
不新增实体、不新增迁移、不新增权限位；`customers` 读取路径从本模块删除。

## Problem Statement

**当前实现（复述事实，含证据）**：

- 表单买方字段：`src/modules/internal_sales/components/InternalSalesForm.tsx` 的 `customerEntityId`
  （`type: 'select'`，`loadOptions: loadCustomerOptions`）+ `customerName`（自由文本）；`loadCustomerOptions`
  读 `customers/companies`（`pageSize: 100`，按当前组织收窄）。
- 落库：`toHeadPayload` 写 `customerEntityId`（uuid 列，无外键）+ `customerSnapshot: { name }`；
  列表与编辑页回读 `customer_snapshot.name`（`InternalSalesTable` / `toInternalSalesFormValues`）。
- 本机 dev 库实测（2026-09-28）：`customer_companies` **0 行**、`parties_parties` **0 行**、`sales_quotes`
  **0 行**（`sales_orders` 2 行且买方字段全空）→ 打开 `/backend/internal-sales/quotes/create`，买方下拉恒为空，
  业务只能手打名字，没有任何「买方是谁」的结构化信息。

**业务口径（owner，2026-09-28 原话要点）**：

> 「这个内部销售报价单，我是用于主体组织给分公司进行报价…比如广州主体：广州凯翠国际贸易有限公司；
> 俄罗斯分公司主体：俄罗斯AB有限公司；后续会有东南亚分公司主体…那么广州〔主体〕只能对俄罗斯主体或者东南亚主体分公司
> 进行内部贸易行为；但对于俄罗斯主体或者东南亚主体可以进行对外贸易行为。」

即：**内部**方向的卖方是集团主体、买方是分支组织（组织树内）；**对外**方向的卖方是分支组织、买方是外部客户
（档案在 `parties`）。两个方向共用同一个表单（页面按组织作用域渲染，`sales.quotes.manage` 角色在总部与分公司都存在）。

**为什么现状不够**：

1. 买方主体已经是 `directory` 的组织（同一租户、同一组织树，`docs/dev/multi-company-org-model.md`），
   CRM 客户表里没有、也不该有第二份记录；让业务在空下拉里手打，等于让「内部交易」在单据上没有对手方。
2. `parties` 是 app 自有的交易对手主数据（买方/分公司/服务方），`trade_docs` 的对手选择器已切到
   `/api/parties/options`（`src/modules/parties/README.md` → Consumed by）；`internal_sales` 仍读 `customers`
   是本部署里最后一条「新业务读 CRM」的路径。
3. 组织可见性已有平台机制：顶栏组织切换器的 payload 就是「调用者可见组织集」（ACL 白名单 + 后代展开，
   总部见全部下级、分公司只见自己，见 `.ai/guides/modules/directory/index.md` 与
   `organization-switcher` 路由源码）——买方选项直接复用它，就自动满足「总部只能对分公司、分公司不能向上」，
   不需要在表单里手写业务规则。

## Overview and Success Measures

- **Primary outcome:** 在 `/backend/internal-sales/quotes/create|orders/create`（及编辑页）里，
  买方下拉列出「关联组织：俄罗斯 AB 有限公司 …」与「外部客户：BR-001 — ABC GmbH …」；选中后买方名称自动带出，
  保存后单据的 `customer_snapshot` 携带 `{ name, customer.displayName, internalSales.organizationId | partyId }`，
  列表买方列显示名称，编辑页回显所选记录。业务不再手打内部买方名字。
- **Leading indicators:** 下拉在总部组织上下文里有组织选项、在纯分公司账号里没有组织选项（fail-closed）；
  `GET /api/parties/options?roles=buyer` 只返回外部买方主体；本模块源码里不再出现 `customers/companies`。
- **Baseline:** 买方下拉空（`customer_companies` 0 行）；单据快照只有 `{ name }`；无组织链接。
- **Market / product reference:** 集团 ERP 的「内部交易对手 = 集团内公司」建模（SAP 的 company code 间交易、
  Odoo 的 `res.company` 互售）：对手方**引用组织主数据**而不是复制一份客户档案；外部对手方走各自的 partner 主数据。
  采用：内部 = 组织树引用 + 快照；外部 = `parties` 主数据引用 + 快照。拒绝：给每个分公司在 CRM 里建一份镜像客户
  （两份主数据必然漂移）；也拒绝把「组织」塞进 `customerEntityId` 列（该列在 installed 契约里是 `customer_entities.id`）。

## Goals

- **REQ-IB-001** — 买方选择器（`buyerRef`，自定义字段）在同一列表里提供两个来源，标签以来源开头区分：
  `关联组织：<组织名>`（值 `org:<uuid>`）与 `外部客户：<CODE — name>`（值 `party:<uuid>`）；
  可搜索（按标签过滤）、可清空。
- **REQ-IB-002** — 关联组织选项**只**来自顶栏组织切换器 payload（`GET /api/directory/organization-switcher`，
  requireAuth、无额外功能位）：取 `selectable !== false` 且 `id !== 当前所选组织` 的节点，按树序排列。
  分公司账号因此天然没有关联组织选项（其 payload 只有自身 + 不可选祖先），不做任何客户端规则判断。
- **REQ-IB-003** — 外部客户选项来自 `GET /api/parties/options`，带 `roles=buyer`（本 spec 为该路由新增的
  可选参数）与当前所选组织收窄；读取失败时选择器仍在（组织选项可用）并在字段下方给出提示文案，不静默渲染空列表。
- **REQ-IB-004** — 选中选项后自动回填 `customerName`：组织 = 组织名；外部客户 = `GET /api/parties/{id}` 的
  `item.name`（失败则不改写已有名字）。`customerName` 仍可编辑，作为「无档案买方」的兜底（保持现有能力）。
- **REQ-IB-005** — 单据写入契约（`customerSnapshot`，jsonb，installed schema 为 `.passthrough()`）：
  `{ name, customer: { displayName: name }, internalSales: { organizationId } | { partyId } }`；
  创建时无买方则不带该键，更新时清空买方写 `null`（显式清除）。`customerEntityId` 不再由本模块写入
  （更新载荷不携带该键 = installed 的「字段缺席不改」语义，历史值保留）。
- **REQ-IB-006** — 编辑回显：从快照解出 `buyerRef`（`internalSales.organizationId` → `org:`、
  `internalSales.partyId` → `party:`），名称取 `name` || `customer.displayName`；选择器用
  `resolveLabel`（组织 = 切换器 payload 名字；外部客户 = `/api/parties/{id}` 的 `code — name`）显示标签，
  值为未覆盖时不得把裸 uuid 画给操作员。
- **REQ-IB-007** — `GET /api/parties/options` 新增可选 `roles=<role>[,<role>]`：只返回**拥有任一**所列角色的主体
  （与 `search`/`ids`/`organizationId` 取值按 AND 组合）；未知角色名 → 400；不带该参数行为与现在逐字一致。
- **REQ-IB-008** — i18n：新增文案落 `src/modules/internal_sales/i18n/{zh,en}.json`（键集合一致，一条一种语言）；
  删除本模块对 `customers/companies` 的读取与相关文案。
- **REQ-IB-009** — 文档与状态：`src/modules/internal_sales/README.md`、`src/modules/parties/README.md`、
  `docs/dev/business-architecture.md`（把待决行改成决定）、`docs/plans/cross-border-erp.md` 进度行、
  `docs/plans/README.md` 状态板、本 spec 的 Status/Changelog 同步。

## Non-goals

- 不做「组织主数据分发/共享读」（PRD Q5），不改商品/价格的组织级私有规则。
- 不改 `sales` 的 API/命令/实体/页面；不动 installed `customers` 模块（页面与 API 保持现状，只是本模块不再读它）。
- 不新增实体、迁移、功能位、事件；不改 `parties` 的实体/命令/表单（只加一个只读查询参数）。
- 不做「内部买方的自动对账/应收」（内部结算仍走现有 `trade_docs` 单证与 `export_finance` 档案）。
- 不把 `/api/parties/options` 的响应形状从 `{ value, label }` 扩成携带原始字段（需要原始 name 时读
  `GET /api/parties/{id}`，与 `trade_docs` 的 `loadPartyDetail` 同款）。
- 不做「组织选项里隐藏停用组织」：切换器 payload 不携带 `isActive`，选项集与顶栏切换器保持一致（同款限制）。

## Proposed Solution

买方字段从一个 installed-CRM 下拉变成**两个来源合并的一个选择器**，名称回填，写快照：

```text
/backend/internal-sales/{quotes,orders}/{create|[id]/edit}
┌─────────────────────────────────────────────────────────────────────┐
│ 买方 *                               买方名称（无档案时填写）        │
│ ┌───────────────────────────┐        ┌────────────────────────────┐ │
│ │ 关联组织：俄罗斯 AB 有限公司 ⌄│        │ 俄罗斯 AB 有限公司          │ │
│ └───────────────────────────┘        └────────────────────────────┘ │
│   ▾ 下拉（可搜索）                                                   │
│     ├ 关联组织：俄罗斯 AB 有限公司        ← 组织切换器 payload        │
│     ├ 关联组织：东南亚 AB 有限公司        ← （selectable ∧ ≠ 当前组织）│
│     ├ 外部客户：BR-001 — ABC GmbH        ← /api/parties/options      │
│     └ 外部客户：RU-007 — VTB Logistics   ← （?roles=buyer）    │
└─────────────────────────────────────────────────────────────────────┘
保存 → POST/PUT /api/sales/{quotes,orders}
       customerSnapshot: { name, customer: { displayName },
                           internalSales: { organizationId } | { partyId } }
```

- **值协议**（表单内部）：`''` | `org:<uuid>` | `party:<uuid>`；标签前缀由 i18n 提供
  （`.ai/lessons/merged-picker-source-belongs-in-the-label.md`：合并来源的 picker，来源必须写在标签最前）。
- **选项装配**：组织来自 `parseOrganizationSwitcherScope` + `flattenOrganizationNodes`
  （复用 `src/modules/dictionaries/lib/dictionariesLibraryApi.ts`，与 `products/components/useOrganizationNames.ts` 同款复用，
  不另写解析器）；外部客户来自 `GET /api/parties/options`（本模块的第一个 `parties` 消费点）。
- **为什么不用 `customerEntityId` 存组织 id**：该列在 installed 契约里是 `customer_entities.id`
  （`resolveCustomerSnapshot` 会拿它查客户表；列表把派生名 fallback 到该列的字符串）。用快照承载链接
  是「ID + 快照」的既有跨模块模式（`.ai/guides/contracts.md` → Cross-Module Mechanism），且 id 与名字一起冻结，
  历史单据不受组织改名影响。
- **为什么写 `customer.displayName`**：installed 的单据**详情页**与**更新响应**（`mapUpdateResponse` → `resolveCustomerName`）从
  `snapshot.customer.displayName` 派生买方显示名；写这一份让平台视角（隐藏但可解析的官方单据页、通知深链）也能显示买方名，
  而不是一片空白。`name` 键保留（本模块列表/表单现有的读取路径；官方列表投影只回传原始快照、不自派生名字）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 内部买方来源 = 组织切换器 payload | 与顶栏「我能操作哪些组织」同一份数据，可见性 fail-closed（总部见下级、分公司不见上级/同级）；零新 API、零新权限位 | 新造 `GET /api/internal_sales/related-organizations`（服务端按组织树算） | 只是把同一份可见性规则再实现一遍，还要自带功能位与 scope 论证 |
| 外部买方来源 = `parties`（角色 `buyer`） | `parties` 是 app 自有的交易对手主数据，`trade_docs` 已切；角色过滤让货代/银行不出现在买方列表 | 继续读 `customers/companies` | 本部署 0 行且仓库方向是「新业务不再以 `customers` 为对方来源」；与 `trade_docs` 不一致 |
| 选项合并进一个选择器（前缀区分来源） | 同一份数据可能同时以组织与档案两种身份存在（分公司既是组织、档案里也可能有角色 `branch` 的记录），分来源前缀可辨；一个可搜索框比「类型单选 + 动态下拉」更省事（CrudForm 的 `loadOptions` 拿不到兄弟字段值） | 两个字段（关联组织 / 外部客户）各选一个 + 校验互斥 | 互斥校验、两个下拉的空白态、`customerName` 回填来源都要各写一遍；合并后与 `purchasing` 合并选品器先例一致 |
| 链接存快照（`internalSales.*`），不占 `customerEntityId` | 快照是「单据必须打印/展示的东西」的既有载体；避免类型混淆（该列是客户实体 id，无外键但语义明确） | 组织 id 写 `customerEntityId` | installed 的 `resolveCustomerName` 会把该列字符串当显示名兜底；未来任何按客户命名空间解析的消费者都会错解 |
| 保留自由文本买方名称 | 买方档案未建时不能挡单（现状能力，`customerName` 已承担） | 强制必须选择关联组织/外部客户 | 会挡掉「对外试单」等场景，且分公司侧外部档案的维护节奏不由表单控制 |
| 更新时清空买方写 `null` | `customerSnapshot` 在 installed update schema 里可空；不写 = 旧快照残留（清不掉的幽灵买方） | 空对象 `{}` 或继续不携带 | `{}` 与「没有快照」语义混淆；不携带等于无法清空 |
| `roles` 过滤加在 `/api/parties/options` | 买方选择器需要「买方类主体」；参数可选、缺省行为不变（向后兼容），其他消费方零影响 | 客户端过滤 | 选项响应只有 `{value,label}`，客户端拿不到角色 |
| 选中后名称用 `GET /api/parties/{id}` 取原值 | 选项标签是 `code — name`，直接当名字会把编码印进单据；详情读本来就存在（`trade_docs.loadPartyDetail` 同款） | 从标签里剥前缀 | 名称里可能含 ` — `，解析不可靠 |
| 不隐藏停用组织 | 切换器 payload 无 `isActive`；选项集与顶栏一致，避免为了这个另开一条需要 `directory.organizations.view` 的读取 | 再读 `/api/directory/organizations?view=tree` 过滤 | 分公司/业务角色未必持有该功能位，会引入 403 的可能性与新的权限依赖 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 主体组织（集团主体） | 集团在系统里的公司，组织树节点；本业务当前是广州凯翠国际贸易有限公司（根） | `directory.organizations` | — |
| 分公司（分支主体） | 挂在主体之下的组织（俄罗斯 AB 有限公司；后续东南亚）；内部交易的买方 | 同上（`parent_id`） | — |
| 关联组织 | = 调用者顶栏切换器 payload 中 `selectable` 且 ≠ 当前所选组织的节点（总部 → 其可见下级；分公司 → 空集） | `organization-switcher` 响应的派生值 | 无选项时选择器只列外部客户 |
| 内部交易 | 主体 → 分公司的销售（报价/订单），买方必须是关联组织 | 本 spec + `internal_sales` | 非关联组织不在选项里（可见性决定，不可绕过） |
| 对外交易 | 分公司 → 外部客户的销售，买方是 `parties` 主数据里角色含 `buyer`/`branch` 的档案 | `parties` | 无 `parties.view` → 外部选项为空并提示（组织选项仍可用） |
| 买方名称 | 单据上打印的买方显示名；组织 = 组织名、档案 = 档案名；无档案时可手填 | `customerSnapshot.name` | 既不选也不填 → 提交被拒（现有 `customerRequired`） |
| 买方链接 | `internalSales.organizationId` 或 `internalSales.partyId`，写时冻结 | `customerSnapshot.internalSales` | — |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 总部业务（如 `hq-sales`） | 建/编辑内部销售单据并选关联组织/外部客户 | 组织 = 所选组织（写入），组织选项 = 可见组织集 − 自身 | `sales.quotes.manage` / `sales.orders.manage`（installed API 门禁，本模块不新增）；外部客户还需 `parties.view` |
| 分公司业务 | 同上；组织选项为空（不能向上/同级），买方是外部客户 | 同上 | 同上 |
| 只读角色 | 能读列表/详情（本模块列表页声明 `sales.quote.view`） | 同上 | `sales.quote.view` / `sales.order.view` |

- `tenantId`/`organizationId` 一律来自会话（cookie 选择 + ACL），页面/表单不接收也不发送可信 scope。
- 组织选项的「可见集」由平台 ACL 决定，不新增功能位：能打开本页就能读到与顶栏同一份组织集合。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 组织树与可见性 | reuse | installed `directory` | `GET /api/directory/organization-switcher`（payload 解析复用 `dictionaries/lib/dictionariesLibraryApi.ts`） | 同一份可见性规则，避免第二套组织枚举/权限语义 |
| 交易对手主数据 | reuse | app `parties` | `GET /api/parties/options`（新增可选 `roles`）+ `GET /api/parties/{id}`（名称回填） | 单一对手方主数据；`trade_docs` 已消费同一来源 |
| 单据本体（编号/状态/金额/行/快照） | reuse | installed `sales` | `POST/PUT /api/sales/{quotes,orders}`；快照为 passthrough jsonb | 引擎不重写；买方链接放快照 |
| 表单壳与选择器 | reuse | app `internal_sales` | `CrudForm` 自定义字段 + `ComboboxInput` | 与行选品器同一套交互与组件 |
| 买方选项装配与快照编解码 | app-own | app `internal_sales` (`lib/buyer.ts`) | 纯函数，供表单与单测使用 | 逻辑可测、无 React 依赖 |

## Architecture and Data Flow

```text
internal_sales 表单 (client)
  ├─ buyerRef 自定义字段
  │    ├─ org 选项  ← GET /api/directory/organization-switcher （复用 dictionaries 解析器；排除自身/不可选）
  │    └─ party 选项 ← GET /api/parties/options?roles=buyer&organizationId=<所选组织>&search=<q>
  ├─ 选中 → setFormValue('customerName', name)
  │         └─ party 名称 ← GET /api/parties/{id}.item.name
  └─ 提交 → POST/PUT /api/sales/{quotes,orders}
             └─ customerSnapshot = { name, customer.displayName, internalSales.{organizationId|partyId} }
```

- **Module boundaries:** 买方选项装配属 `internal_sales`（界面层）；组织数据属 `directory`；对手方数据属 `parties`；
  单据持久化属 installed `sales`。都不越界：本改动只读前两者、经公开 API 写第三者。
- **Extension points:** `CrudForm` 的自定义字段（app 自有表单，非 injected UI）与 `fields/groups` 常量；无 UMES 参与。
- **Alternatives considered:** 见 Design Decisions。
- **Compatibility:** `parties/options` 只加可选查询参数（缺省逐字不变）；`internal_sales` 表单/快照为本模块私有契约，
  旧单据（快照只有 `{name}`）读取路径保留 `name` 键；`sales` API 载荷字段不变。

## User Journeys

### Journey J-IB-001 — 总部对俄罗斯分公司报价

1. 总部账号在 `/backend/internal-sales/quotes/create` 打开表单（组织 = 广州凯亚主体）。
2. 买方下拉出现「关联组织：俄罗斯 AB 有限公司」（+ 其它可见分公司）；选中后买方名称自动显示「俄罗斯 AB 有限公司」。
3. 填币种/行，保存 → 201；列表买方列显示组织名；编辑页打开时选择器显示同一标签。
4. 失败/拒绝：无 `sales.quotes.manage` → 页面 403/表单保存被 installed API 拒；组织读不到 → 字段下方提示、仍可手填名称。

### Journey J-IB-002 — 分公司（俄罗斯主体）对外报价

1. 俄罗斯分公司账号在 `/backend/internal-sales/quotes/create` 打开表单（组织 = 俄罗斯 AB 有限公司）。
2. 买方下拉**没有**关联组织项（该账号的切换器 payload 只有自身），只有「外部客户：…」（本组织档案）。
3. 选外部客户 → 名称回填档案名；保存 → 快照带 `internalSales.partyId`。
4. 失败/拒绝：无 `parties.view` → 外部选项为空且给出提示；不选不填 → 提交被拒。

## UI and Interaction Contracts

参考实现（最接近的既有页面）：本模块自己的行选品器（`components/InternalSalesForm.tsx` 的
`InternalSalesLinesEditor`，`ComboboxInput` + 选项缓存）与 `purchasing` 的合并选品器
（`components/PurchaseOrderForm.tsx` 的 `loadLineProductOptions`，来源前缀写在标签前）。
`.ai/guides/backend-ui.md`：`CrudForm` 拥有字段布局（不得包 `FormField`）、共享 API helpers、i18n 走 `t()`。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/internal-sales/quotes/create`、`/orders/create`（及 `[id]/edit`） | 买方选择 + 名称回填 | 组织：`GET /api/directory/organization-switcher`；档案：`GET /api/parties/options`、`GET /api/parties/{id}`；写入：`POST/PUT /api/sales/{quotes,orders}` | `purchasing` 采购单选品器（合并来源标签）/ 本模块行选品器 | `Page`/`PageBody`、`CrudForm`（自定义字段 `buyerRef` + `text` 字段 `customerName`）、`ComboboxInput` | loading（建议加载中）、empty（无选项时提示）、error（来源失败提示）、conflict（既有 409 冲突面板不变）、success（回填 + 保存 flash） | REQ-IB-001…REQ-IB-006 |

```text
买方（关联组织/外部客户）              买方名称
┌────────────────────────────┐      ┌────────────────────────────┐
│ 关联组织：俄罗斯 AB 有限公司  ⌄│      │ 俄罗斯 AB 有限公司           │
└────────────────────────────┘      └────────────────────────────┘
  （可搜索、可清空；下拉按 关联组织 → 外部客户 分组顺序）
  ⚠ 来源加载失败时：字段下方一行提示（组织 / 外部客户 各自的失败文案）
```

- **Behavior:** 输入过滤（组织按名称本地过滤，外部客户走 `?search=`）；Enter 选高亮项、Escape 关下拉；
  清空只清链接、不清已填名称；`disabled/readOnly` 跟随 CrudForm。
- **Responsive and accessibility:** 桌面两列（`layout: 'half'`）、窄屏堆叠；控件带 label 与 required 标记；
  无自绘按钮，图标无新增。
- **Localization:** 文案键 `internal_sales.form.buyer.*` 与 `internal_sales.form.field.*`；zh 只写中文、en 只写英文。
- **Design-system and theming:** 复用 `CrudForm` 字段与 `ComboboxInput` 语义 token；无硬编码颜色；明暗两态沿用 DS。

## Data Models

N/A — 不新增实体/列/迁移。唯一的数据形状变化是 `sales_quotes.customer_snapshot` / `sales_orders.customer_snapshot`
（既有 jsonb 列，installed schema `.passthrough()`）里本模块写入的键：

| Key | Type / nullability | Meaning | Lifecycle |
|---|---|---|---|
| `name` | string（可缺省） | 打印/列表用买方名 | 写时冻结（改名不回写历史） |
| `customer.displayName` | string（可缺省） | installed 单据详情页 / 更新响应派生买方名的读取点（列表投影只回传原始快照） | 同上 |
| `internalSales.organizationId` | uuid 字符串（可缺省） | 内部买方 = 关联组织 | 同上 |
| `internalSales.partyId` | uuid 字符串（可缺省） | 对外买方 = 交易对手档案 | 同上 |

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/parties/options` | auth + `parties.view` | 既有 `search`（按 code）/`ids`/`organizationId`；**新增** `roles`（逗号分隔） | `{ items: [{ value, label }] }`（label 恒为 `code — name`） | 无角色命中 → `{ items: [] }`；未知角色名 → 400；权限失败 401/403 | REQ-IB-007 |

- 该路由为手写 route（非 `makeCrudRoute`），沿用现有读法：`resolveOrganizationScopeForRequest` 取可读组织、
  `findWithDecryption` 读密文字段；`roles` 过滤只查 `parties_roles` 的 `party_id`（明文列），再与既有
  `search`/`ids` 的 `id` 条件取交。
- `GET /api/directory/organization-switcher`、`GET /api/parties/{id}`、`POST/PUT /api/sales/{quotes,orders}` 均为既有契约，不改。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 无新事件/job/通知；单据的 `sales.*` 事件由 installed 命令照常发出（快照随单据）。

## Security, Privacy, and Compliance

- **Authorization:** 读走两条既有门禁（切换器 = requireAuth；`parties/options` = `parties.view`）；写入门禁仍在
  installed `sales` API（`sales.quotes.manage`/`sales.orders.manage`）。不新增功能位。
- **Tenant isolation:** 组织 payload 来自会话租户；对手方读取按 `resolveOrganizationScopeForRequest` 的可读集 +
  所选组织收窄，fail-closed（无可读组织 → 400 `organization_scope_required`，既有行为）。
- **Sensitive data:** 对手方 `name` 是加密列，仅经既有解密读路径（`findWithDecryption` / `GET /api/parties/{id}`）；
  快照写入的是显示名（业务上要打印），与现状一致；不新增日志字段。
- **Abuse and failure modes:** 未知角色名 400；`roles` 参数不去重时用 `Set` 去重；组织 id/对手方 id 只作为快照值，
  不参与任何服务端授权判断（防伪造无意义：写路径不接受 scope 载荷）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-IB-001 | unit | — | `buildBuyerSnapshot` / `readBuyerSnapshot` 的 org / party / 手填 / 旧快照 组合 | 键形状、round-trip、null 清除语义 | REQ-IB-005, REQ-IB-006 |
| TEST-IB-002 | unit | — | `relatedOrganizationOptions` 输入含不可选节点、当前组织、孙子节点 | 只保留可选且非当前；保持树序 | REQ-IB-002 |
| TEST-IB-003 | unit | — | `buildPartyOptionsUrl` | `roles`/`search`/`organizationId` 编码与省略 | REQ-IB-003, REQ-IB-007 |
| TEST-IB-004 | integration | parties 现有 fixture（HQ/分支组织、superadmin、staff/viewer） | `GET /api/parties/options?roles=…`：买方类/银行类档案、未知角色、无参对照 | 只回买方类；未知角色 400；无参与原行为一致 | REQ-IB-007 |
| TEST-IB-005 | UI (browser smoke) | dev server + 两个组织（主体 + 分公司）+ 两类档案 | 报价/订单新建：选关联组织 → 名称回填 → 保存 → 列表/编辑回显；分公司上下文下拉无组织项；外部客户路径 | 落库快照键齐全；UI 标签与来源正确 | REQ-IB-001…REQ-IB-006 |

## Implementation Phases

### Phase 1 — `/api/parties/options` 的 `roles` 过滤

- **Depends on:** none
- **Outcome:** 买方选择器的外部来源可用且只含买方类主体；该参数对现有消费方零影响。
- **Why this order / value delivered:** 独立可验收（curl/集成测试），先把它落地，Phase 2 的表单只消费不改契约。
- **Deliverables:** `src/modules/parties/api/options/route.ts`（解析/校验 `roles`、角色→`party_id` 过滤）、
  `src/modules/parties/README.md`（API 行 + 消费方）、`src/modules/parties/__integration__/parties.spec.ts`（TEST-IB-004）。
- **Requirements closed:** REQ-IB-007
- **Tests:** TEST-IB-004
- **Validation:** `yarn typecheck`、`npx eslint src/modules/parties`、`yarn mercato test:integration parties`（或 ephemeral 套件）
- **Exit gate:** `roles=buyer` 只返回外部买方档案；`roles=unknown` 400；无参响应与改动前逐字一致。

### Phase 2 — 表单买方选择器 + 单据快照

- **Depends on:** Phase 1 exit gate
- **Outcome:** 用户在新建/编辑页完成「选关联组织或外部客户 → 名称回填 → 保存 → 回显」全流程。
- **Why this order / value delivered:** 逐字满足 owner 的业务口径；单据从此带上结构化的买方链接。
- **Deliverables:** `src/modules/internal_sales/lib/buyer.ts`（纯函数）、
  `src/modules/internal_sales/components/InternalSalesForm.tsx`（自定义字段 + 快照编解码 + 删除 customers 读取）、
  `src/modules/internal_sales/i18n/{zh,en}.json`、`src/modules/internal_sales/lib/__tests__/buyer.test.ts`。
- **Requirements closed:** REQ-IB-001…REQ-IB-006, REQ-IB-008
- **Tests:** TEST-IB-001…TEST-IB-003, TEST-IB-005
- **Validation:** `yarn generate`、`yarn typecheck`、`yarn lint`、`npx jest src/modules/internal_sales`、浏览器实测
- **Exit gate:** 浏览器里：总部上下文选关联组织可保存并回显；分公司上下文无组织项；外部客户路径可保存；
  列表买方列显示名称；无签证快照的旧单据仍可打开（名称取自 `name`）。

### Phase 3 — 文档与状态收口

- **Depends on:** Phase 2 exit gate
- **Outcome:** 决定与证据落进人读文档。
- **Deliverables:** `docs/dev/business-architecture.md`（待决行 → 决定 + 证据）、`docs/plans/cross-border-erp.md`
  进度行、`docs/plans/README.md` 状态板、本 spec Status/Changelog。
- **Requirements closed:** REQ-IB-009
- **Tests:** N/A（文档）
- **Exit gate:** 上述文档同一变更里更新，且与树上的实装一致。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-IB-001 | J-IB-001/002, 表单买方选择器 | 表单字段 `buyerRef`（值协议 `org:`/`party:`） | 2 | TEST-IB-002, TEST-IB-005 | AC-IB-001 |
| REQ-IB-002 | J-IB-002 | `GET /api/directory/organization-switcher` | 2 | TEST-IB-002, TEST-IB-005 | AC-IB-002, AC-IB-003 |
| REQ-IB-003 | J-IB-002 | `GET /api/parties/options?roles=…`、`GET /api/parties/{id}` | 1, 2 | TEST-IB-003, TEST-IB-004, TEST-IB-005 | AC-IB-004 |
| REQ-IB-004 | J-IB-001/002 | `GET /api/parties/{id}`（名称回填） | 2 | TEST-IB-005 | AC-IB-001, AC-IB-005 |
| REQ-IB-005 | J-IB-001/002 | `customerSnapshot`（jsonb passthrough） | 2 | TEST-IB-001, TEST-IB-005 | AC-IB-005 |
| REQ-IB-006 | J-IB-001 | 快照 → 表单值 | 2 | TEST-IB-001, TEST-IB-005 | AC-IB-006 |
| REQ-IB-007 | 外部来源 | `GET /api/parties/options`（+`roles`） | 1 | TEST-IB-004 | AC-IB-004 |
| REQ-IB-008 | 全部 UI | i18n 键 | 2 | TEST-IB-005（目视） | AC-IB-007 |
| REQ-IB-009 | 文档 | — | 3 | — | AC-IB-008 |

## Rollout, Migration, and Rollback

- 无迁移、无种子、无开关；两处改动都是代码级（表单组件 + 查询参数）。
- 回滚：还原 `InternalSalesForm.tsx` 与 `lib/buyer.ts`、去掉 `parties/options` 的 `roles` 分支即可；
  已写入的快照键为 additive jsonb，旧代码读 `snapshot.name` 仍可用（不产生脏数据、不需要数据修复）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 组织切换器 payload 的行为变化（字段名/可见集） | 买方选项丢失或过期 | 解析器与 `products`/`dictionaries` 共用（已是既有依赖）；选项为空时字段提示 | 上游改 payload 形状：三处同时受影响，由既有复用集中暴露 |
| 组织与档案里存在同一法律实体的两条记录 | 下拉出现两条近似选项 | 标签前缀区分来源（既有 lesson）；操作员可选任一条，快照记录来源 | 业务需自行约定内部交易用组织、对外用档案 |
| `roles=buyer` 过滤把「只标 consignee 的实际买方」挡在外面 | 个别买方选不到 | 参数由调用方显式给出，可随时调整；角色可在档案表单补齐 | 低（买方档案应标 `buyer`） |
| 快照是写入时冻结 | 组织/档案改名不回写历史单据 | 设计使然（单据打印口径冻结） | 与其它快照字段一致 |
| `customerEntityId` 不再写入 | installed 视角的「客户链接」为空 | 本部署该列本就为空的实现路径（0 行 customers）；installed 列表派生名改由 `customer.displayName` 提供 | 若未来要按客户实体统计，需单独立项 |

## Acceptance Criteria

- [x] **AC-IB-001** — 总部上下文的新建报价页，买方下拉含「关联组织：<分公司名>」与「外部客户：<CODE — name>」；选中组织后买方名称自动等于组织名。
- [x] **AC-IB-002** — 保存后 `customer_snapshot` 含 `name`、`customer.displayName`、`internalSales.organizationId`（选组织时）/`internalSales.partyId`（选档案时）；列表买方列显示名称；编辑页回显对应选项标签。
- [x] **AC-IB-003** — 纯分公司账号（ACL 仅自身组织）打开同一页面时，下拉没有关联组织项（fail-closed），只有外部客户项。
- [x] **AC-IB-004** — `/api/parties/options?roles=buyer` 过滤生效；未知角色 400；无参响应不变。
- [x] **AC-IB-005** — 外部客户路径：选中档案 → 名称回填档案名 → 保存后快照带 `partyId`。
- [x] **AC-IB-006** — 无 `internalSales` 键的旧快照（只有 `{name}`）打开编辑页时名称不丢、不报错（`readBuyerSnapshot` 的回退分支 + 单元测试）。
- [x] **AC-IB-007** — 新增文案 zh/en 键集合一致且一条一种语言（`yarn test src/lib/i18n/__tests__/language-purity.test.ts` 3 passed；`yarn i18n:check-hardcoded` 对 `internal_sales` 仅报一条诊断用内部错误码）。
- [x] **AC-IB-008** — 文档/状态同步（README、business-architecture、计划进度、状态板、本 spec）。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 根 `AGENTS.md`；`.ai/guides/{backend-ui,contracts,spec-delivery}.md`、`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`；`om-backend-ui-design`（含 `crud-surfaces` / `quality-states`）、`om-spec-writing`、`om-module-scaffold`（`api-and-domain` / `verification`） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无实体/迁移；唯一 API 变化是 `parties/options` 的可选 `roles`；traceability 表 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-IB-001/002 → Phase 1/2 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts（复用 `CrudForm` + `ComboboxInput`） |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–3 |

Verdict: `Implemented`（Phase 1–3 已交付并验证；证据见 Implementation Status）

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-IB-001 | 内部买方是否强制只允许关联组织（总部上下文禁用外部客户项）？ | business | no | 2026-09-28：不强制。同一表单被总部与分公司共用，且分公司做对外交易；「总部→分公司」由组织可见性天然限定，外部客户项对两者都保留。若业务后续要求总部禁用，以一行过滤（按「是否存在关联组织选项」）即可收口 |
| Q-IB-002 | 是否要把「关联组织」也登记进 `parties`（分支档案）以便打印银行/地址？ | business | no | 2026-09-28：本 spec 不做。打印类单证（合同/发票）已有自己的对手方选择与快照；内部买方当前只需要名称与链接 |
| Q-IB-003 | 停用组织是否从买方选项隐藏？ | technical | no | 2026-09-28：不隐藏（切换器 payload 不带 `isActive`，选项集与顶栏一致；隐藏需要 `directory.organizations.view` 的第二条读取，见 Design Decisions） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | 初始版本：业务口径（主体 → 分公司内部交易、分公司对外交易）与现状证据（买方下拉读 0 行的 `customers`）；决定买方选项 = 关联组织（组织切换器 payload）+ 外部客户（`parties` + 新增 `roles` 过滤），名称回填，链接写入 `customerSnapshot.internalSales.*`；Phase 1–3。状态 Draft（实现在同一次交付里落地并回填证据）。 |
| 2026-09-28 | **Phase 1–3 实现并验证 → `Implemented and verified`。** ① `parties/options` 的 `roles` 过滤（未知角色 400、与 `ids`/`search` 按 AND）；② `internal_sales` 合并选择器（`buyerRef` 自定义字段 + `lib/buyer.ts`）与快照契约（`internalSales.{organizationId\|partyId}`、更新清空 `null`），删除 `customers/companies` 读取；③ 文档/状态收口（模块 README、`docs/dev/business-architecture.md` 的「已切换」段、计划进度 六·补19、状态板）。证据：单元 18 例、`yarn test` 38/320、集成 parties **10 passed**（含新增 roles 用例）、真机新建/编辑/清空/分公司上下文实测、门禁全绿。教训：[`.ai/lessons/org-linked-counterparty-lives-in-the-snapshot.md`](../../.ai/lessons/org-linked-counterparty-lives-in-the-snapshot.md)。 |
| 2026-09-28 | **外部客户过滤收窄为 `roles=buyer`（同一次交付内修正）.** 建完分公司组织、分公司 `parties` 档案（角色 `branch`，服务合同/发票的打印块）之后实测发现：`roles=buyer,branch` 会让同一法律主体在买方下拉里出现两次（`关联组织：俄罗斯 AB 有限公司` 与 `外部客户：RU-AB — 俄罗斯 AB 有限公司`）。内部交易的买方是**组织**，`parties` 档案不承担内部买方角色，因此外部来源收窄为 `buyer`，分公司档案只带 `branch`；`EXTERNAL_BUYER_ROLES`、单测 URL 断言、`internal_sales`/`parties` README 与 parties 侧 changelog 同步。 |
