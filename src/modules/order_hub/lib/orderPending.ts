/**
 * The workbench's two pure rules: what "still missing" means for each order kind, and how the merged
 * rows are ordered.
 *
 * Kept out of the component so they can be tested without a DOM, and so the filter and any future
 * reader (a dashboard counter, a notification) cannot disagree about what "待补" means.
 */

export type OrderStageSource = 'sales_order' | 'purchase_order'

/** The slice of a workbench row these rules read; the component's row type is a superset. */
export type OrderPendingInput = {
  kind: 'internal_sales' | 'external_sales' | 'purchase'
  status: string | null
  createdAt: string | null
  stages: {
    procurementCount: number
    shipmentCount: number
    documentCount: number
    collected: boolean
    refunded: boolean
  } | null
}

const STATUS_CANCELLED = 'canceled'
const STATUS_CANCELLED_PURCHASE = 'cancelled'
const STATUS_CLOSED_PURCHASE = 'closed'

/**
 * Whether an order still has something to fill in.
 *
 * A terminal order is never pending — an order that was cancelled is not "missing a shipment", it is
 * finished — and each kind asks only about the branches it actually has: an internal sale must be
 * sourced, shipped, documented and collected; an external sale ships from stock that is already
 * bought, so its purchasing count is not part of the question; a purchase order adds the tax refund
 * that only a container can carry.
 */
export function isOrderPending(row: OrderPendingInput): boolean {
  const stages = row.stages
  if (!stages) return false
  if (row.kind === 'internal_sales') {
    if (row.status === STATUS_CANCELLED) return false
    return stages.procurementCount === 0 || stages.shipmentCount === 0 || stages.documentCount === 0 || !stages.collected
  }
  if (row.kind === 'external_sales') {
    if (row.status === STATUS_CANCELLED) return false
    return stages.shipmentCount === 0 || stages.documentCount === 0
  }
  if (row.status === STATUS_CANCELLED_PURCHASE || row.status === STATUS_CLOSED_PURCHASE) return false
  return stages.shipmentCount === 0 || stages.documentCount === 0 || !stages.collected || !stages.refunded
}

/** Newest first, by the timestamp the list projections carry; a row without one sorts last. */
export function compareByCreatedAtDesc(
  a: Pick<OrderPendingInput, 'createdAt'>,
  b: Pick<OrderPendingInput, 'createdAt'>,
): number {
  const left = a.createdAt ? Date.parse(a.createdAt) : Number.NaN
  const right = b.createdAt ? Date.parse(b.createdAt) : Number.NaN
  if (Number.isNaN(left) && Number.isNaN(right)) return 0
  if (Number.isNaN(left)) return 1
  if (Number.isNaN(right)) return -1
  return right - left
}
