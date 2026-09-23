# `trade_docs` — 购销合同、发票与双口径金额

app 自有模块。**合同的唯一台账**：采购/销售两个方向的购销合同（含行、商品快照）→ 进项/销项发票
（可绑定合同行、扫描件归档）→ 合同头三列金额（合同金额 / 财务金额 / 差额）。需求与验收见
[`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `TradeDocsContract` / `TradeDocsContractLine` / `TradeDocsInvoice` / `TradeDocsInvoiceLine` → 表 `trade_docs_contracts` / `trade_docs_contract_lines` / `trade_docs_invoices` / `trade_docs_invoice_lines` |
| API | `GET|POST|PUT|DELETE /api/trade_docs/contracts`、`/contracts/lines`、`POST /api/trade_docs/contracts/transitions`、`POST|GET /api/trade_docs/contracts/[id]/document`（生成 / 下载合同 Excel）、`/invoices`、`/invoices/lines`、`/invoices/transitions`、`PUT /api/trade_docs/invoices/attach` |
| 命令 | `trade_docs.contracts.{create,update,delete,transition,generate-document}`、`trade_docs.invoices.{create,update,delete,transition,attach}` |
| 后台页面 | `/backend/trade-docs/contracts`（列表/新建/详情/编辑）、`/backend/trade-docs/invoices`（列表/新建/编辑+确认/作废/附件） |
| 事件 | `trade_docs.contract.{created,updated,deleted,issued,signed,closed,cancelled,document.generated}`、`trade_docs.invoice.{created,updated,deleted,confirmed,voided,attached}` |
| 权限 | `trade_docs.contracts.view|manage`、`trade_docs.invoices.view|manage` |
| 迁移 | `migrations/Migration*_trade_docs.ts`（`yarn db:generate` 生成，审阅后应用） |

## 金额口径（唯一权威定义在 `lib/money.ts`）

```text
行：数量 × 单价
   ├─ quantize(币种小数位)        → 财务金额（行绑定「已确认」发票行时取该发票行金额）
   └─ quantize(2)                → 合同金额（合同上打印的数字）
头：Σ 财务金额 = finance_total ；Σ 合同金额 = contract_total ；contract − finance = difference_total
```

- 量化是 BigInt 半进位（远离零），**禁止 `toFixed`**：`(1.005).toFixed(2) === '1.00'`。
- 币种小数位来自 `currencies.decimal_places`（读不到/非法 → 2，钳制 0..8）。
- 发票优先是**逐行**、且只认 `confirmed`：草稿/作废发票不影响合同；作废后自动回退为按单价计算。
- 合同头的三列由 `lib/contractRecalc.ts` 在写入行的同一事务内重算，命令层不自己写算术。

## 规则（有意为之）

- **合同是聚合根**：行只能通过合同的 create/update 写入（行接口只读），行号由命令 1..n 分配。
- **状态机集中在命令**：`draft → issued → signed → closed`，`cancel` 仅 draft/issued 且**必填原因**（原因追加到 `notes`，与 purchasing 一致）；非法流转 422 且状态不变；`issue` 才分配单号
  `PC|SC-<年>-<4位>`（先写占位号再取号，唯一约束是最终保证）。
- **签发后锁定**：非 draft 合同不能编辑（409），明细与抬头都冻结。
- **行存快照**：`name/sku/model/spec/unit` 在写入时从 `products` 冻结，商品改名/删除不改写已出合同；
  引用只存标量 id（无跨模块 ORM 关联），`products` 侧的读取走 scoped Kysely。
- **发票金额以票面为准**：`amount` 不等于 `数量×单价` 也允许（真实发票有运费/折扣/舍入），
  合同行绑定它之后财务口径取票面值，差额留痕。
- **发票号不唯一**：外部票号只建索引，不建唯一约束（两家系统可能重号）。
- **附件先建后绑**：发票先建 → 上传 `/api/attachments` → `attach` 绑 `attachment_id`；上传失败不回滚发票，行内可重试；本期只归档与下载，不解析。
- **合同 Excel 最后补**：`lib/contractTemplate.ts` 的常量是唯一模板出处，`buildXlsx`（平台零依赖写入器）生成后**归档为附件**（重新生成会换新文件，旧文件保留）；金额写数字便于 Excel 求和；大写金额见 `lib/amountInWords.ts`。
- **读写作用域**：读（列表）展开到下级组织，写（命令）只在当前选定组织生效 —— 下级组织的单据要切换组织后再操作，服务端会明确提示。

## 验证

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check
yarn jest --config jest.config.cjs src/modules/trade_docs
# 冒烟（dev server 在跑时）：建合同 201 → 非法流转 422 → issue 得 PC-<年>-0001 → 换币种 0 位小数时
# 合同金额与财务金额分离 → 发票 confirm 后财务金额取票面、void 回退 → 上传+绑定附件 200 →
# POST/GET [id]/document 生成并下载 XLSX（内容类型为 xlsx，金额列可求和）
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'trade_docs', from: '@app' }` 并 `yarn generate`；表与迁移保留
（数据回滚需另行走 `yarn db:migrate:down` 并确认目标库）。合同 Excel 生成的附件仍留在存储驱动中
（不随模块回滚删除）。
