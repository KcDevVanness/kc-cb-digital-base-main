import type { EntityManager } from '@mikro-orm/postgresql'
import { listStorePrices, listStoreProducts, type StoreScope } from '../../products/lib/store'

/**
 * Scoped product-store reads the purchasing surfaces need beyond the store's own API.
 *
 * The store (`../../products/lib/store.ts`) is the one place that knows the catalog's shape; the
 * reads here are the few shapes it does not expose as a batch:
 *
 * - **batch labels** for a page of library rows (one store list instead of one read per row), and
 * - **batch tier prices** for the same page.
 *
 * Nothing here writes: product changes go through the store's commands.
 *
 * Two probes used to live here and both rested on a **soft-delete** premise that does not hold:
 * `catalog.products.delete` (`@open-mercato/core/modules/catalog/commands/products.ts`) removes the
 * row (`em.remove`), so a deleted product is `missing`, never a row with `deleted_at` set, and its
 * SKU is free again. The store's own reads filter `deleted_at is null` anyway, which is why a
 * product that no longer exists answers a plain 404 instead of a repair instruction (measured
 * 2026-10-10; the integration specs were rewritten to the hard-delete reality).
 */

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
