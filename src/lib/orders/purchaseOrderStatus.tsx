'use client'

import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * The purchase order's status vocabulary: the badge tone and the label of each status, in one place.
 *
 * App-level rather than module-local because two surfaces read the same rows — the `purchasing`
 * module's own list and detail pages, and the order workbench's 采购 column — and a status that
 * rendered as "待收" on one screen and something else on the other is exactly the drift this file
 * prevents.
 *
 * **The words stay in `purchasing`'s catalogs** (`purchasing.orders.status.*`): this file owns the
 * mapping, the module owns the language. Adding a status means adding its key there.
 */

export const PURCHASE_ORDER_STATUSES = ['draft', 'placed', 'shipped', 'received', 'closed', 'cancelled'] as const
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number]

/**
 * The badge tones, exported because surfaces that render their own badge — the order hub's 采购 rows,
 * which mix purchase orders with other child kinds — must show the same colours as this component
 * does; a status that reads «info» here and «neutral» there is the drift this file exists to prevent.
 */
export const PURCHASE_ORDER_STATUS_TONES: StatusMap<PurchaseOrderStatus> = {
  draft: 'neutral',
  placed: 'info',
  shipped: 'info',
  received: 'success',
  closed: 'success',
  cancelled: 'error',
}

const STATUS_LABEL_KEYS: Record<PurchaseOrderStatus, string> = {
  draft: 'purchasing.orders.status.draft',
  placed: 'purchasing.orders.status.placed',
  shipped: 'purchasing.orders.status.shipped',
  received: 'purchasing.orders.status.received',
  closed: 'purchasing.orders.status.closed',
  cancelled: 'purchasing.orders.status.cancelled',
}

export function isPurchaseOrderStatus(value: unknown): value is PurchaseOrderStatus {
  return typeof value === 'string' && (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value)
}

export function purchaseOrderStatusLabel(t: TranslateFn, status: PurchaseOrderStatus): string {
  return t(STATUS_LABEL_KEYS[status])
}

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const t = useT()
  return (
    <StatusBadge variant={PURCHASE_ORDER_STATUS_TONES[status]} dot>
      {purchaseOrderStatusLabel(t, status)}
    </StatusBadge>
  )
}
