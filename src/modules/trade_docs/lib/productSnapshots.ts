import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { listStoreProducts } from '../../products/lib/store'

/**
 * Display snapshots of the products a contract/invoice/document line references.
 *
 * The product data itself lives in the installed `catalog` module; the app reads it through the
 * products store (`listStoreProducts`), which applies the caller's tenant + organization scope and
 * maps the business custom fields back into the app's field names. Nothing here writes — peer state
 * changes go through their commands.
 */

export type ProductSnapshot = {
  productId: string
  sku: string | null
  name: string | null
  brand: string | null
  series: string | null
  model: string | null
  spec: string | null
  unit: string | null
  hsCode: string | null
  countryOfOriginCode: string | null
}

/**
 * Loads the display snapshot for the products a contract/invoice line references.
 *
 * The snapshot is frozen into the line at write time: renaming or deleting a product afterwards
 * must not rewrite a signed contract. A product that is not visible in this organization fails
 * the whole document — silently dropping a line would issue a document with the wrong total.
 */
export async function readProductSnapshots(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  productIds: string[],
): Promise<Map<string, ProductSnapshot>> {
  const unique = Array.from(new Set(productIds.filter((id) => !!id)))
  const snapshots = new Map<string, ProductSnapshot>()
  if (unique.length === 0) return snapshots

  const { items } = await listStoreProducts({ em, scope, ids: unique, pageSize: unique.length })
  for (const product of items) {
    snapshots.set(product.id, {
      productId: product.id,
      sku: product.sku || null,
      name: product.name || null,
      brand: product.brand || null,
      series: product.series,
      model: product.manufacturerModel,
      spec: product.specSummary,
      unit: product.unit || null,
      hsCode: product.hsCode,
      countryOfOriginCode: product.countryOfOriginCode,
    })
  }

  for (const id of unique) {
    if (!snapshots.has(id)) throw badRequest(`Product not found in this organization: ${id}`)
  }
  return snapshots
}

/** The snapshot as it is stored on a line (`product_snapshot` jsonb). */
export function productSnapshotPayload(snapshot: ProductSnapshot): Record<string, unknown> {
  return {
    sku: snapshot.sku,
    name: snapshot.name,
    brand: snapshot.brand,
    series: snapshot.series,
    model: snapshot.model,
    spec: snapshot.spec,
    unit: snapshot.unit,
    hsCode: snapshot.hsCode,
    countryOfOriginCode: snapshot.countryOfOriginCode,
  }
}
