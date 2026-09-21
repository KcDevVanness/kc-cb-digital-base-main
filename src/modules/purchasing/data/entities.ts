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
 * One order line. References a catalog product by scalar id plus a display snapshot —
 * the module is product-level today (the catalog supports variants; a variant column can be
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

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

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
