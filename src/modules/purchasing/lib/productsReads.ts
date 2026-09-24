import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Scoped reads of the product master's tables.
 *
 * Raw Kysely on purpose, like `cross_border/lib/purchasingReads.ts`: this module must not import
 * another module's entities, it needs a handful of columns for a comparison, and every query is
 * filtered by the caller's tenant + organization scope. Nothing here writes — product changes go
 * through the products module's commands.
 *
 * Soft-deleted products are returned on purpose: `products_products.sku` is unique including
 * soft-deleted rows, so a promotion has to know that a SKU is taken by a deleted product instead
 * of failing on the unique index.
 */
export type ProductRow = {
  id: string
  sku: string
  name: string | null
  nameEn: string | null
  specSummary: string | null
  hsCode: string | null
  unit: string | null
  netWeight: string | null
  dimensions: Record<string, unknown> | null
  cartonQuantity: number | null
  categoryId: string | null
  deletedAt: Date | null
}

export type ProductPriceRow = {
  id: string
  priceTier: string
  currencyCode: string
  minQuantity: number
  unitPrice: string
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
}

export type CategoryRow = { id: string; code: string; name: string }

/**
 * The projection every product-master read in this module shares.
 *
 * A cross-module read is a projection, not an entity dependency, so the shape is declared once
 * here and mapped once — a second select list would be a second truth about what the master has.
 */
const PRODUCT_COLUMNS = [
  'id',
  'sku',
  'name',
  'name_en',
  'spec_summary',
  'hs_code',
  'unit',
  'net_weight',
  'dimensions',
  'carton_quantity',
  'category_id',
  'deleted_at',
] as const

type RawProductRow = {
  id: string
  sku: string
  name: string | null
  name_en: string | null
  spec_summary: string | null
  hs_code: string | null
  unit: string | null
  net_weight: string | null
  dimensions: Record<string, unknown> | null
  carton_quantity: number | null
  category_id: string | null
  deleted_at: Date | null
}

function toProductRow(row: RawProductRow): ProductRow {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: row.name ?? null,
    nameEn: row.name_en ?? null,
    specSummary: row.spec_summary ?? null,
    hsCode: row.hs_code ?? null,
    unit: row.unit ?? null,
    netWeight: row.net_weight === null || row.net_weight === undefined ? null : String(row.net_weight),
    dimensions: row.dimensions ?? null,
    cartonQuantity: row.carton_quantity === null || row.carton_quantity === undefined ? null : Number(row.carton_quantity),
    categoryId: row.category_id ?? null,
    deletedAt: row.deleted_at ?? null,
  }
}

/** `date` columns arrive as `Date` or `YYYY-MM-DD` depending on the driver's parser. */
function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const text = String(value)
  return text.length >= 10 ? text.slice(0, 10) : null
}

export async function findProductBySku(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  sku: string,
): Promise<ProductRow | null> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('products_products')
    .select(PRODUCT_COLUMNS)
    .where('sku', '=', sku)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .limit(1)
    .execute()) as RawProductRow[]
  const row = rows[0]
  return row ? toProductRow(row) : null
}

/**
 * One product master row by id, in the caller's scope.
 *
 * `includeDeleted` is what the link action needs: `product_id` is a scalar id with no foreign key,
 * so a link can outlive its target and 换绑 / 解除关联 have to be able to name that state. Every
 * other caller wants the live row only.
 *
 * `forUpdate` runs the read on the passed EntityManager (never a fork) and takes a row lock, which
 * is only meaningful inside `em.transactional`: it is how the link command makes "the product still
 * exists and is live" and "write the link" one atomic step.
 */
export async function findProductById(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  id: string,
  options: { includeDeleted?: boolean; forUpdate?: boolean } = {},
): Promise<ProductRow | null> {
  const handle = options.forUpdate ? em.getKysely<any>() : em.fork().getKysely<any>()
  let query = handle
    .selectFrom('products_products')
    .select(PRODUCT_COLUMNS)
    .where('id', '=', id)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
  if (!options.includeDeleted) query = query.where('deleted_at', 'is', null)
  if (options.forUpdate) query = query.forUpdate()
  const rows = (await query.limit(1).execute()) as RawProductRow[]
  const row = rows[0]
  return row ? toProductRow(row) : null
}

export async function loadProductPrices(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  productId: string,
): Promise<ProductPriceRow[]> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('products_prices')
    .select(['id', 'price_tier', 'currency_code', 'min_quantity', 'unit_price', 'starts_at', 'ends_at', 'is_active'])
    .where('product_id', '=', productId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .orderBy('price_tier')
    .orderBy('currency_code')
    .orderBy('min_quantity')
    .execute()) as Array<{
    id: string
    price_tier: string
    currency_code: string
    min_quantity: number
    unit_price: string
    starts_at: unknown
    ends_at: unknown
    is_active: boolean
  }>
  return rows.map((row) => ({
    id: String(row.id),
    priceTier: String(row.price_tier),
    currencyCode: String(row.currency_code),
    minQuantity: Number(row.min_quantity),
    unitPrice: String(row.unit_price),
    startsAt: toDateOnly(row.starts_at),
    endsAt: toDateOnly(row.ends_at),
    isActive: row.is_active === true,
  }))
}

export async function findCategoryByCode(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
): Promise<CategoryRow | null> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('products_categories')
    .select(['id', 'code', 'name'])
    .where('code', '=', code)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .limit(1)
    .execute()) as Array<{ id: string; code: string; name: string }>
  const row = rows[0]
  return row ? { id: String(row.id), code: String(row.code), name: String(row.name) } : null
}

/**
 * Display labels for the products a supplier library row is linked to.
 *
 * The library list resolves `product_id` for a whole page at once: one scoped query instead of
 * one per row, and soft-deleted products are filtered out (a synced product cannot be deleted
 * while a library row still points at it, but the read must not show a label for a row that is
 * gone). Missing ids simply contribute no entry — the caller renders "not synced".
 */
export async function loadProductLabels(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ids: string[],
): Promise<Record<string, { sku: string; name: string }>> {
  if (ids.length === 0) return {}
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('products_products')
    .select(['id', 'sku', 'name'])
    .where('id', 'in', ids)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string; sku: string; name: string | null }>
  const labels: Record<string, { sku: string; name: string }> = {}
  for (const row of rows) {
    labels[String(row.id)] = { sku: String(row.sku), name: row.name ?? '' }
  }
  return labels
}
