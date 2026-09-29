import type { EntityManager } from '@mikro-orm/postgresql'
import { AMOUNT_SCALE, toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { derivePaymentState, type OrderPaymentState } from '../../purchasing/lib/orderTotals'
import type { ReadScope } from './scope'

/**
 * 应付台账 / 应收台账 — both are **read-only projections** over peer tables; this module never
 * writes the money it reports.
 *
 * 应付 reuses `purchasing`'s own `derivePaymentState` (the one implementation of
 * 未付/定金已付/部分付款/已付) instead of computing a second status beside it. 应收 normalizes
 * three sources (export collections, platform settlements, internal sales orders) into one row
 * shape so the ledger reads the same regardless of where the money came from.
 *
 * **Cross-currency rows are never summed.** Amounts are grouped and displayed per currency; a CNY
 * total would need a rate and a date for every row, so it is deliberately absent from this layer.
 */

type LedgerScope = ReadScope

type LedgerDatabase = {
  purchasing_purchase_orders: {
    id: string
    number: string | null
    business_number: string | null
    supplier_id: string
    supplier_snapshot: Record<string, unknown> | null
    currency_code: string
    total: string
    status: string
    placed_at: Date | string | null
    expected_ship_at: Date | string | null
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  purchasing_purchase_payments: {
    id: string
    order_id: string
    stage: string
    amount: string
    tenant_id: string
    organization_id: string
  }
  cross_border_shipments: {
    id: string
    number: string | null
    status: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  cross_border_shipment_allocations: {
    shipment_id: string
    purchase_order_id: string
    tenant_id: string
    organization_id: string
  }
  export_finance_collections: {
    id: string
    purchase_order_id: string
    purchase_order_number: string | null
    currency_code: string
    collection_status: string
    amount: string | null
    received_at: Date | string | null
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  platform_ops_settlements: {
    id: string
    channel_id: string | null
    external_settlement_id: string
    currency_code: string
    net_amount: string
    status: string
    received_at: Date | string | null
    created_at: Date | string
    tenant_id: string
    organization_id: string
  }
  platform_ops_channels: {
    id: string
    name: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  sales_orders: {
    id: string
    order_number: string | null
    currency_code: string
    status: string
    grand_total_gross_amount: string | null
    paid_total_amount: string | null
    outstanding_amount: string | null
    created_at: Date | string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
}

function readDb(em: EntityManager) {
  return em.fork().getKysely<LedgerDatabase>()
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function readSnapshotName(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  const name = snapshot.name
  return typeof name === 'string' && name.length > 0 ? name : null
}

/** Σ of decimal strings at the amount scale; a null anywhere makes the sum null, never zero. */
function sumOrNull(values: readonly (string | null)[]): string | null {
  if (values.some((value) => value === null)) return null
  const units = values.reduce((total, value) => total + toScaledUnits(value ?? '0', AMOUNT_SCALE), 0n)
  return toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE)
}

function subtractOrNull(left: string | null, right: string): string | null {
  if (left === null) return null
  const units = toScaledUnits(left, AMOUNT_SCALE) - toScaledUnits(right, AMOUNT_SCALE)
  return toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE)
}

export type PayableShipment = { number: string | null; status: string }

export type PayableRow = {
  purchaseOrderId: string
  number: string | null
  businessNumber: string | null
  supplierId: string
  supplierName: string | null
  currencyCode: string
  orderTotal: string
  paidAmount: string
  outstandingAmount: string
  paymentStatus: OrderPaymentState['paymentStatus']
  placedAt: string | null
  expectedShipAt: string | null
  shipments: PayableShipment[]
}

export type PayableGroup = {
  supplierId: string
  supplierName: string | null
  currencyCode: string
  orderCount: number
  orderTotal: string
  paidAmount: string
  outstandingAmount: string
}

export type PayablesResult = {
  rows: PayableRow[]
  groups: PayableGroup[]
}

/**
 * 应付台账: one row per live purchase order that is an actual obligation.
 *
 * `draft` orders have not been placed yet and `cancelled` ones are not owed, so neither appears;
 * everything else does, including fully paid orders (the ledger must be able to show that nothing
 * is outstanding).
 */
export async function loadPayables(
  em: EntityManager,
  scope: LedgerScope,
  filters: { supplierId?: string; paymentStatus?: OrderPaymentState['paymentStatus'] } = {},
): Promise<PayablesResult> {
  const db = readDb(em)
  const orders = await db
    .selectFrom('purchasing_purchase_orders')
    .select([
      'id',
      'number',
      'business_number',
      'supplier_id',
      'supplier_snapshot',
      'currency_code',
      'total',
      'status',
      'placed_at',
      'expected_ship_at',
    ])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .where('deleted_at', 'is', null)
    // A null status is "not cancelled"; `NULL NOT IN (...)` is NULL, so it needs its own branch —
    // without it a placed-but-odd-status order silently disappears from the ledger.
    .where((eb) => eb.or([eb('status', 'is', null), eb('status', 'not in', ['draft', 'cancelled'])]))
    .orderBy('placed_at', 'desc')
    .execute()

  const orderIds = orders.map((order) => String(order.id))
  if (orderIds.length === 0) return { rows: [], groups: [] }

  const [payments, allocations] = await Promise.all([
    db
      .selectFrom('purchasing_purchase_payments as p')
      .select(['p.order_id as order_id', 'p.stage as stage', 'p.amount as amount'])
      .where('p.order_id', 'in', orderIds)
      .where('p.tenant_id', '=', scope.tenantId)
      .where('p.organization_id', 'in', scope.organizationIds)
      .execute(),
    db
      .selectFrom('cross_border_shipment_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.purchase_order_id as purchase_order_id', 's.id as shipment_id', 's.number as number', 's.status as status'])
      .where('a.purchase_order_id', 'in', orderIds)
      .where('a.tenant_id', '=', scope.tenantId)
      .where('a.organization_id', 'in', scope.organizationIds)
      .where('s.deleted_at', 'is', null)
      .execute(),
  ])

  const paymentsByOrder = new Map<string, Array<{ stage: string; amount: string }>>()
  for (const payment of payments) {
    const key = String(payment.order_id)
    const list = paymentsByOrder.get(key) ?? []
    list.push({ stage: String(payment.stage), amount: String(payment.amount ?? '0') })
    paymentsByOrder.set(key, list)
  }

  const shipmentsByOrder = new Map<string, PayableShipment[]>()
  for (const allocation of allocations) {
    const key = String(allocation.purchase_order_id)
    const list = shipmentsByOrder.get(key) ?? []
    if (!list.some((shipment) => shipment.number === (allocation.number ?? null) && shipment.status === String(allocation.status))) {
      list.push({ number: allocation.number ?? null, status: String(allocation.status) })
    }
    shipmentsByOrder.set(key, list)
  }

  const rows: PayableRow[] = orders.map((order) => {
    const orderId = String(order.id)
    const state = derivePaymentState(String(order.total ?? '0'), paymentsByOrder.get(orderId) ?? [])
    return {
      purchaseOrderId: orderId,
      number: order.number ?? null,
      businessNumber: order.business_number ?? null,
      supplierId: String(order.supplier_id),
      supplierName: readSnapshotName(order.supplier_snapshot),
      currencyCode: String(order.currency_code ?? 'CNY'),
      orderTotal: toAmountString({ units: toScaledUnits(String(order.total ?? '0'), AMOUNT_SCALE), scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      paidAmount: state.paidTotal,
      outstandingAmount: state.outstanding,
      paymentStatus: state.paymentStatus,
      placedAt: toIsoDate(order.placed_at),
      expectedShipAt: toIsoDate(order.expected_ship_at),
      shipments: shipmentsByOrder.get(orderId) ?? [],
    }
  })

  const filtered = rows.filter((row) => {
    if (filters.supplierId && row.supplierId !== filters.supplierId) return false
    if (filters.paymentStatus && row.paymentStatus !== filters.paymentStatus) return false
    return true
  })

  // Grouped by supplier **and** currency: two currencies are never added together.
  const groups = new Map<string, PayableGroup>()
  for (const row of filtered) {
    const key = `${row.supplierId}::${row.currencyCode}`
    const group = groups.get(key) ?? {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      currencyCode: row.currencyCode,
      orderCount: 0,
      orderTotal: '0.00',
      paidAmount: '0.00',
      outstandingAmount: '0.00',
    }
    group.orderCount += 1
    group.orderTotal = sumOrNull([group.orderTotal, row.orderTotal]) ?? group.orderTotal
    group.paidAmount = sumOrNull([group.paidAmount, row.paidAmount]) ?? group.paidAmount
    group.outstandingAmount = sumOrNull([group.outstandingAmount, row.outstandingAmount]) ?? group.outstandingAmount
    groups.set(key, group)
  }

  return {
    rows: filtered,
    groups: [...groups.values()].sort((left, right) => {
      const byName = (left.supplierName ?? '').localeCompare(right.supplierName ?? '')
      return byName !== 0 ? byName : left.currencyCode.localeCompare(right.currencyCode)
    }),
  }
}

export type ReceivableKind = 'export_collection' | 'platform_settlement' | 'internal_sales'

export type ReceivableRow = {
  kind: ReceivableKind
  reference: string
  counterpartyName: string | null
  currencyCode: string
  /** Amount receivable; `null` = nobody has recorded one yet (never rendered as 0). */
  amount: string | null
  receivedAmount: string
  outstandingAmount: string | null
  occurredAt: string | null
  status: string
}

export type ReceivableCurrencyTotal = {
  currencyCode: string
  receivedAmount: string
  outstandingAmount: string | null
  rowCount: number
}

export type ReceivablesResult = {
  rows: ReceivableRow[]
  /** Per-currency totals — deliberately not a single figure across currencies. */
  totalsByCurrency: ReceivableCurrencyTotal[]
}

/**
 * 应收台账 over the three sources.
 *
 * The rule that matters: **being received is judged by the receipt date, never by a status field**.
 * A settlement whose status says "paid" but that carries no `received_at` is not money in the bank,
 * and a status word is not evidence of a bank credit.
 */
export async function loadReceivables(
  em: EntityManager,
  scope: LedgerScope,
  filters: { kind?: ReceivableKind } = {},
): Promise<ReceivablesResult> {
  const db = readDb(em)
  const wants = (kind: ReceivableKind) => !filters.kind || filters.kind === kind

  const [collections, settlements, orders] = await Promise.all([
    wants('export_collection')
      ? db
          .selectFrom('export_finance_collections as fc')
          .select([
            'fc.id as id',
            'fc.purchase_order_number as purchase_order_number',
            'fc.purchase_order_id as purchase_order_id',
            'fc.currency_code as currency_code',
            'fc.collection_status as collection_status',
            'fc.amount as amount',
            'fc.received_at as received_at',
          ])
          .where('fc.tenant_id', '=', scope.tenantId)
          .where('fc.organization_id', 'in', scope.organizationIds)
          .where('fc.deleted_at', 'is', null)
          .execute()
      : Promise.resolve([]),
    wants('platform_settlement')
      ? db
          .selectFrom('platform_ops_settlements as s')
          .leftJoin('platform_ops_channels as c', 'c.id', 's.channel_id')
          .select([
            's.id as id',
            's.external_settlement_id as external_settlement_id',
            's.currency_code as currency_code',
            's.net_amount as net_amount',
            's.status as status',
            's.received_at as received_at',
            's.created_at as created_at',
            'c.name as channel_name',
          ])
          // `platform_ops_settlements` has no soft-delete column: a settlement is either imported
          // or it is not, so there is nothing to filter out here.
          .where('s.tenant_id', '=', scope.tenantId)
          .where('s.organization_id', 'in', scope.organizationIds)
          .orderBy('s.created_at', 'desc')
          .execute()
      : Promise.resolve([]),
    wants('internal_sales')
      ? db
          .selectFrom('sales_orders as o')
          .select([
            'o.id as id',
            'o.order_number as order_number',
            'o.currency_code as currency_code',
            'o.status as status',
            'o.grand_total_gross_amount as grand_total_gross_amount',
            'o.paid_total_amount as paid_total_amount',
            'o.outstanding_amount as outstanding_amount',
            'o.created_at as created_at',
          ])
          .where('o.tenant_id', '=', scope.tenantId)
          .where('o.organization_id', 'in', scope.organizationIds)
          .where('o.deleted_at', 'is', null)
          // The installed sales module leaves `status` null on orders that were never transitioned;
          // a null status is a live order, not a cancelled one.
          .where((eb) => eb.or([eb('o.status', 'is', null), eb('o.status', 'not in', ['draft', 'cancelled'])]))
          .orderBy('o.created_at', 'desc')
          .execute()
      : Promise.resolve([]),
  ])

  const rows: ReceivableRow[] = []

  for (const collection of collections) {
    const amount =
      collection.amount === null ? null : toAmountString({ units: toScaledUnits(collection.amount, AMOUNT_SCALE), scale: AMOUNT_SCALE }, AMOUNT_SCALE)
    const received = collection.received_at !== null && amount !== null
    const receivedAmount = received ? (amount as string) : '0.00'
    rows.push({
      kind: 'export_collection',
      reference: collection.purchase_order_number ?? String(collection.purchase_order_id).slice(0, 8),
      counterpartyName: null,
      currencyCode: String(collection.currency_code ?? 'CNY'),
      amount,
      receivedAmount,
      outstandingAmount: subtractOrNull(amount, receivedAmount),
      occurredAt: toIsoDate(collection.received_at),
      status: String(collection.collection_status ?? 'unknown'),
    })
  }

  for (const settlement of settlements) {
    const amount = toAmountString(
      { units: toScaledUnits(String(settlement.net_amount ?? '0'), AMOUNT_SCALE), scale: AMOUNT_SCALE },
      AMOUNT_SCALE,
    )
    // Receipt is the date, not the status word.
    const receivedAmount = settlement.received_at !== null ? amount : '0.00'
    rows.push({
      kind: 'platform_settlement',
      reference: String(settlement.external_settlement_id ?? settlement.id),
      counterpartyName: settlement.channel_name ?? null,
      currencyCode: String(settlement.currency_code ?? 'USD'),
      amount,
      receivedAmount,
      outstandingAmount: subtractOrNull(amount, receivedAmount),
      occurredAt: toIsoDate(settlement.received_at ?? settlement.created_at),
      status: String(settlement.status ?? 'unknown'),
    })
  }

  for (const order of orders) {
    const amount =
      order.grand_total_gross_amount === null
        ? null
        : toAmountString(
            { units: toScaledUnits(String(order.grand_total_gross_amount), AMOUNT_SCALE), scale: AMOUNT_SCALE },
            AMOUNT_SCALE,
          )
    const receivedAmount = toAmountString(
      { units: toScaledUnits(String(order.paid_total_amount ?? '0'), AMOUNT_SCALE), scale: AMOUNT_SCALE },
      AMOUNT_SCALE,
    )
    const outstanding =
      order.outstanding_amount === null || order.outstanding_amount === undefined
        ? subtractOrNull(amount, receivedAmount)
        : toAmountString(
            { units: toScaledUnits(String(order.outstanding_amount), AMOUNT_SCALE), scale: AMOUNT_SCALE },
            AMOUNT_SCALE,
          )
    rows.push({
      kind: 'internal_sales',
      reference: String(order.order_number ?? String(order.id).slice(0, 8)),
      counterpartyName: null,
      currencyCode: String(order.currency_code ?? 'CNY'),
      amount,
      receivedAmount,
      outstandingAmount: outstanding,
      occurredAt: toIsoDate(order.created_at),
      status: String(order.status ?? 'unknown'),
    })
  }

  rows.sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''))

  const totals = new Map<string, ReceivableCurrencyTotal>()
  for (const row of rows) {
    const entry = totals.get(row.currencyCode) ?? {
      currencyCode: row.currencyCode,
      receivedAmount: '0.00',
      outstandingAmount: '0.00',
      rowCount: 0,
    }
    entry.receivedAmount = sumOrNull([entry.receivedAmount, row.receivedAmount]) ?? entry.receivedAmount
    const outstanding = entry.outstandingAmount
    entry.outstandingAmount =
      outstanding === null || row.outstandingAmount === null
        ? null
        : sumOrNull([outstanding, row.outstandingAmount])
    entry.rowCount += 1
    totals.set(row.currencyCode, entry)
  }

  return { rows, totalsByCurrency: [...totals.values()].sort((l, r) => l.currencyCode.localeCompare(r.currencyCode)) }
}
