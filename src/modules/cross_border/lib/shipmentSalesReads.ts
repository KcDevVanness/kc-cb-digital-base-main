import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './scope'

/**
 * Scoped reads of the shipment ↔ internal-sales-order allocations, and of the `sales` order lines
 * they are built from.
 *
 * Raw Kysely reads on purpose, exactly like `purchasingReads`: this module must not import another
 * module's entities, it only needs a handful of columns, and every query is filtered by the same
 * tenant + organization scope the caller is acting in. Nothing here writes — the allocation rows
 * are replaced by the shipment commands, and peer state changes go through their own commands.
 */
export type ShipmentSalesAllocationRow = {
  id: string
  salesOrderId: string
  salesOrderLineId: string
  salesOrderNumber: string | null
  catalogProductId: string
  productSnapshot: Record<string, unknown> | null
  quantity: string
  unitPrice: string | null
  currencyCode: string | null
}

export type ShipmentPurchaseAllocationRow = {
  id: string
  purchaseOrderId: string
  purchaseOrderLineId: string
  purchaseOrderNumber: string | null
  catalogProductId: string
  productSnapshot: Record<string, unknown> | null
  quantity: string
}

type ShipmentSalesAllocationDbRow = {
  id: string
  sales_order_id: string
  sales_order_line_id: string
  sales_order_number: string | null
  catalog_product_id: string
  product_snapshot: Record<string, unknown> | null
  quantity: string
  unit_price: string | null
  currency_code: string | null
}

type ShipmentPurchaseAllocationDbRow = {
  id: string
  purchase_order_id: string
  purchase_order_line_id: string
  purchase_order_number: string | null
  catalog_product_id: string
  product_snapshot: Record<string, unknown> | null
  quantity: string
}

/** The internal sales-order lines a shipment's sales allocations point at, plus the reads that
 * resolve them. Other modules never touch this module's entities; this module never touches
 * `sales`' entities. */
export type SalesOrderLineRef = {
  id: string
  orderId: string
  orderNumber: string | null
  /** App-owned product master id carried on the line; null on a manual (name-only) line. */
  productId: string | null
  productVariantId: string | null
  /** Catalog product the line is bridged to, resolved through the product link or the variant. */
  catalogProductId: string | null
  productSnapshot: Record<string, unknown> | null
  quantity: string
  unitPrice: string | null
  currencyCode: string | null
}

type SalesOrderLineDbRow = {
  id: string
  order_id: string
  order_number: string | null
  product_id: string | null
  product_variant_id: string | null
  catalog_snapshot: Record<string, unknown> | null
  quantity: string
  unit_price_net: string | null
  currency_code: string | null
}

/**
 * The sales allocations of one shipment, in the order they were written. `createdAt` then `id`
 * keeps the read stable when several rows share a timestamp (they are inserted together).
 */
export async function readShipmentSalesAllocations(
  em: EntityManager,
  scope: Scope,
  shipmentId: string,
): Promise<ShipmentSalesAllocationRow[]> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('cross_border_shipment_sales_allocations')
    .select([
      'id',
      'sales_order_id',
      'sales_order_line_id',
      'sales_order_number',
      'catalog_product_id',
      'product_snapshot',
      'quantity',
      'unit_price',
      'currency_code',
    ])
    .where('shipment_id', '=', shipmentId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as ShipmentSalesAllocationDbRow[]

  return rows.map((row) => ({
    id: String(row.id),
    salesOrderId: String(row.sales_order_id),
    salesOrderLineId: String(row.sales_order_line_id),
    salesOrderNumber: row.sales_order_number ?? null,
    catalogProductId: String(row.catalog_product_id),
    productSnapshot: row.product_snapshot ?? null,
    quantity: String(row.quantity ?? '0'),
    unitPrice: row.unit_price === null || row.unit_price === undefined ? null : String(row.unit_price),
    currencyCode: row.currency_code ?? null,
  }))
}

/**
 * The purchase allocations of one shipment. Exposed here (rather than only through the route) so a
 * consumer that already holds an `EntityManager` — the CI aggregation command — reads both halves
 * of a shipment's allocation through one seam.
 */
export async function readShipmentPurchaseAllocations(
  em: EntityManager,
  scope: Scope,
  shipmentId: string,
): Promise<ShipmentPurchaseAllocationRow[]> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('cross_border_shipment_allocations')
    .select([
      'id',
      'purchase_order_id',
      'purchase_order_line_id',
      'purchase_order_number',
      'catalog_product_id',
      'product_snapshot',
      'quantity',
    ])
    .where('shipment_id', '=', shipmentId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as ShipmentPurchaseAllocationDbRow[]

  return rows.map((row) => ({
    id: String(row.id),
    purchaseOrderId: String(row.purchase_order_id),
    purchaseOrderLineId: String(row.purchase_order_line_id),
    purchaseOrderNumber: row.purchase_order_number ?? null,
    catalogProductId: String(row.catalog_product_id),
    productSnapshot: row.product_snapshot ?? null,
    quantity: String(row.quantity ?? '0'),
  }))
}

/**
 * Resolves the internal sales-order lines an allocation may point at, scoped to the caller's
 * organization and excluding soft-deleted lines/orders. The catalog product is bridged through the
 * app-owned product link (`products_products.catalog_product_id`) and, when the product is not
 * linked, through the line's catalog variant — the same bridge `internal_sales` writes. A line
 * whose product is not bridged yields `catalogProductId: null`, which the caller refuses.
 */
export async function loadSalesOrderLines(
  em: EntityManager,
  scope: Scope,
  lineIds: string[],
): Promise<Record<string, SalesOrderLineRef>> {
  if (lineIds.length === 0) return {}
  const kysely = em.fork().getKysely<any>()
  const rows = (await kysely
    .selectFrom('sales_order_lines as l')
    .innerJoin('sales_orders as o', 'o.id', 'l.order_id')
    .select([
      'l.id as id',
      'l.order_id as order_id',
      'l.product_id as product_id',
      'l.product_variant_id as product_variant_id',
      'l.catalog_snapshot as catalog_snapshot',
      'l.quantity as quantity',
      'l.unit_price_net as unit_price_net',
      'l.currency_code as currency_code',
      'o.order_number as order_number',
    ])
    .where('l.id', 'in', lineIds)
    .where('l.tenant_id', '=', scope.tenantId)
    .where('l.organization_id', '=', scope.organizationId)
    .where('l.deleted_at', 'is', null)
    .where('o.deleted_at', 'is', null)
    .execute()) as SalesOrderLineDbRow[]

  const productIds = Array.from(new Set(rows.map((row) => row.product_id).filter((id): id is string => Boolean(id))))
  const variantIds = Array.from(new Set(rows.map((row) => row.product_variant_id).filter((id): id is string => Boolean(id))))

  // The bridge reads are separate, scoped lookups rather than extra joins: a join would have to
  // carry its own tenant/organization/soft-delete predicates, and the id lists are tiny.
  const productLinks = productIds.length
    ? ((await kysely
        .selectFrom('products_products')
        .select(['id', 'catalog_product_id'])
        .where('id', 'in', productIds)
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('deleted_at', 'is', null)
        .execute()) as Array<{ id: string; catalog_product_id: string | null }>)
    : []
  const variantLinks = variantIds.length
    ? ((await kysely
        .selectFrom('catalog_product_variants')
        .select(['id', 'product_id'])
        .where('id', 'in', variantIds)
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .execute()) as Array<{ id: string; product_id: string | null }>)
    : []

  const catalogProductByProductId = new Map(productLinks.map((link) => [String(link.id), link.catalog_product_id]))
  const catalogProductByVariantId = new Map(variantLinks.map((link) => [String(link.id), link.product_id]))

  const byId: Record<string, SalesOrderLineRef> = {}
  for (const row of rows) {
    const bridged =
      (row.product_id ? catalogProductByProductId.get(String(row.product_id)) : null) ??
      (row.product_variant_id ? catalogProductByVariantId.get(String(row.product_variant_id)) : null) ??
      null
    byId[String(row.id)] = {
      id: String(row.id),
      orderId: String(row.order_id),
      orderNumber: row.order_number ?? null,
      productId: row.product_id ? String(row.product_id) : null,
      productVariantId: row.product_variant_id ? String(row.product_variant_id) : null,
      catalogProductId: bridged ? String(bridged) : null,
      productSnapshot: row.catalog_snapshot ?? null,
      quantity: String(row.quantity ?? '0'),
      unitPrice: row.unit_price_net === null || row.unit_price_net === undefined ? null : String(row.unit_price_net),
      currencyCode: row.currency_code ?? null,
    }
  }
  return byId
}
