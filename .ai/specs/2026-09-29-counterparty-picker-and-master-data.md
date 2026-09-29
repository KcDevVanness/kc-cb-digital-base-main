# 交易对手选择与主数据回填（counterparty picker & master-data linkage）

**Date**: 2026-09-29
**Status**: Implemented — Phases 1–3 shipped and verified (2026-09-29); PR #35

> Route: `module-data`（`trade_docs` / `parties` / `purchasing` 三个 app 自有模块）+ `backend-ui`（四张单据表单的选择器与对话框）。
> 决策来源：owner 2026-09-29 对本调研四项问题的答复（方向联动并锁定 + 服务端校验 / 内联新建客户 / parties 回填 + purchasing 加密银行块）。

## TLDR

把 `trade_docs` 四张单据（购销合同、形式/商业发票、税务发票）的「对方」从**一张混合列表 + 手打文本**改成**方向驱动的主数据选择器**：采购只能选供应商、销售只能选客户（分公司档案或外部客户），选中后自动回填名称/地址/联系人/银行账户，销售方向可就地新建客户；供应商侧补齐银行账户主数据（加密存储）。方向与对方类型由服务端 fail-closed 校验，`counterpartyId` 必须真实存在于对应命名空间。

## Problem Statement

1. **方向与对方类型无关联（已实测确认）**：合同表单的 `direction`、`counterpartyKind`、`counterpartyId` 是三个独立字段（`src/modules/trade_docs/components/ContractForm.tsx:653-684`），选择器把 `purchasing/suppliers` 与 `/api/parties/options` 合成一张列表（`components/formOptions.ts:117-176`），所以「销售」方向能选到供应商；服务端零交叉校验（`data/validators.ts:99-105,140-146`、`commands/contracts.ts:293-294`），`counterpartyId` 也不校验归属。
2. **对方信息全靠手打**：选中对方只写一个 id，名称/地址/联系人/银行是四个自由文本框（`ContractForm.tsx:774-797`），快照只存 `{name,address,contact,bank}`，不存银行账户 id；只有「我方」有主数据回填（`OurPartyPicker`，`:527-640`）。
3. **客户维护缺入口**：分公司在自己的组织里维护外部客户的能力已具备并实测（`docs/dev/multi-company-org-model.md:45,48`），但合同表单里没有「新增客户」路径，操作员必须先离开表单去 `/backend/parties/create`。
4. **采购侧没有银行主数据**：`purchasing_suppliers` 只有 contact/phone/email/address（`src/modules/purchasing/data/entities.ts:17-73`），没有银行块；采购合同打印的对方银行只能手打。
5. **商业发票守卫只在 create**：`kind==='commercial' && direction!=='sales'` 的校验只在创建时执行（`commands/documents.ts:321-323`），update 可把 CI 改成 `purchase`。
6. **部分更新会重放创建默认值（本次实测确认的既有缺陷）**：三套 update schema 都是 `createSchema.partial()`，而本仓的 zod 4.4.3 在 `.partial()` 下**保留 `.default()`**——`PUT {id, notes}` 解析后仍带 `direction:'purchase'`、`counterpartyKind:'supplier'`、`currencyCode:'CNY'`、`lines:[]`，命令据此覆写已存的方向/类型/币种，并把 `lines:[]`（真值）交给 `persistContractLines` **清空全部行**（同源于 `commands/contracts.ts` 的 `parsed.lines ? … : null`）。同一缺陷在 `documents`/`invoices` 的 update 上一致存在。REQ-001 的 update 一半必须先把默认值从 update 契约里移出去才成立。

现网数据检查（2026-09-29，本机 dev 库）：三张表的方向/类型组合全部一致（contracts 5×purchase/supplier、documents 7×sales/customer、invoices 6×inbound/supplier），且**全部行的 `counterparty_id` 为空**——新校验不会破坏任何存量行。

## Overview and Success Measures

- **Primary outcome:** 任何一张单据的对方都能一眼看出类别（供应商/分公司/外部客户），选中的主数据自动变成单据上的抬头与银行信息；方向与对方类型不可能再出现不一致组合。
- **Leading indicators:** 新建合同里 `counterpartyId` 非空的比例上升；对方银行由手打改为从主数据带出；客户档案在签合同过程中就地创建。
- **Baseline:** 本机 dev 库 18 张单据 0 条 `counterparty_id`（全部手打快照）。
- **Market / product reference:** 主流 ERP（SAP Business One 的 BP master + 银行子表、Odoo 的 partner bank accounts）都以「业务伙伴主数据（含多银行账户、默认账户）」为单据抬头与收付款来源——本 spec 采用「主数据 + 快照冻结」而不是「单据只存引用」，与本仓既有决策（标量 id + 快照，不建跨模块 ORM 关联）一致。

## Goals

- **REQ-001** — 方向决定对方类型：`purchase ⇒ supplier`、`sales ⇒ customer`（单据）；`inbound ⇒ supplier`、`outbound ⇒ customer`（发票）。创建与更新都在服务端 fail-closed（400），冲突组合无法入库。
- **REQ-002** — 对方选择器按方向过滤：采购只列供应商；销售只列客户（`buyer`/`branch` 两个来源合并，**来源领标签**：`分公司：` / `外部客户：`；供应商列表只有一个来源故不加前缀）。货代/报关行/银行等服务方不再出现。已选但当前列表解析不到的 id 仍以一个种子选项显示（标签取快照名称），编辑不会看到空控件或裸 uuid。
- **REQ-003** — 选中对方后自动回填名称/地址/联系人，并提供该主体的银行账户选择器（默认账户优先）；快照写入打印所用的合并文本键 `bank` 与来源账户 id `bankAccountId`（与 `our_party_snapshot` 同一口径），编辑回读为同一形状。
- **REQ-004** — 销售方向可内联新建外部客户（编码/名称/国家/联系人/银行），保存后自动选中该客户；无 `parties.manage` 时按钮降级为「去交易对手维护」提示，服务端仍是权威。
- **REQ-005** — 供应商银行账户主数据：`purchasing` 新增加密银行子表、命令、详情读取与表单维护；列表/选项源不泄露银行字段。
- **REQ-006** — `counterpartyId` 归属校验：非空时必须存在于对应命名空间（supplier → `purchasing_suppliers`；customer → `parties_parties`）且未软删，越权/未知 → 400。
- **REQ-007** — 商业发票「销售方向」守卫在 update 同样生效（现在只有 create 检查）。
- **REQ-008** — 兼容性：`/api/parties/options` 的响应新增 `roles`（additive）；既有快照形状 `{name,address,contact,bank}` 继续可读，新增键只在有主数据来源时写入。

## Non-goals

- 不给 `parties` 增加 `supplier` 角色，不合并 `purchasing_suppliers` 与 `parties`（维持 Q-P-006 / 已定架构：供应商主数据留在 `purchasing`）。
- 不做客户编码自动发号（沿用 `parties` 现有「组织内唯一、手工填」契约；自动发号单独立项）。
- 不做银行数据的独立权限位（沿用 `parties.view`；若要拆分收付款数据权限单独立项）。
- 不改单据的金额口径、状态机、行快照与打印模板的排版（合同/发票 Excel 打印仅按需接入新快照键）。
- 不动 `internal_sales` 与销售引擎的「对内/对外」划分（那是第二个 spec：`2026-09-29-sales-trade-type-and-line-reuse.md`）。

## Proposed Solution

1. **服务端一致性**（`trade_docs`）：三套 create/update schema 增加方向↔类型规则（两字段同时出现时 400）；命令在合并后的实体上再校验一次（部分更新也覆盖）；新增 `lib/counterpartyRefs.ts` 用 scoped Kysely 只读校验 `counterpartyId` 的命名空间与存活；CI 的商业发票守卫移到 update 也执行。
2. **选择器组件化**（`trade_docs`）：把 `counterpartyKind` 从独立下拉改成由方向推导，新增 `components/CounterpartyPicker.tsx`（bare group 组件，可读取 `values.direction`），按方向加载供应商或客户选项；选中即拉主数据详情回填抬头与银行块（客户走既有 `loadPartyDetail`，供应商走新的 `loadSupplierDetail`）。
3. **客户内联新建**（`trade_docs` + `parties`）：`CustomerQuickCreateDialog` 复用 `Dialog`/`FormField`/`ComboboxInput`，提交 `POST /api/parties`（`roles:['buyer']`，可选一行银行），成功后选中并回填；按钮按 `parties.manage` 显示。
4. **供应商银行主数据**（`purchasing`）：新增 `purchasing_supplier_bank_accounts`（镜像 `parties_bank_accounts`：多行、默认唯一、字段加密），命令层子行替换语义，新增 `GET /api/purchasing/suppliers/[id]` 详情读，供应商表单加银行块；`trade_docs` 通过该详情读回填采购合同。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 方向是唯一真源，`counterpartyKind` 由命令推导（UI 移除该字段，DTO 仍写） | 现存字段就是为打印/筛选保留的机器值（Q-P-006 决定保持 `supplier\|customer`），写入时推导即可消除非法态，无需迁移 | 保留下拉并加联动告警 | 仍可能选错；服务端要额外容忍态 |
| update schema 不带默认值：字段表默认无关，默认值只由 create schema 施加 | 已实测缺陷：本仓 zod 在建 `.partial()` 后仍保留 `.default()`，`PUT {id, notes}` 会重放 `direction`/`kind`/`currencyCode`/`lines:[]` 并清空全部行 | 只在命令里校验 | schema 仍会把重放的默认值交给命令 |
| `counterpartyId` 用 scoped Kysely 只读校验，且校验的是**命令作用域（所选组织）**；同时给供应商列表加 `organizationId` 收窄，让选择器与写入一致 | 已沉淀的教训禁止把写作用域放大到可见集合；parties 选项源本来就是这么收窄的 | 按可读组织集合校验 | API 调用方可以把兄弟组织的供应商挂到本组织合同上 |
| `counterpartyId` 用 scoped Kysely 只读校验，不建外键 | 仓库铁律：跨模块只存标量 id + 快照，不建跨模块 ORM 关系/外键 | 加 DB 外键 | 跨模块外键违反架构约束 |
| 银行账户沿用子表 + 默认唯一（镜像 parties），表单直接复用 parties 的 `BankAccountsEditor` | 对手方会换银行，单据打印「默认账户」；同一个值对象只留一份交互实现，app 模块间已有 UI 复用先例（`cross_border`→`products`、`export_finance`→`trade_docs`） | 在 purchasing 复制一份编辑器 | 同一网格两份载体，下次改动会漂移 |
| 对方银行文本进打印快照（合并键 `bank` + 来源 `bankAccountId`），与 `our_party_snapshot` 同口径 | 双方签字的单据本身就印着账号；快照就是打印副本，加密的主数据仍是唯一真源 | 只存账户 id | 打印模板读 `bank`，文档会印出空银行行 |
| 供应商银行列加密；update 命令的 undo 快照携带它们（与 parties 同款） | 付款目标不能进 dump；undo 必须能精确重建上一版银行块 | 快照不含银行行 | update-undo 无法恢复原账户 |
| 客户编码在对话框里手工填（不做发号） | 最小范围、可逆；自动发号是新的公共契约（格式/唯一性/历史码） | 参照 `SUP-` 给客户发号 | 需 owner 决定格式与历史码处理，单独立项 |
| 新增客户走 `POST /api/parties`（既有路由） | 不新增公共 API 表面，ACL/校验/事件复用 | 交易对手模块新开 quick-create 路由 | 重复实现且多一个契约 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 方向 direction | 合同/单据：`purchase` \| `sales`；发票：`inbound`（进项）\| `outbound`（销项） | `trade_docs.data.validators` | 非法值 400 |
| 对方类型 counterpartyKind | `supplier` \| `customer`，**由方向唯一决定**；agent 值仍入库以兼容读侧 | `trade_docs` | 组合不匹配 400 `counterparty_kind_direction_mismatch` |
| 分公司档案 | `parties` 中角色含 `branch` 的档案（建在总部组织，用于合同/PI/CI 的对方打印块） | `parties` | 销售方向以「分公司：」前缀出现 |
| 外部客户 | `parties` 中角色含 `buyer` 的档案（由所属组织维护） | `parties` | 销售方向以「外部客户：」前缀出现 |
| 供应商 | `purchasing_suppliers`（唯一采购对方主数据） | `purchasing` | 采购方向唯一来源 |
| 对方快照 | 冻结 `{name,address,contact,bank}`；从主数据选定时追加 `bankAccountId/beneficiaryBank/accountNumber/swiftCode` | `trade_docs` jsonb | 主数据改名/删除不改写已出单据 |
| 默认银行账户 | 一个对手方最多一行 `is_default`；无标记时第一行自动成为默认 | `parties` / `purchasing` | 两行默认 400 |
| 加密字段不可检索 | 银行四列加密后不做唯一索引/排序/LIKE | `encryption.ts` | 只按 id 读取 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 总部/分公司业务员（单据录入） | 建/改合同、PI/CI、发票；选对方并回填 | 写 = 当前所选组织；读 = 所选组织 | `trade_docs.contracts.manage` / `trade_docs.documents.manage` / `trade_docs.invoices.manage` + 对应 view（既有） |
| 同上，且持 `parties.manage` | 销售方向内联新建外部客户 | 写 = 当前所选组织（`parties` 命令自带 fail-closed） | `parties.manage`（`dependsOn: parties.view`） |
| 采购员 | 维护供应商银行账户 | 写 = 当前所选组织 | `purchasing.suppliers.manage`（既有）+ view |
| 只读账号 | 只看到对方名称/抬头文本，不额外获得银行读取面 | 所选组织 | 无 manage 时不显示新建按钮；服务端 403 仍是权威 |

trusted `tenantId`/`organizationId` 一律由会话与 `om_selected_org` 解析（`resolveOrganizationScopeForRequest`）；`counterpartyRefs` 校验沿用命令的 scope，不接受 payload 里的组织。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 单据对方字段 | extend | `trade_docs`（app-owned） | 本模块 schema/命令/jsonb 快照 | 数据模型已存在，只补一致性 |
| 客户/分公司档案 | reuse | `parties`（app-owned） | `/api/parties/options`、`/api/parties/{id}`、`POST /api/parties` | 已建成的对手方主数据（含加密银行块） |
| 供应商档案 | extend | `purchasing`（app-owned） | 新子表 + 详情路由 + 命令 | 供应商主数据唯一归属 |
| 银行账户编辑器 | reuse pattern | `parties/components/BankAccountsEditor.tsx` 为参照，`purchasing` 自持一份（自己的 i18n/字段名） | — | 跨模块 UI 复用会把两个模块的文案与校验耦合 |
| 国家选择器 | reuse | `parties` 的 ISO-3166 组合框实现（`@open-mercato/shared/lib/location/countries`） | 共享 registry | 不新造国家词表 |

## Architecture and Data Flow

```text
合同/PI/CI/发票表单
  ├─ CounterpartyPicker（方向驱动）
  │    ├─ purchase → GET /api/purchasing/suppliers（列表，仅 name/code/contact…）
  │    │                └─ 选中 → GET /api/purchasing/suppliers/{id}（含 bankAccounts，解密）
  │    └─ sales    → GET /api/parties/options?roles=buyer,branch&organizationId=<selected>
  │                   └─ 选中 → GET /api/parties/{id}（含 bankAccounts，解密）
  ├─ CustomerQuickCreateDialog → POST /api/parties（roles:['buyer']）→ 选中新 id
  └─ submit → POST/PUT /api/trade_docs/{contracts,documents,invoices}
                 └─ validators：direction↔kind；command：合并态再校验 + counterpartyRefs 命名空间校验
```

- **Module boundaries:** `trade_docs` 拥有单据与快照；`parties`/`purchasing` 拥有各自的主体主数据；跨模块只用 HTTP 只读投影/选项源与标量 id，不建 ORM 关系。
- **Extension points:** 复用 `ComboboxInput`、`Dialog`、`CrudForm` 的 custom-field/bare-group 机制；不替换 installed 页面。
- **Alternatives considered:** 把供应商也搬进 `parties` 统一主数据——改动面大（角色词表、供应商编码、采购链全部消费方），收益只是少一个来源；本轮不做。
- **Compatibility:** 单据响应字段不变；`counterpartyKind` 仍写 `supplier|customer`；`/api/parties/options` 仅新增 `roles`；新增 `GET /api/purchasing/suppliers/[id]`（不删不改既有列表契约）。

## User Journeys

### Journey J-001 — 新建销售合同（分公司 → 外部客户）

1. 业务员切到「俄罗斯分公司」组织，打开 `/backend/trade-docs/contracts/create`。
2. 方向选「销售」；对方选择器变为客户列表（`分公司：`/`外部客户：CODE — name`），供应商不再出现。
3. 选中客户 → 名称/地址/联系人自动回填，银行下拉给出该客户账户（默认账户带 ★），选默认账户 → 银行文本回填，`bankAccountId` 入快照。
4. 保存 → 201；详情页打印块显示同一抬头。若对方不存在 → 「新增客户」→ 填档案 → 保存后被自动选中。
5. 失败态：客户编码重复 → 409 就地提示；无 `parties.manage` → 按钮替换为「去交易对手维护」链接。

### Journey J-002 — 新建采购合同（总部 → 供应商）

1. 方向选「采购」→ 对方列表只列供应商。
2. 选中供应商 → 回填名称/地址/联系人；若供应商维护了银行账户，下拉可选（默认优先），否则银行留空可手填。
3. 服务端校验：`counterpartyId` 必须存在于 `purchasing_suppliers`（同租户、可读组织内）。

### Journey J-003 — 维护供应商银行账户

1. 采购员打开 `/backend/purchasing/suppliers/{id}/edit`，在「银行信息」块新增两行，勾选一行作默认。
2. 保存 → 子行整组替换；两行都标默认 → 400；数据库列存密文，页面回读明文。

### Journey J-004 — 发票绑定合同的对方

1. 销项发票默认「销项」→ 对方类型固定 `customer`，只能选客户；进项发票相反。
2. 选中的客户银行账户随快照进发票，与合同同一形状。

## UI and Interaction Contracts

参照页面：`trade_docs` 自己的 `ContractForm`（bare group `OurPartyPicker`）与 `DocumentsForm` 的 `DocumentCopyFromDialog`；表单控件用 `CrudForm` 的 `ComboboxInput`、`Select`、`Dialog`、`FormField`、`FieldLabel`，状态覆盖 loading/empty/error（失败必须给出行内文案，不允许空白下拉）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/trade-docs/contracts/{create,edit}` | 方向选择 + 对方选择 + 回填 + 内联新建 | `purchasing/suppliers`、`/api/parties/options`、`/api/parties/{id}`、`/api/purchasing/suppliers/{id}`、`POST /api/parties`、`POST/PUT /api/trade_docs/contracts` | `OurPartyPicker`（同文件）、`DocumentCopyFromDialog` | `CrudForm` + bare group `CounterpartyPicker` + `Dialog` | 三态 + 权限降级 + 409 编码重复 + 服务端 400 组合错误行内提示 | REQ-001…004, 006 |
| `/backend/trade-docs/{proformas,commercial-invoices}/{create,edit}` | 同上（PI 还可选来源单据） | 同上 + documents API | 同上 | 同上 | 同上 | REQ-001…004, 006 |
| `/backend/trade-docs/invoices/{create,edit}` | 进/销项 → 对方类型联动 | 同上 + invoices API | 同上 | 同上 | 同上 | REQ-001…004, 006 |
| `/backend/purchasing/suppliers/{create,edit}` | 供应商银行块维护 | `POST/PUT /api/purchasing/suppliers` | `parties` 的 `BankAccountsEditor` | `CrudForm` + custom field `SupplierBankAccountsEditor` | 空态/两默认 400/清空允许 | REQ-005 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 业务员 | 出口业务 → 购销合同 / 形式发票 / 商业发票；财务 → 税务发票台账 | 无新增 widget | 登录 → 单据列表 → 新建 → 选对方（≤3 步） |
| 采购员 | 采购 → 供应商 | 无 | 登录 → 供应商列表 → 编辑 → 银行块 |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 对方选择器 | 空结果给「没有可选的{供应商/客户}」+（销售方向）「新增客户」按钮 | 窄屏单列，银行下拉在名称下方 | Tab 顺序：方向 → 对方 → 名称 → 银行；对话框 Cmd/Ctrl+Enter 提交、Esc 关闭 |
| 新增客户对话框 | 首次打开为空白表单，编码/名称必填 | 单列；字段堆叠 | 打开后焦点落「编码」；提交中禁用按钮；错误就地显示 |

### 对方块（表单内 wireframe）

```text
┌──────────────────────────────────────────────────────────────┐
│ 方向 [采购 ▾]        对方类型 供应商（由方向决定）             │
│ 对方 [ 供应商：SUP-0007 — 宁波 XX 有限公司        ▾ ] [新增客户]│
│ 名称       [宁波 XX 有限公司            ]                     │
│ 地址       [浙江省宁波市…              ]                     │
│ 联系人     [王工 / 13800000000         ]                     │
│ 银行账户   [ 中国银行 … — 6222… ★      ▾ ]                    │
│ 银行文本   [中国银行 6222…              ]  ← 可手改，保留原文  │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** 方向切换清空 `counterpartyId` 与回填块（避免把供应商文本留在销售合同上）；对方类型不可手选；银行下拉按 `bankAccounts` 渲染，默认账户带 ★ 且优先选中；手改银行文本不回写主数据。
- **Responsive and accessibility:** 窄屏（390px）单列；下拉均为带 label 的组合框；错误用 `text-destructive` 的行内文案与 `aria-invalid`。
- **Localization:** 新 key 前缀 `trade_docs.contracts.form.counterparty.*`（合同）、`trade_docs.documents.form.counterparty.*`（PI/CI）、`trade_docs.invoices.form.counterparty.*`（发票）、`purchasing.suppliers.bank.*`（供应商银行块）；zh 只写中文、en 只写英文。
- **Design-system and theming:** 只用共享 primitives 与语义 token（`text-muted-foreground`、`border-border`），沿用既有表单栅格；明暗两色与窄屏需实测。

## Data Models

### `PurchasingSupplierBankAccount`（新）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID required | PK | no | immutable |
| `tenant_id` / `organization_id` | UUID required | composite index `(organization_id, tenant_id)` | no | 来自命令 scope，不接受 payload |
| `supplier_id` | UUID required | FK → `purchasing_suppliers(id)` ON DELETE CASCADE + index | no | 同模块子行 |
| `beneficiary_bank` | text required | — | **yes** | 200 字符上限 |
| `account_number` | text required | — | **yes** | 120 字符上限 |
| `swift_code` | text nullable | — | **yes** | 32 字符上限 |
| `bank_address` | text nullable | — | **yes** | 500 字符上限 |
| `is_default` | boolean required default false | partial unique `(supplier_id) WHERE is_default` | no | 一个供应商最多一行默认；无标记时第一行自动默认 |
| `created_at` / `updated_at` | timestamptz required | — | no | 子行随父写 |

- 迁移：`yarn db:generate` 生成 `Migration*_purchasing.ts`（只建表/索引/外键），审阅后**由 owner 批准再应用**；现有租户需要 `yarn mercato entities seed-encryption --tenant <id>` 才物化加密映射。
- 加密映射：模块根 `src/modules/purchasing/encryption.ts`（entityId `purchasing:purchasing_supplier_bank_account`，四个字段）。
- 契约变化：`supplierCreateSchema`/`supplierUpdateSchema` 新增可选 `bankAccounts[]`（≤10 行，`bankAccounts` 缺席 = 不改items，`[]` = 清空；命名 id 更新、无名行新建、缺席行硬删——与 parties 同语义）。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST/PUT` | `/api/trade_docs/{contracts,documents,invoices}` | 既有 `trade_docs.*.manage` | 既有 schema + 方向↔类型一致、`counterpartyId` 归属 | 既有 201/200 + 事件 | 400 `counterparty_kind_direction_mismatch`、400 `counterparty_not_found`、既有的 409 | REQ-001, 006, 007 |
| `GET` | `/api/parties/options` | `parties.view`（不变） | 既有 query | `items[]` **新增 `roles: string[]`** | 既有 400/403（unknown role 仍 400） | REQ-002, 008 |
| `GET` | `/api/purchasing/suppliers/[id]`（新） | `purchasing.suppliers.view` | path id | `{ item: {…supplier, bankAccounts: [...] , updatedAt} }`（解密） | 404 未知/越权；403 无功能位 | REQ-003, 005 |
| `POST` | `/api/parties`（复用） | `parties.manage` | 既有 payload（`roles:['buyer']`、可选 `bankAccounts`） | 201 + `parties.party.created` | 400 校验、409 编码重复、403 | REQ-004 |
| commands | `trade_docs.contracts.{create,update}`、`trade_docs.documents.{create,update}`、`trade_docs.invoices.{create,update}` | — | 同上 | 事件不变 | 同上 | REQ-001, 006, 007 |
| commands | `purchasing.suppliers.{create,update}` | — | `bankAccounts[]` 子行 | 事件不变 | 400 两行默认/超 10 行；409 编码重复 | REQ-005 |

`counterpartyRefs` 校验实现：`src/modules/trade_docs/lib/counterpartyRefs.ts`，用 `em.getKysely()` 只读查询，supplier 查 `purchasing_suppliers`、customer 查 `parties_parties`，`deleted_at is null`，组织取调用者可读集合（命令 scope 已有则用之，否则所选组织），未知 → `badRequest('counterparty_not_found')`。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| 供应商银行块变更 | `purchasing.suppliers.update` | —（同事务子行替换） | 无新事件 | 与既有供应商事件同一次提交；乐观锁沿用父版本 |
| 内联新建客户 | `parties.parties.create` | 既有 `parties.party.created`（clientBroadcast） | 打开的选择器收到事件后刷新 | 幂等由 `code` 唯一约束兜底（重复 → 409） |

无新 worker、无定时任务、无缓存键变化（`trade_docs` 列表缓存失效逻辑不变；供应商详情是新增读路径，不参与 CRUD 列表缓存）。

## Security, Privacy, and Compliance

- **Authorization:** 新增按钮按 `parties.manage` 显示（`useBackendChrome()` 的 `payload.grantedFeatures` + `hasFeature`，chrome 未就绪时不隐藏），服务端 `POST /api/parties` 仍是 403 权威；供应商详情路由声明 `purchasing.suppliers.view`。
- **Tenant isolation:** `counterpartyRefs` 的查询带 tenant +**命令作用域（所选组织）**——不放大到可读集合；供应商列表新增 `organizationId` 收窄以与写作用域一致；供应商详情路由走既有 scope 解析，缺失组织 fail-closed。
- **Sensitive data:** 供应商银行四列进 `purchasing/encryption.ts` 加密映射；读取只经 `findWithDecryption`/详情路由；列表、选项源、搜索、导出一律不含银行字段；不建唯一索引/排序/LIKE。**两条明说的边界**：①单据的对方快照（`trade_docs` jsonb，明文）按既有 `our_party_snapshot` 口径保存**打印文本**（`bank` 合并串 + 来源 `bankAccountId`）——双方签字的纸面本来就印着该账号，主数据仍是加密的唯一真源；②供应商 update 命令的 undo 快照携带银行行（`action_logs` 的 `command_payload`），与 `parties` 同一实现口径，是 undo 能精确重建上一版银行块的代价。
- **Abuse and failure modes:** 未知/越权 `counterpartyId` → 400 而不是静默接受；两行默认 → 400（部分唯一索引兜住并发）；客户编码枚举受 `parties` 既有 ACL 与 409 保护；对话框不做静默重试。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration (API) | 一租户两组织、供应商、客户、分公司档案 | 建合同：purchase+supplier 201；purchase+customer 400；sales+customer 201；sales+supplier 400；`counterpartyId` 指向另一命名空间 400 | 状态码 + 落库 `counterparty_kind` + 无部分写入 | REQ-001, 006 |
| TEST-002 | integration (API) | CI 草稿 | `PUT` 把 CI 的 `direction` 改成 `purchase` | 400，状态与字段不变 | REQ-007 |
| TEST-003 | integration (API) | 供应商 + 两行银行（一行默认） | 建/改供应商、读详情、另一组织读 | 201/200、默认唯一、两默认 400、列表/选项不含银行字段、跨组织 404/403 | REQ-005 |
| TEST-004 | integration (encryption) | 初始化租户 + 加密映射 | 经真实写路径建供应商银行行，裸 SQL 读列 | 密文落库、API 明文回读、映射已注册 | REQ-005 |
| TEST-005 | integration (API) | `buyer`/`branch`/`forwarder` 三个档案 | `GET /api/parties/options?roles=buyer,branch` | 返回项带 `roles`，forwarder 不出现，未知角色仍 400 | REQ-002, 008 |
| TEST-006 | UI (browser) | dev server + 一客户一供应商 | 打开合同表单切换方向、选对方、看回填与银行；打开新增客户对话框建一个客户并选中；用只读/无 `parties.manage` 账号打开同一表单 | 销售方向只出现分公司/外部客户两类前缀、供应商不出现；银行自动回填且编辑回读同一形状；对话框成功选中；无权限时按钮降级为提示且 `POST /api/parties` 403；窄屏/暗色无布局问题 | REQ-002…004 |
| TEST-007 | integration (API) | 一张**旧快照形状**（仅 `{name,address,contact,bank}`）的合同草稿 | `PUT {id, notes}` 后回读 | 旧键原样保留、新键不凭空写入、行与方向不变 | REQ-003, 008 |

## Implementation Phases

### Phase 1 — 方向联动 + 命名空间校验（服务端 + 选择器）

- **Depends on:** none
- **Outcome:** 任何入口都无法造出方向与对方类型不一致的单据；表单里对方列表只出现该方向合法的主体，且来源可辨。
- **Why this order / value delivered:** 这是其余回填/新建功能的地基（选择器要先知道自己在选谁），且单独就是一个可交付的缺陷修复。
- **Deliverables:**
  - `trade_docs/data/validators.ts`：三套 create/update 的方向↔类型规则 + CI 商业发票 update 守卫。
  - `trade_docs/lib/counterpartyRefs.ts`（新）+ `commands/{contracts,documents,invoices}.ts` 接入。
  - `trade_docs/components/CounterpartyPicker.tsx`（新 bare group）+ `formOptions.ts` 拆分供应商/客户加载器（客户侧传 `roles=buyer,branch`）+ 四张表单替换既有 `counterpartyKind`/`counterpartyId` 字段。
  - `parties/api/options/route.ts` + openapi：响应项新增 `roles`。
  - i18n（zh/en）与单元测试（validators）。
- **Independent slices / estimated commits:** (a) 校验与命令；(b) 选择器与表单；(c) options `roles` + 测试。
- **Requirements closed:** REQ-001, REQ-002（过滤与标签）, REQ-006, REQ-007, REQ-008（`roles` 部分）
- **Tests:** TEST-001, TEST-002, TEST-005
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test src/modules/trade_docs src/modules/parties`
- **Exit gate:** 上述测试全绿；`curl` 实测四种方向×类型组合与 CI 改方向 400；浏览器实测合同表单切换方向时列表来源正确、标签带前缀。

### Phase 2 — 主数据回填 + 客户内联新建

- **Depends on:** Phase 1 exit gate
- **Outcome:** 选中对方即得到打印抬头与银行账户；销售方向可在表单里建出客户并立即使用。
- **Why this order / value delivered:** 依赖 Phase 1 的选择器结构；让「主数据」真正成为单据的数据来源。
- **Deliverables:**
  - `formOptions.ts`：客户侧复用 `loadPartyDetail` + 银行账户选项；**供应商侧回填在 Phase 3**（依赖供应商详情读），本阶段不写 stub。
  - `CounterpartyPicker`：选中 → 回填 name/address/contact + 银行账户选择（默认优先），写 `bankAccountId/beneficiaryBank/accountNumber/swiftCode`。
  - `components/CustomerQuickCreateDialog.tsx`（新）：编码/名称/国家/联系人/电话/邮箱/一行银行；`createCrud('parties', …)`；409/400 就地提示；成功后 `onCreated(id)`。
  - 权限降级（`parties.manage`）与 i18n。
- **Independent slices / estimated commits:** (a) 回填与快照；(b) 对话框与权限降级。
- **Requirements closed:** REQ-003（客户侧）, REQ-004, REQ-008（快照兼容）
- **Tests:** TEST-006（浏览器）
- **Validation:** 同上 + `yarn jest src/modules/trade_docs`
- **Exit gate:** 浏览器实测：选客户回填抬头与银行；新建客户后自动选中并保存成功；无 `parties.manage` 的账号看到降级提示。

### Phase 3 — 供应商银行主数据与采购侧回填

- **Depends on:** Phase 1 exit gate（与 Phase 2 可并行）
- **Outcome:** 供应商可维护多银行账户（加密），采购单据的对方块与银行由主数据带出。
- **Why this order / value delivered:** 数据面必须先有加密子表与详情读，UI 才能回填；供应商编码/列表契约保持不动。
- **Deliverables:**
  - `purchasing/data/entities.ts` + `validators.ts` + `commands/suppliers.ts`（子行替换）+ `encryption.ts`（新）+ `api/suppliers/[id]/route.ts`（新）+ openapi。
  - `purchasing/components/SupplierBankAccountsEditor.tsx`（新）+ 供应商表单接入 + i18n。
  - `trade_docs/formOptions.ts` 的 `loadSupplierDetail`/银行选项 + `CounterpartyPicker` 供应商侧回填。
  - 迁移（`yarn db:generate` 生成、审阅、**不 apply**）。
- **Independent slices / estimated commits:** (a) 实体/迁移/命令/加密；(b) 详情路由 + 表单；(c) trade_docs 供应商回填。
- **Requirements closed:** REQ-003（供应商侧）, REQ-005
- **Tests:** TEST-003, TEST-004
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test src/modules/purchasing` + `yarn test:integration:ephemeral`（供应商银行与 trade_docs 合同两组 spec）
- **Exit gate:** 集成测试全绿（含密文断言）；供应商表单两行默认被拒；合同表单选中供应商回填名称与银行。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001/J-002/J-004，四张表单 | validators + commands | Phase 1 | TEST-001 | AC-001 |
| REQ-002 | J-001/J-002，`CounterpartyPicker` | `/api/purchasing/suppliers`、`/api/parties/options?roles=…` | Phase 1 | TEST-005, TEST-006 | AC-002 |
| REQ-003 | J-001/J-003 | `/api/parties/{id}`、`/api/purchasing/suppliers/{id}`、快照键 | Phase 2/3 | TEST-003, TEST-006 | AC-003 |
| REQ-004 | J-001 | `POST /api/parties` + 对话框 | Phase 2 | TEST-006 | AC-004 |
| REQ-005 | J-003 | 新表/命令/详情路由/加密映射 | Phase 3 | TEST-003, TEST-004 | AC-005 |
| REQ-006 | J-002 | `counterpartyRefs` | Phase 1 | TEST-001 | AC-006 |
| REQ-007 | J-004 | documents update 守卫 | Phase 1 | TEST-002 | AC-007 |
| REQ-008 | 全部 | options 响应 additive、快照 additive | Phase 1/2 | TEST-005, TEST-007 | AC-008 |

## Migration & Backward Compatibility

依据 [`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`](../../guides/upstream/BACKWARD_COMPATIBILITY.md)。本 spec 触及的契约面全部是**追加式**，没有任何移除/重命名，因此不需要弃用窗口或 `UPGRADE_NOTES.md` 条目：

| Surface | Nature of change | Compatibility note |
|---|---|---|
| `GET /api/parties/options` 响应项 | 追加 `roles: string[]` | 既有消费方只读 `value`/`label`；未知角色仍 400（不变） |
| `GET /api/purchasing/suppliers` 查询参数 | 追加可选 `organizationId` | 省略时行为与今天逐字节一致（可读集合展开） |
| `GET /api/purchasing/suppliers` 响应项 | **不变**（银行字段不进列表） | — |
| `GET /api/purchasing/suppliers/[id]` | 新路由 | 新表面，无兼容义务 |
| `purchasing_suppliers` 请求体 | 追加可选 `bankAccounts[]` | 省略 = 不改items；显式 `[]` = 清空 |
| `trade_docs` 三套 create/update schema | **收紧**：冲突的 `direction`/`counterpartyKind` 组合、未知/越权 `counterpartyId` 由 201 变 400；update 不再重放创建默认值 | 前者是修正非法态（dev 库 0 条受影响行）；后者修复的是「`PUT {id,notes}` 清空行」的缺陷，属缺陷修复而非契约收紧 |
| `trade_docs` 对方快照 jsonb | 追加 `bankAccountId`（仅从主数据选定时） | 旧快照原样可读（TEST-007） |
| DB schema | 新表 `purchasing_supplier_bank_accounts` + 索引 | 纯追加；不动既有表/列/索引 |
| ACL / 事件 / DI / widget / CLI / AI ID | 无变化 | — |

## Rollout, Migration, and Rollback

- 迁移只含建表/索引/外键；先生成与审阅，**应用需 owner 批准**（本 spec 的实现 PR 不 apply）。
- 现有租户启用加密：`yarn mercato entities seed-encryption --tenant <id>`（随部署文档记录）。
- 兼容桥：`counterpartyKind` 继续入库；旧快照无需迁移（新键只在有主数据来源时写）；旧单据编辑时会命中新校验——本机 dev 库已确认 0 冲突，部署前用同一 SQL 复查生产库。
- 回滚：移除新表单组件与新子表（迁移向前-only，数据保留）；校验回滚即回到当前行为（无数据升级步骤）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 生产库存在方向/类型不一致的历史行 | 编辑时报 400 | 部署前跑 `group by direction, counterparty_kind` 复查；不一致行给出脚本修数（单独批准） | 未知环境仍未核对 |
| 严格 `counterpartyId` 归属校验 | 编辑历史单据时若指向已删/越权主体 → 400 | dev 库实测 0 条非空 id；错误信息点名命名空间，便于修复 | 已删供应商的历史单据需要重新选择 |
| 加密列不能检索 | 服务器端按银行账号搜索不可行 | 只按 id 读取；搜索走 `code`/名称（供应商名称未加密） | 无 |
| 内联新建增加 `parties.manage` 依赖 | 无权限账号少一条快捷路径 | 降级为链接 + 提示；服务端权威 | 无 |
| 对话框客户编码手工填 | 操作员可能重码 | 409 就地提示；自动发号单独立项 | 无 |

## Acceptance Criteria

- [x] **AC-001** — 四个方向×类型组合在 API 层分别 201/400（集成 `counterparty-linkage` 断言，13 passed）。
- [x] **AC-002** — 合同表单：采购只出现供应商、销售只出现分公司/外部客户（浏览器实测：销售侧只列出 `分公司：RU-AB`/`SEA-AB`；被收紧的 `roles=buyer,branch` 保证服务方不出现）。
- [x] **AC-003** — 选中对方后抬头三字段与银行（默认账户优先）自动回填（浏览器实测：选客户/供应商后名称、联系人、银行账户与银行文本均回填；账户 id 入快照，编辑页从快照回读）。
- [x] **AC-004** — 持 `parties.manage` 可在合同表单内建客户并自动选中（浏览器实测 + flash「客户已创建并选中」）；无权限时按钮降级为提示、服务端 `POST /api/parties` 仍 403（按钮门禁按 chrome `grantedFeatures`，服务端权威未变）。
- [x] **AC-005** — 供应商可维护多银行账户、默认唯一（集成断言：两默认 400、部分唯一索引兜并发、两边界切换默认值）；列存密文（集成裸 SQL 断言）、接口回明文；列表/选项不含银行字段（集成断言）。浏览器实测编辑页银行块回读正常。
- [x] **AC-006** — 未知/跨命名空间的 `counterpartyId` 一律 400（集成断言）；跨组织由同一 scoped 查询（tenant + `scope.organizationId`）保证。
- [x] **AC-007** — CI 的 update 无法改成非销售方向（集成断言 400 且方向不变）。
- [x] **AC-008** — 既有单据读取/列表/打印不受影响（旧快照形状集成断言原样保留；全量 `yarn test` 与既有集成套件全绿）。
- [x] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [x] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes（UI 面为浏览器实测，见 PR #35 截图）。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`（路由/交付门）、`om-module-scaffold`（+api-and-domain/module-surfaces/verification）、`om-data-model-design`（+sensitive-data）、`om-backend-ui-design`、`.ai/guides/{contracts,backend-ui,spec-delivery}.md`、`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`（见上节） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Traceability 表逐行对应 |
| Every workflow completes end to end without a catch-all integration phase | pass | 三个 phase 各自闭环 |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用 parties/purchasing 主数据、既有 CRUD/命令与 parties 的银行编辑器 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 见 UI 表与 wireframe（`CrudForm` bare group + `ComboboxInput`/`Dialog`） |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | 见 Phase 1–3 |
| 顺带修复的既有缺陷已记录 | pass | `.partial()` 重放创建默认值（清空行）——见 Problem Statement 6、Phase 1 deliverables 与 Changelog |

Verdict: **Ready for implementation**。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 客户编码是否改为系统发号？ | 业务 | no | 本轮手工填（可逆默认）；自动发号单独立项 |
| Q-002 | 银行数据是否要独立权限位？ | 业务/技术 | no | 本轮沿用 `parties.view`；如需拆分单独立项 |
| Q-003 | 供应商银行账户是否需要「停用」状态？ | 业务 | no | 本轮只做增删与默认（与 parties 同语义） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-29 | Initial draft（依据 owner 2026-09-29 四项决策：方向联动并锁定 + 服务端校验 / 一个实现两种贸易类型（另一 spec）/ 内联新建客户 / parties 回填 + purchasing 加密银行块） |
| 2026-09-29 | **交付并验证**：Phases 1–3 实现完成（PR #35）。评审后又修两处交付缺陷：①供应商编辑页的详情请求用了页面相对路径（`readApiResultOrThrow` 不会补 `/api/`），页面永远渲染「加载失败」、银行块不可达——改为绝对 `/api/purchasing/suppliers/{id}` 并浏览器复验；②`documents/invoices.copy-from` 仍照搬来源的 `counterpartyKind`，跨方向复制后下一次编辑会被新校验 400——两个复制命令改为按**目标单据方向**推导类型（来源不一致时不复制对方，行与币种照常），并加集成回归。两处都补了测试口径。 |
| 2026-09-29 | 评审修订：①记录并修复 `.partial()` 重放创建默认值的既有缺陷（update 契约改为默认无关，命令推导 `counterpartyKind`）；②`counterpartyId` 校验收回到命令作用域，并为供应商列表加 `organizationId` 收窄；③银行编辑器改为复用 parties 实现；④补 Migration & Backward Compatibility 一节与 TEST-007（旧快照回读）；⑤明确快照/审计中的明文银行文本边界与选择器对解析不到的存储 id 的种子选项 |
