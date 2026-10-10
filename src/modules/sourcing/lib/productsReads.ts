import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { listStoreProducts, type StoreScope } from '../../products/lib/store'

/**
 * The few product reads the sourcing module needs beyond the store's own API.
 *
 * The catalog module is the one product store, reached through `products/lib/store.ts`; nothing
 * here reads the app's retired product tables. The two shapes the store does not expose live here:
 *
 * - a **soft-deleted SKU probe** — the store filters soft-deleted rows out on purpose, but
 *   `catalog_products.sku` is unique *including* soft-deleted rows, so the promotion's
 *   "this SKU is taken by a deleted product" refusal cannot come from a live read, and
 * - **display labels** for a page of product ids.
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

/**
 * The id of the soft-deleted catalog product that owns a SKU, when one does.
 *
 * `catalog_products.sku` is unique within the scope including soft-deleted rows, so a promotion
 * that matched only live products would try to create a second row with an occupied SKU and fail
 * on the unique index with an unreadable error. This probe turns that into the explicit
 * `sku_belongs_to_deleted_product` refusal. `getKysely()` is untyped at the platform boundary;
 * `CatalogLivenessTables` supplies the shape.
 */
export async function findDeletedProductIdBySku(
  em: EntityManager,
  scope: StoreScope,
  sku: string,
): Promise<string | null> {
  const db = em.fork().getKysely() as unknown as Kysely<CatalogLivenessTables>
  const row = await db
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
 * Display labels for the catalog products a caller holds ids for.
 *
 * Resolved for a whole page in one store list: a product deleted since the link simply contributes
 * no entry, and the caller renders "not synced".
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
