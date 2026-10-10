import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { listStorePrices, listStoreProducts, type StoreScope } from '../../products/lib/store'

/**
 * Scoped product-store reads the purchasing surfaces need beyond the store's own API.
 *
 * The store (`../../products/lib/store.ts`) is the one place that knows the catalog's shape; the
 * reads here are the few shapes it does not expose as a batch or cannot answer at all:
 *
 * - **batch labels** for a page of library rows (one store list instead of one read per row), and
 * - **batch tier prices** for the same page,
 * - a **liveness probe** that can tell a soft-deleted product from a missing one — the store filters
 *   soft-deleted rows out on purpose, but `catalog_products.sku` is unique *including* soft-deleted
 *   rows, so the SKU-ownership guard a promotion needs cannot come from the store's live read.
 *
 * Nothing here writes: product changes go through the store's commands.
 */

type CatalogLivenessTables = {
  catalog_products: {
    id: string
    sku: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

/** `getKysely()` is untyped at the platform boundary; the probes below supply the shape. */
function catalogDb(em: EntityManager): Kysely<CatalogLivenessTables> {
  return em.fork().getKysely() as unknown as Kysely<CatalogLivenessTables>
}

export type ProductLiveness = 'live' | 'deleted' | 'missing'

/**
 * Whether a catalog product exists in the caller's scope, and whether it is soft-deleted.
 *
 * The store refuses to return a soft-deleted row, so it answers "not found" for both a deleted and
 * a missing product; the link/sync paths have to tell them apart because one is a 422 with a repair
 * ("restore it or re-link") and the other a 404.
 */
export async function loadProductLiveness(
  em: EntityManager,
  scope: StoreScope,
  id: string,
): Promise<ProductLiveness> {
  const row = await catalogDb(em)
    .selectFrom('catalog_products')
    .select(['id', 'deleted_at'])
    .where('id', '=', id)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .executeTakeFirst()
  if (!row) return 'missing'
  return row.deleted_at ? 'deleted' : 'live'
}

/**
 * The id of the soft-deleted catalog product that owns a SKU, when one does.
 *
 * `catalog_products_sku_scope_unique` includes soft-deleted rows, so a promotion that matched only
 * live products would try to create a second row with an occupied SKU and fail on the unique index
 * with an unreadable error. This probe turns that into the explicit `sku_belongs_to_deleted_product`
 * refusal.
 */
export async function findDeletedProductIdBySku(
  em: EntityManager,
  scope: StoreScope,
  sku: string,
): Promise<string | null> {
  const row = await catalogDb(em)
    .selectFrom('catalog_products')
    .select(['id'])
    .where('sku', '=', sku)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is not', null)
    .executeTakeFirst()
  return row ? String(row.id) : null
}

/**
 * Display labels for the catalog products a supplier library row points at.
 *
 * Resolved for a whole page in one store list: the list's 关联商品 column needs the live label, and
 * a product deleted since the link simply contributes no entry — the caller renders "已关联的商品已删除".
 */
export async function loadProductLabels(
  em: EntityManager,
  scope: StoreScope,
  ids: readonly string[],
): Promise<Record<string, { sku: string; name: string }>> {
  if (ids.length === 0) return {}
  const { items } = await listStoreProducts({
    em,
    scope,
    ids: [...ids],
    pageSize: Math.min(200, ids.length),
  })
  const labels: Record<string, { sku: string; name: string }> = {}
  for (const item of items) {
    labels[item.id] = { sku: item.sku, name: item.name }
  }
  return labels
}

/** One product's price cell, as the library list renders it. The tier is the query, not a field. */
export type ProductTierPriceCell = {
  currencyCode: string
  unitPrice: string
  minQuantity: number
}

/**
 * The base price of one tier for many products, keyed by product id.
 *
 * The library list's 本公司报价 column reads the **store's** `internal`（内部结算价）tier: our own
 * offer is a fact about the product, so the library shows it instead of keeping a second editable
 * copy. "Base" is the same rule the library's own price cells use — the lowest minimum quantity,
 * with the currency code breaking ties — so both columns read alike. Only active rows count.
 *
 * The store reads prices per product, so this is one scoped read per id; the caller passes one page
 * of library rows (≤50), which keeps that bounded.
 */
export async function loadBaseTierPricesByProduct(
  em: EntityManager,
  scope: StoreScope,
  productIds: readonly string[],
  priceTier: string,
): Promise<Record<string, ProductTierPriceCell>> {
  const byProduct: Record<string, ProductTierPriceCell> = {}
  await Promise.all(
    productIds.map(async (productId) => {
      const prices = await listStorePrices({ em, scope, productId })
      for (const price of prices) {
        if (price.tier !== priceTier || !price.isActive) continue
        const candidate: ProductTierPriceCell = {
          currencyCode: price.currencyCode,
          unitPrice: price.unitPrice,
          minQuantity: price.minQuantity,
        }
        const current = byProduct[productId]
        if (
          !current ||
          candidate.minQuantity < current.minQuantity ||
          (candidate.minQuantity === current.minQuantity &&
            candidate.currencyCode.localeCompare(current.currencyCode) < 0)
        ) {
          byProduct[productId] = candidate
        }
      }
    }),
  )
  return byProduct
}
