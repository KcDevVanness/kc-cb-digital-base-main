import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Scoped reads of the product master's tables.
 *
 * Raw Kysely on purpose, like `cross_border/lib/purchasingReads.ts`: the sourcing module must not
 * import another module's entities, it needs a handful of columns for a comparison, and every
 * query is filtered by the caller's tenant + organization scope. Nothing here writes — product
 * changes go through the products module's commands.
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
  grossWeight: string | null
  volume: string | null
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
    .select([
      'id',
      'sku',
      'name',
      'name_en',
      'spec_summary',
      'hs_code',
      'unit',
      'net_weight',
      'gross_weight',
      'volume',
      'dimensions',
      'carton_quantity',
      'category_id',
      'deleted_at',
    ])
    .where('sku', '=', sku)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .limit(1)
    .execute()) as Array<{
    id: string
    sku: string
    name: string | null
    name_en: string | null
    spec_summary: string | null
    hs_code: string | null
    unit: string | null
    net_weight: string | null
    gross_weight: string | null
    volume: string | null
    dimensions: Record<string, unknown> | null
    carton_quantity: number | null
    category_id: string | null
    deleted_at: Date | null
  }>
  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: row.name ?? null,
    nameEn: row.name_en ?? null,
    specSummary: row.spec_summary ?? null,
    hsCode: row.hs_code ?? null,
    unit: row.unit ?? null,
    netWeight: row.net_weight === null || row.net_weight === undefined ? null : String(row.net_weight),
    grossWeight: row.gross_weight === null || row.gross_weight === undefined ? null : String(row.gross_weight),
    volume: row.volume === null || row.volume === undefined ? null : String(row.volume),
    dimensions: row.dimensions ?? null,
    cartonQuantity: row.carton_quantity === null || row.carton_quantity === undefined ? null : Number(row.carton_quantity),
    categoryId: row.category_id ?? null,
    deletedAt: row.deleted_at ?? null,
  }
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
