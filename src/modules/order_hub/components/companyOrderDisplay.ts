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

/**
 * The dictionary code → option label (`CODE — name`), for the hub header's 订单描述 cell.
 *
 * The root stores the `product_category` code; the label is what the operator reads. A code the
 * loaded dictionary no longer carries still renders as **itself** — the header must show the value
 * the record actually holds rather than inventing “—” for a value that is there (and a missing
 * dictionary must never blank the cell).
 */
export function resolveCodeListLabel(
  code: string | null | undefined,
  options: ReadonlyArray<{ value: string; label: string }>,
): string | null {
  const value = typeof code === 'string' ? code.trim() : ''
  if (value.length === 0) return null
  const match = options.find((option) => option.value === value)
  return match ? match.label : value
}

/**
 * The hub header's 供应商 cell: the root's own frozen default supplier leads; when the root carries
 * none, the **linked purchase rows'** suppliers answer instead (owner 2026-10-10, REQ-040). Duplicate
 * names collapse, and the distinct ones join with ` / ` so a root spanning two suppliers reads both.
 */
export function resolveHeaderSupplierName(
  rootSupplierName: string | null | undefined,
  purchaseSupplierNames: ReadonlyArray<string | null | undefined>,
): string | null {
  const root = typeof rootSupplierName === 'string' ? rootSupplierName.trim() : ''
  if (root.length > 0) return root
  const seen = new Set<string>()
  const names: string[] = []
  for (const candidate of purchaseSupplierNames) {
    const name = typeof candidate === 'string' ? candidate.trim() : ''
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.length > 0 ? names.join(' / ') : null
}

/**
 * The workbench 订单金额 figure (owner 2026-10-10, REQ-042): the **purchase** total while the order
 * has one, and the sales total only when it does not. `0.00` is the “no figure on this side” syntax
 * the stage projection emits, so it is the fallback trigger — never added across currencies.
 */
export function primaryOrderAmount(amount: { sales: string; purchase: string }): string {
  return amount.purchase !== '0.00' ? amount.purchase : amount.sales
}

/** One company order as the hub header card needs it: the root's own fields, nothing derived. */
export type CompanyOrderHead = {
  id: string
  number: string
  title: string | null
  orderDate: string | null
  etaDate: string | null
  status: string
  /** 是否已收款: `paid_full`/`unpaid`, or `null` for a root written before the column existed. */
  paymentStatus: string | null
  notes: string | null
  /** 订单描述 — the stored `product_category` code, resolved to a label by the header card. */
  productCategory: string | null
  /** 采购负责人 — the name frozen into `ownerSnapshot` when the root was written. */
  ownerName: string | null
  /** The frozen display name of the root's default customer/supplier, if any. */
  customerName: string | null
  supplierName: string | null
  /** True when the caller's organization is a collaborator on the root (the list read's flag). */
  viewerIsCollaborator: boolean
  /** The root's own organization; never offered as a collaborator of itself. */
  organizationId: string | null
  updatedAt: string | null
}

/**
 * One detail/list item from `GET /api/order_hub/orders` → the hub header card's fields. Only the
 * root's own columns are read; a missing/non-string one is `null` (rendered `—`) rather than leaking
 * `undefined`. The supplier fallback and the description label are separate, derived at render time.
 */
export function toCompanyOrderHead(item: Record<string, unknown>): CompanyOrderHead {
  const text = (key: string): string | null => {
    const value = item[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  return {
    id: String(item.id ?? ''),
    number: typeof item.number === 'string' ? item.number : '',
    title: text('title'),
    orderDate: text('orderDate'),
    etaDate: text('etaDate'),
    status: typeof item.status === 'string' && item.status.length > 0 ? item.status : 'placed',
    paymentStatus: text('paymentStatus'),
    notes: text('notes'),
    productCategory: text('productCategory'),
    ownerName: snapshotDisplayName(item.ownerSnapshot),
    customerName: snapshotDisplayName(item.customerSnapshot),
    supplierName: snapshotDisplayName(item.supplierSnapshot),
    viewerIsCollaborator: item.viewerIsCollaborator === true,
    organizationId: text('organizationId') ?? text('organization_id'),
    updatedAt: text('updatedAt') ?? text('updated_at'),
  }
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
