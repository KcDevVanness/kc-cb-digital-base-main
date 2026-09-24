import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { readCurrencyScaleInfo } from '../../trade_docs/lib/currencyScale'
import {
  aggregateRefundStatus,
  allocateTaxRefund,
  buildOrderChecklist,
  computeFinanceView,
  deriveBusinessStatus,
  selectKcContract,
  selectSubsidiaryInvoice,
  snapshotName,
  sumAllocationShares,
  toIsoTimestamp,
  toScaledUnits,
  toTime,
  type AllocationOrder,
  type ContractRow,
  type InvoiceRow,
  type OrderContainerRef,
  type OrderFileListParams,
  type OrderFileRow,
} from './fileRules'
import { STORED_AMOUNT_SCALE } from '../../trade_docs/lib/money'

/**
 * 订单档案 — the read-only projection of one purchase order.
 *
 * This file only fetches and assembles; every derivation lives in `fileRules.ts`. Peer tables are
 * read with scoped raw SQL, because the app-wide rule forbids cross-module ORM relations, and
 * every read filters `tenant_id` plus the caller's organization set plus the soft-delete column.
 */

export * from './fileRules'

type OrderRow = {
  id: string
  number: string | null
  business_number: string | null
  supplier_snapshot: Record<string, unknown> | null
  owner_snapshot: Record<string, unknown> | null
  customer_snapshot: Record<string, unknown> | null
  product_category: string | null
  status: string
  currency_code: string
  total: string
  deposit_percent: string | null
  deposit_amount: string | null
  expected_ship_at: Date | string | null
  placed_at: Date | string | null
  received_at: Date | string | null
}

type AllocationRow = {
  purchase_order_id: string
  shipment_id: string
  shipment_number: string | null
  shipment_status: string
  current_milestone: string | null
  departed_at: Date | string | null
  received_at: Date | string | null
  etd: Date | string | null
  container_type: string | null
  container_number: string | null
  seal_number: string | null
  booking_number: string | null
  shipment_created_at: Date | string | null
}

type ContractQueryRow = {
  id: string
  direction: string
  status: string
  source_kind: string | null
  source_id: string | null
  finance_total: string
  currency_code: string
  exchange_rate: string | null
  attachment_id: string | null
  generated_attachment_id: string | null
  updated_at: Date | string | null
}

type InvoiceQueryRow = {
  id: string
  contract_id: string | null
  direction: string
  status: string
  total: string
  currency_code: string
  attachment_id: string | null
  issued_at: Date | string | null
  updated_at: Date | string | null
}

function toContractRow(row: ContractQueryRow): ContractRow {
  return {
    id: String(row.id),
    direction: String(row.direction ?? 'purchase'),
    status: String(row.status ?? 'draft'),
    sourceKind: row.source_kind ?? null,
    sourceId: row.source_id ? String(row.source_id) : null,
    financeTotal: String(row.finance_total ?? '0'),
    currencyCode: String(row.currency_code ?? 'CNY'),
    exchangeRate: row.exchange_rate ?? null,
    attachmentId: row.attachment_id ? String(row.attachment_id) : null,
    generatedAttachmentId: row.generated_attachment_id ? String(row.generated_attachment_id) : null,
    updatedAt: row.updated_at ?? null,
  }
}

function toInvoiceRow(row: InvoiceQueryRow): InvoiceRow {
  return {
    id: String(row.id),
    contractId: row.contract_id ? String(row.contract_id) : null,
    direction: String(row.direction ?? 'inbound'),
    status: String(row.status ?? 'draft'),
    total: String(row.total ?? '0'),
    currencyCode: String(row.currency_code ?? 'CNY'),
    attachmentId: row.attachment_id ? String(row.attachment_id) : null,
    issuedAt: row.issued_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

/**
 * Sorts one page-worth of rows in memory.
 *
 * The sort keys and two of the three filters are derived values (business status, aggregated
 * refund status, allocated amount), so they cannot be expressed in SQL without duplicating the
 * derivation rules this file owns. The SQL stage therefore narrows by scope and search text, and
 * this stage orders and paginates — one place decides what each column means.
 */
function compareOrderRows(left: OrderFileRow, right: OrderFileRow, sortField: OrderFileListParams['sortField'], direction: 1 | -1): number {
  if (sortField === 'total') {
    const leftUnits = toScaledUnits(left.finance.orderAmount, STORED_AMOUNT_SCALE)
    const rightUnits = toScaledUnits(right.finance.orderAmount, STORED_AMOUNT_SCALE)
    if (leftUnits !== rightUnits) return leftUnits < rightUnits ? -direction : direction
    return left.purchaseOrderId < right.purchaseOrderId ? -1 : 1
  }

  const leftTime = sortField === 'placed_at' ? toTime(left.placedAt) : toTime(left.expectedDeliveryAt)
  const rightTime = sortField === 'placed_at' ? toTime(right.placedAt) : toTime(right.expectedDeliveryAt)
  if (leftTime !== rightTime) return leftTime < rightTime ? -direction : direction
  return left.purchaseOrderId < right.purchaseOrderId ? -1 : 1
}

/**
 * The 订单档案 rows of one organization scope.
 *
 * Rows are assembled from nine scoped reads; every one of them filters `tenant_id` and
 * `organization_id in (...)` plus the soft-delete column, so a guessed id can never surface
 * another organization's figure.
 */
export async function loadOrderFiles(
  em: EntityManager,
  params: OrderFileListParams,
): Promise<{ items: OrderFileRow[]; total: number }> {
  const db = em.fork().getKysely<any>()
  const scope = { tenantId: params.tenantId, organizationId: params.organizationIds[0] }
  const search = params.filters.search?.trim()

  let ordersQuery = db
    .selectFrom('purchasing_purchase_orders as o')
    .select([
      'o.id as id',
      'o.number as number',
      'o.business_number as business_number',
      'o.supplier_snapshot as supplier_snapshot',
      'o.owner_snapshot as owner_snapshot',
      'o.customer_snapshot as customer_snapshot',
      'o.product_category as product_category',
      'o.status as status',
      'o.currency_code as currency_code',
      'o.total as total',
      'o.deposit_percent as deposit_percent',
      'o.deposit_amount as deposit_amount',
      'o.expected_ship_at as expected_ship_at',
      'o.placed_at as placed_at',
      'o.received_at as received_at',
    ])
    .where('o.tenant_id', '=', params.tenantId)
    .where('o.organization_id', 'in', params.organizationIds)
    .where('o.deleted_at', 'is', null)

  if (search && search.length > 0) {
    const term = `%${escapeLikePattern(search)}%`
    ordersQuery = ordersQuery.where((eb) =>
      eb.or([
        eb('o.number', 'ilike', term),
        eb('o.business_number', 'ilike', term),
        sql<boolean>`o.supplier_snapshot->>'name' ilike ${term}`,
      ]),
    )
  }

  if (params.filters.purchaseOrderId) {
    ordersQuery = ordersQuery.where('o.id', '=', params.filters.purchaseOrderId)
  }

  const orders = (await ordersQuery.execute()) as OrderRow[]
  if (orders.length === 0) return { items: [], total: 0 }

  const orderIds = orders.map((order) => String(order.id))

  const payments = (await db
    .selectFrom('purchasing_purchase_payments as p')
    .select(['p.order_id as order_id', 'p.amount as amount'])
    .where('p.order_id', 'in', orderIds)
    .where('p.tenant_id', '=', params.tenantId)
    .where('p.organization_id', 'in', params.organizationIds)
    .execute()) as Array<{ order_id: string; amount: string }>

  const purchaseDocuments = (await db
    .selectFrom('purchasing_purchase_order_documents as d')
    .select(['d.order_id as order_id', 'd.doc_type as doc_type', 'd.attachment_id as attachment_id'])
    .where('d.order_id', 'in', orderIds)
    .where('d.tenant_id', '=', params.tenantId)
    .where('d.organization_id', 'in', params.organizationIds)
    .where('d.deleted_at', 'is', null)
    .execute()) as Array<{ order_id: string; doc_type: string; attachment_id: string | null }>

  const allocations = (await db
    .selectFrom('cross_border_shipment_allocations as a')
    .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
    .select([
      'a.purchase_order_id as purchase_order_id',
      's.id as shipment_id',
      's.number as shipment_number',
      's.status as shipment_status',
      's.current_milestone as current_milestone',
      's.departed_at as departed_at',
      's.received_at as received_at',
      's.etd as etd',
      's.container_type as container_type',
      's.container_number as container_number',
      's.seal_number as seal_number',
      's.booking_number as booking_number',
      's.created_at as shipment_created_at',
    ])
    .where('a.purchase_order_id', 'in', orderIds)
    .where('a.tenant_id', '=', params.tenantId)
    .where('a.organization_id', 'in', params.organizationIds)
    .where('s.deleted_at', 'is', null)
    .execute()) as AllocationRow[]

  const shipmentIds = Array.from(new Set(allocations.map((row) => String(row.shipment_id))))

  const milestones = shipmentIds.length > 0
    ? ((await db
        .selectFrom('cross_border_shipment_milestones as m')
        .select(['m.shipment_id as shipment_id', 'm.milestone as milestone'])
        .where('m.shipment_id', 'in', shipmentIds)
        .where('m.tenant_id', '=', params.tenantId)
        .where('m.organization_id', 'in', params.organizationIds)
        .execute()) as Array<{ shipment_id: string; milestone: string }>)
    : []

  // Every order of every container in play — the allocation denominator is the container's whole
  // order set, not the single order being projected (a 拼柜 container's refund is not all one
  // order's). The sibling container projection reads the same set, so both pages agree.
  const containerOrdersByShipment = new Map<string, AllocationOrder[]>()
  if (shipmentIds.length > 0) {
    const containerOrderRows = (await db
      .selectFrom('cross_border_shipment_allocations as a')
      .innerJoin('purchasing_purchase_orders as po', 'po.id', 'a.purchase_order_id')
      .select([
        'a.shipment_id as shipment_id',
        'po.id as purchase_order_id',
        'po.number as order_number',
        'po.total as total',
      ])
      .where('a.shipment_id', 'in', shipmentIds)
      .where('a.tenant_id', '=', params.tenantId)
      .where('a.organization_id', 'in', params.organizationIds)
      .where('po.deleted_at', 'is', null)
      .execute()) as Array<{
        shipment_id: string
        purchase_order_id: string
        order_number: string | null
        total: string
      }>

    for (const row of containerOrderRows) {
      const shipmentId = String(row.shipment_id)
      const list = containerOrdersByShipment.get(shipmentId) ?? []
      list.push({
        purchaseOrderId: String(row.purchase_order_id),
        number: row.order_number ?? null,
        total: String(row.total ?? '0'),
      })
      containerOrdersByShipment.set(shipmentId, list)
    }
  }

  const exportDocuments = shipmentIds.length > 0
    ? ((await db
        .selectFrom('cross_border_export_documents as x')
        .select(['x.shipment_id as shipment_id', 'x.doc_type as doc_type', 'x.attachment_id as attachment_id'])
        .where('x.shipment_id', 'in', shipmentIds)
        .where('x.tenant_id', '=', params.tenantId)
        .where('x.organization_id', 'in', params.organizationIds)
        .where('x.deleted_at', 'is', null)
        .execute()) as Array<{ shipment_id: string; doc_type: string; attachment_id: string | null }>)
    : []

  const contracts = (await db
    .selectFrom('trade_docs_contracts as c')
    .select([
      'c.id as id',
      'c.direction as direction',
      'c.status as status',
      'c.source_kind as source_kind',
      'c.source_id as source_id',
      'c.finance_total as finance_total',
      'c.currency_code as currency_code',
      'c.exchange_rate as exchange_rate',
      'c.attachment_id as attachment_id',
      'c.generated_attachment_id as generated_attachment_id',
      'c.updated_at as updated_at',
    ])
    .where('c.source_id', 'in', orderIds)
    .where('c.source_kind', '=', 'purchase_order')
    .where('c.tenant_id', '=', params.tenantId)
    .where('c.organization_id', 'in', params.organizationIds)
    .where('c.deleted_at', 'is', null)
    .execute()) as ContractQueryRow[]

  const contractIds = contracts.map((row) => String(row.id))

  const invoices = contractIds.length > 0
    ? ((await db
        .selectFrom('trade_docs_invoices as i')
        .select([
          'i.id as id',
          'i.contract_id as contract_id',
          'i.direction as direction',
          'i.status as status',
          'i.total as total',
          'i.currency_code as currency_code',
          'i.attachment_id as attachment_id',
          'i.issued_at as issued_at',
          'i.updated_at as updated_at',
        ])
        .where('i.contract_id', 'in', contractIds)
        .where('i.tenant_id', '=', params.tenantId)
        .where('i.organization_id', 'in', params.organizationIds)
        .where('i.deleted_at', 'is', null)
        .execute()) as InvoiceQueryRow[])
    : []

  const collections = (await db
    .selectFrom('export_finance_collections as fc')
    .select(['fc.id as id', 'fc.purchase_order_id as purchase_order_id', 'fc.collection_status as collection_status'])
    .where('fc.purchase_order_id', 'in', orderIds)
    .where('fc.tenant_id', '=', params.tenantId)
    .where('fc.organization_id', 'in', params.organizationIds)
    .where('fc.deleted_at', 'is', null)
    .execute()) as Array<{ id: string; purchase_order_id: string; collection_status: string }>

  const collectionIds = collections.map((row) => String(row.id))

  const collectionDocuments = collectionIds.length > 0
    ? ((await db
        .selectFrom('export_finance_collection_documents as fd')
        .select(['fd.collection_id as collection_id', 'fd.doc_type as doc_type', 'fd.attachment_id as attachment_id'])
        .where('fd.collection_id', 'in', collectionIds)
        .where('fd.tenant_id', '=', params.tenantId)
        .where('fd.organization_id', 'in', params.organizationIds)
        .where('fd.deleted_at', 'is', null)
        .execute()) as Array<{ collection_id: string; doc_type: string; attachment_id: string | null }>)
    : []

  const refunds = shipmentIds.length > 0
    ? ((await db
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
        }>)
    : []

  const refundsByShipment = new Map(refunds.map((row) => [String(row.shipment_id), row]))

  const currencyScales = new Map<string, number>()
  for (const order of orders) {
    const code = String(order.currency_code ?? 'CNY')
    if (currencyScales.has(code)) continue
    const info = await readCurrencyScaleInfo(em, scope, code)
    currencyScales.set(code, info.scale)
  }

  const pickedUpShipments = new Set(
    milestones.filter((row) => row.milestone === 'picked_up').map((row) => String(row.shipment_id)),
  )

  const items: OrderFileRow[] = orders.map((order) => {
    const orderId = String(order.id)
    const currencyScale = currencyScales.get(String(order.currency_code ?? 'CNY')) ?? 2

    const containers: OrderContainerRef[] = allocations
      .filter((row) => String(row.purchase_order_id) === orderId)
      .map((row) => {
        const shipmentId = String(row.shipment_id)
        const refund = refundsByShipment.get(shipmentId)
        return {
          shipmentId,
          shipmentNumber: row.shipment_number ?? null,
          shipmentStatus: String(row.shipment_status ?? 'draft'),
          currentMilestone: row.current_milestone ?? null,
          pickedUp: pickedUpShipments.has(shipmentId),
          departed: Boolean(row.departed_at),
          departedAt: row.departed_at ?? null,
          receivedAt: row.received_at ?? null,
          etd: row.etd ?? null,
          containerType: row.container_type ?? null,
          containerNumber: row.container_number ?? null,
          sealNumber: row.seal_number ?? null,
          bookingNumber: row.booking_number ?? null,
          createdAt: row.shipment_created_at ?? null,
          taxRefundStatus: refund ? String(refund.tax_refund_status ?? 'unknown') : 'unknown',
          taxRefundAmount: refund?.tax_refund_amount ?? null,
          taxRefundNote: refund?.tax_refund_note ?? null,
        }
      })

    // The container facts shown on the order row are the newest shipment's, with `shipmentCount`
    // telling the reader how many containers the order actually spans.
    const latestContainer = containers
      .slice()
      .sort((left, right) => {
        const leftTime = toTime(left.departedAt) || toTime(left.createdAt)
        const rightTime = toTime(right.departedAt) || toTime(right.createdAt)
        if (leftTime !== rightTime) return rightTime - leftTime
        return left.shipmentId < right.shipmentId ? -1 : 1
      })[0] ?? null

    const orderContracts = contracts.filter((row) => String(row.source_id) === orderId).map(toContractRow)
    const kcContract = selectKcContract(orderContracts, orderId)
    const purchaseContract = orderContracts.find((contract) => contract.direction === 'purchase') ?? null
    const kcInvoices = kcContract
      ? invoices.filter((row) => String(row.contract_id) === String(kcContract.id)).map(toInvoiceRow)
      : []
    const subsidiaryInvoice = selectSubsidiaryInvoice(kcInvoices, kcContract?.id ?? null)

    const collection = collections.find((row) => String(row.purchase_order_id) === orderId) ?? null
    const orderCollectionDocuments = collection
      ? collectionDocuments
          .filter((row) => String(row.collection_id) === String(collection.id))
          .map((row) => ({ docType: String(row.doc_type), attachmentId: row.attachment_id ?? null }))
      : []

    const orderExportDocuments = exportDocuments
      .filter((row) => containers.some((container) => container.shipmentId === String(row.shipment_id)))
      .map((row) => ({ docType: String(row.doc_type), attachmentId: row.attachment_id ?? null }))

    const { checklist, checklistMissing } = buildOrderChecklist({
      purchaseDocuments: purchaseDocuments
        .filter((row) => String(row.order_id) === orderId)
        .map((row) => ({ docType: String(row.doc_type), attachmentId: row.attachment_id ?? null })),
      purchaseContract,
      salesContract: kcContract,
      kcInvoices,
      exportDocuments: orderExportDocuments,
      collectionDocuments: orderCollectionDocuments,
    })

    // Each container's refund is allocated over that container's whole order set; an order that
    // spans several containers therefore sums one share per container, and `null` (nothing
    // allocatable) stays `null` rather than becoming a refund of zero.
    const allocatedRefundAmount = sumAllocationShares(
      containers.map((container) =>
        container.taxRefundAmount === null
          ? null
          : allocateTaxRefund({
              refundAmount: container.taxRefundAmount,
              orders: containerOrdersByShipment.get(container.shipmentId) ?? [],
            }).get(orderId) ?? null,
      ),
    )

    return {
      purchaseOrderId: orderId,
      number: order.number ?? null,
      businessNumber: order.business_number ?? null,
      supplierName: snapshotName(order.supplier_snapshot),
      ownerName: snapshotName(order.owner_snapshot),
      customerName: snapshotName(order.customer_snapshot),
      productCategory: order.product_category ?? null,
      businessStatus: deriveBusinessStatus({
        poStatus: String(order.status ?? 'draft'),
        pickedUp: containers.some((container) => container.pickedUp),
        departed: containers.some((container) => container.departed),
      }),
      placedAt: toIsoTimestamp(order.placed_at),
      expectedDeliveryAt: toIsoTimestamp(order.expected_ship_at),
      shipmentEtd: toIsoTimestamp(latestContainer?.etd),
      shipmentDepartedAt: toIsoTimestamp(latestContainer?.departedAt),
      receivedAt: toIsoTimestamp(latestContainer?.receivedAt ?? order.received_at),
      containerType: latestContainer?.containerType ?? null,
      containerNumber: latestContainer?.containerNumber ?? null,
      sealNumber: latestContainer?.sealNumber ?? null,
      bookingNumber: latestContainer?.bookingNumber ?? null,
      shipmentCount: containers.length,
      finance: computeFinanceView({
        total: String(order.total ?? '0'),
        depositAmount: order.deposit_amount ?? null,
        depositPercent: order.deposit_percent ?? null,
        currencyScale,
        paymentAmounts: payments.filter((row) => String(row.order_id) === orderId).map((row) => String(row.amount ?? '0')),
        kcPriceAmount: kcContract?.financeTotal ?? null,
        kcPriceCurrency: kcContract?.currencyCode ?? null,
        subsidiaryInvoiceAmount: subsidiaryInvoice?.total ?? null,
        subsidiaryInvoiceCurrency: subsidiaryInvoice?.currencyCode ?? null,
        exchangeRate: kcContract?.exchangeRate ?? null,
      }),
      collectionStatus: collection ? String(collection.collection_status ?? 'unknown') : 'unknown',
      refundStatus: aggregateRefundStatus(containers.map((container) => container.taxRefundStatus)),
      allocatedRefundAmount,
      containers: containers.map((container) => ({
        shipmentId: container.shipmentId,
        shipmentNumber: container.shipmentNumber,
        status: container.shipmentStatus,
        currentMilestone: container.currentMilestone,
        containerNumber: container.containerNumber,
        departedAt: toIsoTimestamp(container.departedAt),
        receivedAt: toIsoTimestamp(container.receivedAt),
        taxRefundStatus: container.taxRefundStatus,
        taxRefundAmount: container.taxRefundAmount,
        taxRefundNote: container.taxRefundNote,
      })),
      checklist,
      checklistMissing,
    }
  })

  const filtered = items.filter((item) => {
    if (params.filters.status && item.businessStatus !== params.filters.status) return false
    if (params.filters.collectionStatus && item.collectionStatus !== params.filters.collectionStatus) return false
    if (params.filters.taxRefundStatus && item.refundStatus !== params.filters.taxRefundStatus) return false
    return true
  })

  const direction = params.sortDir === 'asc' ? 1 : -1
  filtered.sort((left, right) => compareOrderRows(left, right, params.sortField, direction))

  const offset = (params.page - 1) * params.pageSize
  return {
    items: filtered.slice(offset, offset + params.pageSize),
    total: filtered.length,
  }
}
