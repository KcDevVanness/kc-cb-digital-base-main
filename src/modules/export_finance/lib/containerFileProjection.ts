import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  allocateTaxRefund,
  buildContainerChecklist,
  sharePercentages,
  snapshotName,
  toIsoTimestamp,
  toTime,
  type AllocationOrder,
  type ContainerFileListParams,
  type ContainerFileRow,
  type ContainerOrderRow,
} from './fileRules'

/**
 * 柜档案 — the read-only projection of one container (shipment), seen as the tax-refund unit.
 *
 * This file only fetches and assembles; the rules live in `fileRules.ts`. The per-order refund
 * shares are derived there too, so the sum of the shares a page shows always equals the container
 * amount and a reconciliation difference is a data fact, not a rounding artifact.
 */

export {
  CONTAINER_CHECKLIST_KEYS,
  CONTAINER_EXPORT_CHECKLIST_KEYS,
  CONTAINER_REFUND_CHECKLIST_KEYS,
  buildContainerChecklist,
  type ContainerChecklist,
  type ContainerChecklistKey,
  type ContainerChecklistSources,
  type ContainerFileFilters,
  type ContainerFileRow,
  type ContainerOrderRow,
} from './fileRules'

/** The raw shipment row this projection selects; the shape the SQL layer hands back. */
type ShipmentRow = {
  id: string
  number: string | null
  status: string
  current_milestone: string | null
  carrier_name: string | null
  departure_port: string | null
  departed_at: Date | string | null
  received_at: Date | string | null
  etd: Date | string | null
  eta: Date | string | null
  container_type: string | null
  container_number: string | null
  seal_number: string | null
  booking_number: string | null
}

type ContainerOrderQueryRow = {
  shipment_id: string
  purchase_order_id: string
  order_number: string | null
  business_number: string | null
  owner_snapshot: Record<string, unknown> | null
  customer_snapshot: Record<string, unknown> | null
  total: string
}

function compareContainerRows(
  left: ContainerFileRow,
  right: ContainerFileRow,
  sortField: ContainerFileListParams['sortField'],
  direction: 1 | -1,
): number {
  if (sortField === 'number') {
    const leftNumber = left.shipmentNumber ?? ''
    const rightNumber = right.shipmentNumber ?? ''
    if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -direction : direction
    return left.shipmentId < right.shipmentId ? -1 : 1
  }
  const leftTime = sortField === 'departed_at' ? toTime(left.departedAt) : toTime(left.eta)
  const rightTime = sortField === 'departed_at' ? toTime(right.departedAt) : toTime(right.eta)
  if (leftTime !== rightTime) return leftTime < rightTime ? -direction : direction
  return left.shipmentId < right.shipmentId ? -1 : 1
}

/**
 * The 柜档案 rows of one organization scope: the container, its orders with their allocated
 * shares, its refund record and its checklist.
 */
export async function loadContainerFiles(
  em: EntityManager,
  params: ContainerFileListParams,
): Promise<{ items: ContainerFileRow[]; total: number }> {
  const db = em.fork().getKysely<any>()
  const search = params.filters.search?.trim()

  let shipmentsQuery = db
    .selectFrom('cross_border_shipments as s')
    .select([
      's.id as id',
      's.number as number',
      's.status as status',
      's.current_milestone as current_milestone',
      's.carrier_name as carrier_name',
      's.departure_port as departure_port',
      's.departed_at as departed_at',
      's.received_at as received_at',
      's.etd as etd',
      's.eta as eta',
      's.container_type as container_type',
      's.container_number as container_number',
      's.seal_number as seal_number',
      's.booking_number as booking_number',
    ])
    .where('s.tenant_id', '=', params.tenantId)
    .where('s.organization_id', 'in', params.organizationIds)
    .where('s.deleted_at', 'is', null)

  if (params.filters.status) {
    shipmentsQuery = shipmentsQuery.where('s.status', '=', params.filters.status)
  }

  if (search && search.length > 0) {
    const term = `%${escapeLikePattern(search)}%`
    shipmentsQuery = shipmentsQuery.where((eb) =>
      eb.or([
        eb('s.number', 'ilike', term),
        eb('s.container_number', 'ilike', term),
        eb('s.seal_number', 'ilike', term),
        eb('s.booking_number', 'ilike', term),
        sql<boolean>`exists (
          select 1 from cross_border_shipment_allocations a
          join purchasing_purchase_orders po on po.id = a.purchase_order_id
          where a.shipment_id = s.id
            and a.tenant_id = s.tenant_id
            and a.organization_id = s.organization_id
            and po.deleted_at is null
            and (po.number ilike ${term} or po.business_number ilike ${term})
        )`,
      ]),
    )
  }

  if (params.filters.shipmentId) {
    shipmentsQuery = shipmentsQuery.where('s.id', '=', params.filters.shipmentId)
  }

  const shipments = (await shipmentsQuery.execute()) as ShipmentRow[]
  if (shipments.length === 0) return { items: [], total: 0 }

  const shipmentIds = shipments.map((shipment) => String(shipment.id))

  const orders = (await db
    .selectFrom('cross_border_shipment_allocations as a')
    .innerJoin('purchasing_purchase_orders as po', 'po.id', 'a.purchase_order_id')
    .select([
      'a.shipment_id as shipment_id',
      'po.id as purchase_order_id',
      'po.number as order_number',
      'po.business_number as business_number',
      'po.owner_snapshot as owner_snapshot',
      'po.customer_snapshot as customer_snapshot',
      'po.total as total',
    ])
    .where('a.shipment_id', 'in', shipmentIds)
    .where('a.tenant_id', '=', params.tenantId)
    .where('a.organization_id', 'in', params.organizationIds)
    .where('po.deleted_at', 'is', null)
    .execute()) as ContainerOrderQueryRow[]

  const exportDocuments = (await db
    .selectFrom('cross_border_export_documents as x')
    .select(['x.shipment_id as shipment_id', 'x.doc_type as doc_type', 'x.attachment_id as attachment_id'])
    .where('x.shipment_id', 'in', shipmentIds)
    .where('x.tenant_id', '=', params.tenantId)
    .where('x.organization_id', 'in', params.organizationIds)
    .where('x.deleted_at', 'is', null)
    .execute()) as Array<{ shipment_id: string; doc_type: string; attachment_id: string | null }>

  const refunds = (await db
    .selectFrom('export_finance_refunds as fr')
    .select([
      'fr.id as id',
      'fr.shipment_id as shipment_id',
      'fr.tax_refund_status as tax_refund_status',
      'fr.tax_refund_amount as tax_refund_amount',
      'fr.tax_refund_note as tax_refund_note',
    ])
    .where('fr.shipment_id', 'in', shipmentIds)
    .where('fr.tenant_id', '=', params.tenantId)
    .where('fr.organization_id', 'in', params.organizationIds)
    .where('fr.deleted_at', 'is', null)
    .execute()) as Array<{
      id: string
      shipment_id: string
      tax_refund_status: string
      tax_refund_amount: string | null
      tax_refund_note: string | null
    }>

  const refundIds = refunds.map((refund) => String(refund.id))

  const refundDocuments = refundIds.length > 0
    ? ((await db
        .selectFrom('export_finance_refund_documents as fd')
        .select(['fd.refund_id as refund_id', 'fd.doc_type as doc_type', 'fd.attachment_id as attachment_id'])
        .where('fd.refund_id', 'in', refundIds)
        .where('fd.tenant_id', '=', params.tenantId)
        .where('fd.organization_id', 'in', params.organizationIds)
        .where('fd.deleted_at', 'is', null)
        .execute()) as Array<{ refund_id: string; doc_type: string; attachment_id: string | null }>)
    : []

  const items: ContainerFileRow[] = shipments.map((shipment) => {
    const shipmentId = String(shipment.id)
    const containerOrders = orders.filter((row) => String(row.shipment_id) === shipmentId)
    const refund = refunds.find((row) => String(row.shipment_id) === shipmentId) ?? null

    const allocationOrders: AllocationOrder[] = containerOrders.map((row) => ({
      purchaseOrderId: String(row.purchase_order_id),
      number: row.order_number ?? null,
      total: String(row.total ?? '0'),
    }))
    const shares = allocateTaxRefund({ refundAmount: refund?.tax_refund_amount ?? null, orders: allocationOrders })
    const percentages = sharePercentages(allocationOrders)

    const { checklist, checklistMissing } = buildContainerChecklist({
      exportDocuments: exportDocuments
        .filter((row) => String(row.shipment_id) === shipmentId)
        .map((row) => ({ docType: String(row.doc_type), attachmentId: row.attachment_id ?? null })),
      refundDocuments: refund
        ? refundDocuments
            .filter((row) => String(row.refund_id) === String(refund.id))
            .map((row) => ({ docType: String(row.doc_type), attachmentId: row.attachment_id ?? null }))
        : [],
    })

    return {
      shipmentId,
      shipmentNumber: shipment.number ?? null,
      shipmentStatus: String(shipment.status ?? 'draft'),
      currentMilestone: shipment.current_milestone ?? null,
      carrierName: shipment.carrier_name ?? null,
      departurePort: shipment.departure_port ?? null,
      departedAt: toIsoTimestamp(shipment.departed_at),
      receivedAt: toIsoTimestamp(shipment.received_at),
      etd: toIsoTimestamp(shipment.etd),
      eta: toIsoTimestamp(shipment.eta),
      containerType: shipment.container_type ?? null,
      containerNumber: shipment.container_number ?? null,
      sealNumber: shipment.seal_number ?? null,
      bookingNumber: shipment.booking_number ?? null,
      orders: allocationOrders.map((order, index) => ({
        purchaseOrderId: order.purchaseOrderId,
        number: order.number,
        businessNumber: containerOrders[index]?.business_number ?? null,
        ownerName: snapshotName(containerOrders[index]?.owner_snapshot),
        customerName: snapshotName(containerOrders[index]?.customer_snapshot),
        total: order.total,
        allocatedRefundAmount: shares.get(order.purchaseOrderId) ?? null,
        sharePercent: percentages[index] ?? null,
      })),
      taxRefundStatus: refund ? String(refund.tax_refund_status ?? 'unknown') : 'unknown',
      taxRefundAmount: refund?.tax_refund_amount ?? null,
      taxRefundNote: refund?.tax_refund_note ?? null,
      checklist,
      checklistMissing,
    }
  })

  const filtered = items.filter((item) => {
    if (params.filters.taxRefundStatus && item.taxRefundStatus !== params.filters.taxRefundStatus) return false
    return true
  })

  const direction = params.sortDir === 'asc' ? 1 : -1
  filtered.sort((left, right) => compareContainerRows(left, right, params.sortField, direction))

  const offset = (params.page - 1) * params.pageSize
  return {
    items: filtered.slice(offset, offset + params.pageSize),
    total: filtered.length,
  }
}
