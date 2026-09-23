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

  @Property({ name: 'contract_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  contractTotal: string = '0'

  @Property({ name: 'finance_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  financeTotal: string = '0'

  @Property({ name: 'difference_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  differenceTotal: string = '0'

  @Property({ name: 'signed_at', type: 'date', nullable: true })
  signedAt?: Date | null

  @Property({ name: 'delivery_date', type: 'date', nullable: true })
  deliveryDate?: Date | null

  @Property({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms?: string | null

  @Property({ name: 'shipping_method', type: 'text', nullable: true })
  shippingMethod?: string | null

  @Property({ name: 'destination', type: 'text', nullable: true })
  destination?: string | null

  /** 唛头 — printed shipping marks. */
  @Property({ type: 'text', nullable: true })
  marks?: string | null

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

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 6, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'contract_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  contractAmount: string = '0'

  @Property({ name: 'finance_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  financeAmount: string = '0'

  @Property({ type: 'text', nullable: true })
  note?: string | null

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

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotal: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  total: string = '0'

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

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 6, default: '0' })
  unitPrice: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

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
