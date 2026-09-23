import { OptionalProps } from '@mikro-orm/core'
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * Supplier master — the record the installed platform has no equivalent for.
 *
 * Scope columns are required (not nullable): a supplier belongs to exactly one
 * organization, and the visibility rule (HQ sees its descendants, a subsidiary sees
 * itself) is enforced by the scope columns plus the ACL organization set, never by
 * a nullable "shared" row.
 *
 * `code` is unique per organization, not globally: two subsidiaries may legitimately
 * deal with the same agent under their own numbering.
 */
@Entity({ tableName: 'purchasing_suppliers' })
@Unique({ name: 'purchasing_suppliers_scope_code_uniq', properties: ['tenantId', 'organizationId', 'code'] })
export class PurchasingSupplier {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'contact_name', type: 'text', nullable: true })
  contactName?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  address?: string | null

  @Property({ name: 'default_currency_code', type: 'text', default: 'CNY' })
  defaultCurrencyCode: string = 'CNY'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

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
 * Purchase order placed on a domestic agent. Goods ship straight from the supplier to the
 * overseas warehouse, so this record owns the commercial terms and the derived payment
 * state — never a domestic stock balance.
 *
 * `supplierSnapshot` freezes the supplier's display data at `placed`: renaming or deleting
 * the supplier must not rewrite history, and the module deliberately keeps no ORM relation
 * across modules (a scalar id plus a snapshot is the platform's durable-reference pattern).
 */
@Entity({ tableName: 'purchasing_purchase_orders' })
@Unique({ name: 'purchasing_purchase_orders_scope_number_uniq', properties: ['tenantId', 'organizationId', 'number'] })
export class PurchasingPurchaseOrder {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Assigned when the order leaves `draft`; null while drafting. */
  @Property({ type: 'text', nullable: true })
  number?: string | null

  @Property({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string

  @Property({ name: 'supplier_snapshot', type: 'jsonb', nullable: true })
  supplierSnapshot?: Record<string, unknown> | null

  /**
   * Business order number (年-月-序列), typed by the operator. `number` above is the system number
   * the platform assigns at `place`; this one is the number the business and the supplier already
   * use on paper, so the two are deliberately kept apart and neither overwrites the other.
   */
  @Property({ name: 'business_number', type: 'text', nullable: true })
  businessNumber?: string | null

  /** Product category (订单描述) — a single dictionary value from `order_product_category`. */
  @Property({ name: 'product_category', type: 'text', nullable: true })
  productCategory?: string | null

  /**
   * Purchaser and customer are scalar references — the auth user and the CRM company — plus a
   * display snapshot the client sends with the form; the module keeps no ORM relation across
   * modules, so renaming or deleting a user/company never rewrites what a placed order printed.
   */
  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'owner_snapshot', type: 'jsonb', nullable: true })
  ownerSnapshot?: Record<string, unknown> | null

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'customer_snapshot', type: 'jsonb', nullable: true })
  customerSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotal: string = '0'

  @Property({ name: 'tax_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotal: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  total: string = '0'

  /** Deposit as a percentage of the total; the amount below overrides it when set. */
  @Property({ name: 'deposit_percent', type: 'numeric', precision: 6, scale: 3, nullable: true })
  depositPercent?: string | null

  @Property({ name: 'deposit_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  depositAmount?: string | null

  @Property({ name: 'expected_ship_at', type: 'date', nullable: true })
  expectedShipAt?: Date | null

  @Property({ name: 'placed_at', type: Date, nullable: true })
  placedAt?: Date | null

  @Property({ name: 'shipped_at', type: Date, nullable: true })
  shippedAt?: Date | null

  @Property({ name: 'received_at', type: Date, nullable: true })
  receivedAt?: Date | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

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
 * One order line. A line references exactly one product by scalar id plus a display snapshot: the
 * supplier product library row (`sourcing_supplier_products.id` — the supplier-facing item this
 * line was ordered from), the app-owned product master (`products_products.id`), or — historical
 * rows only — the installed catalog. The library and the master are two identities of the same
 * goods, so a line never carries both, and the receipt path resolves the line through the
 * master: a library row that has not been synced yet can be ordered but not received.
 *
 * The module is product-level today (the catalog supports variants; a variant column can be
 * added additively later) and must not import another module's entities.
 *
 * Tax is per line: suppliers quote with or without tax, so `priceIncludesTax` decides how
 * `unitPrice` is split into net and tax, and the order totals are the sums.
 */
@Entity({ tableName: 'purchasing_purchase_order_lines' })
@Unique({ name: 'purchasing_purchase_order_lines_order_line_uniq', properties: ['order', 'lineNumber'] })
export class PurchasingPurchaseOrderLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PurchasingPurchaseOrder, { fieldName: 'order_id', deleteRule: 'cascade' })
  order!: PurchasingPurchaseOrder

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  /**
   * The app-owned product master reference (`products_products`), written by every new order.
   *
   * `catalogProductId` below is the historical reference to the installed catalog: it stays
   * readable (and still selects the line for old orders) but is no longer written. A line carries
   * exactly one reference — this one, the supplier library row below, or the catalog — and the
   * command rejects a line with none, and a line that mixes the library row with either of the two.
   */
  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  /** Scalar id into `sourcing_supplier_products` — the supplier-facing item this line was ordered from. */
  @Property({ name: 'supplier_product_id', type: 'uuid', nullable: true })
  supplierProductId?: string | null

  @Property({ name: 'catalog_product_id', type: 'uuid', nullable: true })
  catalogProductId?: string | null

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  /** Advanced by receipts (manual today, shipment-driven once `cross_border` lands). */
  @Property({ name: 'received_quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  receivedQuantity: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 6, scale: 3, default: '0' })
  taxRate: string = '0'

  @Property({ name: 'price_includes_tax', type: 'boolean', default: true })
  priceIncludesTax: boolean = true

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'net_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netTotal: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'line_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  lineTotal: string = '0'

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * A payment against an order, in stages: 定金 then 尾款, paid in full or in parts.
 * The order's payment state and outstanding balance are derived from these rows — there is
 * deliberately no stored payment status and no separate AP ledger.
 */
@Entity({ tableName: 'purchasing_purchase_payments' })
export class PurchasingPurchasePayment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PurchasingPurchaseOrder, { fieldName: 'order_id', deleteRule: 'cascade' })
  order!: PurchasingPurchaseOrder

  @Property({ type: 'text' })
  stage!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  @Property({ name: 'paid_at', type: 'date' })
  paidAt!: Date

  @Property({ type: 'text', nullable: true })
  reference?: string | null

  @Property({ name: 'method_note', type: 'text', nullable: true })
  methodNote?: string | null

  /** Bank slip or other proof of payment; the file itself lives in the `attachments` module. */
  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * Order paperwork that travels with the purchase order: the supplier's invoice, the packing list,
 * and the receipts for what was paid against this order. One row is one file — a document type
 * that arrives as several files (receipts, invoices) is several rows — and the file itself lives
 * in the installed `attachments` module, so only its id is stored here.
 *
 * The document hangs on the order rather than on a shipment because these papers exist before
 * anything ships; the export set travels with the consignment and is recorded in `cross_border`.
 */
@Entity({ tableName: 'purchasing_purchase_order_documents' })
export class PurchasingPurchaseOrderDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PurchasingPurchaseOrder, { fieldName: 'order_id', deleteRule: 'cascade' })
  order!: PurchasingPurchaseOrder

  @Property({ name: 'doc_type', type: 'text' })
  docType!: string

  @Property({ name: 'document_number', type: 'text', nullable: true })
  documentNumber?: string | null

  @Property({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt?: Date | null

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
