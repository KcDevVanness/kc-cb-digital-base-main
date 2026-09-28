# 外贸三单据：PI（形式发票）/ CI（商业发票）/ 税务发票

**Date**: 2026-09-24
**Status**: Phase 0–4 已实现并验证（2026-09-28）；规格完成（F-305 发票生成/打印为规格内可选项，未做）

> 关联规格：[`2026-09-21-cross-border-shipments.md`](./2026-09-21-cross-border-shipments.md)（出口单证 B-3 / PRD Q1）、
> [`2026-09-22-products-and-trade-docs.md`](./2026-09-22-products-and-trade-docs.md)（购销合同与发票台账）、
> [`2026-09-22-order-file-and-export-finance.md`](./2026-09-22-order-file-and-export-finance.md)（收汇 / 退税锚点）。
> 业务口径（2026-09-24，业务人员确认）：**PO / PI / CI 三件套都要**，三条流程全部保留。
>
> **决策确认（2026-09-28，业主）**：本文「推荐口径」表 Q-1…Q-12 **全部照原样确认为开工基线**；N-3 按原文执行（采购组报价页改名「供应商报价单（SQ）」）。
> 本文已按 `SPEC-000-template.md` 补齐至可实施状态。**代码尚未开工**；实现顺序 Phase 0 → Phase 4，
> 一次只进一个 phase（`om-implement-spec`），每阶段自己的验收证据落地后才进入下一阶段。

## TLDR

外贸链上业务要用**三张单据**：**PI**（形式发票，发货前开给买方作为收款依据）、**CI**（商业发票，出口报关/清关用）、
**税务发票**（境内税务口径的进项/销项票，含出口发票）。今天系统里只有第三张的一半（`trade_docs` 的发票**台账**：登记外部票号 + 扫描件）
和 CI 的一个**空槽位**（`cross_border` 单证类型 `commercial_invoice`，只存单号/日期/附件），PI **完全没有承载**。
本规格补齐三张单据的**结构化字段、我方发号、生成 XLSX 与归档**，并把它们挂到既有锚点
（内部销售订单 / 采购订单 / 发运单 / 合同）上，不改动既有链路的语义。
承载方式：PI + CI 进 `trade_docs` 的新表 `trade_docs_documents`（`kind` 区分，命令与页面体共用一套）；
税务发票继续由既有 `trade_docs_invoices` 承接（追加票种与税务列），保证「`confirmed` 发票 → 合同财务金额」只有一个写入方。

## Problem Statement

### 现状盘点（代码级证据）

| 单据 | 今天的承载 | 实际能力 | 证据 |
|---|---|---|---|
| **PI** | **无** | 全仓无 PI 单据、无 `PI-` 发号、无生成；「形式发票」只作为供应商 Excel 的表名被导入成报价 | `cross_border/data/validators.ts:15-25`（单证类型枚举无 proforma）；`sourcing/lib/__tests__/headerDetection.test.ts:81` |
| **CI** | `cross_border` 单证类型 `commercial_invoice` | 只有「类型 + 单号 + 签发日 + 可选采购单 + 附件 + 备注」，**无金额/币种/行/收货人**，不生成文件 | `cross_border/data/validators.ts`（`EXPORT_DOC_TYPES` 含 `commercial_invoice`；`documentCreateSchema.shipmentId` 必填）、`cross_border/data/entities.ts`（`cross_border_export_documents`）、`components/ShipmentForm.tsx:103-130` |
| **税务发票** | `trade_docs` 发票台账 `trade_docs_invoices` | 进项/销项登记：外部票号、对方、绑合同/合同行、币种、小计/合计、开票日期、扫描件、draft→confirmed→void | `trade_docs/data/entities.ts`（`trade_docs_invoices` / `trade_docs_invoice_lines`）、`data/validators.ts:88-90`（`INVOICE_STATUSES` / `INVOICE_TRANSITIONS`）、`i18n/zh.json:164-171` |

### 缺口清单

**PI（形式发票）— 从零开始，缺口最大**

1. **没有任何承载**：出口单证的类型枚举里没有 proforma；官方 `sales` 链也没有 proforma 单据；`trade_docs` 发票没有「票种」维度（只有 `direction: inbound|outbound`）。
2. **锚点时机不符**：出口单证行**必填 `shipmentId`**（`cross_border/data/validators.ts` 的 `documentCreateSchema`），而 PI 是**发货前**开的 → 挂不到发运单上。
3. **没有我方发号**：现有编号序列只有 `PO-<年>-<4位>`（`purchasing/commands/orders.ts:439-466` 的 `nextOrderNumber`）、
   `PC-/SC-<年>-<4位>`（`trade_docs/commands/contracts.ts:226-255` 的 `nextContractNumber`）、installed sales 的 `QUOTE-/ORDER-`。
4. **收款要素无处可取**：PI 要写受益人银行账户，而合同上的我方抬头/银行是**手工录入并快照**
   （`trade_docs/components/ContractForm.tsx`、`ContractDetail.tsx`）；主数据 `parties_bank_accounts` 已有银行名/账号/SWIFT
   （`parties/data/entities.ts:142` 起的 `PartyBankAccount`，含 `is_default` 部分唯一索引）却**没有任何单据消费**。
   付款条款只在合同上（`trade_docs_contracts.payment_terms`），内部销售订单没有该字段。
5. **不生成文件**：全仓只有合同能生成 XLSX（`trade_docs/commands/contracts.ts:624-713` → `lib/contractTemplate.ts:126` 的 `buildContractSheet` → `buildXlsx` → `createAttachmentFromBuffer`），PI 只能手工做 + 上传。

**CI（商业发票）— 有槽位，没有内容**

1. 单证行字段不含金额/币种/行项目/收货人/贸易术语 → 报关用的 CI 金额只能靠附件里的 PDF，系统内查不到、对不上发运分摊行。
2. 发运单本身只有物流字段（`cross_border/data/entities.ts` 的 `CrossBorderShipment`）+ 分摊行数量（`cross_border_shipment_allocations`），
   没有贸易术语/收货人/金额 → CI 若要结构化，需要补发运单或从分摊行派生（本规格取后者，见 Q-4/Q-12）。
3. **发运单 ↔ 内部销售订单无任何关联**：`cross_border` 全模块无 sales 引用，分摊实体只有 `purchase_order_id`/`purchase_order_line_id`
   （`cross_border_shipment_allocations`）；而业务链是「内部销售订单 → 拣货装箱 → 报关 → 发运」（`docs/dev/business-architecture.md` 链路②），
   CI 的买方=分公司、价格来自内部销售订单 → 不对齐只能人工抄。
4. 出口单证的范围仍是 PRD 未决问题 Q1（`docs/prd/cross-border-erp.md` 开放问题表），当年以「最小结构化字段 + 附件」的可逆默认落地。

**税务发票 — 只有台账，没有"票"**

1. **无票种**：没有增值税专用/普通/出口发票的区分，`number` 的标签就是「票号（外部）」（`trade_docs/i18n/zh.json`）。
2. **无税务字段**：行只有 `quantity/unitPrice/amount`，没有税率/税额/价税合计。对照：采购单行**已有**
   `tax_rate`（numeric(6,3) default '0'）/ `price_includes_tax`（boolean default true）/ `tax_amount`（numeric(18,2)）
   （`purchasing/data/entities.ts:245-262`）可直接复用口径。
3. **无我方发号**：合同在 `issue` 时才发号；发票 `confirm` 只翻状态（`trade_docs/commands/invoices.ts` 的 `trade_docs.invoices.transition`）。
4. **口径耦合是坑**：只有 `status='confirmed'` 且绑定合同行的发票行会覆盖合同的**财务金额**
   （`trade_docs/lib/contractRecalc.ts:39-49`，**不按票种过滤**）→ 任何以 confirmed 登记的 PI/CI/出口发票若绑了合同行，会污染「合同金额 / 财务金额 / 差额」三列。
5. **不生成文件**：发票同样只能归档扫描件。

### 与三个「相近页面」的边界（外形像 ≠ 可合并）

`/backend/internal-sales/quotes`、`/backend/internal-sales/orders`、`/backend/trade-docs/invoices` 外表相似
（都是「抬头 + 行」的单据页，因为平台把这类面统一交给 `DataTable` / `CrudForm`），但归属和语义完全不同：

| 维度 | internal-sales 报价 / 订单 | trade-docs 发票 |
|---|---|---|
| 归属 | **界面层**：app 模块驱动 installed `sales`（`fetchCrudList('sales/orders')`，本模块自无表、自无 API） | **自有表**：`trade_docs_invoices` + 自有命令/API |
| 金额语义 | 引擎按行重算（数量×净价 + 税策略） | **票面行金额之和**，可 ≠ 数量×单价，因为要贴对方票面 |
| 单号 | 引擎发号 `QUOTE-/ORDER-…` | **外部票号**（登记对方号；本规格追加我方 `TI-` 号） |
| 状态 | 由引擎字典（报价 `sent` 等） | `draft → confirmed → void`，且 `confirmed` 会改写合同**财务金额**（`lib/contractRecalc.ts:39-49`） |
| 对方主数据 | `customers/companies` | `purchasing` 供应商 + `parties` |
| 附件 | 无 | 扫描件归档（`attachmentId` + `/api/attachments`） |
| 下游消费者 | 订单是**履约锚点**（发货/发票/收款） | 合同金额口径 + 退税资料 |

结论：**不能合并成一个模块或一张表**（归属、金额语义、下游消费者、权限都不同）；
可共享的是三处**缝**：① 交易对手选择器（今天三套并存，`docs/dev/business-architecture.md` 的「尚未切换的 `customers` 消费方」表已把它列为待定）；
② 「生成文件 + 归档附件」的 seam（合同 XLSX 已有，`trade_docs/commands/contracts.ts:649-713`）；
③ 页面形态本身（`DataTable`/`CrudForm`，无需自造）。

**对三张新单据的启示**：PI / CI / 税务发票都是「我方开出、我方发号、要出文件」的单据，
更像 `trade_docs` 那种**自有表单据**，而不是 `internal_sales` 那种**引擎界面层**（官方 `sales` 链里没有 proforma，
也塞不进它的状态机）。

## Overview and Success Measures

- **Primary outcome:** 外贸三张单据在系统内闭环——PI 发货前签发并可打印收款要素、CI 报关金额可对账到发运分摊、
  税务发票可按票种与税率登记并支持出口发票 0%；每张单据都能生成 XLSX 归档且能挂回既有锚点。
  可量化目标：一次「建 PI → 签发 → 生成 XLSX → 下载」全程在系统内完成（0 次手工拼 Excel）；
  一张柜的 CI 行数量与分摊行**逐行一致**；出口发票登记后合同三列金额**零变化**。
- **Leading indicators:** 新页面创建/签发单据数；`trade_docs.document.issued` 事件量；
  编号冲突 409 次数（应接近 0）；CI 汇总后人工覆盖行占比（衡量分摊数据质量）。
- **Baseline:** 今天 PI/CI 承载为 0（PI 无表、CI 只有附件槽位）；税务发票无票种与税务字段（见「现状盘点」的代码级证据）。
- **Market / product reference:** 通用外贸/关务做法——PI 是发货前的收款依据（列明收款账户、付款条款、有效期），
  CI 按报关行要求列明收货人/贸易术语/发票金额且金额须与装箱数据对账，出口发票以 0% 税率供退税。
  **采用**：结构化字段 + 我方发号 + 服务端生成 XLSX 归档。
  **拒绝/延后**：PDF 引擎（首版零新依赖，Q-3）；把三张单据塞进同一张表（归属与下游消费者不同，见上「边界」）；
  与税务系统/开票软件对接（不在本切片）。

## Goals

- **REQ-001** — PI 可在发货前签发：结构化抬头/行/收款要素/贸易术语 + 我方发号 `PI-<年>-<4位>`（按组织），
  锚点为内部销售订单**或**采购订单（两侧都要），允许一张订单开多张 PI。
- **REQ-002** — PI/CI 可生成 XLSX 并归档为附件，可被上传件替换；详情页可下载/预览（首版无 PDF）。
- **REQ-003** — CI 结构化（金额/币种/收货人/通知方/贸易术语），行从发运单分摊汇总（数量与分摊一致），单价/金额可手工覆盖且逐行留来源；无发运单时（预报关）也能开。
- **REQ-004** — CI 在系统内**只有一个真相源**：`cross_border` 的 `commercial_invoice` 槽位完成处置，不再产生第二张"商业发票"。
- **REQ-005** — 发运单 ↔ 内部销售订单建立分摊关联（与采购分摊同构，一柜可对多单），CI 的行与买方由此生成。
- **REQ-006** — 税务发票支持票种（增值税专用 / 普通 / 出口发票）+ 税率/税额/价税合计 + 我方发号 `TI-<年>-<4位>`（签发时），
  并与 `export_finance` 的退税资料（按柜）互链。
- **REQ-007** — 合同金额口径隔离：出口发票与 PI/CI **不改变**合同三列的「合同金额 / 财务金额 / 差额」，有回归测试锁死。
- **REQ-008** — 合同我方抬头/银行从 `parties` 主体 + 银行账户选择后**快照**；贸易术语（incoterms）入字典并出现在合同/PI/CI。
- **REQ-009** — 统一承载与权限：PI/CI 共用 `trade_docs_documents` + `trade_docs_document_lines`（一套命令与页面体）；
  新功能位 `trade_docs.documents.view|manage`；组织作用域 fail-closed。
- **REQ-010** — 术语与菜单校正 N-1…N-6（「出口业务」组名、税务发票台账移入财务组、报价页挂业务缩写）。
- **REQ-011** — 单据间一次性复制 + 来源链接（PI → CI → 税务发票），复制后各自可改，来源可追。

## Non-goals

- 不重写官方 `sales` 单据链（发货/发票/收款/退货仍由它承担），不 eject 任何 installed 模块。
- 不做 PDF 生成（首版仅 XLSX；PDF 待后续依赖决策），不做税务系统/开票软件/电子发票对接。
- 不改出口报关的实际申报动作（系统只出单据与归档，不代替报关行）。
- 不迁移既有 `trade_docs_invoices` / `cross_border_export_documents` 历史数据；新列可空、历史行语义不变。
- 不改既有 `PC-/SC-/PO-/SQ-` 编号规则与既有单据状态机（合同 `draft→issued→signed→closed`、发票 `draft→confirmed→void`）。
- 不做单据间实时同步（只存链接 + 一次性复制，Q-10）；不做分摊变更后的自动重算与自动差异提示。
- 不新增 `cross_border` 的装箱/分箱模型（分摊到行已覆盖拼柜/拆柜）。

## Proposed Solution

PI 与 CI 是同一个形状的「我方开出」单据，共用一个新实体族：

```text
trade_docs.documents（kind = proforma | commercial）
   ├─ 抬头：我方主体+银行快照 / 对方快照 / （CI）收货人+通知方
   ├─ 元信息：编号、签发日、币种、汇率快照、贸易术语、付款条款、有效期（PI）
   ├─ 行：trade_docs_document_lines（product 快照 + 数量/单价/金额 + 来源快照）
   └─ 文件：generated_attachment_id（我方渲染 XLSX）+ attachment_id（上传替换件）
```

- **发号**：`draft → issued` 时签发（`PI-<年>-<4位>` / `CI-<年>-<4位>`，按 `(tenant, organization)` 独立），
  复用 `nextContractNumber`（`trade_docs/commands/contracts.ts:226-255`）与 `nextOrderNumber`（`purchasing/commands/orders.ts:439-466`）的既有口径：
  读同前缀最大号 +1、四位补零、**唯一索引兜底**、冲突 → 409 重试。草稿不消耗序号。
- **生成**：`buildDocumentSheet(input, t)`（新 `lib/documentTemplate.ts`）复用合同的 `buildXlsx` + `amountInWords` + `createAttachmentFromBuffer` seam；
  重复生成 = 新附件 + 指针前移（旧文件保留），与合同口径一致。
- **税务发票**留在 `trade_docs_invoices`：追加 `invoice_kind` 与税务列，`confirm`（既有签发动作）为销项票发 `TI-` 号；
  `contractRecalc` 只增加一条票种排除（export），其余照旧。
- **CI 的数据来源**：`cross_border` 新增 `cross_border_shipment_sales_allocations`（与采购分摊同构），
  CI 的行按「销售分摊 → 采购分摊 → 手工」优先级汇总，一次性复制并逐行留来源快照。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| PI/CI 共用 `trade_docs_documents` + `kind`；税务发票留在 `trade_docs_invoices` 追加列 | Q-11 的「统一表 + 复用一套命令与页面体」；两张出口单据字段同构。税务发票的 `confirmed → 合同财务金额` 只能有一个写入方，挪表会把该口径与既有台账数据切开 | ① 三张各自建表；② 三张全部进新表；③ 全部扩列既有表 | ① 命令与页面三套、审计/事件/权限面翻三倍；② 合同金额口径跨表且要迁移既有台账；③ 出口单证槽位必填 `shipmentId`，承载不了发货前的 PI |
| 表名 `trade_docs_documents`（不是稿内写的 `trade_documents`） | 本仓表名一律 `<moduleId>_<plural>`（`trade_docs_contracts`、`trade_docs_invoices`、`parties_bank_accounts`、`cross_border_shipments`）；`trade_documents` 会被读成另一个模块 | 字面沿用 `trade_documents` | 与模块前缀惯例冲突，且 API/ACL 前缀（`trade_docs.`）对不上 |
| 发号时机统一在**签发**（`draft → issued` 才取号） | 与合同 `issue`、发运单 `depart` 的既有口径一致；草稿删除/作废不产生号段空洞 | 创建即发号（功能清单 F-102 的字面） | 草稿消耗序号；与合同/发运单口径分叉，且 PI/CI 的草稿本来就允许推翻重来 |
| 命令与 API 统一为 `trade_docs.documents.*` / `/api/trade_docs/documents`，`kind` 走判别校验 | Q-11 统一承载的直接后果：一份审计、事件、权限与页面体 | 按类型分命令 ID（`trade_docs.proformas.create` …） | 行为完全相同却双倍命令面与事件面；页面仍按类型分开（菜单需要两个入口） |
| 功能位 `trade_docs.documents.view\|manage` | 本仓 ACL 特性 ID 一律 `<moduleId>.<capability>`（既有 `trade_docs.contracts.*` / `trade_docs.invoices.*`），且特性 ID 是冻结面 | 稿内写的 `trade_documents.view\|manage` | 前缀指向不存在的模块 `trade_documents` |
| CI 行来源优先级：销售分摊 → 采购分摊 → 手工 | 买方=分公司、价格来自内部销售订单（F-006）；但预报关/发货前可能还没有内部销售订单（Q-9） | 只认销售分摊 | 发货前的 CI 无行可开 |
| 销售分摊行带 `unit_price`/`currency_code` 快照 | 跨模块只存标量 + 快照；CI 默认价取内部销售订单当时值，事后改价不改已开单据 | 实时读 installed `sales` 订单行 | 违反冻结快照口径，且把 CI 与引擎状态绑死 |
| 税务发票发号挂在既有 `confirm` 上 | `contractRecalc` 只看 `status='confirmed'`；新增 `issued` 状态会扩宽既有状态机与台账 UI/API 契约 | 新增 `issue` 动作（F-302 的字面） | 三态是既有契约面（台账 UI 与 `contractRecalc` 都按它写死） |
| `contractRecalc` 只排除 `invoice_kind='export'` | 出口发票是退税凭证、不是结算凭证；其余票种与历史行（`invoice_kind IS NULL`）行为逐字节保持 | 所有票种照旧参与 | 0% 退税票会污染合同三列（REQ-007） |
| 合同我方抬头/银行改「选 `parties` 主体 + 银行账户 → 快照」，与 PI 共用同一 snapshot shape | 收款账户是资金风险点，必须来自主数据；快照保证换账户不动历史单据 | 继续手填四个文本框 | 手填与主数据脱节，PI 印错账户是资金风险 |
| `cross_border` 的 `commercial_invoice` 槽位保留枚举、业务上停止新建 | 禁止双真相；但移除枚举会让既有行无法编辑/显示，且迁移既有数据不是本切片范围 | 从 `EXPORT_DOC_TYPES` 移除该类型 | 破坏既有行（BC 面：枚举/行语义），且违反「不改既有数据」边界 |

### 对既有页面的改动判定（合同 / 发运单）

#### `/backend/trade-docs/contracts` — 小改，不重构

它已经是完整的「自有表单据」：发号 `PC-/SC-<年>-<4位>`、状态机 `draft→issued→signed→closed`、行快照、
双口径金额（合同/财务/差额）、签发后锁定、生成 Excel、盖章件附件。PI/CI 不推翻它，但有三处必须补、一处可选：

| # | 改动 | 现状（证据） | 为什么 |
|---|---|---|---|
| C-1 | 我方抬头/银行改为「选 `parties` 主体 + 银行账户 → 快照」 | 手填文本框快照进 `our_party_snapshot`（`components/ContractForm.tsx`、`ContractDetail.tsx`） | PI 的收款账户来自同一处；手填与主数据脱节，PI 印错收款账户是资金风险 |
| C-2 | 补**贸易术语（incoterms）** | 全仓 grep 无 incoterm / EXW / FOB / CIF | 合同 / PI / CI 都要印；落在字典（与 `payment_terms`、`shipping_method` 同构的种子，`trade_docs/setup.ts:16-33` 的用法）并允许自由输入 |
| C-3 | **金额口径收口**（跟随 REQ-007） | `lib/contractRecalc.ts:39-49` 只按 `status='confirmed'` 过滤、不看票种 | 加了票种之后必须显式声明哪些票种参与财务金额；出口发票**不得**影响，需测试锁死 |
| C-4（可选） | 合同的「来源单据」接上 UI | `sourceKind: purchase_order \| sales_order \| manual` 只有 schema，表单里没有该字段 | 若 PI 以合同为锚点或要溯源，需要一个可选选择器 |

**不需要改**：方向/状态机/行快照/双口径算法/Excel 生成/附件。

#### `/backend/cross_border/shipments` — 需要真改（它是 CI 的锚点）

| # | 改动 | 现状（证据） | 为什么 |
|---|---|---|---|
| S-1 | **发运单 ↔ 内部销售订单 无关联**（最大的结构性缺口） | `cross_border` 全模块无 sales 引用；分摊实体只有 `purchase_order_id`/`purchase_order_line_id` | 业务链是「内部销售订单 → 拣货装箱 → 报关 → 发运」，CI 的买方=分公司、价格来自内部销售订单 → 不对齐只能人工抄。本规格落为**新表 `cross_border_shipment_sales_allocations`**（Q-12：分摊到行） |
| S-2 | **CI 的双真相处置** | `commercial_invoice` 只是个下拉项（`EXPORT_DOC_TYPES` + i18n + `ShipmentForm.tsx:103-130` 的标签表 + `ShipmentDetail.tsx:527-532` 的选项源），没有命令、没有测试引用它 | 新 CI 单据上线后必须二选一：本规格取「保留枚举、停止新建 + 详情页跳转新单据」，禁止双份真相 |
| S-3 | 贸易术语 / 收货人 / 通知方 | 发运单只有 `departure_port`、`destination_warehouse_id`、`destination_location_id` | CI 要印收货人与术语。**放在单据上**（CI 可独立重开，预报关时可能还没有发运单），发运单只提供行与数量 |
| S-4 | 税务发票（出口发票）联动 | 退税档案按发运单唯一（`export_finance_refunds` 的 `(tenant, organization, shipment_id)`） | REQ-006 走这条现成锚点，发运单侧**无需改结构**（只加只读互链） |

**不需要改**：多对多分摊、超发校验、里程碑单调、收货回写采购单行、柜型/箱号/封条/订舱号。

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| PI（形式发票） | 发货前开给买方（销售侧，对分公司）或供应商（采购侧）的收款依据；我方发号 `PI-<年>-<4位>`；状态 `draft→issued→void` | `trade_docs_documents(kind='proforma')` | 越态转换 422；编号冲突 409（重试取新号） |
| CI（商业发票） | 出口报关/清关与对分公司结算用的商业单据；买方=分公司/海外买方；行 = 柜内商品；金额须能与发运分摊对账 | `trade_docs_documents(kind='commercial')` | 汇总时发运单不存在/已取消 422 |
| 税务发票 | 境内税务口径的进项/销项票；票种 `vat_special`（增值税专用）/ `vat_general`（增值税普通）/ `export`（出口发票）；我方号 `TI-<年>-<4位>` 仅在**销项**且 `confirm` 时签发 | `trade_docs_invoices` | 未选票种视为「未分类」（历史行同义），不参与新校验 |
| 出口发票 | 票种 `export`，税率 0，供退税；**不参与**合同财务金额；可与按柜的退税资料互链 | `trade_docs_invoices(invoice_kind='export')` + `export_finance_refunds` | 若被绑定到合同行，登记后合同三列**不变**（回归测试） |
| 合同三列金额 | `contract_total`（票面）/ `finance_total`（财务）/ `difference_total`（差额）；财务金额只由「非 export 票种 + `confirm` + 绑定合同行」的发票行驱动 | `trade_docs_contracts` / `lib/contractRecalc.ts` | 非法票种尝试绑定不报错但**不影响**金额（口径隔离） |
| 一单多张 | 同一订单/发运可开多张 PI/CI（分批收款、分批出货、部分报关）；**不设** 1:1 唯一约束 | `trade_docs_documents.source_kind/source_id` | — |
| 来源快照 | 跨模块引用一律「标量 id + 快照」；复制是**一次性**的，复制后两边独立 | `*_snapshot` jsonb 列 | 来源被删不级联、不改已开单据 |
| 编号规则 | `<PRE>-<年>-<4位>`，按 `(tenant, organization)` 独立；最大号 +1、四位补零；唯一索引兜底 | 三个发号器（PO/PC-SC/PI-CI-TI） | 唯一冲突 → 409，重试时重新读最大号 |
| 金额口径 | 行 `amount` 是**票面金额**，默认 `HALF_UP(数量 × 单价, 2)`（金额与币种无关、恒 2 位），可手工覆盖；头 `subtotal` = Σ 行 `amount`，由命令重算（唯一写入方） | `trade_docs_documents` / `trade_docs_document_lines` | 覆盖不影响来源快照（追溯保留） |
| 价税合计 | `gross_total`（价税合计）= Σ 行（含税口径金额）；`tax_total` = Σ 行 `tax_amount`；不含税合计 = `gross_total − tax_total`；0% 票种 `tax_amount = 0` | `trade_docs_invoice_lines` / `trade_docs_invoices` | 命令重算，前端只读 |
| 单据文件 | `generated_attachment_id`（我方渲染 XLSX，可重复生成、指针前移）与 `attachment_id`（上传替换件：盖章件/对方回签/报关件）**互相独立**；上传件就绪后以它为对外件 | `attachments`（installed） | 未生成时下载入口禁用；重复生成保留旧文件 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 外贸业务（staff） | PI/CI 的 list/create/update/delete/签发/生成/上传；税务发票台账登记与确认 | 读：可读组织集（含下级）；写：当前所选组织 | `trade_docs.documents.view` / `trade_docs.documents.manage`；台账沿用 `trade_docs.invoices.view\|manage` |
| 财务 | 税务发票台账（票种/税额/确认）+ 退税资料互链；只读 PI/CI | 同上 | `trade_docs.invoices.view\|manage`（+ `trade_docs.documents.view` 只读） |
| 管理员 | 全量（`trade_docs.*`） | 同上 | `trade_docs.*` |

- **信任边界**：`tenantId` / `organizationId` 一律由服务端 auth context 推导（`ensureScope` 同款），**绝不**接受请求体里的 scope；
  写操作落在所选组织，读操作展开到调用方可读组织集（`.ai/lessons/read-expands-writes-are-selected-org.md`）。
- **失败闭锁**：无 `organizationId` 或不可读的 id → 401/403/404（不可见），不返回跨组织数据；无功能位 → 403。
- **系统作用域**：本切片不新增任何 `organizationId: null`（system scope）操作；无installed 契约被用来放宽作用域。
- **权限落地**：`src/modules/trade_docs/acl.ts` 追加 `trade_docs.documents.view` 与 `trade_docs.documents.manage`（后者 `dependsOn` 前者）；
  `setup.ts` 的 `defaultRoleFeatures`（superadmin/admin 已是 `trade_docs.*`）；既有租户需 `yarn mercato auth sync-role-acls`
  （`.ai/lessons/module-features-need-role-acl-sync.md`）。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| PI/CI 承载（表+命令+页面） | app-own | `trade_docs`（新表 `trade_docs_documents` / `trade_docs_document_lines`） | 本模块实体 + 命令 + `makeCrudRoute` | 三张单据里两张字段同构、归属 trade_docs |
| 税务发票票种/税务字段 | extend | `trade_docs`（既有 `trade_docs_invoices` / `_lines` 追加列） | 追加可空/带默认列 + 既有 `confirm` 动作 | 合同财务金额口径只有一个写入方 |
| 发运单 ↔ 内部销售订单分摊 | extend | `cross_border`（新表 `cross_border_shipment_sales_allocations`） | 随发运单命令写入（同 `replaceAllocations` 的写法） | 分摊只是发运单的一部分，拆模块会让「一柜多单」跨事务 |
| 出口单证 `commercial_invoice` 槽位 | extend（行为收窄） | `cross_border`（枚举不动，业务上停止新建） | 详情页跳转新 CI 单据 | 禁止双真相、不动既有数据 |
| 我方主体 + 银行账户 | reuse | `parties` | 选项源 `/api/parties/options`（`?search=`/`?ids=`）+ `/api/parties/{id}` 的 `bankAccounts`；选择后写快照 | 收款账户必须来自主数据；快照冻结历史 |
| 商品/单位/币种/对方选择器 | reuse | `products` / `dictionaries` / `currencies` | `trade_docs/components/formOptions.ts` 既有 loader（`loadProductOptions` / `loadUnitOptions` / `loadCurrencyOptions` / `loadCounterpartyOptions`） | 不造第二套选择器 |
| 贸易术语字典 | extend | `dictionaries`（`trade_docs/setup.ts` 新增 `incoterms` 种子） | 与 `payment_terms` / `shipping_method` 同构 | 字典是既有词汇表能力 |
| XLSX 生成 + 附件归档 | reuse | `attachments`（installed）+ `trade_docs/lib` | `buildXlsx` / `XLSX_CONTENT_TYPE` / `amountInWords` / `createAttachmentFromBuffer`（合同 seam 同款） | 零新依赖（Q-3） |
| 编号器 | reuse（口径） | `trade_docs` / `purchasing` | 最大号 +1 + 唯一索引 + 409 重试 | 三个发号器同一口径 |
| 币种小数位 | ~~reuse~~ **superseded** | — | — | **Superseded by [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](2026-09-28-money-scale-2dp-unification.md)：金额恒 2 位、与币种无关；`lib/currencyScale.ts` 已删除** |
| 事件/审计 | reuse | `trade_docs/events.ts` | `createModuleEvents` 追加 `trade_docs.document.*` | 事件 ID 冻结面，只增不改 |
| 导航与分组 | reuse | 各模块 `page.meta.ts` + `src/modules.ts:246` 的 `overrides.nav.groupOrder` | `pageGroupKey`（组 id 不变，只改 label，N-5） | 组 id 同时是用户侧边栏偏好键 |
| 内部销售订单/采购订单/发运单选择器 | reuse | installed `sales`（`/api/sales/orders` 只读投影）、`purchasing`、`cross_border` | 只读选项源 + 快照 | 锚点单据不复制其数据 |

## Architecture and Data Flow

```text
外贸业务 ── /backend/trade-docs/proformas ── POST /api/trade_docs/documents (kind=proforma)
                                          └─ 签发(PI-…) ── trade_docs.document.issued
                                          └─ 生成 ── buildDocumentSheet → createAttachmentFromBuffer → attachments
                                                     └─ GET /api/trade_docs/documents/[id]/document（下载）

外贸业务 ── /backend/trade-docs/commercial-invoices ── POST /api/trade_docs/documents (kind=commercial)
                                          └─ 汇总行 ── cross_border_shipment_sales_allocations
                                                       └─（回退）cross_border_shipment_allocations
                                                       └─（无发运单）手工行

财务 ── /backend/trade-docs/invoices（移至财务组）── 税种/税额录入 ── confirm ── TI-…（销项）
                                          └─ 合同财务金额：lib/contractRecalc.ts（排除 export 票种）
                                          └─ 互链 export_finance 柜档案（source_kind='shipment'）

发运单 ── /backend/cross_border/shipments ── 采购分摊（既有）+ 销售分摊（新增）
```

- **Module boundaries:** PI/CI 与税务发票都归 `trade_docs`（同一张合同的金额口径与单据都在一个模块，避免跨模块事务）；
  发运侧的销售分摊归 `cross_border`（它拥有发运单聚合，分摊必须与发运单同写）；不在 `trade_docs` 里复制发运单数据。
- **Extension points:** 新页面走模块 `backend/**` 自动发现；不注入、不覆写 installed 页面；exports 侧只用 `attachments` 的既有能力。
- **Alternatives considered:** 把 CI 做成 `cross_border` 的子表（否决：CI 可无发运单、且要在「出口业务」组独立成页）；
  把销售分摊放表头单引用（否决：拼柜/拆柜是既有事实，Q-12 已定分摊到行）。
- **Compatibility:** 既有 API/表/事件 ID 只增不改；`EXPORT_DOC_TYPES` 枚举不动；合同三列算法只增加票种排除；
  菜单 group key 不动（只改 label）。详见「Migration & Backward Compatibility」。

## User Journeys

### Journey J-001 — 发货前签发 PI 并拿到可打印文件

1. 业务在 `/backend/trade-docs/proformas` 点「新建」；选择我方主体 + 银行账户（快照）、对方（分公司或供应商）、
   贸易术语、付款条款、有效期，并「从订单复制行」（一次性，复制后可改）或手工录入行。
2. 保存为 `draft`（无编号）；业务核对后点「签发」。
3. 系统在 `draft → issued` 时取号（`PI-<年>-<4位>`，按组织独立），签发后行与金额冻结；重复签发才需作废重开（`void`）。
4. 点「生成单据」→ 服务端渲染 XLSX 并归档 → 详情页出现下载入口；对方回签/盖章后上传替换件（`attachmentId`）。
5. 失败路径：编号冲突 → 409 + 提示重试（重试取新号）；并发编辑 → `updatedAt` 冲突 UI 提示重新载入；
   无 `trade_docs.documents.manage` → 页面入口不可见、API 403。

### Journey J-002 — 依据一张柜开 CI，并把报关金额对到分摊行

1. 业务在发运单详情看到柜内采购分摊与之对应的内部销售订单（销售分摊，Phase 2 起可维护）。
2. 在 `/backend/trade-docs/commercial-invoices` 新建 CI，选发运单为锚点，点「从发运单汇总」。
3. 系统按「销售分摊 → 采购分摊」优先级汇总商品与数量，单价默认取分摊行的内部销售价快照（可空），金额按 2 位 HALF_UP 计算；
   业务可逐行覆盖单价/金额，覆盖后仍能看到来源（来源快照）。
4. 签发 `CI-<年>-<4位>`，生成 XLSX，交付报关行。
5. 失败路径：发运单被取消/删除 → 422；没有销售分摊（预报关）→ 允许纯手工行；无发运单也能开（Q-9）。

### Journey J-003 — 登记/签发出税务发票并核对价税合计

1. 财务在 `/backend/trade-docs/invoices`（财务组）新建发票，选票种（增值税专用 / 普通 / 出口发票）、方向（进项/销项）、
   合同（可选）与行，行上填税率与含税标记。
2. 系统重算税额（含税：`税额 = 金额 − 金额/(1+税率)`；不含税：`税额 = 金额 × 税率`）与价税合计，头三列只读。
3. `confirm`：销项票取 `TI-<年>-<4位>`；出口发票（0%）也可确认，但**不改变**合同三列金额。
4. 柜档案（`export_finance`）可看到该柜关联的税务发票并互相跳转。
5. 失败路径：confirm 后编号冲突 → 409 重试；未选票种的存量行按「未分类」显示，不参与任何口径。

### Journey J-004 — 把上一张单据复制成下一张（Phase 4）

1. 在 CI 详情点「从 PI 复制」（或税务发票详情点「从 CI 复制」），系统一次性复制抬头与行并写入来源链接。
2. 复制后两张单据各自独立可改；详情页显示来源单据链接（可跳转），来源不存在时降级为快照文本。

## UI and Interaction Contracts

所有新页面都走模块自动发现（`src/modules/trade_docs/backend/trade-docs/**`），
`DataTable` / `CrudForm` / 共享 API helper（`apiCall`/`apiCallOrThrow`/`createCrud`/`updateCrud`/`deleteCrud`/`fetchCrudList`）、
`Page`/`PageBody`/`SectionHeader`/`StatusBadge`/`EmptyState`/`ErrorMessage`/`LoadingMessage` 与语义 token；
不得使用裸 `<table>`/`<form>`/`fetch`、硬编码状态色或任意 Tailwind 值（`.ai/guides/backend-ui.md`，`om-backend-ui-design`）。
**最接近的既有参照**：`/backend/trade-docs/contracts`（`backend/trade-docs/contracts/page.tsx` 13 行的壳 + `components/ContractsTable.tsx` +
`components/ContractForm.tsx` + `components/ContractDetail.tsx`），以及 `internal_sales` 的「一个表组件 + `kind` 参数渲染两个页面」写法。
表单引用一律「显示名 + 选择器」：对方 `loadCounterpartyOptions`、商品 `loadProductOptions`、单位 `loadUnitOptions`、
币种 `loadCurrencyOptions`、内部销售订单/采购订单/发运单走各自只读选项源，UUID 只出现在 API 载荷里。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/trade-docs/proformas` | PI 列表：筛选（状态/方向/对方/来源）、新建、打开、删除 | `GET/POST/DELETE /api/trade_docs/documents?kind=proforma` | `/backend/trade-docs/contracts` | `Page`,`PageBody`,`DataTable`,`RowActions`,`StatusBadge` | loading, empty, error, conflict, success, permission denied | REQ-001/002/009 |
| `/backend/trade-docs/proformas/create`、`/[id]/edit` | PI 新建/编辑：抬头、收款要素、条款、行编辑器、复制行 | `POST/PUT /api/trade_docs/documents`、`PUT /api/trade_docs/documents/lines` | `ContractForm` | `CrudForm`（`column:2` 侧栏分组）,`FormField` | 同上 + 校验错误保留输入 | REQ-001/008 |
| `/backend/trade-docs/proformas/[id]` | PI 详情：签发/作废、生成、下载、上传替换件、复制为 CI | `POST …/transitions`、`POST …/generate`、`GET …/document`、`PUT …`（attach） | `ContractDetail` | `Page`,`SectionHeader`,`Button`,`StatusBadge`,`AttachmentPreviewLink`,`useConfirmDialog` | 同上 | REQ-002/011 |
| `/backend/trade-docs/commercial-invoices` + `create` + `[id]` + `[id]/edit` | CI 列表/表单/详情：从发运单汇总行、覆盖单价、收货人/通知方/贸易术语、签发与生成 | 同 documents API + `POST /api/trade_docs/documents/[id]/aggregate-lines` | 同上 | 同 PI（同一套组件，`kind='commercial'`） | 同 PI | REQ-002/003/004 |
| `/backend/trade-docs/invoices`（改造，移至财务组） | 税务发票台账：票种/税率/税额/价税合计列与字段、确认（发号）、退税互链 | 既有 `/api/trade_docs/invoices*`（追加字段） | 自身（现状） | `DataTable`,`CrudForm`,`StatusBadge` | 同 PI | REQ-006/007 |
| `/backend/cross_border/shipments/[id]`（改造） | 发运单详情新增「销售分摊」区：选内部销售订单 + 行（商品/数量/单价快照）；无权限只读 | `GET /api/cross_border/shipments/sales-allocations`（只读）；写随发运单命令 | 自身「采购分摊」区 | `DataTable`（`embedded`,`disableRowClick`）+ 对话框表单 | 同 PI | REQ-005/003 |

### 术语与菜单校正（N-1…N-6，Phase 0）

现状（证据：各页 `page.meta.ts` 的 `pageGroupKey` + 模块 `i18n/{zh,en}.json`；组顺序在 `src/modules.ts:246` 的 `overrides.nav.groupOrder`）：

| 组（group key） | 组名 zh / en | 组内菜单项 zh / en |
|---|---|---|
| `purchasing.nav.group` | 采购 / Purchasing | 供应商 / Suppliers；供应商产品库 / Supplier product library；采购单 / Purchase orders；**供应商报价与变更** / Supplier quotations & changes |
| `cross_border.nav.group` | 外贸 / **Trade** | 内部销售报价单 / Internal sales quotes；内部销售订单 / Internal sales orders；购销合同 / Contracts；发票 / Invoices；发运单 / Shipments |
| `export_finance.nav.group` | 财务 / Finance | 订单档案 / Order file；柜档案 / Container file |
| `products.nav.group` | 商品主数据 / Product master | 产品 / 产品分类 / 编码规则 |
| `parties.nav.group` | 交易对手 / Parties | 交易对手方 |
| `platform_ops.nav.group` | 平台运营 / Platform ops | 平台渠道 / 平台订单 / 平台结算单 / 对账 |
| `master_data.nav.group` | 基础数据 / Master data | 字典维护 |

| # | 问题 | 校正（已确认） |
|---|---|---|
| N-1 | 业务口径是 **PO / PI / CI**，界面一个缩写都没有（自造词：报价单、内部销售订单、发票） | 界面名带业务缩写，用括号形式（`docs/dev/i18n.md`：括号内拉丁缩写按注释处理，不算第二种语言）：zh「内部销售订单（PO）」/ en "Internal sales orders (PO)"；新增「形式发票（PI）」「商业发票（CI）」。报价单**不挂缩写**，并明确它 ≠ PI |
| N-2 | 组名「外贸 / **Trade**」与该组内容不符：组里有内部销售（对分公司）、**两方向**的购销合同、税务发票台账、出口发运单 | 组名改「出口业务 / Export operations」（**只改 label，不改 key**，N-5）；**税务发票台账移入「财务」组**（`pageGroupKey: 'export_finance.nav.group'`，`pageOrder: 420`，排在 订单档案 400 / 柜档案 410 之后）。采购方向合同（`PC-`）留在出口业务组（两方向混排是既有现状，拆组无业务收益） |
| N-3 | 「报价」撞名：采购组「供应商报价与变更」vs 外贸组「内部销售报价单」 | 按原文：采购侧改「供应商报价单（SQ）」/ "Supplier quotations (SQ)"（已有 `SQ-` 发号，变更分析仍在详情/页签内）；销售侧保留「内部销售报价」 |
| N-4 | 「发票 / Invoices」页实为**进项/销项台账**，与新增的 PI/CI 撞名 | 改名「税务发票台账」/ "Tax invoice ledger"，页面描述同步（`trade_docs/i18n/{zh,en}.json`） |
| N-5 | 组名 label 与 key 不一致（key `cross_border.nav.group` / label Trade） | **只改 label，不改 key**：group id 同时是用户侧边栏偏好键，改 key 会重置所有人的导航偏好（`overrides.nav.groupOrder` 里也是这个 key） |
| N-6 | PI / CI 今天没有菜单入口（PI 无承载；CI 藏在发运单详情的单证区） | 新页面进「出口业务」组：形式发票（PI）`pageOrder: 350`、商业发票（CI）`pageOrder: 360`；两者 `page.meta.ts` 的 `requireFeatures: ['trade_docs.documents.view']`；create/[id]/edit 页与列表**同组**（沿用本模块既有约定：create/edit 作为列表子项嵌套，不用 `navHidden`——`navHidden` 只用在 installed 页面的 `routes.pages` 覆写上） |

风险与约束：纯 `i18n` + `page.meta` 改动（+ F-003 的状态列），无迁移、无 API 变更；
双语言各自单语言，`yarn test` 的 `language-purity` 必须过（`src/lib/i18n/__tests__/language-purity.test.ts`）。

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 外贸业务 | 采购 → **出口业务** → 财务 → 商品主数据 → 交易对手 → 平台运营 → 基础数据 | 无新增仪表盘组件（本切片不做，N/A） | 登录 → 出口业务 → 形式发票（PI）→ 新建 → 签发（≤3 次点击） |
| 财务 | 财务（税务发票台账）→ 出口业务（只读） | 无 | 登录 → 财务 → 税务发票台账 → 新建/确认（≤3 次） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| PI/CI 列表 | 本地化说明 + 「新建 PI/CI」主按钮 | 窄屏列降级（隐藏次要列，保留编号/对方/状态/金额/操作） | 行内操作可 Tab 到、Enter 打开；列表筛选可键盘操作 |
| PI/CI 表单（行编辑器） | 空行提示「添加行 / 从订单复制行」 | 行编辑器随容器换行；窄屏改为卡片式行 | `CrudForm` 标准：提交/取消、错误聚焦首个非法字段、重复提交禁用 |
| 汇总对话框 | 无分摊时提示「该发运单还没有分摊行，可手工录入」 | 对话框窄屏全宽 | Cmd/Ctrl+Enter 确认、Esc 取消 |
| 发运单「销售分摊」区 | 「添加销售分摊」+ 说明一柜可对多单 | 嵌入表格横向滚动 | 删除需二次确认（`useConfirmDialog`） |

### `/backend/trade-docs/proformas` — 形式发票（PI）

```text
┌────────────────────────────────────────────────────────────────────┐
│ 形式发票（PI）                            [新建 PI]                 │
│ [状态▾] [方向▾] [对方▾] [来源单据▾]  搜索: [编号/对方]               │
├────────────────────────────────────────────────────────────────────┤
│ 编号 │ 方向 │ 对方 │ 生效/有效期 │ 币种 │ 合计 │ 状态 │ 签发日        │
│ PI-2026-0001 │ 销售 │ 分公司A │ 2026-10-31 │ USD │ 12,300.00 │ 已签发 │
│ … 行操作：打开 / 编辑（草稿）/ 删除（草稿）                          │
├────────────────────────────────────────────────────────────────────┤
│ 分页                                                                │
└────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** 列表默认按签发日倒序；草稿可编辑/删除，已签发只能「作废」（二次确认）；409 冲突走共享冲突 UI。
- **Responsive and accessibility:** 见上表；金额右对齐并带币种；状态用 `StatusBadge`。
- **Localization:** 文案在 `src/modules/trade_docs/i18n/{zh,en}.json`，key 前缀 `trade_docs.documents.*`；生成的 XLSX 标签在生成时按 `resolveTranslations()` 语言解析。
- **Design-system and theming:** 语义 token；暗色/亮色与窄屏都要实测。

（CI 页面结构同 PI，差异：行区多「从发运单汇总」动作、抬头多收货人/通知方、锚点选择器为发运单。）

### `/backend/trade-docs/invoices` — 税务发票台账（改造）

- 列表新增列：票种（`StatusBadge` 或纯文本）、`tax_total`、`gross_total`；筛选新增票种与来源单据。
- 表单新增字段：票种（必选，存量行显示「未分类」）、行级税率与含税标记；头部税额/价税合计只读。
- 「确认」在销项+有票种时发 `TI-` 号并在详情展示；「作废」释放此前占用的合同财务金额（既有行为）。
- 详情新增「退税资料」区：按 `source_kind='shipment'` 显示所属柜的退税档案链接（只读互链）。

## Data Models

所有新实体遵守 `data/entities.ts` 约定：UUID 主键 `gen_random_uuid()`、`tenant_id`/`organization_id` 组合索引、
`created_at`/`updated_at`（可编辑行）、软删 `deleted_at`（需要时）、**不做跨模块 ORM 关联**（标量 id + 快照），
表名 `<moduleId>_<plural>`。

### `trade_docs_documents`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | `trade_docs_documents_scope_idx (organization_id, tenant_id)` | no | 由可信上下文推导 |
| `kind` | text, required | `trade_docs_documents_kind_status_idx (tenant_id, organization_id, kind, status)` | no | `proforma` \| `commercial`（`TRADE_DOCUMENT_KINDS`），创建后不可改 |
| `direction` | text, default `sales` | 同上索引前置列之一（kind/status） | no | `sales` \| `purchase`；CI 仅 `sales`（校验器限制） |
| `number` | text, nullable | `@Unique trade_docs_documents_scope_number_uniq (tenant_id, organization_id, number)` | no | 签发时写入 `PI-/CI-<年>-<4位>`；草稿为 null |
| `status` | text, default `draft` | 同 kind 索引 | no | `draft`→`issued`→`void`（`TRADE_DOCUMENT_STATUSES`/`TRADE_DOCUMENT_TRANSITIONS`） |
| `counterparty_kind` | text, default `customer` | — | no | `supplier` \| `customer`（对方主体在 `parties`） |
| `counterparty_id` / `counterparty_snapshot` | uuid nullable / jsonb nullable | — | 对方名称在 `parties` 侧是加密列，快照为本模块展示副本 | 选择器写 id + 服务端取显示名快照 |
| `our_party_snapshot` | jsonb, nullable | — | 含银行账号/银行名（与合同 `our_party_snapshot` 同口径，非加密） | `{partyId,name,address,contact,bankAccountId,beneficiaryBank,accountNumber,swiftCode,bankAddress}`；由共享 builder 生成 |
| `consignee_snapshot` / `notify_party_snapshot` | jsonb, nullable | — | no | CI 专用（收货人/通知方），自由文本 + 可选主体引用 |
| `currency_code` | text, default `CNY` | — | no | 三位 ISO；仅文档币种，金额与币种无关、恒 2 位（`AMOUNT_SCALE`） |
| `exchange_rate` | numeric(18,8), nullable | — | no | 快照，不自动换算 |
| `subtotal` / `total` | numeric(18,2), default `0` | — | no | 命令重算（唯一写入方）：`subtotal = Σ line.amount`，`total = subtotal` |
| `payment_terms` / `incoterms` / `valid_until` / `delivery_date` / `marks` | text/date, nullable | — | no | PI：付款条款/有效期/交期；PI+CI：贸易术语（字典 `incoterms` 或自由输入）；唛头 |
| `source_kind` / `source_id` / `source_snapshot` | text/uuid/jsonb, nullable | 列表按 `source_kind`+`source_id` 过滤 | no | `sales_order` \| `purchase_order` \| `shipment` \| `manual`；一单多张（无唯一约束） |
| `issued_at` | date, nullable | — | no | 签发日（`issue` 时写入） |
| `generated_attachment_id` / `generated_at` | uuid/timestamp, nullable | — | no | 我方渲染的 XLSX；重复生成前移指针，旧文件保留 |
| `attachment_id` | uuid, nullable | — | no | 上传替换件（盖章/回签/报关件），与生成件独立 |
| `notes` | text, nullable | — | no | 备注（状态转换的 reason 也追加在这里，同合同） |
| `created_at` / `updated_at` / `deleted_at` | timestamp | `updated_at` 为乐观锁版本，API 回传 `updatedAt` | no | 乐观锁冲突 409 |

### `trade_docs_document_lines`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | `trade_docs_document_lines_scope_idx (organization_id, tenant_id)` | no | 可信上下文 |
| `document_id` | FK → `trade_docs_documents` (cascade) | `@Unique trade_docs_document_lines_document_line_uniq (document_id, line_number)` | no | 模块内 ORM 关联允许 |
| `line_number` | integer, required | 同上唯一键 | no | 从 1 连续编号 |
| `product_id` / `product_snapshot` | uuid nullable / jsonb nullable | — | no | 商品来自 `products`（标量 id + 快照） |
| `name` / `sku` / `model` / `spec` / `unit` | text, nullable | — | no | 行写时从商品快照抄写的打印副本（冻结） |
| `quantity` | numeric(18,6), default `0` | — | no | ≥ 0 |
| `unit_price` | numeric(18,4), default `0` | — | no | ≥ 0；来自订单/分摊快照或被覆盖 |
| `amount` | numeric(18,2), default `0` | — | no | 票面金额；默认 `HALF_UP(quantity × unit_price, 2)`，可覆盖 |
| `source_snapshot` | jsonb, nullable | — | no | `{kind:'sales_allocation'\|'purchase_allocation'\|'order_line'\|'manual', ids, quantity, unitPrice, copiedAt, overridden:{unitPrice?,amount?}}` |
| `note` | text, nullable | — | no | 行备注 |
| `created_at` / `updated_at` | timestamp | — | no | 行随头一起替换（`*.lines.replace` 语义，同合同） |

### `cross_border_shipment_sales_allocations`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | `cross_border_shipment_sales_allocations_scope_idx (organization_id, tenant_id)` | no | 可信上下文 |
| `shipment_id` | FK → `cross_border_shipments` (cascade) | `@Unique cross_border_shipment_sales_allocations_shipment_line_uniq (shipment_id, sales_order_line_id)` | no | 随发运单命令整体替换（同 `replaceAllocations`） |
| `sales_order_id` / `sales_order_line_id` | uuid, required | — | no | installed `sales` 的订单/行标量 id（无跨模块 ORM 关联） |
| `sales_order_number` | text, nullable | — | no | 单号快照（列表/详情显示用） |
| `catalog_product_id` | uuid, required | — | no | 与采购分摊同构：发运/收货按 catalog 变体解析（`.ai/lessons/stock-receipt-needs-variant-resolution.md`） |
| `product_snapshot` | jsonb, nullable | — | no | 商品展示快照 |
| `quantity` | numeric(18,4), default `0` | — | no | ≥ 0；CI 汇总的数量来源 |
| `unit_price` / `currency_code` | numeric(18,4) nullable / text nullable | — | no | 内部销售价与币种**快照**（可空：订单行未定价时留空，CI 行单价需人工填） |
| `created_at` / `updated_at` | timestamp | — | no | — |

### `trade_docs_invoices` / `trade_docs_invoice_lines`（Phase 3 追加列，全部 ADDITIVE）

| Field | Type / nullability | Notes |
|---|---|---|
| `trade_docs_invoices.invoice_kind` | text, nullable | `vat_special` \| `vat_general` \| `export`（`INVOICE_KINDS`）；**null = 历史登记/未分类**，显示「未分类」，不参与新校验 |
| `trade_docs_invoices.our_number` | text, nullable | `TI-<年>-<4位>`；`@Unique trade_docs_invoices_our_number_uniq (tenant_id, organization_id, our_number)`（Postgres 唯一索引允许多个 NULL）；仅销项 + `confirm` 时写 |
| `trade_docs_invoices.tax_total` | numeric(18,2), default `'0'` | Σ 行 `tax_amount`，命令重算 |
| `trade_docs_invoices.gross_total` | numeric(18,2), default `'0'` | 价税合计 = Σ 行含税口径金额，命令重算 |
| `trade_docs_invoice_lines.tax_rate` | numeric(6,3), default `'0'` | 百分数（13 = 13%），口径同 `purchasing_purchase_order_lines.tax_rate` |
| `trade_docs_invoice_lines.price_includes_tax` | boolean, default `true` | 口径同采购单行 |
| `trade_docs_invoice_lines.tax_amount` | numeric(18,2), default `'0'` | 含税：`amount − HALF_UP(amount/(1+rate/100),2)`；不含税：`HALF_UP(amount×rate/100,2)` |

**迁移与快照**：Phase 1 生成 `trade_docs_documents` / `trade_docs_document_lines`；Phase 2 生成 `cross_border_shipment_sales_allocations`；
Phase 3 生成四个 invoices/line 追加列（带默认值/可空，历史行语义不变）。每步 `yarn db:generate` → 人工审阅生成的 SQL 与 `.snapshot-open-mercato.json`
→ **应用前问业主**（不迁移既有数据；迁移文件一旦提交不得再改）。

## API, Command, and Error Contracts

路由一律 `makeCrudRoute`（CRUD 面，`api/<resource>/route.ts`，per-method `metadata`，独立 `openApi` 导出）
或 guarded command route（动作面），错误用既有 `CrudHttpError` 映射（400/401/403/404/409/422）。
新路由的 entityId 取冒号形式 `trade_docs:trade_docs_documents`（同 `trade_docs:trade_docs_contract` 的既有写法）。

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/trade_docs/documents` | auth + `trade_docs.documents.view` | `kind`(必填)/`status`/`direction`/`counterpartyId`/`sourceKind`/`sourceId`/`search`/分页 | `{ items, total, page, pageSize }`，含 `counterpartyName`、`updatedAt` | 400（kind 缺失/非法）/401/403 | REQ-001/009 |
| `POST` | `/api/trade_docs/documents` | auth + `.manage` | `documentCreateSchema`（判别 `kind`） | 201 + `trade_docs.document.created` | 400/403/422（CI 非法 direction） | REQ-001/003 |
| `GET` | `/api/trade_docs/documents/[id]` | auth + `.view` | — | 单据 + 行 + 来源 | 401/403/404 | REQ-001 |
| `PUT` | `/api/trade_docs/documents/[id]` | auth + `.manage` | `documentUpdateSchema`（含 `updatedAt` 乐观锁） | 200 + `trade_docs.document.updated` | 403/404/**409**（版本冲突）/422（已签发禁改） | REQ-001 |
| `DELETE` | `/api/trade_docs/documents/[id]` | auth + `.manage` | `{id, updatedAt}` | 200 + `trade_docs.document.deleted`（软删；已签发只能作废） | 403/404/409/422 | REQ-001 |
| `PUT` | `/api/trade_docs/documents/lines` | auth + `.manage` | `{documentId, lines[]}` | 200（头金额重算）+ `…updated` | 404/409/422 | REQ-001 |
| `POST` | `/api/trade_docs/documents/transitions` → `trade_docs.documents.transition` | auth + `.manage` | `{id, action:'issue'\|'void', reason?}` | 200 + `trade_docs.document.issued` / `.voided` | **409**（编号冲突，提示重试）/422（越态、无行） | REQ-001 |
| `POST` | `/api/trade_docs/documents/[id]/aggregate-lines` → `trade_docs.documents.aggregate-lines` | auth + `.manage` | `{id, sourceId?}` | 200（行被替换，来源快照写入）+ `…updated` | 404/**422**（发运单不存在/已取消/无分摊且未给 sourceId） | REQ-003 |
| `POST` | `/api/trade_docs/documents/[id]/generate` → `trade_docs.documents.generate-document` | auth + `.manage` | `{id}` | 200 `{attachmentId, fileName}` + `trade_docs.document.document.generated` | 403/404/422（草稿/作废不可生成） | REQ-002 |
| `GET` | `/api/trade_docs/documents/[id]/document` | auth + `.view` | — | XLSX 流（`XLSX_CONTENT_TYPE`，`<number>.xlsx`） | 404（未生成）/403 | REQ-002 |
| `PUT` | `/api/trade_docs/documents/[id]`（attach 语义，同合同 `contracts/attach`） | auth + `.manage` | `{id, attachmentId: uuid\|null}` | 200 | 404/422 | REQ-002 |
| `GET` | `/api/cross_border/shipments/sales-allocations` | auth + `cross_border.shipments.view` | `shipmentId`/`page` | 只读列表（含 `salesOrderNumber`、商品显示名） | 401/403 | REQ-005 |
| 写入 | `cross_border.shipments.create` / `.update`（既有命令，追加 `salesAllocations[]`） | auth + `cross_border.shipments.manage` | 行数组（订单行/商品/数量/单价/币种） | 既有事件不变 + 分摊整体替换 | 403/404/409/422（订单行不存在、商品未桥接 catalog 变体） | REQ-005 |
| 既有扩展 | `/api/trade_docs/invoices*`（create/update/transitions/list） | 既有 `trade_docs.invoices.*` | 追加 `invoiceKind`、行 `taxRate`/`priceIncludesTax`、列表 `invoiceKind`/`sourceKind`/`sourceId` 过滤 | 既有事件；`confirm` 时写 `our_number` | 409（TI 号冲突）/422 | REQ-006/007 |

**约定**：命令 ID 一律 `trade_docs.documents.*`（统一族）；命令层做校验与重算（`subtotal`/`total`/`tax_total`/`gross_total` 的唯一写入方），
路由只做校验与分发；行替换与头重算在同一 `withAtomicFlush(..., {transaction: true})` 边界内；
动作类端点在命令层 `enforceCommandOptimisticLock`；`openApi` 用 `createCrudOpenApiFactory` + `createPagedListResponseSchema` 或本模块既有的
`createTradeDocsCrudOpenApi`；`indexer: { entityType: 'trade_docs:trade_docs_documents' }`。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `trade_docs.document.created` / `.updated` / `.deleted` | `trade_docs/events.ts`（`createModuleEvents`，entity `document`，`clientBroadcast: true`） | 打开的列表（广播刷新） | 列表无需轮询 | 与既有 contract/invoice CRUD 事件同口径 |
| `trade_docs.document.issued` / `.voided` | 同上（lifecycle） | 后续切片（通知/对账）预留 | 编号、状态变更的审计锚点 | 事件在提交后发出；失败不回滚主事务（既有语义） |
| `trade_docs.document.document.generated` | `generate-document` 命令 | 详情页/审计 | 记录 `templateId` 与 `attachmentId` | 重复生成 = 新事件 + 指针前移（不幂等去重，与合同一致） |
| 发运单销售分摊写入 | `cross_border.shipments.*` 命令 | — | 复用既有发运单事件，**不新增** cross_border 事件 | 分摊随发运单事务整体替换 |
| 税务发票退税互链 | 只读（`GET /api/trade_docs/invoices?sourceKind=shipment&sourceId=…`） | 柜档案面板 | 无写入、无事件 | N/A（投影） |

- **Jobs / 定时任务**：N/A — 本切片无排队/定时工作（生成是同步小文件渲染，沿用合同口径）。
- **Notifications**：N/A — 不新增通知类型；签发/作废走既有审计与事件（若后续要提醒，另立规格）。
- **Cache/索引**：读路径不新增缓存；`makeCrudRoute` 的 `indexer.entityType` 指向新实体以接入 query-index 覆盖；写后失效沿用框架 post-commit 语义。

## Security, Privacy, and Compliance

- **Authorization:** 所有新路由 per-method `requireFeatures`（`trade_docs.documents.view|manage`；发运分摊沿用 `cross_border.shipments.*`）；
  页面 `page.meta.ts` 同步声明；**绝不**用角色名判断；支持通配授权（`trade_docs.*` 覆盖新特性）。
- **Tenant isolation:** 每个查询/命令都带 `tenant_id` + `organization_id`；读展开到可读组织集、写落在所选组织；
  缺 scope → 401/403/404，不返回跨组织数据（无 system-scope 分支）。
- **Sensitive data:** 我方银行账户与 SWIFT 以**快照**形式存于 `our_party_snapshot`（jsonb），
  与既有 `parties_bank_accounts` / 合同 `our_party_snapshot` 同口径（均非加密列，属已交付面）；
  本切片不引入新的加密字段，也不把银行信息写进日志/事件载荷（事件只带 id/scope/编号）。
  如需对银行账号加密，应在 `parties` 规格里统一决策（非本切片）。
- **Abuse and failure modes:** 编号枚举不可预测（顺序号，非安全敏感）；越权枚举返回 404/403 而非数据；
  重复提交由乐观锁 + 唯一索引挡住；生成接口不返回任意文件（只服务自己的附件 id）；无新公开端点。

## Edge Cases & Failure Scenarios

| 场景 | 用户看到 | 系统行为 |
|---|---|---|
| 并发签发撞号 | 提示「号码已被占用，请重试」 | 唯一索引报错 → 409；重试时重新读最大号 |
| 已签发单据被编辑 | 表单只读 + 提示先作废重开 | 422；`PUT` 拒绝非 draft 的行/金额变更 |
| CI 汇总时发运单已取消 | 提示「发运单不可用」 | 422，不写行 |
| CI 无分摊（预报关） | 汇总对话框提示可手工录入 | 允许 0 行 → 手工添加；不强制 sourceId |
| 分摊行在 CI 之后被改 | 详情显示的来源数量是当时快照 | 不自动同步（Q-10 一次性复制）；页面显示来源快照与当前分摊的对照文本 |
| 生成时模板/字典缺失 | 生成按钮报错并保留原因 | 生成失败不写指针（`generated_attachment_id` 不变） |
| 附件被删 | 下载入口消失，显示「无文件」 | 指针保留但预览/下载 404（attachments 既有语义） |
| 无 `documents.manage` | 列表可看、按钮不可见 | API 403（UI 隐藏不是授权） |
| 跨组织 id | 404 | 作用域过滤（fail closed） |
| 出口发票确认后合同金额 | 三列不变 | `contractRecalc` 排除 `invoice_kind='export'`（测试锁死） |
| `invoice_kind` 为 null 的历史行 | 票种列显示「未分类」 | 不参与新校验与口径变更，行为逐字节同今天 |
| 税务发票 confirm 撞 TI 号 | 提示重试 | 409 |
| 发运单销售分摊指向的商品无 catalog 变体 | 表单选择器不接受该商品 | 422（沿用发货/收货的变体解析约束） |

## Integration Coverage

测试自包含（fixtures 建租户/组织/角色/用户与记录），走真实 API/UI 路径；
集成用例目录为 `src/modules/<id>/__integration__/{meta.ts,*.spec.ts}`（Playwright + `@open-mercato/core/helpers/integration/*`），
单跑命令 `yarn mercato test:integration <slug>`（例：`yarn mercato test:integration pi-documents`），全量 `yarn test:integration:ephemeral`。
注意：`trade_docs` / `cross_border` / `export_finance` 目前**没有** `__integration__` 目录（本切片新建）。

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | 租户 + 总部/分公司组织；`trade_docs.documents.*` 角色；1 个 `parties` 主体 + 银行账户；1 张内部销售订单（含行） | 建 PI（复制订单行）→ 签发 → 生成 → 下载 | 签发前无编号、签发后 `PI-<年>-0001`；跨组织序列各自独立；下载响应为 XLSX；`generatedAttachmentId` 持久化；事件 `trade_docs.document.issued`；收款账户与条款来自主数据快照（银行账户来自 `parties`，incoterms 可存可印） | REQ-001, REQ-002, REQ-008, REQ-009 |
| TEST-002 | security | 同上 + 第二个租户；无功能位角色；跨组织 id | 读写对方组织/租户单据；无功能位调用 | 403/404，无数据泄露；列表不出现跨组织行 | REQ-009 |
| TEST-003 | integration | 1 张销售订单 + 1 张采购订单 | 各建 2 张 PI；「从订单复制行」后改行 | 一张订单可挂多张 PI（无唯一约束冲突）；复制后两边独立（改 A 不影响 B）；快照冻结 | REQ-001 |
| TEST-004 | integration | 1 张发运单 + 采购分摊 + 销售分摊（含单价快照） | 建 CI → 汇总 → 覆盖一行单价与金额 | 汇总数量 = 销售分摊数量（逐行）；被覆盖行 `source_snapshot.overridden` 记录；重跑汇总 = 重新复制（行数一致） | REQ-003, REQ-005 |
| TEST-005 | integration | 无发运单 | 直接建 CI 并手工加行；在 `cross_border` 找 `commercial_invoice` 入口 | CI 可建可签发；发运单详情不再提供新建 `commercial_invoice`（或标注为历史归档）；系统内只有一张真相 | REQ-003, REQ-004 |
| TEST-006 | integration | 合同 + 合同行 | 建三类票种发票（含 export 0%）→ confirm 销项 | `tax_total`/`gross_total` 与手算一致；export 票 `tax_amount=0`；销项获得 `TI-<年>-0001`；`source_kind='shipment'` 可在柜档案互链（只读） | REQ-006 |
| TEST-007 | unit + integration | 合同 + 合同行 + 已确认的普通发票 | 登记并确认 export 发票（绑合同行）→ 读合同 | 合同 `contract_total`/`finance_total`/`difference_total` **不变**；既有（非 export）行为不变的回归用例（`trade_docs/__tests__/contractRecalc*`） | REQ-007 |
| TEST-008 | integration | 发运单 + 2 张销售订单 | 加销售分摊（跨 2 单）→ 改数量 → 删除一单 | 一柜多单可写；数量/单价快照持久化；整体替换语义；无 catalog 变体的商品被拒 | REQ-005 |
| TEST-009 | UI（浏览器冒烟） | 3 个新/改页面 + 数据 | loading/empty/error/冲突/权限/成功六态；键盘与窄屏；暗色 | 观察到的渲染与交互符合契约（含冲突提示、禁用重复提交、Esc/Ctrl+Enter） | REQ-001, REQ-002, REQ-003, REQ-006, REQ-009 |
| TEST-010 | unit | i18n 文案 | 跑 `language-purity` 与 key 集合一致性 | zh/en key 集合一致；无中英混排；组名/菜单项符合 N-1…N-4；新增 `incoterms` 字典种子 label 单语言、只写显示名 | REQ-008, REQ-010 |
| TEST-011 | integration | 已签发的 PI + 发运单 | PI→CI→税务发票 逐级复制 | 行与抬头一次性复制；来源链接可追；来源删除后降级为快照文本；复制后互不影响 | REQ-011 |

## Implementation Phases

阶段按依赖排序；同一时间只进一个阶段，阶段内可并行独立切片；每阶段结束必须留下可运行的应用与自己的证据（含 UI 的暗色/窄屏实测）。

### Phase 0 — 术语与菜单校正

- **Depends on:** none
- **Outcome:** 侧边栏与页面标题符合业务口径（PO/PI/CI、SQ、税务发票台账），为 PI/CI 新页面腾出入口位置。
- **Why this order / value delivered:** 无迁移、无 API 变更，可独立上线；先纠正术语，避免新页面沿用旧称谓。
- **Deliverables:**

| ID | 功能点 | 交付物（落点） | 验收 |
|---|---|---|---|
| F-001 | 菜单与页标题校正（N-1…N-4） | `src/modules/{internal_sales,sourcing,trade_docs,cross_border}/i18n/{zh,en}.json` + `src/modules/trade_docs/backend/trade-docs/invoices/page.meta.ts`（`pageGroupKey: 'export_finance.nav.group'`、`pageGroup: 'Finance'`、`pageOrder: 420`）+ `src/modules/cross_border/i18n/{zh,en}.json:2` 的组名（label） | 侧边栏/页面标题符合 N-1…N-4；`yarn lint && yarn test`（含 language-purity） |
| F-002 | 术语表入文档 | `docs/dev/business-architecture.md` 增「业务术语 ↔ 系统单据」映射表（PO / PI / CI / 税务发票 / 报价 / 合同 / 发运单） | 文档可直接回答"业务说的 X 在系统里叫什么" |
| F-003 | 列表补状态列 | `internal_sales/components/InternalSalesTable.tsx`（报价/订单各加状态列，读销售单据投影；今天 `buildColumns` 只有 5 列，无 status） | 列表可见报价 `sent`/订单状态，空值有兜底 |

- **Independent slices / estimated commits:** ①i18n 文案 + 组名（1 commit）；②台账换组（page.meta，1 commit）；③术语文档 + 状态列（1 commit）。
- **Requirements closed:** REQ-010
- **Tests:** TEST-010（UI 冒烟并入 TEST-009 的浏览器实测清单）
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test`；浏览器实测侧边栏与两处标题（en/zh）
- **Exit gate:** 「出口业务 / Export operations」组名生效且 group key 未变；采购组显示「供应商报价单（SQ）」；税务发票台账在财务组且名为「税务发票台账」；`language-purity` 绿

### Phase 1 — PI（形式发票）：从零补齐

- **Depends on:** Phase 0 的 exit gate（新页面要进已改名的出口业务组）
- **Outcome:** 业务可在发货前建 PI、签发取号、生成并下载 XLSX、上传替换件；合同与 PI 的收款账户来自 `parties` 主数据。
- **Why this order / value delivered:** PI 是从零开始、缺口最大的一张；它先把统一承载（表/命令/页面体/发号/生成/权限）一次性立起来，Phase 2 的 CI 直接复用。
- **Deliverables:**

| ID | 功能点 | 交付物（落点） | 依赖 | 验收 |
|---|---|---|---|---|
| F-004 | 合同我方抬头/银行改选 `parties` + 快照（C-1） | `trade_docs/components/ContractForm.tsx`（主体 + 银行账户选项源：`/api/parties/options`、`/api/parties/{id}` 的 `bankAccounts`）、`commands/contracts.ts` 快照逻辑、共享 `lib/partySnapshot.ts` | — | 合同/PI 印的收款账户与主数据一致；换账户不动历史单据 |
| F-005 | 贸易术语字典 + 合同/PI/CI 字段（C-2） | `trade_docs/setup.ts` 种子（`incoterms`，同 `payment_terms` 口径：单语言 label、`seedDefaults` 幂等）+ 合同/PI/CI 表单字段 | — | 合同与两张单据都能选/自由输入术语并打印 |
| F-101 | 实体与迁移 | `data/entities.ts` 新增 `trade_docs_documents` + `trade_docs_document_lines`（含索引/唯一键）；`yarn db:generate` 迁移（审阅后应用，需业主批准） | — | 迁移只含新表/索引/外键；`yarn db:generate` 无残留 diff |
| F-102 | 我方发号（签发时） | 签发动作 `trade_docs.documents.transition`（`issue`）用 `nextDocumentNumber(scope, 'PI')`（口径同 `nextContractNumber`）+ 唯一索引兜底 | F-101 | 并发/重试不重号；跨组织各自独立序列；草稿无号 |
| F-103 | 收款要素与对方 | `our_party_snapshot`（主体 + 银行账户快照，共享 builder）、`payment_terms`、`incoterms`、`delivery_date`/`valid_until`；对方选择器复用 `components/formOptions.ts` | F-004 | 银行/条款可存可印；对方选项按组织收敛 |
| F-104 | 行与来源复制 | 行引用 `products` + 打印副本快照；「从订单复制行」（一次性，来源 = 内部销售订单或采购订单） | F-101 | 复制后各自可改，互不影响；快照冻结 |
| F-105 | 页面（列表/新建/编辑/详情） | `backend/trade-docs/proformas/**`（`DataTable` + `CrudForm` + 详情区，共享 `DocumentsTable/DocumentsForm/DocumentDetail`，`kind='proforma'`），进「出口业务」组（`pageOrder: 350`） | F-101 | 六态齐全（loading/empty/error/冲突/权限/成功）；键盘与暗色通过 |
| F-106 | 生成文件 + 归档 | 命令 `trade_docs.documents.generate-document` → `lib/documentTemplate.ts`（`buildDocumentSheet` + `buildXlsx` + `createAttachmentFromBuffer`）；下载路由 `GET …/[id]/document` | F-101 | 生成物可在详情下载/预览；重复生成幂等替换（指针前移、旧件保留） |
| F-107 | 权限与作用域 | `acl.ts` 追加 `trade_docs.documents.view\|manage`；`setup.ts` `defaultRoleFeatures`（`trade_docs.*` 已覆盖）；`yarn mercato auth sync-role-acls` | F-101 | 跨组织 403/不可见；无功能位拒绝 |
| F-108 | 锚点 | `source_kind='sales_order'\|'purchase_order'\|'manual'` + `source_id` + 快照；选项源走 `/api/sales/orders`、采购订单只读接口（只读） | F-101 | 一张订单可挂多张 PI（REQ-001） |
| F-109 | 集成测试 | `src/modules/trade_docs/__integration__/{meta.ts,pi-documents.spec.ts}` | — | 建单→发号→生成→下载→跨组织隔离全绿 |

- **Independent slices / estimated commits:** ①F-101+F-102+F-107（表/发号/权限）→ ②F-004+F-005+F-103（主数据快照与字典）→ ③F-104+F-105（页面与行）→ ④F-106+F-108+F-109（生成、锚点、测试）。
- **Requirements closed:** REQ-001, REQ-002（PI 侧）, REQ-008, REQ-009
- **Tests:** TEST-001, TEST-002, TEST-003, TEST-009（PI 面）
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`；`yarn mercato test:integration pi-documents`；迁移应用前 `yarn db:generate` 审阅
- **Exit gate:** PI 全链路（建单→签发→生成→下载→替换件）在真实页面走通；跨组织/缺权限拒绝；合同与 PI 的收款账户来自主数据；incoterms 可选可打印

### Phase 2 — CI（商业发票）：从空槽位到结构化

- **Depends on:** Phase 1 的 exit gate（复用承载/命令/页面体）
- **Outcome:** 一张柜可开结构化 CI，报关金额与分摊行逐行对账；发运单能看出对应的内部销售订单。
- **Why this order / value delivered:** CI 的锚点（发运单 ↔ 内部销售订单）必须在 CI 之前建立；CI 复用 Phase 1 的全部机制，增量只在「分摊来源 + 槽位处置」。
- **Deliverables:**

| ID | 功能点 | 交付物（落点） | 依赖 | 验收 |
|---|---|---|---|---|
| F-006 | 发运单 ↔ 内部销售订单分摊（S-1/Q-12） | `cross_border/data/entities.ts` 新增 `cross_border_shipment_sales_allocations` + 迁移；`commands/shipments.ts` 追加 `replaceSalesAllocations`（同 `replaceAllocations` 写法）；`api/shipments/sales-allocations/route.ts`（只读）；发运表单/详情新增「销售分摊」区（订单/行选项源 + 单价快照） | — | 一张发运单能看出它对应哪张内部销售订单；跨 2 单可写；CI 的行/买方由此生成 |
| F-201 | 结构化字段 | `kind='commercial'`：金额/币种/收货人（`consignee_snapshot`）/通知方/贸易术语（字段进 `trade_docs_documents`） | F-101 | 报关金额可与发运分摊行对账 |
| F-202 | 从发运单汇总生成 | 命令 `trade_docs.documents.aggregate-lines`：按「销售分摊 → 采购分摊 → 手工」优先级汇总商品/数量，单价默认取分摊快照，允许逐行覆盖；每行写 `source_snapshot` | F-006 | 汇总值 = 分摊行数量；覆盖后仍可追溯来源 |
| F-203 | 与既有单证槽位的关系（S-2） | `cross_border` 的 `commercial_invoice`：**保留枚举、停止新建**（发运单详情的选项源移除该项或改为「历史归档」提示），并在图表/文案指明新单据位置 | F-201 | 同一张 CI 在系统里只有一个真相源 |
| F-204 | 页面与入口 | `backend/trade-docs/commercial-invoices/**`（`pageOrder: 360`）+ 发运单详情跳转新 CI | F-201 | 无需先进发运单也能开预报关 CI |
| F-205 | 生成与归档 | 同 F-106 seam（`kind='commercial'` 模板） | F-106 | 生成物可下载/预览 |
| F-206 | 集成测试 | `__integration__/commercial-invoices.spec.ts` | — | 汇总、覆盖、隔离、生成全绿 |

- **Independent slices / estimated commits:** ①F-006（发运侧分摊 + 迁移）→ ②F-201+F-202（汇总命令与字段）→ ③F-204+F-205（页面与生成）→ ④F-203+F-206（槽位处置与测试）。
- **Requirements closed:** REQ-003, REQ-004, REQ-005, REQ-002（CI 侧）
- **Tests:** TEST-004, TEST-005, TEST-008, TEST-009（CI 面）
- **Validation:** 同 Phase 1 的门禁 + `yarn mercato test:integration commercial-invoices`；两份迁移审阅
- **Exit gate:** CI 行数量与分摊逐行一致、覆盖留源；无发运单可开预报关 CI；发运单不再新建 `commercial_invoice`；发运单↔内部销售订单关联可查

### Phase 3 — 税务发票：票种与税务口径

- **Depends on:** Phase 2 的 exit gate（同模块 i18n/README 与 `trade_docs_invoices` 相邻文件串行，避免并行改同一文件）
- **Outcome:** 台账支持票种与税率/税额/价税合计，销项票签发发 `TI-` 号，出口发票 0% 并可挂退税资料；合同三列金额口径隔离被测试锁死。
- **Why this order / value delivered:** 它是唯一改动「既有单据表 + 既有金额口径」的阶段，风险最高、依赖最少，放在前两个阶段把新面立稳之后再做。
- **Deliverables:**

| ID | 功能点 | 交付物（落点） | 依赖 | 验收 |
|---|---|---|---|---|
| F-301 | 票种 + 税率/税额/价税合计 | `trade_docs_invoices` 追加 `invoice_kind`/`our_number`/`tax_total`/`gross_total`；`trade_docs_invoice_lines` 追加 `tax_rate`/`price_includes_tax`/`tax_amount`（口径对齐 `purchasing/data/entities.ts:245-262`）+ 迁移；命令重算 | — | 价税合计 = 不含税 + 税额；出口发票 0% 可表达 |
| F-302 | 我方发号（保留外部票号） | `confirm` 时对销项 + 有票种的发票写 `our_number = TI-<年>-<4位>`（`nextDocumentNumber(scope,'TI')`） | F-301 | 未确认不发号；冲突 409 重试 |
| F-303 | 口径隔离（**高风险项**） | `lib/contractRecalc.ts` 增加 `invoice_kind <> 'export'`（含 NULL 语义：历史行照旧参与） | F-301 | 出口发票/PI/CI 的登记**不改变**合同三列金额 |
| F-304 | 退税资料联动 | 只读互链：发票 `source_kind='shipment'` + `source_id`；柜档案面板列出该柜税务发票并互跳（无 schema 变更） | F-301 | 退税资料清单可引用税务发票 |
| F-305 | 生成/打印（可选） | 同 F-106 seam（`kind` 走发票模板） | F-106 | 生成物可下载 |

- **Independent slices / estimated commits:** ①F-301+F-303（列 + 重算 + 口径排除 + 单测）→ ②F-302（发号）→ ③F-304（互链）→ ④F-305（生成，可延后）。
- **Requirements closed:** REQ-006, REQ-007
- **Tests:** TEST-006, TEST-007
- **Validation:** 门禁 + `yarn mercato test:integration tax-invoice-ledger`；迁移审阅
- **Exit gate:** 三种票种与税额计算在页面与 API 一致；出口发票不污染合同三列（回归测试）；销项票 `TI-` 号可见；柜档案互链可用

### Phase 4 — 联通与收口

- **Depends on:** Phase 3 的 exit gate（三张单据都在）
- **Outcome:** 单据间可一次性复制并保留来源；文档与状态板收口，无「done 但无证据」的表述。
- **Why this order / value delivered:** 复制流需要三张单据都存在；收口让下一个会话能凭证据接手。
- **Deliverables:**

| ID | 功能点 | 交付物（落点） | 依赖 | 验收 |
|---|---|---|---|---|
| F-401 | 单据间复制流 | PI → CI → 税务发票 的「从上一张复制行/抬头」（一次性复制 + 存链接：`source_kind`/`source_id`/快照） | Phase 3 | 复制后各自可改；来源链接可追 |
| F-402 | 文档与状态收口 | `src/modules/{trade_docs,cross_border,export_finance}/README.md`、`docs/dev/business-architecture.md`、`docs/plans/README.md` 状态板、`docs/plans/cross-border-erp.md` 进度表、本 spec 的 Status/Changelog + 各 phase 的证据 | 全部 | 状态板与 spec 一致，无"done 但无证据"的表述 |

- **Independent slices / estimated commits:** ①F-401（复制命令 + UI）→ ②F-402（文档收口，含每阶段证据回填）。
- **Requirements closed:** REQ-011（+ 全部 REQ 的文档证据）
- **Tests:** TEST-011
- **Validation:** 门禁 + `yarn mercato test:integration document-copy-flow`
- **Exit gate:** 复制流在浏览器实测可用；三份 README/两份文档与 spec 状态一致

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/trade-docs/proformas` | `trade_docs_documents`, `POST/GET/PUT /api/trade_docs/documents`, `…/transitions`, `trade_docs.document.issued` | Phase 1 | TEST-001, TEST-003, TEST-009 | AC-001 |
| REQ-002 | J-001/J-002, 详情「单据文件」区 | `…/[id]/generate`, `GET …/[id]/document`, `trade_docs.document.document.generated`, `attachments` | Phase 1 (+CI 侧 Phase 2) | TEST-001, TEST-009 | AC-001 |
| REQ-003 | J-002, `/backend/trade-docs/commercial-invoices` | `…/aggregate-lines`, `trade_docs_document_lines.source_snapshot` | Phase 2 | TEST-004, TEST-005, TEST-009 | AC-002 |
| REQ-004 | J-002, 发运单详情单证区 | `cross_border_export_documents`（枚举不变、停止新建）+ 详情跳转 | Phase 2 | TEST-005 | AC-002 |
| REQ-005 | J-002, 发运单详情「销售分摊」 | `cross_border_shipment_sales_allocations`, `cross_border.shipments.*` | Phase 2 | TEST-008, TEST-004 | AC-002 |
| REQ-006 | J-003, `/backend/trade-docs/invoices` | `invoice_kind`/`our_number`/`tax_total`/`gross_total`, line tax 列, `confirm` 发号 | Phase 3 | TEST-006, TEST-009 | AC-003 |
| REQ-007 | J-003 | `lib/contractRecalc.ts` 票种排除 + 回归测试 | Phase 3 | TEST-007 | AC-004 |
| REQ-008 | J-001, 合同/PI 表单 | `parties` 选项源 + `our_party_snapshot` + `incoterms` 字典种子 | Phase 1 | TEST-001, TEST-010 | AC-001 |
| REQ-009 | 全部页面/API | `trade_docs.documents.view\|manage`、page.meta、scope 过滤 | Phase 1（+Phase 0 入口） | TEST-001, TEST-002, TEST-009 | AC-005, AC-006 |
| REQ-010 | Phase 0 全部界面 | i18n + page.meta（label 与 group key） | Phase 0 | TEST-010 | AC-006 |
| REQ-011 | J-004 | `source_kind`/`source_id`/`source_snapshot` 复制语义 | Phase 4 | TEST-011 | AC-007 |

## Rollout, Migration, and Rollback

- **迁移边界**：Phase 1（两张新表）、Phase 2（一张新表）、Phase 3（四列追加）各自 `yarn db:generate` → 人工审阅 SQL 与 `.snapshot-open-mercato.json`
  → **提交前问业主**再 `yarn db:migrate`；**绝不用迁移来验证**（验证跑门禁与集成测试）。
- **Seed / 运维步骤**：`incoterms` 字典种子走 `trade_docs/setup.ts` 的 `seedDefaults`（幂等，insert-only；既有租户要跑一次 `seed:defaults` 或等效入口，
  见 `.ai/lessons/module-seeded-dictionaries-need-seed-defaults.md`）；新功能位对既有角色跑 `yarn mercato auth sync-role-acls`。
- **Feature flags**：不新增开关；Phase 0 的菜单改名与 Phase 1+ 的新页面天然可按页面 `navHidden` / 组织权限灰度。
- **上线顺序**：Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4；每阶段独立可上线、可回滚。
- **观测**：`trade_docs.document.*` 事件流（签发/作废/生成）+ 发号 409 计数；CI 汇总后人工覆盖率（来源快照里 `overridden` 的行占比）。
- **回滚**：全部是新增面（新表/新列/新页面/新命令/新特性 ID/新事件）。
  回滚 = 移除页面入口（`navHidden` 或撤页面）+ 保留数据；旧路径（合同/发票台账/发运单单证）不受影响；
  已归案的附件留在 `attachments`；`contractRecalc` 的票种排除回滚后出口发票会重新参与金额（需同时作废相关发票或保留排除）。

## Migration & Backward Compatibility

（依据 `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`：本规格涉及契约面新增，逐项分类如下。）

| Surface | Change | Classification |
|---|---|---|
| API routes | 新增 `/api/trade_docs/documents*`、`/api/cross_border/shipments/sales-allocations` | ✓ ADDITIVE（新路由） |
| API routes（既有） | `/api/trade_docs/invoices*` 追加**可选**字段（`invoiceKind`、行 `taxRate`/`priceIncludesTax`、`ourNumber` 只读、列表过滤参数）；`/api/cross_border/shipments*` 追加**可选** `salesAllocations` | ✓ ADDITIVE（请求/响应加可选字段，既有键不动） |
| DB schema | 新表 `trade_docs_documents`、`trade_docs_document_lines`、`cross_border_shipment_sales_allocations`；追加列 `trade_docs_invoices.{invoice_kind,our_number,tax_total,gross_total}`、`trade_docs_invoice_lines.{tax_rate,price_includes_tax,tax_amount}`（可空/带默认） | ✓ ADDITIVE（不重命名、不删除、不缩窄；`our_number` 唯一索引允许多 NULL） |
| ACL feature IDs | 新增 `trade_docs.documents.view` / `.manage` | ✓ ADDITIVE（既有 ID 与既有角色授权不动；既有 `trade_docs.*` 通配继续生效） |
| Event IDs | 新增 `trade_docs.document.*` 六个 | ✓ ADDITIVE（既有 ID/载荷不动） |
| 枚举面 | `EXPORT_DOC_TYPES` **不变**（`commercial_invoice` 保留，仅业务上停止新建）；`INVOICE_STATUSES`/`INVOICE_TRANSITIONS` 不变 | ✓ 行为收窄仅在 UI/业务流程，不是枚举移除 |
| Behavior（唯一行为变更） | `lib/contractRecalc.ts` 增加 `invoice_kind <> 'export'` | ⚠️ 行为变更，仅影响**新增的** `invoice_kind='export'` 行（历史行 `invoice_kind IS NULL` 逐字节保持原行为）；回归测试 TEST-007 双向锁死 |
| UI / 导航 | 组 label（外贸 → 出口业务）、菜单名（N-1…N-4）、台账换组；**group key 不变** | ✓ 非契约面；group id 是用户偏好键，刻意不动 |
| 生成文件契约 | 无改动（沿用 `attachments` 与 `buildXlsx`） | ✓ n/a |

**既有租户迁移路径**：无数据迁移。部署后跑一次 `yarn mercato auth sync-role-acls`（新功能位）与字典种子补齐（`incoterms`）；
`trade_docs_invoices` 历史行显示「未分类」且行为不变；发运单既有单证行不变（只是不再新建 `commercial_invoice`）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 统一表让 PI/CI 字段交叉（收货人对 PI 无意义） | 表宽增长、校验分支 | `kind` 判别校验器 + 表单按 kind 呈现；字段仍可空 | 表宽与分支成本（可接受） |
| 发号「最大号 +1」在并发下冲突 | 用户看到 409 重试 | 唯一索引兜底 + 409 提示；草稿不占号 | 高并发下的重试率（可观测 409 计数） |
| CI 汇总是一次性复制 | 分摊后续变更不自动跟随 | 行级 `source_snapshot` + 详情对照显示 | 需人工重汇总（Q-10 已接受） |
| 销售分摊数据质量依赖人工 | CI 金额与报关不一致 | TEST-008/004；汇总为一次性且可覆盖 | 人工维护成本 |
| Phase 2 改发运单聚合（表单/命令/迁移） | 既有发运链路回归风险 | 分摊整体替换语义同采购分摊；既有校验（超发/里程碑/收货）不动；集成测试覆盖 | 发运表单复杂度上升 |
| `contractRecalc` 行为变更 | 合同金额口径 | 只排除 export 票种；TEST-007 双向回归 | 若未来新增票种需再声明参与与否 |
| 银行账户以快照明文存 jsonb | 财务敏感信息 | 沿用既有口径（`parties_bank_accounts` 与合同快照均非加密） | 若合规要求加密，需在 `parties` 规格统一处理 |
| 生成件与上传件并存 | 用户可能拿错文件 | 详情分区显示（「我方生成」/「上传替换件」）+ 文案说明对外件 | 需 UI 文案清晰（TEST-009 覆盖） |
| 迁移新增列/表 | 数据库变更风险 | 生成审阅 + 应用前问业主 + 与代码同 PR；不做数据迁移 | 低（纯新增面） |
| 三张单据的门禁时间 | 交付周期 | 每阶段独立上线、可回滚 | — |

## Acceptance Criteria

- [ ] **AC-001** — 外贸业务可从内部销售订单或采购订单建 PI、复制行、签发获得 `PI-<年>-<4位>`（按组织独立、草稿无号）、生成并下载 XLSX，并能上传替换件预览/下载；合同与 PI 的收款账户取自 `parties` 主数据快照。
- [ ] **AC-002** — 一张发运单的 CI 行数量与分摊行**逐行一致**（销售分摊优先、可回退采购分摊、无发运单可手工），逐行覆盖后仍可追溯来源；系统内 `commercial_invoice` 不再新建，CI 只有一个真相源。
- [ ] **AC-003** — 税务发票三种票种可选；价税合计 = 不含税合计 + 税额合计（含税/不含税两种输入都可表达）；出口发票 0%；销项票 `confirm` 获得 `TI-<年>-<4位>`，并与柜档案的退税资料互链。
- [ ] **AC-004** — 登记/确认出口发票与 PI/CI 后，合同 `contract_total`/`finance_total`/`difference_total` **不变**（回归测试锁死，历史行行为不变）。
- [ ] **AC-005** — 失败安全：跨组织访问不可见（403/404），无 `trade_docs.documents.*` 的功能位拒绝，编号冲突 409 且可重试，已签发单据不可改。
- [ ] **AC-006** — 每个列出的后端面都与其记录的 Open Mercato 参照一致（`DataTable`/`CrudForm`/共享 API helper/语义 token），六态齐备，键盘/窄屏/暗色通过；术语与菜单校正 N-1…N-6 生效且 group key 未变。
- [ ] **AC-007** — 单据间一次性复制（PI → CI → 税务发票）可用，来源可追；复制后互不影响。
- [ ] **AC-008** — 每个已列出的 API/UI 路径都有自包含的集成覆盖（`__integration__` 新建并提供 `meta.ts`），且各阶段配置的验证门禁（`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`，API/UI 阶段加对应 `yarn mercato test:integration <slug>`）全部退出码 0。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 根 `AGENTS.md`（三轴路由、Ask First、Always/Never）；`.ai/guides/contracts.md`、`backend-ui.md`、`upstream/BACKWARD_COMPATIBILITY.md`、`docs/dev/i18n.md`、`.agents/skills/om-spec-writing`、`.agents/skills/om-implement-spec`、`.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md`、`.ai/skills/om-backend-ui-design`（含 `references/quality-states.md`） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 见 Requirement Traceability：REQ-001…011 各自映射到表/路由/事件/页面/测试/AC；表名/命令/特性 ID/事件 ID 与既有惯例一致 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-004 各自落在具体 Phase（1/2/3/4）；Phase 4 只做复制流与文档收口，不承担前面阶段的行为 |
| Platform-native reuse and extension points were chosen before custom code | pass | 见 Reuse and Ownership Map：XLSX/附件、选择器、字典、编号口径、作用域、导航全部复用；自建仅三张表与页面体 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 见 UI and Interaction Contracts：每个面记录最接近的既有参照（`backend/trade-docs/contracts`、`internal_sales` 的 kind 参数写法）与组件族；六态/键盘/暗色/窄屏写进验收 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | 见 Implementation Phases 的每阶段 Depends/Outcome/Deliverables/Requirements/Tests/Validation/Exit gate |
| 契约面变更完成 BC 分类与迁移路径 | pass | 见 Migration & Backward Compatibility：全部 ADDITIVE，唯一行为变更（export 票种排除）有双向回归测试 |
| 阻塞性开放问题全部关闭 | pass | 见 Open Questions：Q-1…Q-12 于 2026-09-28 由业主确认（推荐口径原文） |

**Verdict: Ready for implementation**

## Open Questions

阻塞性问题已全部关闭；实现期若出现新的未知项，回到 `om-spec-writing` 的 gate 单独提问（不要在设计里自行发明）。

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-1 | 三张单据一份规格，还是拆两份？ | 业务 + 技术 | resolved | 拆两份（PI+CI 出口商业单据 / 税务发票并入 trade_docs 既有规格扩列），但**本次在同一份 spec 内按 Phase 分阶段交付**，保持依赖顺序与独立上线；2026-09-28 确认 |
| Q-2 | PI 开给谁、挂在哪？ | 业务 | resolved | 两侧都要：销售侧挂内部销售订单、采购侧挂采购订单，用 `direction` 区分；2026-09-28 确认 |
| Q-3 | 单据形态？ | 业务 + 技术 | resolved | 生成 XLSX + 允许上传件替换；PDF 留后续；2026-09-28 确认 |
| Q-4 | CI 结构化程度？ | 业务 | resolved | 结构化（金额/币种/收货人/贸易术语），行从发运分摊汇总、允许覆盖；2026-09-28 确认 |
| Q-5 | 税务发票票种与发号？ | 业务 + 财务 | resolved | 要票种（增值税专用/普通/出口发票）+ 税率/税额/价税合计 + 我方发号；2026-09-28 确认 |
| Q-6 | 出口发票是否为一类、是否联动退税？ | 业务 + 财务 | resolved | 是，并与 `tax_refund_package`（按柜）互链；2026-09-28 确认 |
| Q-7 | 编号规则？ | 业务 | resolved | `PI-/CI-/TI-<年>-<4位>`，按组织独立；2026-09-28 确认 |
| Q-8 | 同一订单/发运能否开多张？ | 业务 | resolved | 允许一单多张，不做 1:1 唯一约束；2026-09-28 确认 |
| Q-9 | 挂载与权限？ | 技术 | resolved | 新增统一功能位（落为 `trade_docs.documents.view\|manage`）；CI 允许挂发运单或采购单/销售订单，也可无发运单；2026-09-28 确认 |
| Q-10 | 三张单据之间的数据流？ | 业务 + 技术 | resolved | 存链接 + 一次性复制，不做实时同步；2026-09-28 确认 |
| Q-11 | 承载形态？ | 技术 | resolved | 统一 `trade_docs_documents` + `kind`（PI/CI 共用，命令与页面体一套）；税务发票留在 `trade_docs_invoices` 扩列以保合同金额口径单一写入方；2026-09-28 确认 |
| Q-12 | 发运单 ↔ 内部销售订单的关联方式？ | 业务 + 技术 | resolved | 分摊到行（新表 `cross_border_shipment_sales_allocations`，与采购分摊同构）；2026-09-28 确认 |
| Q-13（实现细化，2026-09-28 落定） | 发号时机、命令/表/功能位命名 | 技术 | resolved | 发号统一在签发；命令 `trade_docs.documents.*`；表名 `trade_docs_documents`；功能位 `trade_docs.documents.view\|manage`（见 Design Decisions 的理由） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | 金额口径统一：金额 2 位/单价 4 位，HALF_UP，引擎单点；金额列 numeric(18,2)、单价列 numeric(18,4)（见 [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](2026-09-28-money-scale-2dp-unification.md)）。本 spec：单据/发票行金额列 18,4→18,2、单价列 18,6→18,4；税金额 `tax_total`/`gross_total`/`tax_amount` 18,4→18,2；金额口径改为 `HALF_UP(数量×单价, 2)`（与币种无关）；币种小数位复用行 superseded（`lib/currencyScale.ts` 已删除）。 |
| 2026-09-24 | Initial skeleton：业务口径（PO/PI/CI 三件套都要）+ 三张单据的现状盘点与缺口清单（代码级证据）+ 开放问题 Q-1…Q-10 |
| 2026-09-24 | 补「与三个相近页面的边界」对比（internal-sales 报价/订单 vs trade-docs 发票：归属、金额语义、单号、状态、对方主数据、附件、下游消费者）与 Q-11（承载形态） |
| 2026-09-24 | 补「术语与菜单校正清单」（N-1…N-6）+「实作功能清单」（F-001…F-402）+ Q-1…Q-11 的推荐口径 |
| 2026-09-24 | 补「合同与发运单的修改判定」：合同小改 4 处、发运单需真改；新增 Q-12 与追加功能点 F-004…F-007 |
| 2026-09-28 | 业主确认推荐口径 Q-1…Q-12（N-3 按原文）。按 `SPEC-000-template.md` 补齐：Overview/Success Measures、Design Decisions、Domain Vocabulary、Permissions、Reuse Map、Architecture、Journeys、UI 契约、Data Models、API/Command/Error、Events、Security、Edge Cases、Integration Coverage（TEST-001…011）、Phases（含各阶段 exit gate）、Traceability（REQ-001…011）、Rollout/Rollback、Migration & BC、Risks、AC-001…008、Final Compliance Report（Verdict: Ready for implementation） |
| 2026-09-28 | 实现细化（Q-13）：发号统一在**签发**（草稿不占号）；命令统一 `trade_docs.documents.*`；表名 `trade_docs_documents`（模块前缀惯例）；功能位 `trade_docs.documents.view\|manage`；税务发票留在 `trade_docs_invoices` 扩列、`confirm` 发 `TI-` 号；`contractRecalc` 仅排除 `export` 票种。原 F-102/F-302 的「创建发号 / 新增 issue 动作」按此修正 |
| 2026-09-28 | **Phase 1 实现并验证**（PI 全链路；迁移 `Migration20260928021830_trade_docs.ts` 生成、审阅后经业主同意应用）`trade_docs_documents` + `trade_docs_document_lines`（`kind` 判别，PI/CI 共用）+ `trade_docs_contracts.incoterms` 追加列；签发时发号 `PI-<年>-<4位>`（PENDING 占位 + 唯一索引 + 409 重试，按组织独立）；`trade_docs.documents.{create,update,delete,lines.replace,transition,generate-document,attach}`；`/api/trade_docs/documents*` 六条路由；`lib/documentTemplate.ts` 的 XLSX 生成 + 附件归档 + 下载路由；`trade_docs.documents.view\|manage`；`/backend/trade-docs/proformas/**` 四页 + 共享 `DocumentsTable/DocumentsForm/DocumentDetail`（`kind` 参数化）；F-004 合同我方抬头/银行选择器（共享 `OurPartyPicker`/`lib/partySnapshot.ts`）；F-005 incoterms 字典 + 合同/PI 字段与打印。证据：`yarn generate` ✓｜`yarn typecheck` ✓｜`yarn lint` 0 error / 8 既有 warning｜`yarn ds:check` 731 files ✓｜`yarn test` 284 passed（含 language-purity，zh/en 各 419 键）｜`yarn mercato test:integration pi-documents` **10 passed**（TEST-001/002/003 面：建单/改行/空单拒签/发号与按组织序列/签发冻结/生成+下载+重生成换指针/跨组织隔离/功能位 403+允许/一单多张/非法输入）｜浏览器实测（zh，超管，dev 库）：列表→新建（币种选择器 `CNY — 人民币`）→保存草稿→签发得 `PI-2026-0001`→生成单据→下载（HTTP 200，`application/vnd...sheet`，2083B；解包 `sheet1.xml` 17 行，含 编号/签发日/卖方/买方/行/合计/大写金额「人民币贰拾伍元整」+ SAY YUAN TWENTY-FIVE ONLY，标签按生成时语言解析）→作废（`void`，保留编号）→删除 200；暗色（`html.dark`，body 近黑）与 420px 窄屏（无横向溢出、侧栏收起）实测通过（运行时截图超时，以 DOM/计算样式为证） |
| 2026-09-28 | **Phase 2 实现并验证**（CI + 发运单↔内部销售订单分摊；迁移 `Migration20260928030727_cross_border.ts`）：新表 `cross_border_shipment_sales_allocations`（一柜可对多单，唯一键 `(shipment, sales_order_line_id)`）+ 随发运单命令整体替换的写入路径 + 只读面 `GET /api/cross_border/shipments/sales-allocations` + 读缝 `lib/shipmentSalesReads.ts`；发运表单「销售分摊」编辑器与详情只读表；命令 `trade_docs.documents.aggregate-lines` + `POST /documents/[id]/aggregate-lines`（销售分摊优先、回退采购分摊、逐行 `source_snapshot`、一次性复制）；CI 页面 `/backend/trade-docs/commercial-invoices/**`（`pageOrder 360–363`）；F-203：`commercial_invoice` 保留枚举但不再可选，单证区与对话框给出「已改为结构化单据」提示与跳转链接。证据：门禁全绿｜`yarn mercato test:integration commercial-invoices` **7 passed**（TEST-004/005/008：两张销售订单的分摊往返与整体替换、CI 汇总与采购回退、无发运单 CI 全链路 + 旧槽位仍可读、跨组织与权限）｜浏览器实测：发运详情「销售分摊」行（ORDER-…/商品/数量 9/单价 12.5 USD）与单证区提示+链接、CI 详情「从发运单汇总」按确认对话框执行后明细为 1 行（9 × 12.50 = US$112.50，来源 `sales_allocation`） |
| 2026-09-28 | **Phase 3 实现并验证**（税务发票票种/税额/我方发号/口径隔离；迁移 `Migration20260928033446_trade_docs.ts`）：`trade_docs_invoices` 追加 `invoice_kind`/`our_number`/`tax_total`/`gross_total`（`our_number` 唯一索引）+ `trade_docs_invoice_lines` 追加 `tax_rate`/`price_includes_tax`/`tax_amount`；税额与价税合计由 `lib/invoiceTax.ts` 单一实现（含 `lib/__tests__/invoiceTax.test.ts` 六个精确算式：含税 113@13%→13、不含税 100@13%→13/113、0%→0、1234.56@9%→101.9361）；`confirm` 对销项+有票种发票发 `TI-<年>-<4位>`（PENDING 占位 + 409 重试），进项/无票种/历史行永不发号；`contractRecalc` 仅排除 `invoice_kind='export'`（NULL 历史行逐字节不变，JSDoc 说明退税凭证≠结算凭证）；台账列表新增票种/税额/价税合计列与票种筛选、表单新增票种与行级税率/含税、详情显示我方号与退税锚点链接。证据：门禁全绿（含 language-purity，zh/en 各 449 键）｜`yarn mercato test:integration tax-invoice-ledger` **5 passed**（TEST-006/007：两种价格口径的税额、销项发号与草稿/进项不发号、历史行行为不变、**出口发票确认后合同三列不变而非出口票仍驱动财务金额**、非法票种/负税率/未认证被拒）｜开发库实测：含税行 `taxTotal=13.0000`、`grossTotal=113.0000`，台账页列与筛选渲染正常。**注意（测试方法）**：生产构建下同一 GET URL 的第二次读取会返回上一次的状态（引导缓存），集成用例的读回一律带缓存击穿参数 | |
| 2026-09-28 | **Phase 4 实现并验证**（单据间一次性复制 + 文档收口；无新表/无迁移）：命令 `trade_docs.documents.copy-from`（PI → CI：抬头（对方/我方/币种/汇率/条款/贸易术语/唛头/收货人/通知方）+ 明细一次性复制，逐行 `source_snapshot.kind='trade_document'`，头部 `source_kind='trade_document'` + `source_id` + 快照，重跑整组替换不追加）与 `trade_docs.invoices.copy-from`（CI → 税务发票：对方/币种 + 明细，`taxRate` 保持 0 由业务补，不碰合同绑定，走 `applyInvoiceTotals` 重算）；两条路由 `POST /api/trade_docs/{documents,invoices}/[id]/copy-from`；UI：CI 详情「从形式发票复制」与发票详情「从商业发票复制」（共享可搜索选择器对话框 + 二次确认 + 提交中禁用），来源以 `形式发票（PI） PI-2026-0002` 形式链回源单据详情页（快照缺失时降级为文本）。证据：门禁全绿（generate/typecheck/lint 0 error/ds:check 747 files/test 290 passed）｜`yarn mercato test:integration document-copy-flow` **4 passed**（TEST-011）｜浏览器实测：CI 详情「从形式发票复制」→ 选择 `PI-2026-0002` → 明细 1 行（来源 `trade_document`）、抬头 USD 与合计 US$40.00、来源链接指向 `/backend/trade-docs/proformas/<id>` |
| 2026-09-28 | **修复「改完列表不变」（CRUD 列表缓存失效缺口）**：平台在 `ENABLE_CRUD_API_CACHE=true` 时按「资源 + 租户 + 组织」缓存 CRUD 列表，而 `makeCrudRoute` 只失效「本路由自己那个资源」——三类写从此前无人失效：① 改**别的**资源列的命令（发票确认改写合同 `finance_total`）② 子集合是独立资源（发运写入改分摊列表）③ 绕过工厂的 `[id]/…` 动作路由（生成/汇总/复制）。实测（dev 启 `ENABLE_CRUD_API_CACHE=true`）：合同列表暖读 1000.0000 → 确认发票（真实值 100.0000）→ **同一 URL 仍回 1000.0000**，带 `&_=<ts>` 才见 100.0000。修复：新增 `trade_docs/lib/cacheInvalidation.ts` 与 `cross_border/lib/cacheInvalidation.ts`（在 `runWithCacheTenant` 内调 `invalidateCrudCache`，含只读路由按实体名推导的别名），并把 23 处 `emitCrudSideEffects/emitCrudUndoSideEffects` 之后接上对应集合的失效；测试改用**无缓存击穿**的原始 URL 作为回归口径（`__integration__/crud-cache-freshness.spec.ts` 为常驻 oracle，三例：单据列表反映签发/生成、合同列表反映发票确认、单据行集合反映复制命令）。证据：修复后同一 URL 立即返回新值；五套集成 **3 / 10 / 7 / 5 / 4 passed**（均无 `&_=` 参数）；经验沉淀为 lesson [`crud-cache-invalidation-spans-resources`](../../lessons/crud-cache-invalidation-spans-resources.md) |
