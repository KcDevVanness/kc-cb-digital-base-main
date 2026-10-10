import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { PurchasingSupplierProduct } from '../data/entities'

/**
 * The library rows a purchase order line resolves through.
 *
 * A scoped entity read (this module owns the table): the order line needs the row's identity, its
 * display snapshot and whether it has been promoted into the catalog store, and it must see exactly
 * the rows its own organization can order from. Nothing here writes — creating or promoting a
 * library row goes through the module's commands.
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
  /** Set once the row has been promoted into the catalog store; null while it is library-only. */
  catalogProductId: string | null
}

export async function loadSupplierProducts(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ids: string[],
): Promise<Record<string, SupplierProductRef>> {
  if (ids.length === 0) return {}
  const rows = await em.fork().find(
    PurchasingSupplierProduct,
    {
      id: { $in: ids },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<PurchasingSupplierProduct>,
  )

  const byId: Record<string, SupplierProductRef> = {}
  for (const row of rows) {
    byId[String(row.id)] = {
      id: String(row.id),
      supplierId: String(row.supplierId),
      supplierSku: String(row.supplierSku),
      itemNo: row.itemNo ?? null,
      name: String(row.name),
      description: row.description ?? null,
      unit: String(row.unit ?? 'PCS'),
      catalogProductId: row.catalogProductId ? String(row.catalogProductId) : null,
    }
  }
  return byId
}
