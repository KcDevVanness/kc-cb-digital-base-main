import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Scoped reads of the `sourcing` module's supplier product library.
 *
 * Raw Kysely reads on purpose: this module must not import another module's entities (the
 * app-wide rule against cross-module coupling), it only needs a handful of columns to resolve and
 * snapshot a picked line, and every query is filtered by the same tenant + organization scope the
 * caller is acting in. Nothing here writes: creating or syncing a library row goes through the
 * `sourcing` commands.
 */
export type SupplierProductRef = {
  id: string
  supplierId: string
  /** The library key: the supplier's own code for the item. */
  supplierSku: string
  /** The supplier's original item number, shown in preference to the derived code when set. */
  itemNo: string | null
  name: string
  description: string | null
  unit: string
  /** Set once the row has been synced into the product master; null while it is library-only. */
  productId: string | null
}

type SupplierProductRow = {
  id: string
  supplier_id: string
  supplier_sku: string
  item_no: string | null
  name: string
  description: string | null
  unit: string
  product_id: string | null
}

export async function loadSupplierProducts(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ids: string[],
): Promise<Record<string, SupplierProductRef>> {
  if (ids.length === 0) return {}
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('sourcing_supplier_products')
    .select([
      'id',
      'supplier_id',
      'supplier_sku',
      'item_no',
      'name',
      'description',
      'unit',
      'product_id',
    ])
    .where('id', 'in', ids)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as SupplierProductRow[]

  const byId: Record<string, SupplierProductRef> = {}
  for (const row of rows) {
    byId[String(row.id)] = {
      id: String(row.id),
      supplierId: String(row.supplier_id),
      supplierSku: String(row.supplier_sku),
      itemNo: row.item_no ?? null,
      name: String(row.name),
      description: row.description ?? null,
      unit: String(row.unit ?? 'PCS'),
      productId: row.product_id ? String(row.product_id) : null,
    }
  }
  return byId
}
