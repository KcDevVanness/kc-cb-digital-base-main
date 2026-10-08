import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/**
 * The stage projection behind the order workbench: for a batch of company orders, how far each one has
 * been filled in — 采购 / 发运 / 单证 / 收汇·退税.
 *
 * One scoped read per stage, all batched over the requested ids: the workbench lists up to a few
 * hundred rows, and a per-row query would turn one screen into hundreds of round trips. Every query
 * carries the caller's tenant and organization set and skips soft-deleted rows, so an id from another
 * organization simply produces no stage row — the caller never sees it at all.
 *
 * Nothing here writes, and nothing decrypts: the counts and flags are what the workbench needs, while
 * the names beside them come from the modules that own them (the buyer name is encrypted, so it is
 * only ever read through the sales API).
 *
 * **Buyer names are deliberately absent**: see the module README.
 */


/**
 * The columns this projection reads, declared here because a cross-module read is a projection, not an
 * entity dependency: `order_hub` owns no table, and importing five modules' entities to count rows
 * would make it depend on their schemas rather than on the four columns it actually needs. The handle
 * is cast once because MikroORM types `getKysely()`'s DB generic as `never` (a bare call can address
 * no table at all) — see `.ai/lessons/kysely-bare-handle-types-tables-away.md`.
 */
type OrderStageReadTables = {
  sales_orders: { id: string; tenant_id: string; organization_id: string; deleted_at: Date | null }
  purchasing_purchase_orders: {
    id: string
    source_sales_order_id: string | null
    status: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  cross_border_shipments: { id: string; deleted_at: Date | null }
  cross_border_shipment_sales_allocations: {
    shipment_id: string
    sales_order_id: string
    tenant_id: string
    organization_id: string
  }
  cross_border_shipment_allocations: {
    shipment_id: string
    purchase_order_id: string
    tenant_id: string
    organization_id: string
  }
  cross_border_export_documents: {
    shipment_id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_contract_orders: {
    contract_id: string
    order_id: string
    tenant_id: string
    organization_id: string
  }
  trade_docs_documents: {
    contract_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_invoices: {
    contract_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  export_finance_collections: {
    purchase_order_id: string
    collection_status: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  export_finance_refunds: {
    shipment_id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

const readDb = (em: EntityManager): Kysely<OrderStageReadTables> =>
  em.fork().getKysely() as unknown as Kysely<OrderStageReadTables>

export type OrderStageSource = 'sales_order' | 'purchase_order'

export type OrderStageItem = {
  id: string
  source: OrderStageSource
  /** Sales rows only: the sales order's purchase orders that are not cancelled. */
  procurementCount: number
  /** Distinct shipments carrying goods from this order (sales allocations) or this purchase order. */
  shipmentCount: number
  /** PI/CI + tax invoices of its contracts, plus the export documents of its shipments. */
  documentCount: number
  /** Sales rows: any linked purchase order has a received collection. Purchase rows: its own. */
  collected: boolean
  /** Any of its shipments carries a tax-refund record. */
  refunded: boolean
}

export type OrderStageScope = {
  tenantId: string
  organizationIds: readonly string[]
}

const PURCHASE_ORDER_CANCELLED = 'cancelled'
const COLLECTION_RECEIVED = 'received'

type SalesOrderDbRow = { id: string }
type PurchaseOrderDbRow = { id: string; source_sales_order_id: string | null; status: string | null }
type AllocationDbRow = { shipment_id: string; order_id: string }
type ContractOrderDbRow = { contract_id: string; order_id: string }
type CountDbRow = { key: string; count: number | string }
type StatusDbRow = { key: string; status: string | null }

function addToSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const existing = map.get(key)
  if (existing) {
    existing.add(value)
    return
  }
  map.set(key, new Set([value]))
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function distinctIds(values: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const value of values) if (value) out.add(value)
  return [...out]
}

export async function loadOrderStages(
  em: EntityManager,
  scope: OrderStageScope,
  ids: readonly string[],
): Promise<OrderStageItem[]> {
  if (ids.length === 0) return []
  if (!scope.tenantId || scope.organizationIds.length === 0) return []
  const kysely = readDb(em)
  const organizationIds = [...scope.organizationIds]

  // Which of the requested ids are sales orders, and which are purchase orders (either by their own
  // id or as the source of a sales order we were asked about).
  const salesRows = (await kysely
    .selectFrom('sales_orders')
    .select(['id'])
    .where('id', 'in', [...ids])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', organizationIds)
    .where('deleted_at', 'is', null)
    .execute()) as SalesOrderDbRow[]

  const purchaseRows = (await kysely
    .selectFrom('purchasing_purchase_orders')
    .select(['id', 'source_sales_order_id', 'status'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', organizationIds)
    .where('deleted_at', 'is', null)
    // One id list matches either the purchase order itself or the sales order it was raised for.
    .where((eb) => eb.or([eb('id', 'in', [...ids]), eb('source_sales_order_id', 'in', [...ids])]))
    .execute()) as PurchaseOrderDbRow[]

  const salesIds = salesRows.map((row) => String(row.id))
  const purchaseOrderIds = purchaseRows.map((row) => String(row.id))
  const allOrderIds = distinctIds([...salesIds, ...purchaseOrderIds])
  if (allOrderIds.length === 0) return []

  const purchaseOrdersBySalesOrder = new Map<string, PurchaseOrderDbRow[]>()
  for (const row of purchaseRows) {
    const source = row.source_sales_order_id ? String(row.source_sales_order_id) : null
    if (!source) continue
    const list = purchaseOrdersBySalesOrder.get(source) ?? []
    list.push(row)
    purchaseOrdersBySalesOrder.set(source, list)
  }

  const shipmentsBySalesOrder = new Map<string, Set<string>>()
  const shipmentsByPurchaseOrder = new Map<string, Set<string>>()
  const allShipmentIds = new Set<string>()

  if (salesIds.length > 0) {
    const rows = (await kysely
      .selectFrom('cross_border_shipment_sales_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.shipment_id as shipment_id', 'a.sales_order_id as order_id'])
      .where('a.sales_order_id', 'in', salesIds)
      .where('a.tenant_id', '=', scope.tenantId)
      .where('a.organization_id', 'in', organizationIds)
      .where('s.deleted_at', 'is', null)
      .execute()) as AllocationDbRow[]
    for (const row of rows) {
      addToSet(shipmentsBySalesOrder, String(row.order_id), String(row.shipment_id))
      allShipmentIds.add(String(row.shipment_id))
    }
  }

  if (purchaseOrderIds.length > 0) {
    const rows = (await kysely
      .selectFrom('cross_border_shipment_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.shipment_id as shipment_id', 'a.purchase_order_id as order_id'])
      .where('a.purchase_order_id', 'in', purchaseOrderIds)
      .where('a.tenant_id', '=', scope.tenantId)
      .where('a.organization_id', 'in', organizationIds)
      .where('s.deleted_at', 'is', null)
      .execute()) as AllocationDbRow[]
    for (const row of rows) {
      addToSet(shipmentsByPurchaseOrder, String(row.order_id), String(row.shipment_id))
      allShipmentIds.add(String(row.shipment_id))
    }
  }

  // Contracts linked to any of the orders, then the documents and invoices those contracts carry.
  const contractsByOrder = new Map<string, Set<string>>()
  const contractRows = (await kysely
    .selectFrom('trade_docs_contract_orders')
    .select(['contract_id', 'order_id'])
    .where('order_id', 'in', allOrderIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', organizationIds)
    .execute()) as ContractOrderDbRow[]
  for (const row of contractRows) {
    addToSet(contractsByOrder, String(row.order_id), String(row.contract_id))
  }

  const contractIds = distinctIds(contractRows.map((row) => String(row.contract_id)))
  const documentsByContract = new Map<string, number>()
  if (contractIds.length > 0) {
    const documentCounts = (await kysely
      .selectFrom('trade_docs_documents')
      .select((builder) => [builder.ref('contract_id').as('key'), builder.fn.countAll().as('count')])
      .where('contract_id', 'in', contractIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .groupBy('contract_id')
      .execute()) as CountDbRow[]
    const invoiceCounts = (await kysely
      .selectFrom('trade_docs_invoices')
      .select((builder) => [builder.ref('contract_id').as('key'), builder.fn.countAll().as('count')])
      .where('contract_id', 'in', contractIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .groupBy('contract_id')
      .execute()) as CountDbRow[]
    for (const row of [...documentCounts, ...invoiceCounts]) {
      const key = String(row.key)
      documentsByContract.set(key, (documentsByContract.get(key) ?? 0) + toNumber(row.count))
    }
  }

  // Export documents belong to a shipment, not to a contract: they count for whichever order the
  // shipment carries goods from.
  const exportDocsByShipment = new Map<string, number>()
  const shipmentIds = [...allShipmentIds]
  if (shipmentIds.length > 0) {
    const counts = (await kysely
      .selectFrom('cross_border_export_documents')
      .select((builder) => [builder.ref('shipment_id').as('key'), builder.fn.countAll().as('count')])
      .where('shipment_id', 'in', shipmentIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .groupBy('shipment_id')
      .execute()) as CountDbRow[]
    for (const row of counts) exportDocsByShipment.set(String(row.key), toNumber(row.count))
  }

  const collectionStatusByPurchaseOrder = new Map<string, string[]>()
  if (purchaseOrderIds.length > 0) {
    const rows = (await kysely
      .selectFrom('export_finance_collections')
      .select(['purchase_order_id as key', 'collection_status as status'])
      .where('purchase_order_id', 'in', purchaseOrderIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as StatusDbRow[]
    for (const row of rows) {
      const key = String(row.key)
      const list = collectionStatusByPurchaseOrder.get(key) ?? []
      list.push(String(row.status ?? ''))
      collectionStatusByPurchaseOrder.set(key, list)
    }
  }

  const refundedShipments = new Set<string>()
  if (shipmentIds.length > 0) {
    const rows = (await kysely
      .selectFrom('export_finance_refunds')
      .select(['shipment_id as key'])
      .where('shipment_id', 'in', shipmentIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ key: string }>
    for (const row of rows) refundedShipments.add(String(row.key))
  }

  const documentCountFor = (orderId: string, shipmentIdsOfOrder: Iterable<string>): number => {
    let total = 0
    for (const contractId of contractsByOrder.get(orderId) ?? []) {
      total += documentsByContract.get(contractId) ?? 0
    }
    for (const shipmentId of shipmentIdsOfOrder) {
      total += exportDocsByShipment.get(shipmentId) ?? 0
    }
    return total
  }

  const collectedFor = (purchaseOrders: PurchaseOrderDbRow[]): boolean =>
    purchaseOrders.some((row) =>
      (collectionStatusByPurchaseOrder.get(String(row.id)) ?? []).includes(COLLECTION_RECEIVED),
    )

  const refundedFor = (shipmentIdsOfOrder: Iterable<string>): boolean => {
    for (const shipmentId of shipmentIdsOfOrder) if (refundedShipments.has(shipmentId)) return true
    return false
  }

  const items: OrderStageItem[] = []

  for (const salesOrderId of salesIds) {
    const purchaseOrders = purchaseOrdersBySalesOrder.get(salesOrderId) ?? []
    const shipments = shipmentsBySalesOrder.get(salesOrderId) ?? new Set<string>()
    items.push({
      id: salesOrderId,
      source: 'sales_order',
      procurementCount: purchaseOrders.filter((row) => row.status !== PURCHASE_ORDER_CANCELLED).length,
      shipmentCount: shipments.size,
      documentCount: documentCountFor(salesOrderId, shipments),
      collected: collectedFor(purchaseOrders),
      refunded: refundedFor(shipments),
    })
  }

  for (const row of purchaseRows) {
    const purchaseOrderId = String(row.id)
    // A purchase order that was requested by id is reported as itself, even when it also matched as
    // some sales order's source: the two entries describe different rows of the workbench.
    if (!ids.includes(purchaseOrderId)) continue
    const shipments = shipmentsByPurchaseOrder.get(purchaseOrderId) ?? new Set<string>()
    items.push({
      id: purchaseOrderId,
      source: 'purchase_order',
      procurementCount: 0,
      shipmentCount: shipments.size,
      documentCount: documentCountFor(purchaseOrderId, shipments),
      collected: collectedFor([row]),
      refunded: refundedFor(shipments),
    })
  }

  return items
}
