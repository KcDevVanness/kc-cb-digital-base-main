import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './scope'

/**
 * Scoped reads of the neighbouring modules' tables.
 *
 * Raw Kysely reads on purpose: this module must not import another module's entities (the
 * app-wide rule against cross-module coupling), it only needs a handful of columns, and every
 * query is filtered by the same tenant + organization scope the caller is acting in. Nothing
 * here writes: peer state changes go through their commands.
 */
export type PurchaseOrderLineRef = {
  id: string
  orderId: string
  orderNumber: string | null
  orderStatus: string
  /** Owned-master reference on newer lines; null on historical ones. */
  productId: string | null
  /** Installed-catalog reference: legacy lines carry it directly, newer lines through the product link. */
  catalogProductId: string | null
  productSnapshot: Record<string, unknown> | null
  quantity: string
  receivedQuantity: string
}

type PurchaseOrderLineRow = {
  id: string
  order_id: string
  order_number: string | null
  order_status: string
  product_id: string | null
  catalog_product_id: string | null
  product_snapshot: Record<string, unknown> | null
  quantity: string
  received_quantity: string
}

export async function loadPurchaseOrderLines(
  em: EntityManager,
  scope: Scope,
  lineIds: string[],
): Promise<Record<string, PurchaseOrderLineRef>> {
  if (lineIds.length === 0) return {}
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('purchasing_purchase_order_lines as l')
    .innerJoin('purchasing_purchase_orders as o', 'o.id', 'l.order_id')
    .select([
      'l.id as id',
      'l.order_id as order_id',
      'l.product_id as product_id',
      'l.catalog_product_id as catalog_product_id',
      'l.product_snapshot as product_snapshot',
      'l.quantity as quantity',
      'l.received_quantity as received_quantity',
      'o.number as order_number',
      'o.status as order_status',
    ])
    .where('l.id', 'in', lineIds)
    .where('l.tenant_id', '=', scope.tenantId)
    .where('l.organization_id', '=', scope.organizationId)
    .where('o.deleted_at', 'is', null)
    .execute()) as PurchaseOrderLineRow[]

  const byId: Record<string, PurchaseOrderLineRef> = {}
  for (const row of rows) {
    byId[String(row.id)] = {
      id: String(row.id),
      orderId: String(row.order_id),
      orderNumber: row.order_number ?? null,
      orderStatus: String(row.order_status),
      productId: row.product_id ? String(row.product_id) : null,
      catalogProductId: row.catalog_product_id ? String(row.catalog_product_id) : null,
      productSnapshot: row.product_snapshot ?? null,
      quantity: String(row.quantity ?? '0'),
      receivedQuantity: String(row.received_quantity ?? '0'),
    }
  }
  return byId
}

/**
 * Quantity already committed to non-cancelled shipments, per purchase-order line. Cancelled
 * shipments release their allocation, which is why the join filters on shipment status rather
 * than on a flag this module would have to maintain.
 */
export async function loadAllocatedQuantities(
  em: EntityManager,
  scope: Scope,
  lineIds: string[],
  excludeShipmentId?: string | null,
): Promise<Record<string, number>> {
  if (lineIds.length === 0) return {}
  let query = (em.fork().getKysely<any>())
    .selectFrom('cross_border_shipment_allocations as a')
    .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
    .select(['a.purchase_order_line_id as line_id', 'a.quantity as quantity'])
    .where('a.purchase_order_line_id', 'in', lineIds)
    .where('a.tenant_id', '=', scope.tenantId)
    .where('a.organization_id', '=', scope.organizationId)
    .where('s.status', '!=', 'cancelled')
  if (excludeShipmentId) query = query.where('a.shipment_id', '!=', excludeShipmentId)
  const rows = (await query.execute()) as Array<{ line_id: string; quantity: string }>

  const totals: Record<string, number> = {}
  for (const row of rows) {
    const key = String(row.line_id)
    totals[key] = (totals[key] ?? 0) + Number.parseFloat(String(row.quantity ?? '0'))
  }
  return totals
}

/**
 * `wms.inventory.receive` books stock at variant level while purchase orders are product level,
 * so the default (else oldest active) variant of the product is used and recorded on the
 * allocation. A product with no variant cannot be received — the caller reports that instead of
 * writing stock against nothing.
 */
export async function resolveDefaultVariantId(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string | null,
): Promise<string | null> {
  if (!catalogProductId) return null
  const row = (await (em.fork().getKysely<any>())
    .selectFrom('catalog_product_variants')
    .select(['id'])
    // `product_id` (the raw column), not the entity property name: Kysely works on columns.
    // Variants have no soft-delete column, so activity is expressed through `is_active`.
    .where('product_id', '=', catalogProductId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('is_active', '=', true)
    .orderBy('is_default', 'desc')
    .orderBy('id', 'asc')
    .limit(1)
    .executeTakeFirst()) as { id: string } | undefined
  return row ? String(row.id) : null
}
