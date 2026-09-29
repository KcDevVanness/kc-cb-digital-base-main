import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A signed purchase or sales contract — the document the business actually signs.
 *
 * `direction` separates the two sides of the same physical shipment (`purchase`: we buy the goods
 * from a brand owner, an agent or our own factory; `sales`: we sell to the overseas subsidiary), and the
 * head stores **three** money columns rather than one:
 *
 * - `contractTotal` — the sum of the lines' contract amounts (2 decimals): what the paper says.
 * - `financeTotal` — the sum of the lines' financial amounts (currency decimals; a line bound to
 *   a *confirmed* invoice line takes that invoice's amount): what finance reconciles.
 * - `differenceTotal` — the two subtracted, signed, shown to the operator instead of hidden.
 *
 * The head totals are derived: `commands/contracts.ts` recomputes them in the same transaction
 * that rewrites the lines or confirms an invoice, so there is exactly one writer.
 *
 * Counterparties are referenced by a scalar id plus a display snapshot (the platform's
 * durable-reference rule — no cross-module ORM relation), and the snapshot is what a reprint
 * shows even after the master record is renamed.
 */
@Entity({ tableName: 'trade_docs_contracts' })
@Index({ name: 'trade_docs_contracts_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'trade_docs_contracts_scope_number_uniq', properties: ['tenantId', 'organizationId', 'number'] })
export class TradeDocsContract {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Assigned at `issue`: `PC-<year>-<4 digits>` / `SC-<year>-<4 digits>`; null while drafting. */
  @Property({ type: 'text', nullable: true })
  number?: string | null

  @Property({ type: 'text', default: 'purchase' })
  direction: string = 'purchase'

  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'counterparty_kind', type: 'text', default: 'supplier' })
  counterpartyKind: string = 'supplier'

  @Property({ name: 'counterparty_id', type: 'uuid', nullable: true })
  counterpartyId?: string | null

  @Property({ name: 'counterparty_snapshot', type: 'jsonb', nullable: true })
  counterpartySnapshot?: Record<string, unknown> | null

  /** Our own side (buyer/seller) as printed: name, address, contact, bank. */
  @Property({ name: 'our_party_snapshot', type: 'jsonb', nullable: true })
  ourPartySnapshot?: Record<string, unknown> | null

  /** `purchase` | `internal` | `export` — which price tier the lines were quoted from. */
  @Property({ name: 'price_tier', type: 'text', nullable: true })
  priceTier?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** Cross-currency records store the rate as a snapshot only; nothing is auto-converted. */
  @Property({ name: 'exchange_rate', type: 'numeric', precision: 18, scale: 8, nullable: true })
  exchangeRate?: string | null

  @Property({ name: 'source_kind', type: 'text', nullable: true })
  sourceKind?: string | null

  @Property({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId?: string | null

  @Property({ name: 'source_snapshot', type: 'jsonb', nullable: true })
  sourceSnapshot?: Record<string, unknown> | null

  @Property({ name: 'contract_total', type: 'numeric', precision: 18, scale: 2, default: '0' })
  contractTotal: string = '0'

  @Property({ name: 'finance_total', type: 'numeric', precision: 18, scale: 2, default: '0' })
  financeTotal: string = '0'

  @Property({ name: 'difference_total', type: 'numeric', precision: 18, scale: 2, default: '0' })
  differenceTotal: string = '0'

  @Property({ name: 'signed_at', type: 'date', nullable: true })
  signedAt?: Date | null

  @Property({ name: 'delivery_date', type: 'date', nullable: true })
  deliveryDate?: Date | null

  @Property({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms?: string | null

  @Property({ name: 'shipping_method', type: 'text', nullable: true })
  shippingMethod?: string | null

  /** Trade term (贸易术语) printed beside the payment terms: `EXW`, `FOB`, `CIF`, … — a dictionary value, free text is allowed. */
  @Property({ type: 'text', nullable: true })
  incoterms?: string | null

  @Property({ name: 'destination', type: 'text', nullable: true })
  destination?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  /** Generated XLSX document (Phase 4); a regeneration moves the pointer to a new attachment. */
  @Property({ name: 'generated_attachment_id', type: 'uuid', nullable: true })
  generatedAttachmentId?: string | null

  /**
   * The counterparty-signed/stamped scan the business files back against the contract — the paper
   * the operator receives, not the file we render.
   *
   * Independent of `generatedAttachmentId`: generating the contract again replaces the XLSX
   * pointer and never touches the stamped scan, and binding a scan never regenerates the document.
   * Only `trade_docs.contracts.attach` writes this column.
   */
  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'generated_at', type: Date, nullable: true })
  generatedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One contract line.
 *
 * The printing copies (`name`, `sku`, `model`, `spec`, `unit`) are written from the product
 * snapshot at line-write time so a re-import of the product master cannot rewrite a signed
 * contract. `productId` stays a scalar id — no cross-module ORM relation.
 *
 * `contractAmount` and `financeAmount` are derived by the money engine; the command layer is the
 * only writer.
 */
@Entity({ tableName: 'trade_docs_contract_lines' })
@Index({ name: 'trade_docs_contract_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'trade_docs_contract_lines_contract_line_uniq', properties: ['contract', 'lineNumber'] })
export class TradeDocsContractLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'quantity' | 'unitPrice' | 'contractAmount' | 'financeAmount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => TradeDocsContract, { fieldName: 'contract_id', deleteRule: 'cascade' })
  contract!: TradeDocsContract

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'text', nullable: true })
  model?: string | null

  @Property({ type: 'text', nullable: true })
  spec?: string | null

  @Property({ type: 'text', nullable: true })
  unit?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 6, default: '0' })
  quantity: string = '0'

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'contract_amount', type: 'numeric', precision: 18, scale: 2, default: '0' })
  contractAmount: string = '0'

  @Property({ name: 'finance_amount', type: 'numeric', precision: 18, scale: 2, default: '0' })
  financeAmount: string = '0'

  @Property({ type: 'text', nullable: true })
  note?: string | null

  /**
   * Frozen provenance of a line copied from an order/quote
   * (`{kind:'order_line', id, orderKind, copiedAt}`). The copy is one-shot: the snapshot names where
   * the row came from after the fact, and nothing syncs it back.
   */
  @Property({ name: 'source_snapshot', type: 'jsonb', nullable: true })
  sourceSnapshot?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * An inbound (supplier) or outbound (issued) invoice.
 *
 * `number` is the *external* document number: it is indexed but deliberately not unique,
 * because two systems legitimately reuse numbers and rejecting an import over that would be
 * wrong. The archived scan lives in the platform's `attachments` store via `attachmentId` —
 * this slice archives and downloads, it does not parse.
 *
 * `status` gates the financial caliber: only a `confirmed` invoice's lines may take over a
 * contract line's financial amount, and `void` releases that hold again.
 */
@Entity({ tableName: 'trade_docs_invoices' })
@Index({ name: 'trade_docs_invoices_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'trade_docs_invoices_number_idx', properties: ['tenantId', 'organizationId', 'number'] })
@Unique({ name: 'trade_docs_invoices_our_number_uniq', properties: ['tenantId', 'organizationId', 'ourNumber'] })
export class TradeDocsInvoice {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text', nullable: true })
  number?: string | null

  /**
   * Tax invoice kind: `vat_special` (增值税专用) | `vat_general` (增值税普通) | `export` (出口发票).
   *
   * `null` means a historical, uncategorized ledger row — it keeps every behavior it had before
   * this column existed and never receives `ourNumber`.
   */
  @Property({ name: 'invoice_kind', type: 'text', nullable: true })
  invoiceKind?: string | null

  /**
   * Our own `TI-<year>-<4 digits>` sequence, assigned at `confirm` for an *outbound* invoice that
   * carries a kind. Inbound, kind-less and historical rows stay `null`; the unique index allows
   * many nulls.
   */
  @Property({ name: 'our_number', type: 'text', nullable: true })
  ourNumber?: string | null

  @Property({ type: 'text', default: 'inbound' })
  direction: string = 'inbound'

  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'counterparty_kind', type: 'text', default: 'supplier' })
  counterpartyKind: string = 'supplier'

  @Property({ name: 'counterparty_id', type: 'uuid', nullable: true })
  counterpartyId?: string | null

  @Property({ name: 'counterparty_snapshot', type: 'jsonb', nullable: true })
  counterpartySnapshot?: Record<string, unknown> | null

  @ManyToOne(() => TradeDocsContract, { fieldName: 'contract_id', nullable: true, deleteRule: 'set null' })
  contract?: TradeDocsContract | null

  @Property({ name: 'source_kind', type: 'text', nullable: true })
  sourceKind?: string | null

  @Property({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId?: string | null

  @Property({ name: 'source_snapshot', type: 'jsonb', nullable: true })
  sourceSnapshot?: Record<string, unknown> | null

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  @Property({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  subtotal: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  total: string = '0'

  /** Σ line `tax_amount`; recomputed by the command layer, never posted by a client. */
  @Property({ name: 'tax_total', type: 'numeric', precision: 18, scale: 2, default: '0' })
  taxTotal: string = '0'

  /**
   * 价税合计 — Σ of each line's tax-inclusive amount (`amount` when the price includes tax,
   * `amount + taxAmount` otherwise). Recomputed by the command layer, never posted.
   */
  @Property({ name: 'gross_total', type: 'numeric', precision: 18, scale: 2, default: '0' })
  grossTotal: string = '0'

  @Property({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt?: Date | null

  /** Archived scan/PDF in the platform attachment store; bound by `trade_docs.invoices.attach`. */
  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One invoice line.
 *
 * `amount` is the figure **as printed on the supplier's invoice** — editable and not derived from
 * `quantity × unitPrice`, because a real invoice often rounds, adds a freight line, or applies a
 * discount the contract does not know about.
 *
 * `contractLine` binds this line to a contract line (same module, so an ORM relation is allowed):
 * once the invoice is `confirmed`, the contract line's *financial* amount becomes this line's
 * `amount`, and the difference against the contracted figure shows up on the contract head.
 */
@Entity({ tableName: 'trade_docs_invoice_lines' })
@Index({ name: 'trade_docs_invoice_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'trade_docs_invoice_lines_invoice_line_uniq', properties: ['invoice', 'lineNumber'] })
export class TradeDocsInvoiceLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'quantity' | 'unitPrice' | 'amount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => TradeDocsInvoice, { fieldName: 'invoice_id', deleteRule: 'cascade' })
  invoice!: TradeDocsInvoice

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'text', nullable: true })
  unit?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 6, default: '0' })
  quantity: string = '0'

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPrice: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  amount: string = '0'

  /**
   * Tax rate as a **percentage** (`13` = 13%, `0` = an export invoice), same caliber as
   * `purchasing_purchase_order_lines.tax_rate`.
   */
  @Property({ name: 'tax_rate', type: 'numeric', precision: 6, scale: 3, default: '0' })
  taxRate: string = '0'

  /** Whether `amount` already includes tax — decides which side the tax is extracted from. */
  @Property({ name: 'price_includes_tax', type: 'boolean', default: true })
  priceIncludesTax: boolean = true

  /**
   * The tax on this line, always **computed server-side** from `amount`/`taxRate` (never accepted
   * from a payload): inclusive `amount − round(amount/(1+rate/100), 2)`, exclusive
   * `round(amount×rate/100, 2)`.
   */
  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 2, default: '0' })
  taxAmount: string = '0'

  @ManyToOne(() => TradeDocsContractLine, {
    fieldName: 'contract_line_id',
    nullable: true,
    deleteRule: 'set null',
  })
  contractLine?: TradeDocsContractLine | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * A PI (proforma invoice) or CI (commercial invoice) — the document *we* issue and number.
 *
 * **PI and CI share this one table via `kind`** (`proforma`: the pre-shipment payment basis handed
 * to the buyer; `commercial`: the customs/clearing invoice). The two are the same shape — our
 * party + bank snapshot, a counterparty snapshot, money, trade terms, lines and a generated
 * XLSX — and differ only in which optional blocks they print (a CI also carries consignee and
 * notify party), so one table, one command set and one page body carry both instead of two
 * parallel document families with identical audit, event and ACL surfaces (see the spec's Design
 * Decisions).
 *
 * **`number` is assigned at `issue`** (`PI-<year>-<4 digits>` / `CI-<year>-<4 digits>`, per
 * `(tenant, organization)`), so a draft consumes **no** sequence slot and can be thrown away
 * without leaving a gap — the same caliber as the contract's `issue` and the shipment's `depart`.
 *
 * Cross-module references (counterparty, source order/shipment) are a scalar id **plus** a jsonb
 * snapshot (the platform's durable-reference rule — no cross-module ORM relation); the snapshot is
 * what a reprint shows after the master record changes. Files: `generatedAttachmentId` is the
 * XLSX we rendered (regeneration moves the pointer), `attachmentId` is the uploaded replacement
 * (stamped/re-signed/customs copy); the two are independent.
 */
@Entity({ tableName: 'trade_docs_documents' })
@Index({ name: 'trade_docs_documents_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'trade_docs_documents_kind_status_idx', properties: ['tenantId', 'organizationId', 'kind', 'status'] })
@Unique({ name: 'trade_docs_documents_scope_number_uniq', properties: ['tenantId', 'organizationId', 'number'] })
export class TradeDocsDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** `proforma` (PI) | `commercial` (CI) — which document family this row belongs to. */
  @Property({ type: 'text', default: 'proforma' })
  kind: string = 'proforma'

  /** `sales` (to a subsidiary/buyer) | `purchase` (to a supplier); PI is issued on both sides. */
  @Property({ type: 'text', default: 'sales' })
  direction: string = 'sales'

  /** Assigned at `issue`: `PI-<year>-<4 digits>` / `CI-<year>-<4 digits>`; null while drafting. */
  @Property({ type: 'text', nullable: true })
  number?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'counterparty_kind', type: 'text', default: 'customer' })
  counterpartyKind: string = 'customer'

  @Property({ name: 'counterparty_id', type: 'uuid', nullable: true })
  counterpartyId?: string | null

  @Property({ name: 'counterparty_snapshot', type: 'jsonb', nullable: true })
  counterpartySnapshot?: Record<string, unknown> | null

  /** Our own side (seller) as printed, including the beneficiary bank the PI is paid into. */
  @Property({ name: 'our_party_snapshot', type: 'jsonb', nullable: true })
  ourPartySnapshot?: Record<string, unknown> | null

  /** CI only: the consignee named on the customs invoice. */
  @Property({ name: 'consignee_snapshot', type: 'jsonb', nullable: true })
  consigneeSnapshot?: Record<string, unknown> | null

  /** CI only: the notify party named on the customs invoice. */
  @Property({ name: 'notify_party_snapshot', type: 'jsonb', nullable: true })
  notifyPartySnapshot?: Record<string, unknown> | null

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** Cross-currency records store the rate as a snapshot only; nothing is auto-converted. */
  @Property({ name: 'exchange_rate', type: 'numeric', precision: 18, scale: 8, nullable: true })
  exchangeRate?: string | null

  /** Σ line `amount`; derived by the command layer (the only writer). */
  @Property({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  subtotal: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  total: string = '0'

  @Property({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms?: string | null

  /** Trade term (贸易术语) printed on PI/CI: `EXW`, `FOB`, `CIF`, … — a dictionary value. */
  @Property({ type: 'text', nullable: true })
  incoterms?: string | null

  /** PI only: the date the offer stands until. */
  @Property({ name: 'valid_until', type: 'date', nullable: true })
  validUntil?: Date | null

  @Property({ name: 'delivery_date', type: 'date', nullable: true })
  deliveryDate?: Date | null

  /** `sales_order` | `purchase_order` | `shipment` | `manual` — what the document was raised from. */
  @Property({ name: 'source_kind', type: 'text', nullable: true })
  sourceKind?: string | null

  @Property({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId?: string | null

  @Property({ name: 'source_snapshot', type: 'jsonb', nullable: true })
  sourceSnapshot?: Record<string, unknown> | null

  /**
   * The purchase/sales contract this PI/CI belongs to (0..1), resolved server-side and frozen as a
   * snapshot — independent of `source_*`, which stays what the document was *raised from* (an order
   * for a PI, a shipment for a CI). The invoice can therefore carry a contract number it prints
   * while its lines come from the shipment.
   */
  @Property({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string | null

  @Property({ name: 'contract_snapshot', type: 'jsonb', nullable: true })
  contractSnapshot?: Record<string, unknown> | null

  @Property({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt?: Date | null

  /** The XLSX we rendered; regenerating moves the pointer to a fresh attachment (old file kept). */
  @Property({ name: 'generated_attachment_id', type: 'uuid', nullable: true })
  generatedAttachmentId?: string | null

  @Property({ name: 'generated_at', type: Date, nullable: true })
  generatedAt?: Date | null

  /** Uploaded replacement (stamped/re-signed/customs copy); independent of the generated XLSX. */
  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One line of a PI/CI document.
 *
 * `amount` is the **face amount**: it defaults to `round(quantity × unitPrice)` at 2 decimal places
 * (HALF_UP) but may be hand-overridden, because a real invoice rounds or carries a freight line the
 * source order does not — so it is stored, not derived. `productSnapshot` and `sourceSnapshot`
 * freeze what the line was copied/raised from (a product, a shipment allocation, …) so a later
 * change to the master never rewrites an issued document.
 */
@Entity({ tableName: 'trade_docs_document_lines' })
@Index({ name: 'trade_docs_document_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'trade_docs_document_lines_document_line_uniq', properties: ['document', 'lineNumber'] })
export class TradeDocsDocumentLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'quantity' | 'unitPrice' | 'amount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => TradeDocsDocument, { fieldName: 'document_id', deleteRule: 'cascade' })
  document!: TradeDocsDocument

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'text', nullable: true })
  model?: string | null

  @Property({ type: 'text', nullable: true })
  spec?: string | null

  @Property({ type: 'text', nullable: true })
  unit?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 6, default: '0' })
  quantity: string = '0'

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPrice: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  amount: string = '0'

  @Property({ name: 'source_snapshot', type: 'jsonb', nullable: true })
  sourceSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One purchase order or sales document a contract covers.
 *
 * The relation is 1:N from the contract — a signed contract is usually executed through several
 * orders over time — and it is deliberately a **separate table** rather than the single
 * `source_kind/source_id` pair: that pair records where the contract was *raised from* (one order,
 * historical, UI-wired later) and cannot express "this contract covers these three orders". The
 * order itself lives in `purchasing` / the installed `sales` engine; only its id, kind, number and
 * a display snapshot are stored, and the set is replaced wholesale by
 * `trade_docs.contracts.orders.replace` (which is why links stay editable after the contract is
 * issued — orders are placed after the signature, while the contract's own lines stay frozen).
 */
@Entity({ tableName: 'trade_docs_contract_orders' })
@Index({ name: 'trade_docs_contract_orders_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'trade_docs_contract_orders_order_idx', properties: ['organizationId', 'tenantId', 'orderId'] })
@Unique({ name: 'trade_docs_contract_orders_contract_order_uniq', properties: ['contract', 'orderKind', 'orderId'] })
export class TradeDocsContractOrder {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => TradeDocsContract, { fieldName: 'contract_id', deleteRule: 'cascade' })
  contract!: TradeDocsContract

  /**
   * `purchase_order` (供应商采购单) | `internal_sales_order` (总公司 → 分公司) |
   * `external_sales_order` (分公司 → 当地客户). The third value is reserved: the external-sales
   * capability lands with `.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md`, and the kind
   * is accepted here so the relation does not need a migration the day it does.
   */
  @Property({ name: 'order_kind', type: 'text' })
  orderKind!: string

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

  /** The order's business number, frozen at link time (the id itself never reaches the UI). */
  @Property({ name: 'order_number', type: 'text', nullable: true })
  orderNumber?: string | null

  @Property({ name: 'order_snapshot', type: 'jsonb', nullable: true })
  orderSnapshot?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
