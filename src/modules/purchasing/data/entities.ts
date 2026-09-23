import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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
 * supplier product library row (`purchasing_supplier_products.id` — the supplier-facing item this
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

  /** Scalar id into `purchasing_supplier_products` — the supplier-facing item this line was ordered from. */
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

// ---------------------------------------------------------------------------------------
// Supplier product library (the buyer-facing goods list, moved here from `sourcing`)
// ---------------------------------------------------------------------------------------

/**
 * One item a supplier sells — the supplier-side product library.
 *
 * The supplier's own goods list (item no., name, spec, unit, carton data, MOQ, HS code) as
 * opposed to the internal product master: `products_products` is the record stock, internal sales
 * and contracts need, this is the list the buyer orders from. The two are bridged by
 * `product_id`, backfilled by the explicit "sync to product master" action, so a supplier item can
 * be ordered before it exists internally and nothing is auto-created in the master.
 *
 * Carries the item's **current price list** as `PurchasingSupplierProductPrice` rows (one row per
 * `price_kind` × currency × minimum quantity). A price is a record, never a column: the two prices
 * this list has always printed side by side — the supplier's cost and our own offer — are two rows
 * of the same shape, so a third currency or a negotiated quantity ladder is data, not a migration.
 * The quotation stays the document that *negotiates* a price (`sourcing_quote_lines`) and the
 * purchase order still freezes its own `unitPrice` (purchasing Q-P-004); nothing here pre-fills an
 * order line, so an order can never be placed at a stale stored price.
 *
 * `supplier_sku` is unique per supplier **including soft-deleted rows** (same rule as
 * `products_variants`): a supplier code is a stable business identity, so a deleted row keeps
 * owning its code until it is restored. Duplicate checks must therefore query soft-deleted rows
 * too, or the unique index turns a readable 409 into a 500.
 *
 * The buyer-facing pages live at `/backend/purchasing/supplier-products`, so the library sits in
 * the module whose menu it belongs to; `sourcing` reaches it only through its commands (a
 * quotation line feeding the library calls `purchasing.supplier-products.import-from-quote`).
 */
@Entity({ tableName: 'purchasing_supplier_products' })
@Index({ name: 'purchasing_supplier_products_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchasing_supplier_products_supplier_idx', properties: ['supplierId'] })
@Unique({
  name: 'purchasing_supplier_products_scope_supplier_sku_uniq',
  properties: ['tenantId', 'organizationId', 'supplierId', 'supplierSku'],
})
export class PurchasingSupplierProduct {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'unit' | 'status' | 'source' | 'imageAttachmentIds'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /**
   * Scalar id into `purchasing_suppliers`, kept scalar on purpose: the supplier master is an
   * aggregate of its own, and the row already carries a name snapshot so a rename never rewrites
   * the library's history. Immutable after create.
   */
  @Property({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string

  @Property({ name: 'supplier_name_snapshot', type: 'text', nullable: true })
  supplierNameSnapshot?: string | null

  /** The library key: the quotation line's `derived_sku ?? item_no`, or the operator's own code. */
  @Property({ name: 'supplier_sku', type: 'text' })
  supplierSku!: string

  /** The supplier's original item number, kept for display next to the derived code. */
  @Property({ name: 'item_no', type: 'text', nullable: true })
  itemNo?: string | null

  /** The supplier's own product name, as printed on their sheet. */
  @Property({ type: 'text' })
  name!: string

  /** Our Chinese name for the item; becomes the master's `name` when the row is synced. */
  @Property({ name: 'name_zh', type: 'text', nullable: true })
  nameZh?: string | null

  /** Our English name for the item; becomes the master's `name_en` when the row is synced. */
  @Property({ name: 'name_en', type: 'text', nullable: true })
  nameEn?: string | null

  /** Spec sheet text; maps to the product master's `spec_summary` when the row is synced. */
  @Property({ type: 'text', nullable: true })
  description?: string | null

  /**
   * 报关申报要素 — the declaration-elements template the export declaration is filled from
   * (品名/品牌/型号/材质/用途/规格…). Free text on purpose: the wording is copied verbatim onto
   * customs paperwork, so it must not be normalized by a lookup.
   */
  @Property({ name: 'declaration_elements', type: 'text', nullable: true })
  declarationElements?: string | null

  @Property({ type: 'text', default: 'PCS' })
  unit: string = 'PCS'

  @Property({ name: 'hs_code', type: 'text', nullable: true })
  hsCode?: string | null

  @Property({ name: 'moq_quantity', type: 'integer', nullable: true })
  moqQuantity?: number | null

  @Property({ name: 'carton_quantity', type: 'integer', nullable: true })
  cartonQuantity?: number | null

  @Property({ name: 'unit_net_weight', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitNetWeight?: string | null

  @Property({ name: 'carton_gross_weight', type: 'numeric', precision: 16, scale: 4, nullable: true })
  cartonGrossWeight?: string | null

  @Property({ name: 'carton_net_weight', type: 'numeric', precision: 16, scale: 4, nullable: true })
  cartonNetWeight?: string | null

  /** `{ length, width, height, unit: 'cm' }`. */
  @Property({ name: 'inner_packing', type: 'jsonb', nullable: true })
  innerPacking?: Record<string, unknown> | null

  @Property({ name: 'outer_packing', type: 'jsonb', nullable: true })
  outerPacking?: Record<string, unknown> | null

  /**
   * `string[]` of `attachments` ids — the product photos, in display order.
   *
   * The files themselves live in the installed `attachments` module, uploaded against
   * `entityId = purchasing:purchasing_supplier_product` and this row's id; this column is the ordered
   * list the form and the detail read, so rendering a record never needs a second query. Binding
   * an uploaded file is a row update, which is what puts the image list behind the row's
   * optimistic lock.
   */
  @Property({ name: 'image_attachment_ids', type: 'jsonb', default: '[]' })
  imageAttachmentIds: string[] = []

  /** Backfilled by the sync action with the product master row this supplier item became. */
  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  /** `active` | `inactive`. */
  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  /** `manual` (typed by the operator) | `quote` (fed by a quotation line). */
  @Property({ type: 'text', default: 'manual' })
  source: string = 'manual'

  @Property({ name: 'last_quote_id', type: 'uuid', nullable: true })
  lastQuoteId?: string | null

  @Property({ name: 'last_quote_line_id', type: 'uuid', nullable: true })
  lastQuoteLineId?: string | null

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
 * One price row of a supplier library item.
 *
 * The two prices a 产品明细表 prints side by side are the same record shape with different
 * `price_kind`: `supplier_cost` is what the supplier charges us (the sheet's 「PK 单价」), and
 * `company_offer` is what we quote out (the sheet's 「KC 单价」). Party and currency are separate
 * dimensions on purpose — the old `PK.RMB` / `KC.USD` column names glued "who prices it" to "in
 * which currency", which is why neither could be changed without a new column. Here a third
 * currency, a quantity ladder or a future kind (`agent_quote`, `retail`) is a row.
 *
 * `min_quantity` mirrors the product master's price rows: the same kind and currency quoted from
 * 1 piece and from one carton are two rows, and 1 is the base price the list column shows.
 *
 * The whole price set of one item is submitted in one `purchasing.supplier-products.replace-prices`
 * command (mirroring `products.prices.replace`). Rows that disappear from the payload are
 * **deactivated**, never deleted: a purchase order line's snapshot may name a price that is no
 * longer quoted, and an issued document must stay explainable. The unique key excludes
 * `is_active`, so a reactivated row is the same row and history never forks.
 */
@Entity({ tableName: 'purchasing_supplier_product_prices' })
@Index({ name: 'purchasing_supplier_product_prices_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchasing_supplier_product_prices_product_idx', properties: ['supplierProduct'] })
@Unique({
  name: 'purchasing_supplier_product_prices_key_uniq',
  properties: ['tenantId', 'organizationId', 'supplierProduct', 'priceKind', 'currencyCode', 'minQuantity'],
})
export class PurchasingSupplierProductPrice {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'minQuantity' | 'unitPrice' | 'isActive'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Same module, so this is a real relation with the owned side defined. */
  @ManyToOne(() => PurchasingSupplierProduct, { fieldName: 'supplier_product_id', deleteRule: 'cascade' })
  supplierProduct!: PurchasingSupplierProduct

  /** `supplier_cost` | `company_offer` — see `lib/priceKinds.ts` for the fixed code list. */
  @Property({ name: 'price_kind', type: 'text' })
  priceKind!: string

  /** Three-letter uppercase ISO code, checked against the currency dictionary before it is stored. */
  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'min_quantity', type: 'integer', default: 1 })
  minQuantity: number = 1

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 6, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
