/**
 * Display-only reads shared by the order workbench row and the company-order hub header.
 *
 * Both surfaces print the **root's own fields** — the workbench row mirrors the hub's header card so
 * a reader moves between the two without re-learning the columns; child documents (their numbers,
 * their counterparties) belong to the hub's attach blocks. Nothing here talks to the API: the
 * parsers take one item exactly as the list/detail read serialized it.
 */

/**
 * The name frozen into a default-customer/supplier snapshot (`{ name, code }`), for the
 * display-only cells that never re-read the party. The hub header and the workbench row print the
 * same value, so it lives here once.
 */
export function snapshotDisplayName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  if (!('name' in snapshot)) return null
  const name = snapshot.name
  return typeof name === 'string' && name.trim().length > 0 ? name : null
}

/** One company order as the workbench row needs it: the root's own fields, nothing derived. */
export type OrderWorkbenchRow = {
  id: string
  number: string
  title: string | null
  orderDate: string | null
  etaDate: string | null
  status: string
  /** `paid_full` / `unpaid`, or null for a root written before the marker existed (rendered `—`). */
  paymentStatus: string | null
  /** The frozen display name of the default customer/supplier the root carries, if any. */
  customerName: string | null
  supplierName: string | null
  /** True when the caller's organization is a collaborator on the root (list read flag). */
  viewerIsCollaborator: boolean
}

/**
 * One list item from `GET /api/order_hub/orders` → one workbench row. Only the root's own columns
 * are read: a row never prints a purchase order's number or supplier, so the table cannot drift
 * away from what the order page shows. The caller drops rows without an id.
 *
 * Every optional text field is read as "non-empty string, else null" rather than through `String()`,
 * so an absent field renders as `—` instead of `undefined` — the same rule the hub header applies.
 */
export function toOrderWorkbenchRow(item: Record<string, unknown>): OrderWorkbenchRow {
  return {
    id: String(item.id ?? ''),
    number: typeof item.number === 'string' && item.number.length > 0 ? item.number : '',
    title: typeof item.title === 'string' && item.title.length > 0 ? item.title : null,
    orderDate: typeof item.orderDate === 'string' && item.orderDate.length > 0 ? item.orderDate : null,
    etaDate: typeof item.etaDate === 'string' && item.etaDate.length > 0 ? item.etaDate : null,
    status: typeof item.status === 'string' && item.status.length > 0 ? item.status : 'placed',
    paymentStatus:
      typeof item.paymentStatus === 'string' && item.paymentStatus.length > 0 ? item.paymentStatus : null,
    customerName: snapshotDisplayName(item.customerSnapshot),
    supplierName: snapshotDisplayName(item.supplierSnapshot),
    viewerIsCollaborator: item.viewerIsCollaborator === true,
  }
}
