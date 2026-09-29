# 内部销售：订单从报价单载入（引用加载）

**Date**: 2026-09-29
**Status**: Implemented and verified (2026-09-29)

> 本切片只覆盖一个能力：操作员在**订单新建**时引用一张既有报价单，把它的抬头与行一次性载入表单，改完再保存；
> 并把这笔「来源报价」记在订单上。复用的引擎读接口、既有表单与既有创建命令，不新增表/迁移/功能位。

## TLDR

报价谈定后，订单通常与报价只差个别商品/价格/数量；现在唯一的报价→订单入口是引擎的**就地转换**（报价消失、1:1）。
本切片给订单新建页加「从报价单载入」：选一张报价 → 抬头（买方/币种/参考号/备注）与全部行进入表单 → 操作员修改 → 保存为新订单，
订单上以 `metadata.internalSales.sourceQuote = { id, number }` 记录来源，编辑页可见并可跳回报价。
报价本身不被修改或删除；「转为订单」原样保留。

## Problem Statement

- 现状（2026-09-29 实测/读码）：报价→订单只有 `sales.quotes.convert_to_order` 一条路——**就地转换**：同一个 UUID 从 `sales_quotes`
  变成 `sales_orders`（`node_modules/@open-mercato/core/src/modules/sales/commands/documents.ts:6428`、行 `:6569-6570`），
  **报价行与报价被硬删**（`:6733-6737`）。它适合「报价即最终版、原样确认」。
- 但 owner（2026-09-29）确认的业务事实是：订单常与报价**只差个别商品/价格/数量**；**一张订单可能分批发运/分多个柜**，
  也会出现**多张订单合一条柜**——即报价与订单不是 1:1 的封闭链。此时操作员只能重录整张单据的行（读一遍报价、手抄一遍），
  既慢又容易抄错；走转换则报价消失、无法再出第二张订单。
- 证据：`src/modules/internal_sales/components/InternalSalesTable.tsx:186-215`（唯一的报价行操作是编辑与转为订单）；
  `InternalSalesForm.tsx:868-900`（新建表单只支持空表单提交）。
- 影响用户：内部销售操作员（总部对分公司 / 分公司对外客户两个方向共用这套页面）。

## Overview and Success Measures

- **Primary outcome:** 订单新建页可以引用一张报价单一次性载入抬头与行，操作员改完保存；新订单记录来源报价，报价保持原样。
- **Leading indicators:** 从报价列表一步进入已载入的订单新建页；载入失败（403/网络）时有可读提示且表单内容不变。
- **Baseline:** 今天只能重录（或走就地转换、报价消失）。
- **Market / product reference:** 仓内既有先例——`trade_docs` 的「从订单复制行」（订单 → PI/CI 的**一次性复制**，
  `src/modules/trade_docs/components/DocumentsForm.tsx:586-638`，spec F-104 / Q-10「存链接 + 一次性复制，不做实时同步」）。
  本切片采用同一口径（一次性、可改、留来源），只是方向改为报价 → 订单、并把来源落在安装层 `metadata` 上。
  不照搬任何外部产品。

## Goals

- **REQ-001** — 订单**新建**页出现「从报价单载入」：对话框内按报价单选一张（选择器按单号搜索、显示买方名），
  确认后把该报价的抬头（币种、买方链接与名称、客户参考号、备注）与**全部行**（商品 id、目录变体 id、名称、SKU、规格、数量、未税单价、行备注）
  一次性写入表单；保存前任意可改。表单已有操作员输入时，先弹**覆盖确认**（destructive），取消则不发任何请求。
- **REQ-002** — 报价**列表**的行操作（有 `sales.orders.manage` 时显示）新增「按此报价新建订单」：跳转到
  `/backend/internal-sales/orders/create?fromQuote=<quoteId>`，页面进入后自动载入该报价（同一 loader）；载入失败只提示，不阻塞表单。
- **REQ-003** — **来源记录**：经载入（且未清空买方）保存成功的订单写入 `metadata.internalSales.sourceQuote = { id, number }`；
  订单**编辑页**显示「来源报价单 QUOTE-…」并可跳到该报价的编辑页。报价单本身不被修改、不被删除。
- **REQ-004** — 载入是**只读**行为：不产生任何写请求；读报价被拒（缺 `sales.quotes.view`）或读失败时给出可读提示，
  表单当前内容不变；载入不改变页面权限声明（订单页仍是 `sales.orders.manage`）。
- **REQ-005** — 「转为订单」保留且行为不变；两个报价行操作的文案要让操作员看懂区别（转换=报价即最终版、不可逆；载入=以报价为模板、报价保留）。

## Non-goals

- 不改引擎命令、不新增表/迁移/功能位/引擎字段；不新增服务端复制命令。
- 不做实时同步：载入是一次性快照，之后报价与订单互不影响；不做「已载入/已使用」标记。
- 不做订单→报价的反向载入；不做批量载入；不做行级来源快照（只记单据级来源）。
- 不做「载入某张订单的行」（翻单）——如需要，另立切片。
- 不为报价单本身新增「复制/载入」入口。

## Proposed Solution

纯**界面层**能力，全部落在 `src/modules/internal_sales`：

1. **loader**（新 `lib/quoteLoad.ts`，纯函数为主）：`loadQuoteOption*`（选择器选项，`GET /api/sales/quotes`）、
   `loadQuoteIntoValues(quote, lines)`（用既有 `toInternalSalesFormValues` / `toInternalSalesLineValues` / `readBuyerSnapshot`
   把报价映射为表单初值；**行 key 重新发为本地 key**，不复用源行 uuid）、`hasOperatorInput(values)`（覆盖确认用）、
   `readSourceQuote(metadata)` / `buildDocumentMetadata(sourceQuote)`（来源键的写读）。
2. **表单**（`components/InternalSalesForm.tsx`）：订单新建模式在头部上方插入一个 bare 分组「从报价单载入」——
   按钮 + `Dialog` + `ComboboxInput`（复用买方/选品器同款交互）；载入成功 flash 并在按钮下方显示「来源报价单 QUOTE-…」。
   表单值新增 `sourceQuote: { id, number } | null`；`buildInternalSalesPayload`（创建）在存在来源时带上
   `metadata: { internalSales: { sourceQuote } }`；更新路径（`saveInternalSalesDocument`）**不携带 metadata**（引擎「缺席=不改」）。
3. **编辑页来源展示**：`toInternalSalesFormValues` 读回 `metadata.internalSales.sourceQuote`，订单编辑页在头部上方显示来源行（链接到报价编辑页）。
4. **单文档读路径**：编辑页 loader 的 `fetchCrudList(..., { ids: id })` 改为 `{ id }`——安装层工厂只有 `id`（单数）才返回含
   `metadata` 的完整投影（`node_modules/@open-mercato/core/src/modules/sales/api/documents/factory.ts:461-462`；`ids` 走不含 metadata 的 grid 投影 `:435-457`）。
5. **报价列表行操作**（`components/InternalSalesTable.tsx`）：新增 `new-order-from-quote`，`href` 带 `?fromQuote=`。
6. **文档**：本模块 README、quote-to-order spec 的过期表述修正、plan 进度行（见 Rollout）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 载入 = 复制内容到**新建**单据，而不是复用就地转换 | 报价须保留（可能出第二张订单/分批多柜）；订单内容常与报价不同 | 只用 `sales.quotes.convert_to_order` | 转换会硬删报价（`:6733-6737`）且 1:1，报价无法再被引用 |
| 纯客户端载入 + 既有 `POST /api/sales/orders` | 编号/合计/状态仍由引擎生成，不造第二套编号或金额逻辑；载入不写库 | 新增服务端 `copy-from` 命令 | app 侧没有自己的单据表可落；复制清单要与引擎字段同步，`trade_docs` 的 `copy-from` 自带表与状态机不可类比 |
| 来源落 `metadata.internalSales.sourceQuote` | `metadata` 是引擎给文档预留的 jsonb 自由字段（`data/validators.ts:69,718`；创建写入 `commands/documents.ts:5927`）；更新不携带即不改；单文档读带 `id=` 时在完整投影里 | 写进 `customerSnapshot.internalSales` | 语义错位（那是**买方**快照）；清空买方会把来源一起清掉 |
| 编辑页单文档读改用 `id=` | 安装层工厂只有 `id` 返回完整投影（含 metadata） | 保持 `ids=` 并另开一次详情请求 | 多一次请求且同样要读 metadata；`id=` 正是安装层详情页自己的读法（`factory.ts:459-462`） |
| 载入 = **替换**抬头与行（有输入先确认） | 新建页的语义是「以这张报价为初值」；留着空行/半份内容更像故障 | 追加行（`trade_docs` 的做法） | 那是**编辑中**表单的语义；新建页追加会留下未清理的空行 |
| 两个入口：新建页按钮 + 报价列表行操作 | 操作员既可能在订单侧开工，也可能刚谈完报价 | 只做列表行操作 | URL 预填是仓内既有范式（`InvoiceForm.tsx:531` 等），两者共用同一 loader，成本≈0 |
| 行 key 重新发本地 key | create 行 schema 不含 `id`（zod 会剥掉），但更新路径以行 id 作为「更新而非新增」的判据；两种语义不可混用 | 直接沿用映射出的源行 uuid | 语义漂移风险（未来引擎行为变化即变成「带 id 创建」） |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 引用加载（load by reference） | 把一张既有报价的抬头与行一次性读入订单新建表单作为初值；保存时由引擎创建**新**订单 | 本模块（`lib/quoteLoad.ts`） | 读失败 → 提示，表单不变 |
| 来源报价（source quote） | 载入产生的新订单上记录的 `{ id, number }`；仅用于展示与回溯，不驱动任何逻辑 | 订单 `metadata.internalSales.sourceQuote` | 缺/脏数据 → 当作无来源，不报错 |
| 一次性（one-shot） | 载入后报价与订单互不影响；不存在同步或反写 | 本切片不变量 | — |
| 就地转换（convert） | 既有引擎命令：报价 id 变订单、报价消失、不可逆 | `sales.quotes.convert_to_order` | 保持现状 |
| 买方快照 | 订单/报价上 `customerSnapshot` 的既有形状：`{ name, customer.displayName, internalSales.{organizationId\|partyId} }` | `lib/buyer.ts` | 载入时原样读回；无链接的旧快照只回填名称 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 内部销售操作员 | 在订单新建页载入报价并保存订单；在报价列表进入新建并自动载入 | 会话推导的 tenant + 所选组织；读报价与写订单都由引擎按组织收窄 | 写：`sales.orders.manage`（订单页既有）；读报价：`sales.quotes.view`（安装层**复数**） |
| 只读/缺位角色 | 列表可见（若持 view 位）；载入面板给出「无权限读取报价」的 inline 提示，订单表单仍可用 | 同上 | 缺 `sales.quotes.view` → 403 提示 |

`tenantId` / `organizationId` 全部来自会话与前端既有的 scoped 请求头（`withScopedApiRequestHeaders`），本切片不新增任何服务端作用域推导。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 报价抬头/行读取 | reuse | installed `sales` | `GET /api/sales/quotes?id=`、`GET /api/sales/quote-lines?quoteId=` | 引擎是唯一真相；本切片只读 |
| 订单创建 | reuse | installed `sales` | `POST /api/sales/orders`（头+行一次提交） | 编号/合计/状态由引擎生成 |
| 表单与映射 | reuse | app `internal_sales` | `toInternalSalesFormValues` / `toInternalSalesLineValues` / `readBuyerSnapshot` / `buildBuyerSnapshot` | 编辑页已在用，载入与编辑必须同一套映射 |
| 选择器与对话框 | reuse | 平台 UI | `ComboboxInput`、`Dialog` 家族、`Button`、`useConfirmDialog` | 与买方/选品器同款交互 |
| 来源键（metadata） | app-own | `internal_sales`（无自有表） | 安装层 `metadata` jsonb | 引擎没有来源列；metadata 是其自由字段 |
| 报价列表行操作 | extend | app `internal_sales` | 既有 `RowActions` | 与「转为订单」并列，语义区分 |

## Architecture and Data Flow

```text
[报价列表行操作 ?fromQuote=]  ─┐
[订单新建页「从报价单载入」] ──┴─> lib/quoteLoad.ts ──GET /api/sales/quotes?id= <id>（含 customerSnapshot）
                                                    └─GET /api/sales/quote-lines?quoteId=<id>&pageSize=100（snake_case）
        └─> 表单值（抬头 + 行，行 key 本地重发）
                 └─> POST /api/sales/orders（含 metadata.internalSales.sourceQuote）─> 引擎：编号/合计/状态

[订单编辑页] ──GET /api/sales/orders?id=<id>（完整投影）──> metadata.internalSales.sourceQuote ──> 「来源报价单 QUOTE-…」链接
```

- **Module boundaries:** 全部改动在 `src/modules/internal_sales/**`；引擎只被读（+既有创建命令）。
- **Extension points:** 复用既有表单的 bare 分组装载入面板，不替换任何安装层页面。
- **Alternatives considered:** 服务端 `copy-from`（见 Design Decisions）；只用转换（见上）。
- **Compatibility:** `POST /api/sales/orders` 载荷新增可选 `metadata` 键；`customerSnapshot` 形状不变；编辑读路径 `ids=`→`id=` 是同一路由的同一投影语义（安装层详情页本来就这么读），列表读不变。

## User Journeys

### Journey J-001 — 从订单新建页载入报价

1. 操作员打开 `/backend/internal-sales/orders/create`，点「从报价单载入」。
2. 对话框按单号搜索并选择报价（标签 = `QUOTE-… — 买方名`）→ 确认。
3. 表单被填入抬头与行（含已链接目录变体的商品行）；flash「已从报价单 QUOTE-… 载入」；按钮下方出现来源行。
4. 操作员改数量/价格（越出台账口径时按既有 4 位小数校验拒绝）→ 保存 → 跳到订单编辑页，来源报价可见。
5. 失败：读报价 403/网络错误 → flash 错误、表单不变；空报价（0 行）→ 保留空行并提示「该报价没有明细」。

### Journey J-002 — 从报价列表直接开单

1. 操作员在 `/backend/internal-sales/quotes` 某行点「按此报价新建订单」。
2. 进入 `/backend/internal-sales/orders/create?fromQuote=<id>`，页面自动载入该报价（同 J-001 的填充与提示）。
3. 载入失败 → 停在该页、flash 错误，操作员可手动填写或用按钮重试。

### Journey J-003 — 复查订单的来源

1. 打开已载入生成的订单编辑页 → 头部上方显示「来源报价单：QUOTE-…」。
2. 点链接跳到该报价编辑页（只读回溯；报价未被修改）。
3. 报价已被删除/无权限 → 链接仍显示（快照文本），失败由目标页自行处理。

## UI and Interaction Contracts

参照页面：本模块既有订单新建/编辑页（`src/modules/internal_sales/backend/internal-sales/orders/{create,[id]/edit}/page.tsx` + `InternalSalesForm.tsx`），
其买方/选品器交互与 `trade_docs` 的「从订单复制行」对话框（`DocumentsForm.tsx:575-638`）同款；壳层为 `Page`/`PageBody` + `CrudForm`。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/internal-sales/orders/create`（订单新建） | 顶部新增「从报价单载入」面板：按钮 → 对话框（报价选择器 + 载入/取消） | 读 `GET /api/sales/quotes`、`?id=`、`GET /api/sales/quote-lines`；保存走既有 `POST /api/sales/orders` | 本模块订单新建页（买方选择器）；`trade_docs` 复制行对话框 | `CrudForm`(bare 分组)、`Button`、`Dialog`、`ComboboxInput`、`FieldLabel` | 选择器 loading/empty/403/error；载入中禁用重复提交；覆盖确认；成功 flash；来源行 | REQ-001, REQ-004 |
| `/backend/internal-sales/quotes`（报价列表） | 行操作新增「按此报价新建订单」 | 纯导航（`?fromQuote=`） | 同表既有「转为订单」行操作 | `DataTable`/`RowActions`/`Link` | 只在持 `sales.orders.manage` 时出现 | REQ-002 |
| `/backend/internal-sales/orders/[id]/edit`（订单编辑） | 头部上方显示「来源报价单：QUOTE-…」（链接） | 读 `GET /api/sales/orders?id=` 的 `metadata` | 本模块编辑页 | `CrudForm`(bare 分组) | 无来源时不渲染；长单号换行不溢出 | REQ-003 |

### `/backend/internal-sales/orders/create`

```text
┌──────────────────────────────────────────────────────────────┐
│ 新建内部销售订单（PO）                                        │
│ ┌ 从报价单载入 ────────────────────────────────────────────┐  │
│ │ [从报价单载入]  来源报价单：QUOTE-20260929-00003（链接）   │  │
│ └──────────────────────────────────────────────────────────┘  │
│ 买方（分公司/客户） [Combobox]   买方名称 [Input]             │
│ 币种 [Combobox] 客户参考号 [Input] 备注 [Input]               │
│ 明细: 行编辑（商品/数量/未税单价/SKU/规格/行备注）            │
│ [保存] [取消]                                                │
└──────────────────────────────────────────────────────────────┘
对话框：报价单 [Combobox: QUOTE-… — 买方名] [取消] [载入]
         已有输入时：覆盖确认（destructive，说明会替换当前抬头与行）
```

- **Behavior:** 选择器输入即搜索（服务端 `search`，按单号）；载入一次性替换；重复载入同一张只是重放；保存仍走既有校验
  （≥1 行、数量/单价 ≤4 位小数、买方必填）。
- **Responsive and accessibility:** 对话框由平台 `Dialog` 提供焦点陷阱、Esc 取消与 Cmd/Ctrl+Enter 提交；选择器为可键盘操作的 Combobox；
  错误用 `Alert`/行内提示（`role` 由平台组件提供）；窄屏面板换行不横向溢出；来源行链接有可见文本而非裸 URL。
- **Localization:** 新增 key 前缀 `internal_sales.form.quoteLoad.*`、`internal_sales.form.sourceQuote.*`、
  `internal_sales.list.actions.newOrderFrom*`（zh + en 各一份；字面量只写一种语言）。
- **Design-system and theming:** 只用语义 token 与共享原语（`Button`/`Dialog`/`ComboboxInput`/`FieldLabel`/`text-muted-foreground`），无硬编码颜色、无原始 `<form>`/`fetch`；浅色/深色沿用平台 token。

## Data Models

N/A — 本切片不新增实体、迁移或列。唯一新增的持久形状是安装层 `metadata` jsonb 上的一个键：

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `metadata.internalSales.sourceQuote.id` | string(uuid) | 无索引（不参与查询） | 否 | 创建订单时写入；更新不携带 = 不改；读时容忍缺失/脏形状 |
| `metadata.internalSales.sourceQuote.number` | string | 同上 | 否 | 仅为展示（`QUOTE-…`），不做唯一性或存在性校验 |

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/sales/quotes`（选择器列表） | `sales.quotes.view` | `search`、`pageSize`、`sortField=created_at`、`sortDir=desc` | `{ items, total }`（grid 投影） | 401/403 | REQ-001, REQ-004 |
| `GET` | `/api/sales/quotes?id=<id>` | `sales.quotes.view` | 单文档读（**完整**投影，含 `customerSnapshot`、`metadata`） | `{ items:[document] }` | 401/403/404 | REQ-001 |
| `GET` | `/api/sales/quote-lines?quoteId=<id>&pageSize=100` | `sales.quotes.view` | 父键过滤；响应 snake_case | `{ items:[line] }` | 401/403；`pageSize>100` → 400 | REQ-001 |
| `POST` | `/api/sales/orders`（既有） | `sales.orders.manage` | 头+行一次提交；新增可选 `metadata.internalSales.sourceQuote` | 201 `{ id }` | 400（≥1 行、币种）/403/409 | REQ-003 |
| `GET` | `/api/sales/orders?id=<id>`（编辑读，从 `ids=` 改） | `sales.orders.view` | 单文档读，完整投影 | `{ items:[document] }` | 401/403/404 | REQ-003 |

全部为既有路由，无新命令、无新事件、无新功能位。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 载入是纯客户端读+预填；订单创建继续发引擎既有的 `sales.*` 事件，无新增订阅者。

## Security, Privacy, and Compliance

- **Authorization:** 页面权限不变；读报价由安装层 `sales.quotes.view` 把关，缺位时 UI 只提示、不绕过（API 仍 403）。
- **Tenant isolation:** 所有读由平台 scoped 请求头 + 引擎组织过滤完成；来源键只存单据 id 与单号，不含任何跨租户数据。
- **Sensitive data:** `metadata` 新增键不含个人信息；买方信息仍走既有快照口径。
- **Abuse and failure modes:** 载入不写库（无重放/幂等风险）；来源键由 uuid + 展示串组成，不接受用户输入。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit (jest) | 纯函数夹具：报价抬头（buyer 快照 org/party 两种）+ snake_case/camelCase 行 | `loadQuoteIntoValues` / `hasOperatorInput` / `readSourceQuote` / `buildDocumentMetadata` / `toInternalSalesFormValues` 读回 metadata | 抬头与行逐字段映射；行 key 为本地非 uuid；脏检测覆盖空表单与手填；来源键写读往返、脏形状降级为空 | REQ-001, REQ-003, REQ-004 |
| TEST-002 | UI smoke（dev，记录证据） | dev server + 会话；预置一张含 1–2 行、买方=关联组织的报价（探针单，验后删除） | 订单新建 → 从报价单载入 → 改一行数量/单价 → 保存 → 打开编辑页 | 表单填入抬头与行；订单创建成功、`metadata.internalSales.sourceQuote` 落库（同 id/单号）；编辑页显示来源链接；报价单未被修改；另测 403 提示与「空报价」提示；窄屏 + 深色 | REQ-001…REQ-005 |

自动化集成（`yarn test:integration:ephemeral`）未纳入：`internal_sales` 模块目前没有 `__integration__` 目录，本切片沿用其既有
「单元测试 + 真机冒烟」验证口径；待模块整体补集成基线时一并覆盖。

## Implementation Phases

### Phase 1 — 载入主链路（订单新建页）

- **Depends on:** none
- **Outcome:** 订单新建页可以载入一张报价（抬头+行）并保存；订单上落来源键；编辑页显示来源。
- **Why this order / value delivered:** 这是能力本体；owner 的核心痛点（重录行）在此关闭。
- **Deliverables:** `lib/quoteLoad.ts`、`InternalSalesForm.tsx`（面板/对话框/映射/来源键/编辑页展示）、`toInternalSalesFormValues` 读回 metadata、编辑读路径 `ids=`→`id=`、zh/en 字典、单元测试。
- **Independent slices / estimated commits:** ①loader+映射+单测 → ②面板/对话框接线 → ③来源键与编辑页展示。
- **Requirements closed:** REQ-001、REQ-003、REQ-004
- **Tests:** TEST-001、TEST-002（Phase 1 部分）
- **Validation:** `yarn generate`、`yarn typecheck`、`npx jest src/modules/internal_sales`
- **Exit gate:** 真机（dev）载入一张报价并保存成功，落库 `metadata.internalSales.sourceQuote` 正确、报价未变；编辑页可见来源。

### Phase 2 — 报价列表入口与文档收口

- **Depends on:** Phase 1 exit gate
- **Outcome:** 从报价列表一步开单；文档（README/相关 spec/plan）与实际行为一致。
- **Why this order / value delivered:** 入口是发现性优化，依赖 Phase 1 的 loader；文档修正在行为定型后才能写准。
- **Deliverables:** `InternalSalesTable.tsx` 行操作、`?fromQuote=` 自动载入、i18n、README 与 quote-to-order spec 的过期表述修正、plan 进度行。
- **Independent slices / estimated commits:** ①列表入口 → ②文档与证据收口。
- **Requirements closed:** REQ-002、REQ-005
- **Tests:** TEST-002（列表入口与文案）
- **Validation:** `yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build`
- **Exit gate:** 列表行操作进入已载入的订单新建页；门禁全绿；README/spec/plan 无「界面没有入口」类过期表述。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, 订单新建页 | `GET /api/sales/quotes{,?id=}`、`GET /api/sales/quote-lines`、`POST /api/sales/orders` | 1 | TEST-001, TEST-002 | AC-001 |
| REQ-002 | J-002, 报价列表行操作 | 导航 `?fromQuote=` | 2 | TEST-002 | AC-002 |
| REQ-003 | J-003, 订单编辑页 | `metadata.internalSales.sourceQuote`；`GET /api/sales/orders?id=` | 1 | TEST-001, TEST-002 | AC-003 |
| REQ-004 | J-001 失败路径 | 403/网络错误；无写请求 | 1 | TEST-001, TEST-002 | AC-004 |
| REQ-005 | 报价列表两个动作 | 文案 + 既有 convert 不变 | 2 | TEST-002 | AC-005 |

## Rollout, Migration, and Rollback

- 无迁移、无种子、无开关：改动只在前端与字典。`yarn generate` 后随 PR 上线。
- 回滚 = revert 本 PR（无 DDL、无数据修复）；已写入的 `metadata` 键对新旧代码都是惰性数据（旧代码不读它，新代码容忍缺失）。
- 观测：无新增后台任务；载入失败只走 UI 提示。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 载入后订单与报价脱钩（一次性） | 报价改价不影响已建订单 | 这是刻意语义（对齐 `trade_docs` Q-10）；来源链接可回溯 | 操作员误以为会同步（文案写明「一次性」） |
| `metadata` 被后续编辑覆盖 | 来源信息丢失 | 本模块更新从不携带 metadata；编辑读 `id=` 拿完整投影 | 若有人用官方页面编辑并重写 metadata，可能丢失（接受） |
| 编辑读 `ids=`→`id=` | 编辑页读取行为变化 | 同一路由、同一投影语义（安装层详情页同款）；TEST-002 覆盖报价/订单两个编辑页 | 低 |
| 报价功能位与订单功能位不同源 | 有订单 manage 无报价 view 时载入 403 | 面板行内提示 + 重试；不隐藏页面 | 操作员可能不理解为何不能载入（提示文案解释） |
| 空报价（0 行） | 载入后无法保存 | 提示「该报价没有明细」，保留空行由操作员补 | 接受 |

## Acceptance Criteria

- [x] **AC-001** — 订单新建页可从报价载入抬头与全部行，保存前可改；表单有输入时先确认覆盖。
  （2026-09-29 真机：QUOTE-20260929-00022 → 载入 → 数量改 7 → 保存成功；脏表单载入先出 destructive 覆盖确认。）
- [x] **AC-002** — 报价列表行操作进入订单新建页并自动载入该报价；失败时停在可手填的表单。
  （2026-09-29 真机：行操作 href = `/backend/internal-sales/orders/create?fromQuote=<id>`，进页自动载入并 flash。）
- [x] **AC-003** — 载入生成的订单在 `metadata.internalSales.sourceQuote` 记录 `{id, number}`，编辑页可见且可跳回报价；报价单未被修改。
  （ORDER-20260929-00008：`?id=` 读回来源键；编辑页「来源报价单 QUOTE-…」链接到 `/backend/internal-sales/quotes/<id>/edit`；报价仍在、行仍 12。）
- [x] **AC-004** — 载入不发写请求；403/网络失败给可读提示且不改变表单内容。
  （载入只发 GET；拦截 `GET /api/sales/quotes` → 403 时面板显示「没有读取报价单的权限。」、表单保持为空。）
- [x] **AC-005** — 「转为订单」行为与门禁不变；两个动作的文案能区分语义。
  （行操作三项并存：编辑 / 按此报价新建订单 / 转为订单；convert 代码路径未改，报价描述文案已写明分工。）
- [x] 本切片界面沿用既有 `CrudForm`/`Dialog`/`ComboboxInput` 与语义 token，覆盖 loading/empty/error/权限/空报价/键盘/窄屏/深色状态。
  （Dialog 由平台提供 Esc/焦点陷阱、面板含 Cmd/Ctrl+Enter 提交；420px 窄屏与深色已核对；空报价提示与行内错误均已实现——空报价分支为代码路径，未用 0 行报价实测。）
- [x] Phase 1/2 的 exit gate 各有真机证据；配置门禁（`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build`）通过。
  （见 Changelog 的门禁行。）

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 根 `AGENTS.md`、`om-spec-writing`、`om-backend-ui-design` + `.ai/guides/backend-ui.md`、`.ai/guides/spec-delivery.md`、`docs/dev/parallel-development.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无新实体/路由/事件；三者都指向既有 sales 读接口与创建命令（见 Contracts 表） |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001/J-002/J-003 分别落在 Phase 1/2，无「收口阶段」承担行为 |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用 `CrudForm`/`Dialog`/`ComboboxInput`/既有映射函数与引擎 API |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI 契约表含参照页面、组件、状态与 i18n 前缀 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1/2 各自列出 |

Verdict: **Ready for implementation**

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 报价在订单建立后是否需留档？ | owner | no | **不留档**（2026-09-29）：报价保留在系统里即可，不要求它承担审计档案职责；因此「转为订单」的销毁语义可接受，两者并存 |
| Q-002 | 一张报价是否可能对应多张订单？ | owner | no | **是**（2026-09-29）：多张订单可能合一条柜、一张订单可能分批/多柜——载入必须能出第二张订单，故不能只靠就地转换 |
| Q-003 | 订单是否记录来源报价并展示？ | owner | no | **需要**（2026-09-29）：来源记在订单 `metadata` 并在编辑页可见 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-29 | 首版：订单从报价单载入（选择器 + 一次性预填 + 来源键 + 列表入口）；owner 答 Q-001…Q-003。 |
| 2026-09-29 | 实现并验证（Phase 1 + Phase 2 同一 PR）：`lib/documentValues.ts`（值编解码，从组件抽出）、`lib/quoteLoad.ts`、`components/QuoteLoadPanel.tsx`、`InternalSalesForm.tsx`（面板挂载、`?fromQuote=` 自动载入、创建载荷带 metadata、编辑读 `id=`）、`InternalSalesTable.tsx`（行操作）、zh/en 字典、`lib/__tests__/quoteLoad.test.ts`（27 tests 全绿）。真机（dev，探针单已删）：QUOTE-20260929-00022 → 载入 → 改数量 7 → ORDER-20260929-00008，`metadata.internalSales.sourceQuote` 落库、编辑页显示来源链接、报价未变；行操作 `?fromQuote=` 自动载入；脏表单覆盖确认；403 拦截提示。**顺带修正两处读/记录缺口**：① 文档读回的备注键是 `comment`（安装层序列化），值编解码改为两者兼容——此前备注在编辑页永不回显；② README/quote-to-order spec 里「安装层详情页没有 Convert to order」的记录与 `@open-mercato/core@0.8.0` 不符，已更正。门禁：`yarn generate` / `typecheck` / `lint`(0 error) / `check-lessons` / `ds:check`(907 files) / `test` / `build` 全绿。 |
