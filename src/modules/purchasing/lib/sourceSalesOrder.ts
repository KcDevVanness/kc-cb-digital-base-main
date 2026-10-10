/**
 * The purchase order's source anchor: the sales order it was created for.
 *
 * A purchase order is raised *because* a company order was sold, so the operator works backwards
 * from the order — and until this anchor existed there was nothing to work backwards through: the
 * order hub could not list "the purchase orders for this order" and the workbench could not tell
 * whether an order had been sourced yet.
 *
 * Two columns carry the anchor: the sales order id and a frozen copy of its number. The id is what
 * every read joins on; the number is a snapshot so a list row can name the source without a second
 * cross-module read, exactly like the supplier snapshot beside it. The *kind*
 * (`internal_sales_order` / `external_sales_order`) is derived from the sales order's channel, never
 * typed by a client: a document cannot claim a kind its channel contradicts.
 *
 * Everything in this file is pure so both the server command and the create form can share it.
 */

/**
 * The two trade-type kinds and the `?orderKind=&orderId=` parser live in `src/lib/orders/` — every
 * "create something for this order" entry reads the same pair — and are re-exported here so this
 * module's callers (and its tests) keep one import path.
 */
export { SOURCE_SALES_ORDER_KINDS, isSourceSalesOrderKind, parseSourceOrderParams } from '@/lib/orders/sourceOrderParams'
export type { SourceSalesOrderKind, SourceOrderParamResult } from '@/lib/orders/sourceOrderParams'

// Imported as well as re-exported: the mapping below needs the name in scope, not only in the
// module's public surface.
import type { SourceSalesOrderKind } from '@/lib/orders/sourceOrderParams'

/**
 * Channel code → kind. The codes are the identity `internal_sales` seeds per organization
 * (`TRADE_TYPE_CHANNEL_CODES`); matching on the code rather than the channel's display name means a
 * renamed channel never changes an order's kind.
 */
export const SOURCE_KIND_BY_CHANNEL_CODE: Record<string, SourceSalesOrderKind> = {
  INTERNAL_SALES: 'internal_sales_order',
  EXTERNAL_SALES: 'external_sales_order',
}

/** A sales order line as the sales API returns it. */
export type SalesOrderLineForCopy = {
  /**
   * The catalog product id the sales line references. The catalog product **is** the app's product
   * identity, so both the explicit `catalogProductId` and the historical `productId` spellings name
   * the same id after the cutover; either is accepted, the explicit one winning.
   */
  catalogProductId?: string | null
  catalog_product_id?: string | null
  productId?: string | null
  product_id?: string | null
  quantity?: string | number | null
}

/** One seed line for the purchase order form: a catalog product reference and a quantity, nothing else. */
export type PurchaseLineSeed = {
  catalogProductId: string | null
  quantity: string
}

export type SalesLinesCopyResult = {
  lines: PurchaseLineSeed[]
  /** Lines that carry no product reference at all — the form reports how many it could not copy. */
  skipped: number
}

function firstReference(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

/**
 * Maps sales order lines onto purchase order lines.
 *
 * Deliberately copies the product reference and the quantity only: the sales price is what the
 * customer pays, never what the supplier charges, so carrying it across would put a wrong number in
 * a field the operator is about to negotiate. The price is filled from the chosen supplier's own
 * price list (or typed) once a supplier is selected.
 */
export function salesOrderLinesToPurchaseLines(lines: SalesOrderLineForCopy[]): SalesLinesCopyResult {
  const seeds: PurchaseLineSeed[] = []
  let skipped = 0
  for (const line of lines) {
    const catalogProductId = firstReference(
      line.catalogProductId,
      line.catalog_product_id,
      line.productId,
      line.product_id,
    )
    const quantity = line.quantity === null || line.quantity === undefined ? '' : String(line.quantity).trim()
    if (!catalogProductId || quantity.length === 0) {
      skipped += 1
      continue
    }
    seeds.push({ catalogProductId, quantity })
  }
  return { lines: seeds, skipped }
}
