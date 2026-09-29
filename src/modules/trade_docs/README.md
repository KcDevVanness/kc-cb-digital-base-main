# `trade_docs` — 购销合同、发票与统一金额口径（金额 2 位 / 单价 4 位）

app 自有模块。**合同的唯一台账**：采购/销售两个方向的购销合同（含行、商品快照）→ 进项/销项发票
（可绑定合同行、扫描件归档）→ 合同头三列金额（合同金额 / 财务金额 / 差额）。需求与验收见
[`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `TradeDocsContract` / `TradeDocsContractLine` / `TradeDocsInvoice` / `TradeDocsInvoiceLine` → 表 `trade_docs_contracts` / `trade_docs_contract_lines` / `trade_docs_invoices` / `trade_docs_invoice_lines` |
| API | `GET|POST|PUT|DELETE /api/trade_docs/contracts`、`/invoices`；`GET /contracts/lines`、`/invoices/lines`（只读行面，行只经合同 / 发票命令写入）；`POST /contracts/transitions`、`/invoices/transitions`（状态流转：同路径的 GET 列表只为 CRUD 工厂解析作用域，不是 UI 契约）；`PUT /contracts/attach`（绑定盖章扫描件，`attachmentId: null` 解绑）、`PUT /invoices/attach`；`POST|GET /contracts/[id]/document`（生成 / 下载合同 Excel） |
| 命令 | `trade_docs.contracts.{create,update,delete,transition,attach,generate-document}`、`trade_docs.invoices.{create,update,delete,transition,attach}` |
| 后台页面 | `/backend/trade-docs/contracts`（列表/新建/详情/编辑）、`/backend/trade-docs/invoices`（列表/新建/编辑+确认/作废/附件）。**2026-09-28**：发票页标题改「税务发票台账」/ "Tax invoice ledger"，`pageGroupKey` 由 `cross_border.nav.group` 移入 `export_finance.nav.group`（「财务」组，`pageOrder 420`），create/edit 页同组嵌套（`pageOrder 421/422`），导航里不再出现在出口业务组 |
| 事件 | `trade_docs.contract.{created,updated,deleted,issued,signed,closed,cancelled,document.generated}`、`trade_docs.invoice.{created,updated,deleted,confirmed,voided,attached}` |
| 权限 | `trade_docs.contracts.view|manage`、`trade_docs.invoices.view|manage` |
| 迁移 | `migrations/Migration*_trade_docs.ts`（`yarn db:generate` 生成，审阅后应用） |

### PI（形式发票）— 2026-09-28 Phase 1

`trade_docs_documents` + `trade_docs_document_lines`（`kind='proforma'`/`'commercial'` 共用一张表；CI 的字段与页面在 Phase 2 接上）。
规格：[`.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`](../../../.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md)。

| 层 | 内容 |
|---|---|
| 实体 | `TradeDocsDocument` / `TradeDocsDocumentLine` → `trade_docs_documents` / `trade_docs_document_lines`；迁移 `Migration20260928021830_trade_docs.ts`（两张新表 + `trade_docs_contracts.incoterms` 追加列） |
| API | `GET\|POST\|PUT\|DELETE /api/trade_docs/documents`（列表按 `kind/status/direction/counterpartyId/sourceKind/sourceId/search` 过滤，`transformItem` 回传抬头快照与 `counterpartyName`）；`GET\|PUT /documents/lines`（只读行面 + 整组替换）；`POST /documents/transitions`；`PUT /documents/attach`；`POST /documents/[id]/generate`；`GET /documents/[id]/document`（按我方附件流式下发 XLSX） |
| 命令 | `trade_docs.documents.{create,update,delete,lines.replace,transition,generate-document,attach}`（`RESOURCE_KIND = trade_docs.document`） |
| 后台页面 | `/backend/trade-docs/proformas`（列表/新建/详情/编辑；`pageOrder 350/351/352/353`，出口业务组） |
| 事件 | `trade_docs.document.{created,updated,deleted,issued,voided,document.generated}` |
| 权限 | `trade_docs.documents.view\|manage`（既有租户需 `yarn mercato auth sync-role-acls`） |

**口径（与合同同构，别写第二套）**

- **发号在签发时**：`draft → issued` 才取 `PI-<年>-<4位>`（按 `(tenant, organization)` 独立），草稿先写 `PENDING-<id8>` 占位再解析真号；唯一索引 `trade_docs_documents_scope_number_uniq` 兜底，撞号 → **409** 重试（与 `nextContractNumber` / `nextOrderNumber` 同一口径）。
- **签发后冻结**：`update` 只允许 `draft`（否则 409）；`delete` 拒绝 `issued`（改作废）；行与头金额由命令重算——`amount` 缺省时 = `数量 × 单价` 按 **2 位** HALF_UP 量化，显式传入则以票面为准（`lib/money.ts` 的 `computeLineAmounts`）。
- **文件两条指针互不覆盖**：`generated_attachment_id`（我方渲染的 XLSX，重复生成前移指针、旧件保留）与 `attachment_id`（上传的盖章/回签/报关件）。
- **字典**：`setup.ts` 新增 `incoterms` 种子（EXW/FCA/FOB/CFR/CIF/CPT/CIP/DAP/DPU/DDP，单语言显示名）；合同的 `incoterms` 列与打印同步接上（F-005）。
- **收款要素**：`our_party_snapshot` 用 `lib/partySnapshot.ts` 的同一 shape（含 `partyId`/`bankAccountId`），合同表单（`OurPartyPicker`）与 PI 表单共用主体 + 银行账户选择器（F-004）。

### CI（商业发票）— 2026-09-28 Phase 2

与 PI 共用 `trade_docs_documents`（`kind='commercial'`）与全部命令/页面体；增量只有三处：

| 层 | 内容 |
|---|---|
| 页面 | `/backend/trade-docs/commercial-invoices`（列表/新建/详情/编辑，`pageOrder 360–363`，出口业务组）；头部另有收货人/通知方（快照）与发运单锚点选择器 |
| 汇总 | `trade_docs.documents.aggregate-lines` + `POST /api/trade_docs/documents/[id]/aggregate-lines`：按「该发运单的销售分摊 → 采购分摊」优先级复制成行（一次性，不自动同步），逐行写 `source_snapshot`（`sales_allocation` / `purchase_allocation` + 分摊行 id、数量、单价、覆盖标记）；仅 `draft` 且 `kind='commercial'` 可汇总 |
| 来源 | 发运单侧的 `cross_border_shipment_sales_allocations`（见 `cross_border` README）；`direction` 固定 `sales` |

### 税务发票 — 2026-09-28 Phase 3

仍是 `trade_docs_invoices`（**没有**并入 `trade_docs_documents`），追加列与原状态机不变：

| 层 | 内容 |
|---|---|
| 列 | `invoice_kind`（`vat_special`/`vat_general`/`export`，null=历史行「未分类」）、`our_number`（`TI-<年>-<4位>`，唯一索引）、`tax_total`、`gross_total`；行上 `tax_rate`（百分数）/`price_includes_tax`/`tax_amount` |
| 税额 | 唯一实现在 `lib/invoiceTax.ts`：含税 `税额 = 金额 − HALF_UP(金额/(1+税率), 2)`、不含税 `税额 = HALF_UP(金额×税率, 2)`、`价税合计 = Σ(含税行金额 或 不含税行金额+税额)`；`subtotal`/`total` 仍是票面行金额之和，含义未变 |
| 发号 | `confirm` 时对**销项 + 有票种**发票发 `TI-` 号（`PENDING` 占位 + 唯一索引 + 409 重试）；进项、无票种与历史行永不发号 |
| 口径隔离 | `lib/contractRecalc.ts` 的已确认发票查询排除 `invoice_kind='export'`（历史 NULL 行逐字节不变）：出口发票是退税凭证（0%），不参与合同「财务金额」 |
| 联动 | 详情按 `source_kind='shipment'` + `source_id` 给出柜（退税锚点）只读链接；`F-305` 的发票生成/打印未做（规格中标为可选，留待后续） |

## 单据间复制（Phase 4）

- 命令 `trade_docs.documents.copy-from`（PI → CI）与 `trade_docs.invoices.copy-from`（CI → 税务发票），路由 `POST /api/trade_docs/{documents,invoices}/[id]/copy-from`（`{ sourceDocumentId }` → `{ ok, lineCount }`）。
- **一次性**：复制抬头与明细后两张单据各自独立（重跑整组替换、不追加），明细行写 `source_snapshot = { kind: 'trade_document', documentId, number, lineNumber, copiedAt }`，抬头写 `source_kind='trade_document'` + `source_id` + 快照（`{ kind, id, number, documentKind }`）。
- 目标必须是 `draft`（已签发 409）；来源可在任何状态（已签发的 PI 正是常见来源）；来源必须同组织。
- 复制进发票时**不搬税**：`tax_rate` 保持 0 由业务补，也不动合同绑定；头部金额走 `applyInvoiceTotals` 重算。
- 界面：CI 详情「从形式发票复制」、发票详情「从商业发票复制」（共享搜索选择器对话框），来源以 `形式发票（PI） PI-2026-0002` 链回源单据详情。

## 合同行复用（REQ-005）

- 合同明细区「从订单/报价单复制行」（`components/ContractLineSourceDialog.tsx`）：采购方向只列采购订单；销售方向列销售订单/报价单，并按合同对方的**贸易类型**过滤 —— 对方是 `parties` 的 `branch` ⇒ 只列内部销售单据，`buyer` ⇒ 只列对外销售单据（`channelId` 过滤，通道缺失时不展开列表、只给提示）；对方没有主数据链接（手填/供应商）⇒ 两类都列，但每个选项都标出 `内部销售`/`对外销售`。
- **一次性追加**：复制的行追加到已录入行之后（不清空、不替换），逐行写 `source_snapshot = { kind: 'order_line', id, orderKind, copiedAt }`（`orderKind` = `purchase_order` / `sales_order` / `sales_quote`）；`trade_docs_contract_lines.source_snapshot` 列为本次追加（`Migration20260929073531_trade_docs.ts`）。
- **头部锚点**：首次复制写入 `source_kind`（`purchase_order` / 报价单也算 `sales_order`）+ `source_id` + `source_snapshot = { number, counterparty }`；明细区复制按钮旁只读回显来源，`×` 清除后可重新锚定；从未锚定的合同仍写 `null`（与本次改动前的落库形状一致）。
- 来源选择规则是纯函数（`lib/contractLineSource.ts`，含单测 `lib/__tests__/contractLineSource.test.ts`），网络读取复用官方 `sales/{orders,quotes,order-lines,quote-lines}` 与 `purchasing/purchase-orders/lines` 只读列表。

## 列表缓存失效（2026-09-28）

平台的 CRUD 列表在 `ENABLE_CRUD_API_CACHE=true` 时按「资源 + 租户 + 组织」缓存，`makeCrudRoute` 只失效
**本路由自己那个资源**。本模块的三类写因此各自显式失效（`lib/cacheInvalidation.ts`，在
`runWithCacheTenant` 内调 `invalidateCrudCache`）：

| 命令族 | 失效的集合 |
|---|---|
| `trade_docs.contracts.*` | `trade_docs.contract` + `trade_docs.contract.line` |
| `trade_docs.invoices.*`（含确认/作废/撤销） | 发票与发票行 **+ 合同与合同行**（确认会改写合同 `finance_total`） |
| `trade_docs.documents.*`（含生成/汇总/复制等 `[id]/…` 动作路由） | `trade_docs.document` + `trade_docs.document.line` |

回归口径：`__integration__/crud-cache-freshness.spec.ts` 用**无缓存击穿**的原始 URL 断言「写后即新」；
集成环境默认开着该开关（`ENABLE_CRUD_API_CACHE=true`），本地 `.env` 关着——只见于线上/集成，见
[lesson](../../../.ai/lessons/crud-cache-invalidation-spans-resources.md)。

## 金额口径（唯一权威定义在 `lib/money.ts`）

```text
行：数量 × 单价
   ├─ quantize(2)                → 财务金额（行绑定「已确认」发票行时取该发票行金额）
   └─ quantize(2)                → 合同金额（合同上打印的数字）
头：Σ 财务金额 = finance_total ；Σ 合同金额 = contract_total ；contract − finance = difference_total
```

- 量化是 BigInt 半进位（远离零），**禁止 `toFixed`**：`(1.005).toFixed(2) === '1.00'`。
- **金额恒 2 位、与币种无关**（JPY 也是 2 位），单价恒 4 位（`AMOUNT_SCALE=2`、`PRICE_SCALE=4`）；`currencies.decimal_places` 只是展示元数据，不再驱动舍入（`lib/currencyScale.ts` 已删除，见 [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](../../../.ai/specs/2026-09-28-money-scale-2dp-unification.md)）。合同与财务两个口径同为 2 位，唯一差异来自「已确认发票覆盖」。
- 发票优先是**逐行**、且只认 `confirmed`：草稿/作废发票不影响合同；作废后自动回退为按单价计算。
- 合同头的三列由 `lib/contractRecalc.ts` 在写入行的同一事务内重算，命令层不自己写算术。

## 对方：方向决定命名空间（2026-09-29）

- **`direction` 是唯一真源**：合同/单据 `purchase ⇒ supplier`、`sales ⇒ customer`；税务发票 `inbound ⇒ supplier`、`outbound ⇒ customer`。`counterpartyKind` 由命令推导（`lib/counterpartyRefs.ts` 的 `resolveCounterpartyKind`）：调用方不传即按方向落库，传了相冲突的值 400；update 一律写推导值，因此旧行在编辑时被顺带修正。三套 create/update schema 都会在两半同时出现时提前 400。
- **`counterpartyId` 归属校验**：非空时必须存在于对应命名空间（supplier → `purchasing_suppliers`；customer → `parties_parties`）、未软删、且属于**命令作用域（所选组织）**；否则 400 `counterparty_not_found`。不建跨模块外键（标量 id + scoped Kysely 只读）。
- **选择器**（`components/CounterpartyPicker.tsx`，bare group）：按方向加载唯一来源——采购读 `purchasing/suppliers`（可带 `organizationId` 收窄），销售读 `/api/parties/options?roles=buyer,branch`（`buyer`/`branch` 两来源合并，标签前缀 `分公司：`/`外部客户：`）。切换方向会清空已选对方与打印块；选中即用 `GET /api/parties/{id}`（客户）或 `GET /api/purchasing/suppliers/{id}`（供应商）回填名称/地址/联系人，并给出该主体的银行账户（默认账户优先）。存储的 id 在当前列表解析不到时（已删/收窄/历史）仍以一个种子选项显示，标签取快照名称。
- **快照**：对方快照仍是打印副本——`{name,address,contact,bank}`，从主数据选定时追加 `bankAccountId`（与 `our_party_snapshot` 同口径；`bank` 为银行名+账号+SWIFT 的合并文本，打印模板读它）。
- **部分更新不再重放创建默认值（缺陷修复）**：三套 update schema 由**默认无关**的字段表 `partial()` 生成，默认值只由 create schema 施加——此前 `.partial()` 会保留 `.default()`，`PUT {id, notes}` 会覆写 `direction`/`counterpartyKind`/`currencyCode` 并把 `lines:[]` 交给行写入而**清空全部行**。商业发票「必须销售方向」的守卫也补到了 update。
- **内联新建客户**：销售方向的「新增客户」对话框（`components/CustomerQuickCreateDialog.tsx`）走既有 `POST /api/parties`（`roles:['buyer']`，可选一行默认银行），保存后自动选中；按钮按 `parties.manage` 显示（chrome 未就绪时不隐藏），无权限时降级为提示。

## 规则（有意为之）

- **合同是聚合根**：行只能通过合同的 create/update 写入（行接口只读），行号由命令 1..n 分配。
- **状态机集中在命令**：`draft → issued → signed → closed`，`cancel` 仅 draft/issued 且**必填原因**（原因追加到 `notes`，与 purchasing 一致）；非法流转 422 且状态不变；`issue` 才分配单号
  `PC|SC-<年>-<4位>`（先写占位号再取号，唯一约束是最终保证）。
- **签发后锁定**：非 draft 合同不能编辑（409），明细与抬头都冻结。
- **行存快照**：`name/sku/model/spec/unit` 在写入时从 `products` 冻结，商品改名/删除不改写已出合同；
  引用只存标量 id（无跨模块 ORM 关联），`products` 侧的读取走 scoped Kysely。
  行的「单位」是从 `supplier_product_unit` 字典（`products/lib/unitOptions.ts`，与产品主数据、供应商产品库
  同一份词表）选的下拉；**已有值即使不在词表里也作为该行自己的选项保留**（`withCurrentUnit`），
  不会被静默清空 —— 要新增单位先在「字典库」里加一条。
- **发票金额以票面为准**：`amount` 不等于 `数量×单价` 也允许（真实发票有运费/折扣/舍入），
  合同行绑定它之后财务口径取票面值，差额留痕。
- **合同头的三处词表**：`paymentTerms` / `shippingMethod` 读本模块播种的 `payment_terms` / `shipping_method`
  字典（`setup.ts` 幂等写入，`yarn mercato seed:defaults --module trade_docs`；付款方式是合同上印刷的措辞，
  运输方式是海运/空运/铁路/快递/陆运），`destination` 读外贸模块的 `port` 字典。三者都是**带建议的输入框**：
  合同打印的是双方签下的原文，字典没收录的写法必须还能填。
- **发票号不唯一**：外部票号只建索引，不建唯一约束（两家系统可能重号）。
- **附件先建后绑**：发票先建 → 上传 `/api/attachments` → `attach` 绑 `attachment_id`；上传失败不回滚发票，行内可重试；本期只归档与下载，不解析。合同的双方盖章扫描件同理走 `PUT /api/trade_docs/contracts/attach`（`attachmentId: null` 解绑），它只动 `attachment_id`，生成的 XLSX 存在 `generated_attachment_id`，互不覆盖。
- **合同 Excel 最后补**：`lib/contractTemplate.ts` 的常量是唯一模板出处，`buildXlsx`（平台零依赖写入器）生成后**归档为附件**（重新生成会换新文件，旧文件保留）；金额写数字便于 Excel 求和；大写金额见 `lib/amountInWords.ts`。
- **合同表头跟随语言，不是硬编码双语**：模板的每个标题都是一个 `trade_docs.contracts.print.*` key，命令用 `resolveTranslations()` 取**生成者当前语言**的字典，再交给 `buildContractSheet(input, t)`；文件归档时语言就冻结了（重新生成是换新文件，不会改旧的）。中文语系生成的中文合同、英文语系生成的英文合同——不再出现「合同号 Contract No.」这种同一格里两种语言。金额的两个词形（人民币大写 + `SAY …`）保留：那是银行/报关对金额的固定双写，不是语言并列。
- **读写作用域**：读（列表）展开到下级组织，写（命令）只在当前选定组织生效 —— 下级组织的单据要切换组织后再操作，服务端会明确提示。

- **附件可预览（2026-09-24）**：合同盖章件、发票归档件与合同列表的「查看文件 / 预览」走 app 级共享查看器（`src/lib/attachments/AttachmentPreview.tsx`）：图片对话框内等比显示，PDF 由 Mozilla PDF.js（`pdfjs-dist`，已声明依赖）渲染到 canvas（`src/lib/attachments/PdfPreview.tsx`），其它类型给出说明；「下载」入口与 `?download=1` 不变。

## 验证

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check
yarn jest --config jest.config.cjs src/modules/trade_docs
# 冒烟（dev server 在跑时）：建合同 201 → 非法流转 422 → issue 得 PC-<年>-0001 → 换币种 0 位小数时
# 合同金额与财务金额分离 → 发票 confirm 后财务金额取票面、void 回退 → 上传+绑定附件 200 →
# POST/GET [id]/document 生成并下载 XLSX（内容类型为 xlsx，金额列可求和）
# 附件预览冒烟（2026-09-24）：合同详情「盖章件」与发票表单/列表的「查看文件」→ 图片等比显示 / PDF 由 PDF.js 渲染到 canvas / 其它类型说明 + 下载（同一组件，见 purchasing README）
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'trade_docs', from: '@app' }` 并 `yarn generate`；表与迁移保留
（迁移是**向前-only** 的，`yarn mercato db` 只有 `generate` / `migrate` / `greenfield`，没有 `down`：
回滚数据只能从备份恢复，或用 `yarn db:greenfield` 重建库——后者是破坏性的，需所有者批准）。
合同 Excel 生成的附件仍留在存储驱动中（不随模块回滚删除）。
