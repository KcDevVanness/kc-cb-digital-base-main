import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * Product line (界面名「产品线」) — the flat product family a product belongs to (`fountain`,
 * `feeder`, …). The seeded set is a starting point for every organization, not a supplier's list: a
 * self-made line is typed here exactly like a purchased one.
 *
 * Deliberately flat: this axis carries no hierarchy and no behaviour — the product hierarchy lives
 * in `ProductsCategory` (界面名「产品品类」). See
 * `.ai/specs/2026-09-23-product-taxonomy-consolidation.md` before giving it a tree.
 *
 * Scope columns are required (not nullable): a type belongs to exactly one organization, and
 * the visibility rule (HQ sees its descendants, a subsidiary sees itself) is enforced by the
 * scope columns plus the ACL organization set, never by a nullable "shared" row.
 *
 * `code` is unique per organization, not globally: two subsidiaries may keep their own
 * taxonomy for the same physical product line.
 */
@Entity({ tableName: 'products_types' })
@Index({ name: 'products_types_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'products_types_scope_code_uniq', properties: ['tenantId', 'organizationId', 'code'] })
export class ProductsType {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'name_en', type: 'text', nullable: true })
  nameEn?: string | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Product category (界面名「产品品类」) — a per-organization tree, and the module's only product
 * hierarchy: the flat `ProductsType` axis (界面名「产品线」) deliberately carries none.
 *
 * The hierarchy columns (`parent_id`, `root_id`, `tree_path`, `depth`, `ancestor_ids`,
 * `child_ids`, `descendant_ids`) are derived: commands call
 * `rebuildProductCategoryHierarchyForOrganization` after every create/update, so reads never
 * need a recursive query and every list can render the full path. The shape mirrors the
 * installed catalog's category tree so the same algorithm applies.
 */
@Entity({ tableName: 'products_categories' })
@Index({ name: 'products_categories_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'products_categories_scope_code_uniq', properties: ['tenantId', 'organizationId', 'code'] })
export class ProductsCategory {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'name_en', type: 'text', nullable: true })
  nameEn?: string | null

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'root_id', type: 'uuid', nullable: true })
  rootId?: string | null

  @Property({ name: 'tree_path', type: 'text', nullable: true })
  treePath?: string | null

  @Property({ type: 'integer', default: 0 })
  depth: number = 0

  @Property({ name: 'ancestor_ids', type: 'jsonb', default: [], nullable: false })
  ancestorIds: string[] = []

  @Property({ name: 'child_ids', type: 'jsonb', default: [], nullable: false })
  childIds: string[] = []

  @Property({ name: 'descendant_ids', type: 'jsonb', default: [], nullable: false })
  descendantIds: string[] = []

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Product — the master record a contract line snapshots.
 *
 * `catalogProductId` is an **optional** link to the installed catalog's product: the official
 * chain (`sales`, `purchasing`) references `catalog_products`, and this scalar id (plus a
 * snapshot) keeps reconciliation possible without a cross-module ORM relation, which the
 * platform forbids. This module never writes the catalog table.
 *
 * Packaging/export/lithium columns exist because a contract's printed line and an export
 * declaration need them; they are owned here rather than relying on the official product.
 */
@Entity({ tableName: 'products_products' })
@Index({ name: 'products_products_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'products_products_scope_sku_uniq', properties: ['tenantId', 'organizationId', 'sku'] })
export class ProductsProduct {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  sku!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'name_en', type: 'text', nullable: true })
  nameEn?: string | null

  /**
   * The brand the goods are sold under: the brand owner's for a purchased line, our own for a
   * self-designed or commission-produced one. Nothing defaults to a brand — an empty string means
   * "not recorded" — so a self-made product can never be silently stamped with a supplier's brand.
   */
  @Property({ type: 'text', default: '' })
  brand: string = ''

  @Property({ type: 'text', nullable: true })
  series?: string | null

  /**
   * The model code the goods are known by — the brand owner's for a purchased line, the factory's
   * or ours for a self-made one (e.g. `W5C`). Printed on the contract line.
   */
  @Property({ name: 'manufacturer_model', type: 'text', nullable: true })
  manufacturerModel?: string | null

  @Property({ name: 'type_id', type: 'uuid', nullable: true })
  typeId?: string | null

  /** The primary category; multiple assignment can be added later as an assignment table. */
  @Property({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string | null

  /** Spec string used on contracts and declarations, e.g. 白色 / 1.5L / 含滤芯. */
  @Property({ name: 'spec_summary', type: 'text', nullable: true })
  specSummary?: string | null

  @Property({ type: 'text', nullable: true })
  barcode?: string | null

  @Property({ type: 'text', default: 'PCS' })
  unit: string = 'PCS'

  @Property({ name: 'hs_code', type: 'text', nullable: true })
  hsCode?: string | null

  @Property({ name: 'cn_code', type: 'text', nullable: true })
  cnCode?: string | null

  @Property({ name: 'country_of_origin_code', type: 'text', nullable: true })
  countryOfOriginCode?: string | null

  @Property({ name: 'net_weight', type: 'numeric', precision: 16, scale: 4, nullable: true })
  netWeight?: string | null

  @Property({ name: 'gross_weight', type: 'numeric', precision: 16, scale: 4, nullable: true })
  grossWeight?: string | null

  /**
   * Volume of one unit in cm³ — the supplier library's `unit_volume`, carried over on sync. Whole
   * cm³ (`scale: 0`), so the form shows the sheet's own figure (`88642`) instead of a padded
   * `88642.000000`. Recorded, not derived: the size card next door holds the three sides, and a
   * figure the supplier prints must not be silently recomputed from them. Nothing reads it yet
   * (freight quotes are the intended consumer, and they work in m³/CBM).
   */
  @Property({ name: 'volume', type: 'numeric', precision: 16, scale: 0, nullable: true })
  volume?: string | null

  /** `{ length, width, height, unit }` for one unit. */
  @Property({ type: 'jsonb', nullable: true })
  dimensions?: Record<string, unknown> | null

  /** Units per carton, the one carton figure purchasing reads. */
  @Property({ name: 'carton_quantity', type: 'integer', nullable: true })
  cartonQuantity?: number | null

  @Property({ name: 'battery_capacity_mah', type: 'integer', nullable: true })
  batteryCapacityMah?: number | null

  /** Watt-hours for the air-freight lithium declaration. */
  @Property({ name: 'battery_wh', type: 'numeric', precision: 10, scale: 2, nullable: true })
  batteryWh?: string | null

  @Property({ name: 'contains_lithium_battery', type: 'boolean', default: false })
  containsLithiumBattery: boolean = false

  /** `string[]` of certification codes/names. */
  @Property({ type: 'jsonb', nullable: true })
  certifications?: string[] | null

  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  /** Optional link to the installed catalog product; never written by this module. */
  @Property({ name: 'catalog_product_id', type: 'uuid', nullable: true })
  catalogProductId?: string | null

  @Property({ name: 'catalog_snapshot', type: 'jsonb', nullable: true })
  catalogSnapshot?: Record<string, unknown> | null

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
 * One price row: a tier, a currency, a minimum quantity, and a 6-decimal unit price.
 *
 * The whole price set of a product is submitted in one `products.prices.replace` command.
 * Rows that disappear from the payload are **deactivated**, never deleted: a contract's
 * snapshot may reference a price that no longer applies, and history must stay readable.
 */
@Entity({ tableName: 'products_prices' })
@Index({ name: 'products_prices_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'products_prices_key_uniq',
  properties: ['tenantId', 'organizationId', 'product', 'priceTier', 'currencyCode', 'minQuantity'],
})
export class ProductsPrice {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ProductsProduct, { fieldName: 'product_id', deleteRule: 'cascade' })
  product!: ProductsProduct

  @Property({ name: 'price_tier', type: 'text' })
  priceTier!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'min_quantity', type: 'integer', default: 1 })
  minQuantity: number = 1

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 6, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'starts_at', type: 'date', nullable: true })
  startsAt?: Date | null

  @Property({ name: 'ends_at', type: 'date', nullable: true })
  endsAt?: Date | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One product variant — the sellable, stockable SKU under a product.
 *
 * Owned by `products` on purpose: a SKU has no meaning without its product, so identity, prices and
 * variants share one aggregate, one transaction and one audit trail (see
 * `.ai/specs/2026-09-22-product-variants.md`). The installed `catalog` keeps its own variant table
 * for the documents that already reference it; `catalog_product_id` on `ProductsProduct` remains the
 * optional legacy bridge, never a requirement of this module's own paths.
 *
 * `code` is unique per organization **including soft-deleted rows** — the constraint has no
 * `deleted_at` clause, so a removed SKU keeps its code reserved until the row is restored or purged
 * (Q-V-009). That is deliberate: a re-used code would silently re-point historical stock and receipt
 * references at a different item.
 *
 * The field set is the minimal SKU the owner approved (Q-V-001); anything else the business names
 * later arrives as an additive column (one edit in `lib/variantFields.ts` plus a migration) or, until
 * then, inside `attributes`.
 */
@Entity({ tableName: 'products_variants' })
@Index({ name: 'products_variants_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'products_variants_scope_code_uniq', properties: ['tenantId', 'organizationId', 'code'] })
@Index({
  name: 'products_variants_default_unique_idx',
  expression:
    'create unique index "products_variants_default_unique_idx" on "products_variants" ("product_id") where is_default and deleted_at is null',
})
export class ProductsVariant {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ProductsProduct, { fieldName: 'product_id', deleteRule: 'cascade' })
  product!: ProductsProduct

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  barcode?: string | null

  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  /** Free-form until the owner names the fields; promoted to columns as they earn their place. */
  @Property({ type: 'jsonb', nullable: true })
  attributes?: Record<string, unknown> | null

  /** Display order inside the product; written from the position of the row in the payload. */
  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
