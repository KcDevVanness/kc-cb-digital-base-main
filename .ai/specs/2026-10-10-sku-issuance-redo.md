# Product Code Issuance, Redone on the Single Store（商品编码发号重做）

**Date**: 2026-10-10
**Status**: Draft — 本规格是 `.ai/specs/2026-10-10-catalog-single-store.md` 的 **Q1 拆出来的那个切片**
（「一份 spec 覆盖砍+合并+UI，SKU 发号另立」，Phase 4）。所有 ⚠ 标记的决议需要 owner 点头后转
`Ready for implementation`；`owner` 未点头前不写代码。

> **它修订/继承的东西**：`.ai/specs/2026-09-24-supplier-product-code-rules.md`（已 superseded：规则/台账/发号/解析
> 全部删除，但它的三态解析与「旧码别名」教训仍被引用）、`.ai/specs/2026-10-10-catalog-single-store.md`
> （REQ-006 / Q5 的「SKU 全手填、发号器停用」是本规格的**起点**，不是终点）、
> `docs/dev/business-conventions.md` C-11 / C-37。供应商编号 `SUP-####`（`2026-09-24-supplier-code-issuance.md`）
> **不在本规格范围内**，它一直活着。

## TLDR

把 2026-10-10 停掉的产品编码**发号**以**建议器**的形态请回来：商品表单的「商品 SKU」旁恢复「品牌 + 类别 →
生成」这条工具链，生成的码**只是建议**（操作员可改、可无视、可继续手输旧码），写入仍然经 `products/lib/store.ts`
落在 `catalog_products.sku`；序号从**本组织已有编码扫描推导**（不建台账、不建规则表，照 `SUP-####` 的先例）；
当已有商品的 SKU 被改掉时，把旧码写进 `product_codes_aliases`，让「旧码可搜」这条既有口径第一次真正成立。
不恢复的：规则表、发号台账、`/parse` 三态拆解 API、字典值冻结、任何形式的拦截。

## Problem Statement

单一存储改造把发号机制整体停用是**有意的**（Q5「SKU 全手填；发号器停用」），但它同时留下四个可观测的后果：

1. **工具没了，纪律没补上**：品牌/类别字典还在播种（`src/modules/product_codes/README.md` 的字典播种行、
   `product_codes/setup.ts`），却没有任何消费者——操作员拿到一个 PK/CL 字典，却只能自己拼 `PK-CL001`。
2. **「旧码可搜」只对历史成立**：`product_codes_aliases` 只有读（`product_codes/lib/aliasLookup.ts:14-40`、
   `products/lib/store.ts:628-630` 的 `sku ilike / title ilike / id in (aliasIds)` union），
   `src/modules/product_codes/README.md` 明写「手写维护，**不重发**」——当前树里没有任何代码路径能创建一行别名
   （`product_codes/api|commands|backend|components` 目录已不存在），改一次 SKU 旧码就再也搜不到，
   而这正是 C-37 / AC-006 承诺的行为。
3. **改码的门槛被低估**：SKU 的字符集规则在树里有三份拷贝——`products/data/validators.ts:89`（catalog 口径）、
   `sourcing/lib/skuDerivation.ts:29`（已把供应商的 `/` 映射成 `-` 再校验）、
   `sourcing/data/validators.ts:93`（2026-10-10 才跟上，此前仍收斜杠）。`products.items.update:240-247` 只对
   **变化后**的 SKU 校验，所以不合规的输入要等到保存才知道。
4. **迁移期的码还在流通**：`purchasing_supplier_products.supplier_sku`（`purchasing/data/entities.ts:508-510`，唯一键含软删）、
   单据快照里的 `sku`（`trade_docs/lib/productSnapshots.ts:14-16`）与纸面单据上印的旧码不会因为停用发号而消失，
   所以「生成一个新码」与「沿用旧码」两种动作必须同时被支持，不能二选一。
5. **改动会波及印刷面**：编码出现在采购单行快照（`purchasing/commands/orders.ts:292-338`）、合同/单据/发票行
   （`trade_docs/data/entities.ts:171-181` 等）、发运分摊与装箱单（`cross_border/data/entities.ts:139-149`）、
   财务的 SKU 口径（`finance/lib/costResolver.ts:133`、`skuMargin.ts:114`）——所以「改码」只能是**新增**动作，
   历史快照永不重写。

## Overview and Success Measures

- **Primary outcome:** 新建/改档商品时，绝大多数商品由「品牌+类别」一键得到一个**合法且唯一**的 SKU 建议；
  被改掉的旧码仍可搜索命中。
- **Leading indicators:** 建档时 `SKU_PATTERN`/唯一性 400/409 的次数下降；「生成」被点击后在 UI 内完成保存的比例。
- **Baseline:** `unknown — measurement plan`：先记录一个迭代内（例如两周）商品建档/改档的 400/409 次数与手输码比例，
  作为之后对比的基线；仓里现无该指标。
- **Market / product reference:** 主流 ERP 把编码生成做成**可选建议**而非闸门（Odoo 的 sequence 可被手工覆盖、
  SAP 允许外部编号；两边都保留一次性编号台账供审计）。本规格采纳「建议 + 可覆盖」，**拒绝**台账（平台已有审计）
  与强制校验（owner 2026-09-24 的口径「生成后也可以自定义修改…只是一个工具」）。

## Goals

- **REQ-001** — 提供 `POST /api/products/items/suggest-code`（命令 `products.items.suggest-code`）：入参
  `{ brand?: string, category?: string, name?: string }`，出参 `{ code, breakdown, brandCode, categoryCode, taken }`；
  **只读不写**，任何情况下都不拒绝——字典缺条目、无品牌、序号用尽都返回可读的 `code: null` + `reason`。
- **REQ-002** — 商品表单「商品 SKU」字段内恢复生成控件：品牌（字典 `product_brand`，默认取最后选择/商品现有品牌）+
  类别（字典 `product_category`）+ 「生成」；生成结果只填进 SKU 输入框，字段仍可任意编辑。
- **REQ-003** — 序号按**扫描推导**：在调用组织内，把 `catalog_products.sku`、`catalog_product_variants.sku` 与
  `product_codes_aliases.alias_code` 中形如 `{BRAND}-{CATEGORY}{NNN+}` 的码取出，取最大序号 +1，三位起步、超 999 进位到四位；
  保存时若并发撞码，唯一索引给 409，界面提示「已被占用，重新生成」（不自动重试写库，避免替操作员做决定）。
- **REQ-004** — 改码写别名：`products.items.update` 成功改变 SKU 时，经同伴命令 `product_codes.aliases.register` 把**旧码**写入 `product_codes_aliases`
  （`target_kind='product'`、`target_id`=catalog 商品 id）；同一商品多次改码累积多行，别名冲突（旧码已被别人登记）
  不阻塞改名，只记一条日志 + 界面提示「旧码仍指向 <其它商品>」。
- **REQ-005** — 字典口径不变：`product_brand` / `product_category` 继续由 `product_codes/setup.ts` 幂等播种，
  业务在字典库维护；生成器读字典，字典没有的码**不**允许生成（但允许手输，因为手输本来就不查字典）。
- **REQ-006** — 权限沿用 `products.items.view`（建议）与 `products.items.manage`（改名写别名），不新增 feature；
  作用域 = 调用者当前组织，跨组织建议 403。
- **REQ-007** — 生成的码必须满足 `SKU_PATTERN`（与 catalog 同字符集）；建议器产出的码在 UI 上即时校验，手输码的校验时机
  与今天一致（保存时）。

## Non-goals

- **不恢复**规则表（`product_codes_rules`）、发号台账（`product_codes_ledger_entries`）、`/api/product_codes/parse`
  三态拆解、字典值冻结拦截器、规则后台页——它们已在单一存储改造中删除，本规格不把它们带回来。
- **不做拦截**：没有"必须用生成的码"。手输旧码、供应商码直接沿用都是合法路径（本轮不改写这条）。
- 不自动为**变体**生成码（变体 SKU 继续由操作员按需填写）；不改动 `SUP-####` 供应商编号。
- 不做历史数据回填/批量重编号；不新建表、不写迁移。
- 不引入新依赖。

## Proposed Solution

三个小件，全部落在既有 seam 上：

1. **建议器命令**（`products` 模块）：`products.items.suggest-code` 纯读计算——字典取品牌/类别码 → 扫描本组织三类来源
   推导序号 → 返回 `{code, breakdown}`。放在 `products` 而不是 `product_codes`：SKU 是商品字段，消费者是商品表单，
   而 `product_codes` 只剩别名与字典播种（`src/modules/product_codes/README.md` 的「放/不放」）。
2. **表单控件**（`products/components/ProductForm.tsx` 的 SKU 字段，`type: 'custom'`）：`品牌` + `类别` 两个下拉 + 「生成」，
   生成后只写输入框；按钮下方一行拆解说明（`品牌(码) · 类别(码) · 序号`）。类别/品牌任一为空时按钮禁用并说明原因。
3. **改名写别名**（`product_codes` 模块的事件订阅者）：订阅 catalog 商品更新事件，diff 出 SKU 变化 → 插入一行别名。
   订阅者而不是在 `products.items.update` 里直接写：别名的宿主是 `product_codes`，而事件是仓库既有的跨模块 seam
   （`.ai/guides/architecture.md` 的 ID/快照/事件规则）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 建议器：只建议、不拦截 | owner 2026-09-24 的原始口径（「生成后也可以自定义修改…只是一个工具」）；手输旧码/供应商码是既成事实 | 在 `productCreateSchema` 里强制生成规则 | 直接推翻 Q5 的手输决定，且会让既有单据/库行无法建档 |
| 序号**扫描推导**，不建台账 | 仓内先例：`purchasing/commands/suppliers.ts` 的 `SUP-####` 就是「扫本组织取最大 +1 + 有界重试」；无新表、无迁移、回滚=还原分支 | 恢复 `product_codes_ledger_entries` append-only 台账 | 台账解决的是审计与"永不重编"，而平台侧已有 audit + 别名；为一个建议器恢复一张表不值得（也是本规格最大的 scope 争议点，见 Q2） |
| 命令放 `products`、别名写手放 `product_codes` | SKU 是商品字段（消费者是商品表单）；别名的宿主是 `product_codes`（读侧也在这两个模块里） | 全部塞进 `product_codes`（含建议器） | 会让 `product_codes` 反向依赖 `products` 的 store 读（目录桥接），依赖方向变坏 |
| 改名写别名走**同伴命令**（`products.items.update` → `product_codes.aliases.register`，best-effort） | 改码发生在那条命令里、before/after SKU 已在手（`commands/items.ts:240-256`）；跨模块写走命令总线是既有的、被验证过的 seam（store 对 catalog 就是这么做的）；别名的宿主仍是 `product_codes` | 订阅 `catalog.product.updated` 事件 | 事件载荷是否携带 before/after SKU 未经验证（`events.ts` 只说 `catalog.product.*` 会发，形状未查），把一个承诺押在未验证的载荷上不值得；订阅者形态在仓里有先例（`purchasing/subscribers/mirror-root-order-fields.ts`），若 Phase 3 证明事件足够可直接替换 |
| 生成控件重新放回 SKU 字段内部 | 2026-09-24 已按 owner 反馈定型为「一个卡片、生成器在字段里」（`2026-09-24-supplier-product-code-rules.md` 的 Changelog 行） | 顶部工具栏放生成按钮 | 会被读成与 SKU 字段无关的全局动作，且离开字段上下文不知道在给谁生成 |
| 并发撞码：不自动重试 | 建议器只产生**建议**；写库的 409 由操作员重新生成解决，避免系统替业务决定"下一个号" | 命令内自动 +1 重试直到写成功 | 会在并发下漂号，且让 409 失去意义 |
| 不做 4 位以上/多段序号方案 | 现有字典与既有码都是 `PK-CL001` 形状；三位足够此业务（年商品量 < 999） | 引入可配置宽度/年段 | 无需求证据；需要时再开 spec |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 商品 SKU | 我方编码，组织内唯一（活行），字符集 `^[A-Za-z0-9._\-]{1,64}$`，写 `catalog_products.sku`（建档同时复制到默认变体） | `catalog_products`（经 `products/lib/store.ts`） | 重复 → 409；非法 → 400 |
| 供应商货号 | 供应商表格上印的号，**不是**我方编码；存在库行上 | `purchasing_supplier_products.supplier_sku`（唯一键含软删） | 重复 → 409 |
| 建议码（suggested code） | `{品牌码}-{类别码}{3 位序号}`，三段都来自字典与扫描；**只是建议**，无任何写入与占用 | `products.items.suggest-code` | 字典缺条目 → `code: null` + reason；不报错 |
| 序号 | 本组织内匹配同一 `{品牌码}-{类别码}` 前缀的最大序号 +1；同时考虑商品、变体与别名三类来源 | 扫描推导（无表） | 扫描失败（读错误）→ 503 可读文案，UI 仍可手输 |
| 旧码 / 别名 | 一个商品曾经用过的编码，登记在别名表后仍可被搜索命中（列表搜索 union），**不占**当前唯一键 | `product_codes_aliases` | 别名冲突 → 不阻塞改名，仅日志 + 提示 |
| 品牌码 / 类别码 | 字典值（`product_brand` / `product_category`）的 `value`，字典 label 是纯显示名 | 字典库（`product_codes/setup.ts` 播种） | 字典无条目 → 生成按钮禁用（手输不受影响） |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 商品维护者（采购/商品） | 取建议码、改 SKU（含写别名） | 当前组织（`organizationId` 只从可信上下文取，缺组织 fail closed） | `products.items.view`（建议）、`products.items.manage`（改档） |
| 字典管理员 | 维护品牌/类别词表 | 当前组织（既有字典库规则） | `dictionaries.*`（不新增） |
| 只读角色 | 看商品与其编码 | 当前组织 | `products.items.view` |

`tenantId`/`organizationId` 一律来自请求上下文（`resolveProductRouteScope`，缺组织 400 fail closed）；
建议器不读跨组织数据，扫描范围与唯一键范围一致（同租户 + 同组织）。系统作用域：无（本规格不引入任何系统级读）。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 商品身份与 SKU 落库 | reuse | `catalog`（经 `products/lib/store.ts`） | 官方命令（scoped 读写） | 单一存储改造后的唯一存储 |
| 建议器命令 | app-own | `products` | 新命令 + 手写路由 | SKU 是商品字段，消费者是商品表单 |
| 品牌/类别字典 | reuse | `dictionaries`（`product_codes` 播种） | 字典库读 | 已存在且已在维护 |
| 别名写入 | app-own（订阅者） | `product_codes` | **事件订阅** catalog 商品更新 | 别名的宿主是 `product_codes`；跨模块只走事件 |
| 别名读取（搜索兜底） | reuse（已实现） | `products/lib/store.ts` + `product_codes/lib/aliasLookup.ts` | 既有读 | 不动 |
| 审计 | reuse | 官方 catalog 命令的 audit | — | 不为建议器做第二套审计 |

## Architecture and Data Flow

```text
操作员(商品表单) --POST /api/products/items/suggest-code--> products.items.suggest-code
                                                              |-- 读字典 product_brand/product_category
                                                              |-- 扫描 catalog_products.sku / catalog_product_variants.sku
                                                              |   + product_codes_aliases.alias_code（本组织）
                                                              '--> {code, breakdown}（不写库）

操作员保存 --PUT /api/products/items--> products.items.update -> catalog.products.update
                                                              '--> SKU 变化时（best-effort）：
                                                                     product_codes.aliases.register（同伴命令）
                                                                       '-- insert 旧码别名行
```

- **Module boundaries:** 建议器与商品写路径在 `products`（一个不变量：商品字段）；别名的生命周期在 `product_codes`
  （一个不变量：旧码→记录 的映射）。两者只通过事件与只读投影交互。
- **Extension points:** 表单控件走 `CrudForm` 的自定义字段（既有做法）；订阅者走既有事件总线注册（`events.ts`）。
- **Alternatives considered:** 见上表；额外考虑过「把建议器做成 AI 建议」（owner 没要求、无训练信号、延迟不可控）——不做。
- **Compatibility:** `POST /api/products/items/suggest-code` 是新增路径；`products.items.update` 的行为只增加一次
  别名写入（失败不改变响应）。SKU 的字符集与唯一性规则**不变**；既有单据/快照不受影响。

## User Journeys

### Journey J-001 — 新产品建档拿到建议码

1. 操作员在 `/backend/products/items/create` 填「商品标识」，品牌选 `PK — PetKit`、类别选 `CL — 猫砂`。
2. 点 SKU 字段里的「生成」→ `POST /api/products/items/suggest-code` → 输入框出现 `PK-CL004`，下方一行拆解。
3. 直接保存 → `products.items.create` → catalog 建档成功，列表可见。
4. 失败：字典缺类别 → 按钮禁用并说明「字典 `product_category` 没有可用条目」；网络/读失败 → 提示可重试，输入框仍可手输。

### Journey J-002 — 沿用供应商旧码

1. 操作员手输 `P4108-UVC`（供应商侧既有码）。
2. 保存成功（字符集合法、组织内唯一）。
3. 之后任何时候点「生成」会覆盖输入框内容——**不自动保存**；操作员可撤销（不保存即离开）。

### Journey J-003 — 改码保留旧码可搜

1. 商品 `PK-CL004` 改名换码为 `PK-CL010` → 保存成功。
2. 订阅者把 `PK-CL004` 写入别名表。
3. 任何人在商品列表搜索 `PK-CL004` → 命中该商品（显示当前 SKU `PK-CL010`）。
4. 冲突：`PK-CL004` 已被别的商品登记为别名 → 改名照常成功，界面提示「旧码仍指向 <别的商品>」，日志留痕。

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/products/items/create` · `/edit` | SKU 字段内「品牌 + 类别 + 生成」+ 拆解行 | `POST /api/products/items/suggest-code`、字典读；保存走 `products.items.*` | 该字段 2026-09-24 的形态（已删除的 `SkuPanel`；现由 `CrudForm` 自定义字段承载） | `CrudForm` + `Select`/`Input`/`Alert`（语义 token） | 默认、生成中、生成成功、字典空、网络失败、生成后被手改 | REQ-001, REQ-002, REQ-005, REQ-007 |
| `/backend/products/items`（列表） | 按旧码搜索命中（既有能力，本规格回归验证） | `GET /api/products/items?search=` | 同页现有搜索框 | `DataTable` | 命中、无结果 | REQ-004 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 商品维护者 | MASTER DATA → Products（既有） | 既有 widget 不改 | 登录 → Products → 新建 → 填品牌/类别 → 生成 → 保存（≤3 点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| SKU 字段的生成控件 | 字典为空/未选品牌时：按钮禁用 + 一行说明「选品牌与类别后可生成」 | 窄屏：品牌与类别下拉各占一行，生成按钮与输入框同行换行 | Tab 顺序 = 品牌 → 类别 → 生成 → SKU 输入；Enter 在 SKU 输入提交表单；生成后焦点留在 SKU 输入并读出拆解（`aria-live="polite"`） |

- **Behavior:** 生成只改输入框值（不触发保存）；保存仍走既有校验（字符集/唯一性/乐观锁 409）；不新增对话框。
- **Responsive and accessibility:** 沿用商品表单既有栅格；控件带 `<label>`；生成结果以 `aria-live` 播报。
- **Localization:** 键落 `products.*`（如 `products.items.form.sku.generate`、`…sku.breakdown`、`…sku.dictEmpty`），
  zh/en 两份字典逐键一致；字典 label 只做显示名（`CODE — 名称` 由选择器拼）。
- **Design-system and theming:** 只用语义 token 与共享组件（`Select`/`Input`/`Alert`/`Button`），浅深色与窄屏由
  `ds:check` + 浏览器冒烟覆盖；不改任何状态色。

## Data Models

**不新增实体、不写迁移。** 复用的表：

| 表 | 用途 | 生命周期与规则 |
|---|---|---|
| `catalog_products.sku` / `catalog_product_variants.sku` | 编码的唯一性来源与扫描来源 | 唯一键（同租户+组织，含软删行由平台决定）；删除商品即释放 |
| `product_codes_aliases` | 旧码 → 目标记录（`target_kind='product'`，`target_id` = catalog 商品 id） | append-only、手写/订阅者写；唯一键 `(tenant_id, organization_id, alias_code, target_kind, target_id)`；不参与 SKU 唯一性 |
| `dictionaries` / 字典条目 | 品牌码与类别码 | 组织级、父组织继承；insert-only 播种 |

## API, Command, and Error Contracts

```text
POST /api/products/items/suggest-code     requireFeatures: products.items.view
  body:    { brand?: string, category?: string, name?: string }   （brand/category 为字典 value）
  result:  { code: string | null, reason?: 'brand_missing' | 'category_missing'
             | 'dictionary_empty' | 'sequence_exhausted', breakdown?: { brand, category, sequence },
             brandCode?: string, categoryCode?: string, taken?: string[] }
  200 即使 code 为 null（建议器不报错）；401 未登录；403 跨组织/缺 feature；503 扫描读失败（带可重试文案）

products.items.update（既有）行为增量：
  成功改变 SKU → 事件侧写一行别名（best-effort；失败只写日志与界面提示，不影响 200）
```

错误口径：建议器**不**返回 4xx 表达业务缺失（缺字典/缺品牌是正常状态，用 `code: null` + `reason`）；
只有鉴权/作用域/基础设施故障才是 4xx/5xx。

## Events, Jobs, Notifications, and Cross-Module Flows

- **不新增事件**：别名注册走同伴命令（见上表），不依赖任何事件载荷；`products/events.ts` 现有的四个 app 级事件
  已不再由本模块发出（store 改走 catalog 命令），本规格不为发号恢复它们。
- 不新增作业/通知/队列。

## Security, Privacy, and Compliance

- 无 PII；不新增加密字段。作用域：建议器与别名写都限于调用组织（fail closed）。
- 日志：别名冲突只记 `product_codes` 的 warn（商品 id、旧码、现持有者 id），不记自由文本。

## Integration Coverage

| 用例 | 类型 | 断言 |
|---|---|---|
| TEST-001 | unit | 建议器纯函数：前缀匹配/序号推导/三位进位/前缀与字典码等长无关（`PK-CL`、`SP-TP`） |
| TEST-002 | integration | `POST /api/products/items/suggest-code`：空字典 → `code:null` + reason；正常 → `PK-CL004`；跨组织 403 |
| TEST-003 | integration | 改码后 `GET /api/products/items?search=<旧码>` 命中该商品，且显示当前 SKU |
| TEST-004 | unit | 订阅者：SKU 未变不写；变更写一行；别名冲突不抛错 |

## Implementation Phases

### Phase 1 — 建议器命令 + API

- **Depends on:** 单一存储改造已合入（Phase 0–3）
- **Outcome:** `products.items.suggest-code` 可用，返回合法且唯一的建议码（或 null + reason）
- **Deliverables:** 命令 + 手写路由（含 `metadata`/`openApi`）+ 纯函数扫描推导 + 单测
- **Requirements closed:** REQ-001, REQ-003, REQ-006, REQ-007
- **Validation:** `yarn typecheck && yarn lint && yarn test src/modules/products`；`GET/POST` 冒烟
- **Exit gate:** TEST-001/002 绿；跨组织 403；字典空返回 reason 而非报错

### Phase 2 — 表单控件

- **Depends on:** Phase 1
- **Outcome:** 商品表单 SKU 字段内可生成建议码（记住上次选的品牌/类别）
- **Deliverables:** `ProductForm` 自定义字段 + i18n（zh/en 同键集）+ 键盘/`aria-live` 行为
- **Requirements closed:** REQ-002, REQ-005
- **Validation:** `yarn ds:check` + 浏览器冒烟（浅/深色、窄屏、键盘、字典空）
- **Exit gate:** 生成→保存→列表可见；手输路径不受影响

### Phase 3 — 改名写别名

- **Depends on:** Phase 1
- **Outcome:** 改码后旧码仍可搜
- **Deliverables:** `product_codes.aliases.register` 命令 + `products.items.update` 的 best-effort 调用 + 单测/集成用例 + README 段落
- **Requirements closed:** REQ-004
- **Validation:** 集成 TEST-003/004（`yarn test:integration:ephemeral`）
- **Exit gate:** 改名→搜索命中旧码；冲突路径不阻塞改名；别名写失败（如 command bus 不可用）时改码仍 200

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001 | `products.items.suggest-code` | 1 | TEST-001, TEST-002 | AC-001 |
| REQ-002 | J-001/J-002 | 表单字段 | 2 | 冒烟 | AC-002 |
| REQ-003 | J-001 | 扫描推导（无表） | 1 | TEST-001 | AC-003 |
| REQ-004 | J-003 | 订阅者 + `product_codes_aliases` | 3 | TEST-003, TEST-004 | AC-004 |
| REQ-005 | J-001 | 字典读 | 2 | TEST-002 | AC-005 |
| REQ-006 | 全局 | `metadata.requireFeatures` | 1 | TEST-002 | AC-006 |
| REQ-007 | J-001 | `SKU_PATTERN` | 1 | TEST-001 | AC-007 |

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 扫描推导在并发下撞号 | 保存 409，操作员需重新生成 | 唯一索引兜底 + 可读提示；不做自动重试 | 高峰并发下的操作摩擦 |
| 别名只覆盖 UI 改码路径 | 绕过 `products.items.update` 直接改 catalog SKU（本仓没有这种路径）不会写别名 | 验收里写明覆盖范围；日后新增写路径时同点接入 | 平台侧直接改数据不留别名 |
| 建议器被误读为强制 | 用户以为必须用生成的码 | 文案明说「建议，可改」；字段始终可编辑 | 习惯性依赖 |
| 三位序号用尽 | 第 1000 件同前缀商品需要四位 | 进位规则明确（四位起） | 极长前缀的显示宽度 |
| 别名无限增长 | `product_codes_aliases` 行数缓慢上升 | append-only 且每行极小；无清理需求 | 无 |

## Acceptance Criteria

- [ ] **AC-001** — 未选品牌/类别时按钮禁用并给出原因；选中后生成 `{品牌码}-{类别码}{NNN}`。
- [ ] **AC-002** — 生成结果只改输入框；手输旧码保存成功，且生成不触发保存。
- [ ] **AC-003** — 同一前缀第二次生成得到 +1；跨组织不串号（A 组织的 `PK-CL001` 不影响 B 组织从 001 起）。
- [ ] **AC-004** — 改名后旧码可被列表搜索命中；别名冲突只提示不阻塞。
- [ ] **AC-005** — 字典为空/缺条目时 `code: null` + reason，非 4xx。
- [ ] **AC-006** — 缺 `products.items.view` → 403；未选组织 → 400 `organization_scope_required`。
- [ ] **AC-007** — 生成的码通过 `SKU_PATTERN`，且与 catalog 默认变体复制路径一致（建档不因建议码失败）。

## Resolved assumptions (autonomous defaults)

本规格在无人值守下起草，按 `om-spec-writing` 的 `--autonomous` 规则把闸门问题转成**可撤销默认**；
标 ⚠ 的两条需要 owner 明确点头（未点头前 PR 保持 draft / `needs-qa`）。

| # | Question | Chosen default | Rationale | Marker |
|---|---|---|---|---|
| 1 | 发号是否回来 | **回来，但只作为建议器**（可改、可无视，不拦截） | 与 owner 2026-09-24 的口径（「只是一个工具」）一致；建议器不可能破坏既有数据 | ⚠ NEEDS HUMAN CONFIRMATION |
| 2 | 序号用什么承载 | **扫描推导**（照 `SUP-####` 先例），不建台账表 | 最小新表面、无迁移、回滚=还原分支；审计由平台侧承担 | — |
| 3 | 改码是否写别名 | **写**（订阅者，best-effort） | 「旧码可搜」是既有承诺（C-37/AC-006），当前树里没有写入者，等于承诺落空 | ⚠ NEEDS HUMAN CONFIRMATION |
| 4 | 生成范围 | 只生成**商品** SKU，不动变体 | 最小面；变体码仍由操作员按需填写 | — |
| 5 | 序号宽度 | 三位起步、超 999 进位四位 | 与既有码形状一致 | — |
| 6 | UI 位置 | 回到 SKU 字段内部（2026-09-24 已定型的形态） | 复用已获 owner 认可的版式，避免新设计 | — |

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q1 | 发号是否真的回来（默认：作为建议器回来） | owner | **yes** | 待答（⚠ 默认见上表） |
| Q2 | 改码是否登记旧码别名（默认：登记） | owner | **yes** | 待答（⚠ 默认见上表） |
| Q3 | 是否需要「序号永不重编」的审计保证（默认：不需要；沿用平台 audit + 别名） | owner | no | 待答 |
| Q4 | 同名商品的品牌/类别默认值是否跟随最近一次选择（默认：跟随商品现有品牌，否则跟随表单上次选择） | owner | no | 待答 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-10 | Initial spec — 从单一存储改造的 Q1 拆出（Phase 4 另立切片），自动默认见「Resolved assumptions」；状态 Draft 等 owner 回答 Q1/Q2 |
