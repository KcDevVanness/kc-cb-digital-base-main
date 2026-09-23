import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A supplier quotation: one document a supplier sent (an imported workbook or a hand-typed
 * list) with the lines the operator reviews and promotes.
 *
 * `product`-master price rows cannot carry this history — `products_prices` is keyed by
 * `(product, tier, currency, minQuantity)` and holds no supplier, quote date or source file —
 * so the quotation lives here and only the chosen line is written back to the master.
 *
 * `columnMap`, `sectionRules`, `header_row_index` and the layout signature are stored so the
 * same file can be re-parsed deterministically with a different mapping (or no mapping at all)
 * without asking the operator to re-upload it.
 */
@Entity({ tableName: 'sourcing_quotes' })
@Index({ name: 'sourcing_quotes_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'sourcing_quotes_signature_idx', properties: ['sourceLayoutSignature'] })
@Unique({ name: 'sourcing_quotes_scope_number_uniq', properties: ['tenantId', 'organizationId', 'number'] })
export class SourcingQuote {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'currencyCode'
    | 'status'
    | 'sourceKind'
    | 'lineCount'
    | 'promotedCount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Assigned by `approve` as `SQ-<year>-<4 digits>`; drafts have no number (null is not unique). */
  @Property({ type: 'text', nullable: true })
  number?: string | null

  /** Scalar id into `purchasing_suppliers`; never a cross-module ORM relation. */
  @Property({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId?: string | null

  @Property({ name: 'supplier_name_snapshot', type: 'text', nullable: true })
  supplierNameSnapshot?: string | null

  @Property({ name: 'quote_date', type: 'date', nullable: true })
  quoteDate?: Date | null

  @Property({ name: 'valid_until', type: 'date', nullable: true })
  validUntil?: Date | null

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** `draft` | `approved` | `archived` | `cancelled`, command-driven only. */
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  /** `excel_import` | `manual`. */
  @Property({ name: 'source_kind', type: 'text', default: 'excel_import' })
  sourceKind: string = 'excel_import'

  @Property({ name: 'source_attachment_id', type: 'uuid', nullable: true })
  sourceAttachmentId?: string | null

  @Property({ name: 'source_file_name', type: 'text', nullable: true })
  sourceFileName?: string | null

  @Property({ name: 'source_sheet_name', type: 'text', nullable: true })
  sourceSheetName?: string | null

  @Property({ name: 'source_layout_signature', type: 'text', nullable: true })
  sourceLayoutSignature?: string | null

  @Property({ name: 'header_row_index', type: 'integer', nullable: true })
  headerRowIndex?: number | null

  /** `{ targetField: { sourceIndex, sourceHeader } }` as actually applied. */
  @Property({ name: 'column_map', type: 'jsonb', nullable: true })
  columnMap?: Record<string, unknown> | null

  /** `{ useSections, categoryFromSection, detectedCurrency }`. */
  @Property({ name: 'section_rules', type: 'jsonb', nullable: true })
  sectionRules?: Record<string, unknown> | null

  @Property({ name: 'source_profile_id', type: 'uuid', nullable: true })
  sourceProfileId?: string | null

  @Property({ name: 'line_count', type: 'integer', default: 0 })
  lineCount: number = 0

  @Property({ name: 'promoted_count', type: 'integer', default: 0 })
  promotedCount: number = 0

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'approved_at', type: Date, nullable: true })
  approvedAt?: Date | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One offered product variant inside a quotation.
 *
 * The normalized columns drive the review grid and the promotion; `raw` keeps the source row
 * keyed by its original header, so a mis-mapped or unmapped column is never lost and a
 * re-parse stays lossless. `suggested_rsp` deliberately has no product-master counterpart.
 */
@Entity({ tableName: 'sourcing_quote_lines' })
@Index({ name: 'sourcing_quote_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'sourcing_quote_lines_sku_idx', properties: ['derivedSku'] })
@Unique({ name: 'sourcing_quote_lines_quote_line_uniq', properties: ['quote', 'lineNumber'] })
export class SourcingQuoteLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'unit' | 'rowStatus' | 'selected' | 'warnings'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => SourcingQuote, { fieldName: 'quote_id', deleteRule: 'cascade' })
  quote!: SourcingQuote

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  /** Zero-based row index in the source sheet, for reconciliation with the original file. */
  @Property({ name: 'source_row_number', type: 'integer', nullable: true })
  sourceRowNumber?: number | null

  @Property({ name: 'section_label', type: 'text', nullable: true })
  sectionLabel?: string | null

  @Property({ name: 'item_no', type: 'text', nullable: true })
  itemNo?: string | null

  @Property({ name: 'product_name', type: 'text', nullable: true })
  productName?: string | null

  /** The suffix the SKU derivation appended (`UVC`, `5PCS`), when it appended one. */
  @Property({ name: 'variant_label', type: 'text', nullable: true })
  variantLabel?: string | null

  @Property({ name: 'derived_sku', type: 'text', nullable: true })
  derivedSku?: string | null

  @Property({ name: 'hs_code', type: 'text', nullable: true })
  hsCode?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'PCS' })
  unit: string = 'PCS'

  @Property({ name: 'unit_cost', type: 'numeric', precision: 18, scale: 6, nullable: true })
  unitCost?: string | null

  /** Line-level override of the quotation currency; null means "use the quotation's". */
  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'suggested_rsp', type: 'numeric', precision: 18, scale: 6, nullable: true })
  suggestedRsp?: string | null

  @Property({ name: 'moq_raw', type: 'text', nullable: true })
  moqRaw?: string | null

  @Property({ name: 'moq_quantity', type: 'integer', nullable: true })
  moqQuantity?: number | null

  @Property({ name: 'carton_quantity', type: 'integer', nullable: true })
  cartonQuantity?: number | null

  @Property({ type: 'integer', nullable: true })
  cartons?: number | null

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

  @Property({ name: 'carton_volume', type: 'numeric', precision: 16, scale: 6, nullable: true })
  cartonVolume?: string | null

  /** The source row keyed by its original header text. */
  @Property({ type: 'jsonb', nullable: true })
  raw?: Record<string, unknown> | null

  @Property({ type: 'jsonb', default: '[]' })
  warnings: string[] = []

  /** `staged` | `ready` | `invalid` | `skipped` | `promoted`. */
  @Property({ name: 'row_status', type: 'text', default: 'staged' })
  rowStatus: string = 'staged'

  @Property({ type: 'boolean', default: true })
  selected: boolean = true

  @Property({ name: 'promoted_product_id', type: 'uuid', nullable: true })
  promotedProductId?: string | null

  @Property({ name: 'promoted_price_id', type: 'uuid', nullable: true })
  promotedPriceId?: string | null

  @Property({ name: 'promoted_at', type: Date, nullable: true })
  promotedAt?: Date | null

  /**
   * The supplier library row this line fed (`sourcing_supplier_products.id`).
   *
   * Same module, so a plain scalar id is enough — the library row is the durable record and the
   * line only points at it. Null until the line is imported or promoted into the library.
   */
  @Property({ name: 'supplier_product_id', type: 'uuid', nullable: true })
  supplierProductId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One item a supplier sells — the supplier-side product library.
 *
 * The supplier's own goods list (item no., name, spec, unit, carton data, MOQ, HS code) as
 * opposed to the internal product master: `products_products` is the record stock, internal sales
 * and contracts need, this is the list the buyer orders from. The two are bridged by
 * `product_id`, backfilled by the explicit "sync to product master" action, so a supplier item can
 * be ordered before it exists internally and nothing is auto-created in the master.
 *
 * Deliberately carries **no price**: prices live on `sourcing_quote_lines` and purchase order
 * lines (purchasing Q-P-004), so a library row can never go stale about money.
 *
 * `supplier_sku` is unique per supplier **including soft-deleted rows** (same rule as
 * `products_variants`): a supplier code is a stable business identity, so a deleted row keeps
 * owning its code until it is restored. Duplicate checks must therefore query soft-deleted rows
 * too, or the unique index turns a readable 409 into a 500.
 */
@Entity({ tableName: 'sourcing_supplier_products' })
@Index({ name: 'sourcing_supplier_products_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'sourcing_supplier_products_supplier_idx', properties: ['supplierId'] })
@Unique({
  name: 'sourcing_supplier_products_scope_supplier_sku_uniq',
  properties: ['tenantId', 'organizationId', 'supplierId', 'supplierSku'],
})
export class SourcingSupplierProduct {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'unit' | 'status' | 'source'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Scalar id into `purchasing_suppliers`; never a cross-module ORM relation. Immutable after create. */
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

  @Property({ type: 'text' })
  name!: string

  /** Spec sheet text; maps to the product master's `spec_summary` when the row is synced. */
  @Property({ type: 'text', nullable: true })
  description?: string | null

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
 * A saved column mapping for one sheet layout, found by the layout signature.
 *
 * A supplier renaming or adding a column changes the signature, which invalidates the profile
 * and sends the file back through operator confirmation instead of silently mis-mapping prices.
 */
@Entity({ tableName: 'sourcing_import_profiles' })
@Index({ name: 'sourcing_import_profiles_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'sourcing_import_profiles_scope_signature_uniq',
  properties: ['tenantId', 'organizationId', 'layoutSignature'],
})
export class SourcingImportProfile {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'usageCount' | 'builtIn'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  /** Hint only; two suppliers with the same layout share one profile. */
  @Property({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId?: string | null

  @Property({ name: 'layout_signature', type: 'text' })
  layoutSignature!: string

  @Property({ name: 'sheet_name', type: 'text', nullable: true })
  sheetName?: string | null

  @Property({ name: 'header_row_index', type: 'integer' })
  headerRowIndex!: number

  /** `{ targetField: { sourceIndex, sourceHeader } }`. */
  @Property({ name: 'column_map', type: 'jsonb' })
  columnMap!: Record<string, unknown>

  @Property({ name: 'section_rules', type: 'jsonb', nullable: true })
  sectionRules?: Record<string, unknown> | null

  @Property({ name: 'field_options', type: 'jsonb', nullable: true })
  fieldOptions?: Record<string, unknown> | null

  @Property({ name: 'built_in', type: 'boolean', default: false })
  builtIn: boolean = false

  @Property({ name: 'usage_count', type: 'integer', default: 0 })
  usageCount: number = 0

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
