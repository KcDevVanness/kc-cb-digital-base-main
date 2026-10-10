# Product Code Suggester on the Single Store（商品编码建议器）

**Date**: 2026-10-10
**Status**: Draft — 本规格是 `.ai/specs/2026-10-10-catalog-single-store.md` 拆出来的那个切片
（该 spec 的 Q1「SKU 发号另立」与 Phase 4）。唯一的闸门问题标 ⚠，owner 点头后转 `Ready for implementation`；
未点头前不写代码。

> **前提**：本规格在**单一存储改造合入之后**实施（[`.ai/specs/2026-10-10-catalog-single-store.md`](2026-10-10-catalog-single-store.md)，
> PR #171）。正文引用的路径与行号都按**改造后的树**（`feat/catalog-cutover-phase1`）标注——在 `dev` 上这些文件尚未删除或改名
> （例如 `product_codes/{api,commands,backend,components}` 仍在、`products/data/validators.ts` 的字符集还没对齐）。
> 这不是笔误，而是取证口径：本规格描述改造之后的系统。
>
> **它继承/修订的东西**：`.ai/specs/2026-09-24-supplier-product-code-rules.md`（已 superseded：规则表、台账、发号、解析已删除，
> 但它的「三态解析」「旧码别名」教训仍被引用）、`docs/dev/business-conventions.md` C-37。
> 供应商编号 `SUP-####`（`2026-09-24-supplier-code-issuance.md`）不在范围内，它一直活着。
>
> **只做一个能力**：建议器（一条命令 + 一个表单控件）。「改码时登记旧码别名」是与本规格无共享契约的第二个能力，
> 已拆到 [`.ai/specs/2026-10-10-product-alias-on-rename.md`](2026-10-10-product-alias-on-rename.md)。

## TLDR

把 2026-10-10 停掉的产品编码**发号**以**建议器**的形态请回来：商品表单的「商品 SKU」里恢复「品牌 + 类别 → 生成」，
生成的码**只是建议**（可改、可无视、可继续手输旧码），落库仍经既有的 `products.items.*` → `catalog_products.sku`；
序号从**本组织已有编码扫描推导**（商品 + 变体 + 旧码别名三类来源，不建台账、不建规则表，照 `purchasing/commands/suppliers.ts`
的 `SUP-####` 先例）。不恢复的：规则表、发号台账、`/parse` 三态拆解、字典值冻结、任何形式的拦截。

## Problem Statement

单一存储改造把发号机制整体停用是**有意的**（该 spec 的 Q5「SKU 全手填；发号器停用」），它留下四个可观测的后果：

1. **工具没了，纪律没补上**：品牌/类别字典还在播种（`product_codes/setup.ts`、`product_codes/README.md` 的字典播种行），
   却没有任何消费者——操作员拿到 PK/CL 两个码表，却只能自己拼 `PK-CL001`。
2. **改码的门槛被低估**：SKU 的字符集规则在树里有三份拷贝——`products/data/validators.ts:89`（catalog 口径）、
   `sourcing/lib/skuDerivation.ts:29`（已把供应商的 `/` 映射成 `-`）、`sourcing/data/validators.ts:93`
   （2026-10-10 才跟上，此前仍收斜杠）。不合规的输入要等到保存才知道（`products.items.update:240-247` 只校验**变化后**的值）。
3. **迁移期的码还在流通**：`purchasing_supplier_products.supplier_sku`（`purchasing/data/entities.ts:508-510`，唯一键含软删）、
   单据快照里的 `sku`（`trade_docs/lib/productSnapshots.ts:14-16`）与纸面单据上印的旧码不会因为停用发号而消失，
   所以「生成一个新码」与「沿用旧码」必须同时被支持。
4. **编码出现在印刷面**：采购单行快照（`purchasing/commands/orders.ts:292-338`）、合同/单据/发票行（`trade_docs/data/entities.ts:171-181`）、
   发运分摊与装箱单（`cross_border/data/entities.ts:139-149`）、财务的 SKU 口径（`finance/lib/costResolver.ts:133`）——
   所以建议器只影响**新建/未保存**的码，历史快照永不重写。

**证据口径**：以上锚点取自 2026-10-10 的一次只读取证（退役表面、现存消费者 60+ 处 `path:line`、别名表读写方）。

## Overview and Success Measures

- **Primary outcome:** 新建/改档商品时，多数新商品由「品牌+类别」一键得到**合法且唯一**的 SKU 建议。
- **Leading indicators:** 建档时字符集/唯一性 400/409 的次数；「生成」被点击后同一表单内完成保存的比例。
- **Baseline:** `unknown — measurement plan`：先记录一个迭代内商品建档/改档的 400/409 次数与手输码比例，作为之后对比的基线。
- **Market / product reference:** 主流 ERP 把编码生成做成**可选建议**而非闸门（Odoo 的 sequence 可被手工覆盖；SAP 允许外部编号）。
  本规格采纳「建议 + 可覆盖」，**拒绝**台账（平台已有 audit 与别名表）与强制校验（owner 2026-09-24 的口径「生成后也可以自定义修改…只是一个工具」）。

## Goals

- **REQ-001** — 提供 `POST /api/products/items/suggest-code`（命令 `products.items.suggest-code`）：入参
  `{ brand?: string, category?: string, name?: string }`，出参 `{ code, breakdown, brandCode, categoryCode }`；
  **只读不写**，业务性缺失（字典缺条目、无品牌、序列不适用）不返回 4xx，而是 `code: null` + `reason`。
- **REQ-002** — 商品表单「商品 SKU」字段内恢复生成控件：品牌（字典 `product_brand`，默认取商品现有品牌，否则表单上次选择）+
  类别（字典 `product_category`）+ 「生成」；生成结果只填进 SKU 输入框，字段仍可任意编辑，生成不触发保存。
- **REQ-003** — 序号按**扫描推导**：在调用组织内，取 `catalog_products.sku`、`catalog_product_variants.sku` 与
  `product_codes_aliases.alias_code` 中形如 `{品牌码}-{类别码}{NNN+}` 的码，最大序号 +1；三位起步、超 999 进位四位。
  保存时若撞码，既有唯一索引给 409，界面提示「已被占用，重新生成」（不自动重试写库）。
- **REQ-004** — 生成器只认字典里的码：品牌码/类别码必须存在于对应字典（缺码 → `reason: 'brand_missing' | 'category_missing'`）；
  字典没有的码**不**生成，但**不影响手输**（手输本来就不查字典）。
- **REQ-005** — 权限沿用 `products.items.view`，不新增 feature；作用域 = 调用者当前组织，跨组织 403。
- **REQ-006** — 生成的码必须满足 `SKU_PATTERN`（与 catalog 同字符集）；手输码的校验时机与今天一致（保存时）——
  本规格**不**给手输路径加新的即时校验，也不改保存路径。

## Non-goals

- **不恢复**规则表（`product_codes_rules`）、发号台账（`product_codes_ledger_entries`）、`/api/product_codes/parse`
  三态拆解、字典值冻结拦截器、规则后台页——它们已在单一存储改造中删除。
- **不做拦截**：没有"必须用生成的码"。
- **不改码写别名**：改码登记旧码别名是本规格之外的能力（见 `2026-10-10-product-alias-on-rename.md`）；
  本规格对别名表**只读**（序号推导把已退役的别名算进去，避免重发别人用过的旧码）。
- 不自动为**变体**生成码；不改动 `SUP-####` 供应商编号。
- 字典口径不变（`product_brand` / `product_category` 由 `product_codes/setup.ts` 幂等播种、业务在字典库维护）——
  这是**现状陈述**，不是本规格要实现的变更。
- 不做历史数据回填/批量重编号；**不新建表、不写迁移**；不引入新依赖。

## Proposed Solution

两件小东西，都落在既有 seam 上：

1. **建议器命令 + 手写路由**（`products` 模块，与 `/api/products/items/distribute` 同一种形态）：
   `products.items.suggest-code` 纯读计算——字典取品牌/类别码 → 扫描三类来源推导序号 → 返回 `{code, breakdown}`。
   放在 `products` 而不是 `product_codes`：SKU 是商品字段、消费者是商品表单，而 `product_codes` 只剩别名与字典播种
   （`product_codes/README.md` 的「放 / 不放」）。
2. **表单控件**（`products/components/ProductForm.tsx` 的 SKU 字段，`type: 'custom'`）：`品牌` + `类别` 两个下拉 + 「生成」，
   生成后只写输入框，下方一行拆解（`品牌(码) · 类别(码) · 序号`）。品牌/类别任一为空或字典无条目时按钮禁用并说明原因。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 建议器：只建议、不拦截 | owner 2026-09-24 的原始口径（「只是一个工具」）；手输旧码/供应商码是既成事实 | 在 `productCreateSchema` 里强制生成规则 | 直接推翻 Q5 的手输决定，且会让既有单据/库行无法建档 |
| 序号**扫描推导**，不建台账 | 仓内先例：`purchasing/commands/suppliers.ts:336-343` 的 `SUP-####` 就是「扫本组织取最大 +1 + 有界重试」；无新表、无迁移，回滚=还原分支 | 恢复 `product_codes_ledger_entries` append-only 台账 | 台账解决的是审计与"永不重编"，而平台侧已有 audit 与别名表；为一个建议器恢复一张表不值得（这也是本规格最大的 scope 争议点，见 Q2） |
| 命令放 `products`，对 `product_codes` 只读 | SKU 是商品字段；对别名表只需要一处 scoped 投影读（与 `aliasLookup` 同法），避免依赖方向变坏 | 把建议器放进 `product_codes` | 会让 `product_codes` 反向依赖 `products` 的目录读 |
| 生成控件放回 SKU 字段内部 | 2026-09-24 已按 owner 反馈定型为「一个卡片、生成器在字段里」（`2026-09-24-supplier-product-code-rules.md` 的 Changelog 行） | 顶部工具栏放生成按钮 | 会被读成与 SKU 字段无关的全局动作 |
| 撞码：不自动重试 | 建议器只产生**建议**；写库的 409 由操作员重新生成解决，避免系统替业务决定"下一个号" | 命令内自动 +1 重试直到写成功 | 并发下会漂号，且让 409 失去意义 |
| 只做三位起、不做可配置宽度/年段 | 现有字典与既有码都是 `PK-CL001` 形状；此业务年商品量远小于 999 | 引入可配置宽度/年段 | 无需求证据；需要时再开 spec |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 商品 SKU | 我方编码，组织内唯一（活行），字符集 `^[A-Za-z0-9._\-]{1,64}$`，写 `catalog_products.sku`（建档同时复制到默认变体） | `catalog_products`（经 `products/lib/store.ts`） | 重复 → 409；非法 → 400 |
| 供应商货号 | 供应商表格上印的号，**不是**我方编码；存在库行上 | `purchasing_supplier_products.supplier_sku` | 重复 → 409 |
| 建议码 | `{品牌码}-{类别码}{3 位序号}`；**只是建议**，无写入、无占用 | `products.items.suggest-code` | 字典缺条目 → `code: null` + reason，不报错 |
| 序号 | 本组织内匹配同一 `{品牌码}-{类别码}` 前缀的最大序号 +1；来源 = 商品、变体、旧码别名 | 扫描推导（无表） | 扫描读失败 → 503 语义，UI 仍可手输 |
| 品牌码 / 类别码 | 字典值（`product_brand` / `product_category`）的 `value`；字典 label 是纯显示名 | 字典库（`product_codes/setup.ts` 播种） | 字典无条目 → 生成按钮禁用（手输不受影响） |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 商品维护者（采购/商品） | 取建议码、按其意愿填写 SKU | 当前组织（缺组织 fail closed） | `products.items.view` |
| 字典管理员 | 维护品牌/类别词表 | 当前组织（既有字典库规则） | `dictionaries.*`（不新增） |
| 只读角色 | 看商品与其编码 | 当前组织 | `products.items.view` |

`tenantId`/`organizationId` 一律来自请求上下文（`resolveProductRouteScope`，缺组织 400 fail closed）；
建议器不读跨组织数据，扫描范围与唯一键范围一致。系统作用域：无。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 商品身份与 SKU 落库 | reuse | `catalog`（经 `products/lib/store.ts`） | 官方命令（scoped 读写） | 单一存储改造后的唯一存储 |
| 建议器命令 | app-own | `products` | 新命令 + 手写路由 | SKU 是商品字段，消费者是商品表单 |
| 品牌/类别字典 | reuse | `dictionaries`（`product_codes` 播种） | 字典库读 | 已存在且已在维护 |
| 序号来源（商品/变体/别名） | reuse（只读） | `products/lib/store.ts` + `product_codes/lib/aliasLookup.ts` | scoped Kysely 投影 | 与既有别名读同一种读法 |
| 审计 | reuse | 官方 catalog 命令的 audit | — | 不为建议器做第二套审计 |

## Architecture and Data Flow

```text
操作员(商品表单) --POST /api/products/items/suggest-code--> products.items.suggest-code
                                                              |-- 读字典 product_brand / product_category
                                                              |-- 扫描 catalog_products.sku / catalog_product_variants.sku
                                                              |   + product_codes_aliases.alias_code（本组织，只读）
                                                              '--> {code, breakdown}（不写库）
（保存仍走既有 products.items.create|update → catalog.products.*；本规格不改这条路径）
```

- **Module boundaries:** 建议器与商品写路径都在 `products`（一个不变量：商品字段）；对 `product_codes` 只有一处**只读**依赖。
- **Extension points:** 表单控件走 `CrudForm` 的自定义字段（既有做法）；建议器走手写路由 + 命令总线。
- **Alternatives considered:** 把建议器做成 AI 建议（无训练信号、延迟不可控、owner 没要求）——不做。
- **Compatibility:** 新路径是新增；不改任何既有契约；SKU 字符集与唯一性规则不变。

## User Journeys

### Journey J-001 — 新产品建档拿到建议码

1. 操作员在 `/backend/products/items/create` 填「商品标识」：品牌选 `PK — PetKit`、类别选 `CL — 猫砂`。
2. 点 SKU 字段里的「生成」→ `POST /api/products/items/suggest-code` → 输入框出现 `PK-CL004`，下方一行拆解。
3. 直接保存 → 既有 `products.items.create` → catalog 建档成功，列表可见。
4. 失败：字典缺类别 → 按钮禁用并说明「字典 `product_category` 没有可用条目」；读失败 → 提示可重试，输入框仍可手输。

### Journey J-002 — 沿用供应商旧码

1. 操作员手输 `P4108-UVC`（供应商侧既有码）→ 保存成功（字符集合法、组织内唯一）。
2. 之后任何时候点「生成」都会覆盖输入框内容——**不自动保存**；不保存即离开即可放弃。

### Journey J-003 — 序号跳过已退休的旧码（本规格内）

1. 商品 A 曾经是 `PK-CL004`，后来改名成 `PK-CL010`，旧码进了别名表（别名写入是另一份 spec 的能力）。
2. 新建商品 B，品牌/类别同为 PK/CL → 扫描把 `PK-CL004` 也算作"已用过"，给出 `PK-CL005`，不重发别人用过的旧码。
3. 失败：别名表读失败 → 503 语义的可读文案，UI 仍可手输（不阻塞建档）。

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/products/items/create` · `/edit` | SKU 字段内「品牌 + 类别 + 生成」+ 拆解行 | `POST /api/products/items/suggest-code` + 字典读（保存走既有 `products.items.*`） | 该字段 2026-09-24 的形态（已删除的 `SkuPanel`；现由 `CrudForm` 自定义字段承载） | `CrudForm` + `Select`/`Input`/`Alert`（语义 token） | 默认、生成中、生成成功、字典空、读失败、生成后被手改 | REQ-001, REQ-002, REQ-004, REQ-006 |
| `/backend/products/items`（列表） | 按 SKU/名称搜索（**既有**能力，本规格不改） | `GET /api/products/items?search=` | 同页现有搜索框 | `DataTable` | 命中、无结果 | — |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 商品维护者 | MASTER DATA → Products（既有） | 既有 widget 不改 | 登录 → Products → 新建 → 填品牌/类别 → 生成 → 保存（≤3 点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| SKU 字段的生成控件 | 字典为空/未选品牌：按钮禁用 + 一行说明「选品牌与类别后可生成」 | 窄屏：品牌与类别下拉各占一行，生成按钮与输入框可换行 | Tab 顺序 = 品牌 → 类别 → 生成 → SKU 输入；生成后焦点留在 SKU 输入并以 `aria-live="polite"` 播报拆解 |

- **Behavior:** 生成只改输入框值（不触发保存、无对话框）；保存仍走既有校验与乐观锁 409 流程。
- **Localization:** 键落 `products.*`（如 `products.items.form.sku.generate`、`…sku.breakdown`、`…sku.dictEmpty`），
  zh/en 两份字典逐键一致；字典 label 只做显示名（`CODE — 名称` 由选择器拼）。
- **Design-system and theming:** 只用语义 token 与共享组件；浅深色与窄屏由 `ds:check` + 浏览器冒烟覆盖。

## Data Models

**不新增实体、不写迁移。** 复用的表：

| 表 | 用途 | 生命周期与规则 |
|---|---|---|
| `catalog_products.sku` / `catalog_product_variants.sku` | 编码的唯一性来源与扫描来源 | 唯一键（同租户 + 组织）；删除商品即释放 |
| `product_codes_aliases` | 旧码 → 目标记录（`target_kind='product'`） | **本规格只读**（序号来源之一）；写入方是另一份 spec；append-only、不参与 SKU 唯一性 |
| `dictionaries` / 字典条目 | 品牌码与类别码 | 组织级、父组织继承；insert-only 播种 |

## API, Command, and Error Contracts

```text
POST /api/products/items/suggest-code     requireFeatures: products.items.view
  body:    { brand?: string, category?: string, name?: string }   （brand/category 为字典 value）
  result:  { code: string | null, reason?: 'brand_missing' | 'category_missing'
             | 'dictionary_empty' | 'sequence_unavailable', breakdown?: { brand, category, sequence },
             brandCode?: string, categoryCode?: string }
  200 即使 code 为 null（建议器不报错）；401 未登录；403 跨组织/缺 feature；
  503 扫描读失败（带可重试文案，绝不当成"没有候选"静默处理）
```

## Events, Jobs, Notifications, and Cross-Module Flows

- **不新增事件、不订阅任何事件**：建议器是同步只读命令；保存仍走既有商品命令路径。
- 不新增作业/通知/队列。

## Security, Privacy, and Compliance

- 无 PII；不新增加密字段。作用域：只读当前组织的字典与编码（fail closed）。
- 日志：读失败记 `products` 的 warn（组织、原因），不记自由文本。

## Integration Coverage

| 用例 | 类型 | 断言 |
|---|---|---|
| TEST-001 | unit | 建议器纯函数：前缀匹配/序号推导/三位进位到四位/前缀与字典码等长无关（`PK-CL`、`SP-TP`）/非法输入不接受 |
| TEST-002 | integration | `POST /api/products/items/suggest-code`：空字典 → `code:null` + reason；正常 → `PK-CL004`；跨组织 403；缺 feature 403 |
| TEST-003 | unit | 扫描把别名表算进"已用过"：`PK-CL004` 只存在于别名表时建议为 `PK-CL005`；别名读失败 → 503 语义（不静默跳过）|
| TEST-004 | integration | 并发/重复：同一建议码被两个商品占用时第二个 create 409，重新生成得到下一个序号 |
| TEST-005 | unit | 建议码串经 `SKU_PATTERN` 校验通过（含 4 位进位形态），与 catalog 默认变体复制路径一致 |

## Implementation Phases

### Phase 1 — 建议器命令 + API

- **Depends on:** 单一存储改造已合入
- **Outcome:** `products.items.suggest-code` 可用，返回合法且唯一的建议码（或 null + reason）
- **Deliverables:** 命令 + 手写路由（含 `metadata`/`openApi`）+ 扫描纯函数 + 单测
- **Requirements closed:** REQ-001, REQ-003, REQ-004, REQ-005, REQ-006（建议器的全部行为）
- **Validation:** `yarn typecheck && yarn lint && yarn test src/modules/products`（TEST-001/003/005）；
  TEST-002 与 **TEST-004** 走 `yarn test:integration:ephemeral`
- **Exit gate:** TEST-001/002/003/004/005 绿；跨组织 403；字典空返回 reason 而非报错；撞码路径有 409 断言

### Phase 2 — 表单控件

- **Depends on:** Phase 1
- **Outcome:** 商品表单 SKU 字段内可生成建议码（记住上次选的品牌/类别）
- **Deliverables:** `ProductForm` 自定义字段 + i18n（zh/en 同键集）+ 键盘/`aria-live` 行为
- **Requirements closed:** REQ-002（界面呈现；其底层契约属 Phase 1）
- **Validation:** `yarn ds:check` + 浏览器冒烟（浅/深色、窄屏、键盘、字典空）
- **Exit gate:** 生成→保存→列表可见；手输旧码保存成功；字典空时按钮禁用且说明原因

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001 | `products.items.suggest-code` | 1 | TEST-001, TEST-002 | AC-001 |
| REQ-002 | J-001/J-002 | 表单字段（无新契约） | 2 | 浏览器冒烟 | AC-002 |
| REQ-003 | J-001/J-003 | 扫描推导（含别名只读；无新表） | 1 | TEST-001, TEST-003, TEST-004 | AC-003 |
| REQ-004 | J-001 | 字典读（缺码不给建议） | 1 | TEST-002 | AC-004 |
| REQ-005 | 全局 | `metadata.requireFeatures` | 1 | TEST-002 | AC-005 |
| REQ-006 | J-001 | `SKU_PATTERN` | 1 | TEST-005 | AC-006 |

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 扫描推导在并发下撞号 | 保存 409，操作员需重新生成 | 唯一索引兜底 + 可读提示；不做自动重试 | 高峰并发下的操作摩擦 |
| 别名表读失败 | 给不出候选（503 语义） | 明确失败语义（不静默跳过）；手输不受影响 | 极端读故障下的操作摩擦 |
| 建议器被误读为强制 | 用户以为必须用生成的码 | 文案明说「建议，可改」；字段始终可编辑 | 习惯性依赖 |
| 三位序号用尽 | 第 1000 件同前缀商品需要四位 | 进位规则明确（四位起，TEST-001/005 覆盖） | 极长前缀的显示宽度 |
| 对 `product_codes` 的只读依赖 | 别名表结构变化会波及扫描 | 一处投影、一个测试；写侧在另一份 spec | 跨模块表结构漂移 |

## Acceptance Criteria

- [ ] **AC-001** — 命令返回 `{品牌码}-{类别码}{NNN}` + 拆解；未选品牌/类别时 UI 按钮禁用并给出原因。
- [ ] **AC-002** — 生成结果只改输入框；手输旧码保存成功；生成不触发保存。
- [ ] **AC-003** — 同一前缀第二次生成得到 +1；跨组织不串号；已进别名表的旧码被跳过（不重发）。
- [ ] **AC-004** — 字典为空/缺条目时 `code: null` + reason，非 4xx；手输路径不受影响。
- [ ] **AC-005** — 缺 `products.items.view` → 403；未选组织 → 400 `organization_scope_required`；跨组织目标 403。
- [ ] **AC-006** — 生成的码通过 `SKU_PATTERN`，且与 catalog 默认变体复制路径一致（建档不因建议码失败）。
- [ ] **AC-007** — 撞码路径：两个商品拿同一建议码时第二个保存 409，重新生成得到下一个序号（TEST-004）。

## Resolved assumptions (autonomous defaults)

本规格在无人值守下起草，按 `om-spec-writing` 的 `--autonomous` 规则把闸门问题转成**可撤销默认**；
标 ⚠ 的一条需要 owner 明确点头（未点头前 PR 保持 draft / `needs-qa`）。

| # | Question | Chosen default | Rationale | Marker |
|---|---|---|---|---|
| 1 | 发号是否回来 | **回来，但只作为建议器**（可改、可无视，不拦截） | 与 owner 2026-09-24 的口径一致；建议器不可能破坏既有数据 | ⚠ NEEDS HUMAN CONFIRMATION |
| 2 | 序号用什么承载 | **扫描推导**（照 `SUP-####` 先例），不建台账表 | 最小新表面、无迁移、回滚=还原分支；审计由平台侧承担 | — |
| 3 | 改码是否写别名 | **拆出本规格** → `2026-10-10-product-alias-on-rename.md` | 评审认定它与建议器无共享契约、可独立上线，且自带一个 owner 闸门 | — |
| 4 | 生成范围 | 只生成**商品** SKU，不动变体 | 最小面；变体码仍由操作员按需填写 | — |
| 5 | 序号宽度 | 三位起步、超 999 进位四位 | 与既有码形状一致 | — |
| 6 | UI 位置 | 回到 SKU 字段内部（2026-09-24 已定型的形态） | 复用已获 owner 认可的版式 | — |

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q1 | 发号是否真的回来（默认：作为建议器回来） | owner | **yes** | 待答（⚠ 默认见上表） |
| Q2 | 是否需要「序号永不重编」的审计保证（默认：不需要——序号只服务建议，占用由唯一键裁决） | owner | no | 待答 |
| Q3 | 品牌/类别默认值：优先商品现有品牌，否则表单上次选择（默认：是） | owner | no | 待答 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-10 | Initial spec — 从单一存储改造的 Q1 / Phase 4 拆出；自动默认见「Resolved assumptions」，状态 Draft 等 owner 回答 Q1 |
| 2026-10-10 | Scope-cohesion 评审（fresh-context 子代理）判 `split needed`：别名登记拆到 `2026-10-10-product-alias-on-rename.md`；同时修掉评审指出的四处——机制自相矛盾（命令 vs 订阅者）、TEST 无闸门（并发用例进 Phase 1 的门）、REQ 与 AC/Phase 错配、以及「字典口径不变 / 手输即时校验」这类非可实现的现状陈述 |
