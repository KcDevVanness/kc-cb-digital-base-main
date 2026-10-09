/**
 * Reads a company order's default customer/supplier for the child-form prefill (REQ-013).
 *
 * The child creation forms (`internal_sales` orders/quotes and `purchasing` purchase orders) are
 * opened from a company order's "new child" entry with `?companyOrderId=`. Before the operator types
 * anything they offer the root's own defaults as starting values — the buyer for a sales document,
 * the supplier for a purchase order.
 *
 * App-level and side-effect free: it reads the root through its public list route (the same one the
 * edit form uses), degrades to `null` on any failure (a broken read must open a plain create, never
 * block the page) and logs the cause instead of surfacing it. Values are the frozen snapshots'
 * display names, so the prefill is the exact label the root printed.
 */

import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('orders')

export const COMPANY_ORDERS_API_PATH = 'order_hub/orders'

export type CompanyOrderDefaults = {
  /** The default customer (`parties` row) and its frozen display name, or `null` when unset. */
  customerPartyId: string | null
  customerName: string | null
  /** The default supplier (`purchasing_suppliers` row) and its frozen display name/code. */
  supplierId: string | null
  supplierName: string | null
  supplierCode: string | null
}

function readText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readSnapshotName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const name = (snapshot as Record<string, unknown>).name
  return typeof name === 'string' && name.trim().length > 0 ? name : null
}

function readSnapshotCode(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const code = (snapshot as Record<string, unknown>).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}

/** The root's defaults, or `null` when the read fails or the row is not visible. Never throws. */
export async function loadCompanyOrderDefaults(companyOrderId: string): Promise<CompanyOrderDefaults | null> {
  const id = typeof companyOrderId === 'string' ? companyOrderId.trim() : ''
  if (!id) return null
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(COMPANY_ORDERS_API_PATH, { id, pageSize: 1 })
    const item = payload?.items?.[0]
    if (!item) return null
    return {
      customerPartyId: readText(item, 'customerPartyId'),
      customerName: readSnapshotName(item.customerSnapshot),
      supplierId: readText(item, 'supplierId'),
      supplierName: readSnapshotName(item.supplierSnapshot),
      supplierCode: readSnapshotCode(item.supplierSnapshot),
    }
  } catch (error) {
    // Silent degrade: the operator still gets a create. The cause goes to the client log only.
    logger.warn('Could not read company-order defaults for prefill', {
      companyOrderId: id,
      err: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** `CODE — name` when the code is known, else the name — the same shape the supplier picker prints. */
export function formatSupplierLabel(name: string, code: string | null): string {
  return code ? `${code} — ${name}` : name
}
