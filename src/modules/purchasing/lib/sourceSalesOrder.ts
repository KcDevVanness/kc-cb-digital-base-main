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

export const SOURCE_SALES_ORDER_KINDS = ['internal_sales_order', 'external_sales_order'] as const
export type SourceSalesOrderKind = (typeof SOURCE_SALES_ORDER_KINDS)[number]

/**
 * Channel code → kind. The codes are the identity `internal_sales` seeds per organization
 * (`TRADE_TYPE_CHANNEL_CODES`); matching on the code rather than the channel's display name means a
 * renamed channel never changes an order's kind.
 */
export const SOURCE_KIND_BY_CHANNEL_CODE: Record<string, SourceSalesOrderKind> = {
  INTERNAL_SALES: 'internal_sales_order',
  EXTERNAL_SALES: 'external_sales_order',
}

export function isSourceSalesOrderKind(value: unknown): value is SourceSalesOrderKind {
  return typeof value === 'string' && (SOURCE_SALES_ORDER_KINDS as readonly string[]).includes(value)
}

export type SourceOrderParamResult =
  | { status: 'none' }
  | { status: 'ok'; kind: SourceSalesOrderKind; id: string }
  | { status: 'invalid'; reason: 'kind' | 'id' | 'incomplete' }

/**
 * Reads the `?orderKind=&orderId=` pair the order hub and the workbench link with.
 *
 * Returns `none` when neither parameter is present (a plain create page), `ok` when the pair is
 * usable, and `invalid` when something was passed but cannot be trusted — the caller shows an inline
 * message for that case instead of silently ignoring the parameter or failing the whole page.
 */
export function parseSourceOrderParams(params: { get(name: string): string | null }): SourceOrderParamResult {
  const rawKind = params.get('orderKind')
  const rawId = params.get('orderId')
  const kind = rawKind?.trim() ?? ''
  const id = rawId?.trim() ?? ''
  if (kind.length === 0 && id.length === 0) return { status: 'none' }
  if (kind.length === 0 || id.length === 0) return { status: 'invalid', reason: 'incomplete' }
  if (!isSourceSalesOrderKind(kind)) return { status: 'invalid', reason: 'kind' }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { status: 'invalid', reason: 'id' }
  }
  return { status: 'ok', kind, id }
}

/** A sales order line as the sales API returns it. */
export type SalesOrderLineForCopy = {
  productId?: string | null
  product_id?: string | null
  catalogProductId?: string | null
  catalog_product_id?: string | null
  quantity?: string | number | null
}

/** One seed line for the purchase order form: a product reference and a quantity, nothing else. */
export type PurchaseLineSeed = {
  productId: string | null
  catalogProductId: string | null
  quantity: string
}

export type SalesLinesCopyResult = {
  lines: PurchaseLineSeed[]
  /** Lines that carry no product reference at all — the form reports how many it could not copy. */
  skipped: number
}

/**
 * Maps sales order lines onto purchase order lines.
 *
 * Deliberately copies the product reference and the quantity only: the sales price is what the
 * customer pays, never what the supplier charges, so carrying it across would put a wrong number in
 * a field the operator is about to negotiate. The price is filled from the chosen supplier's own
 * price list (or typed) once a supplier is selected.
 *
 * The app-owned product master wins over the catalog reference: a line that carries both is copied
 * as the master reference, which is the identity the receiving path resolves through.
 */
export function salesOrderLinesToPurchaseLines(lines: SalesOrderLineForCopy[]): SalesLinesCopyResult {
  const seeds: PurchaseLineSeed[] = []
  let skipped = 0
  for (const line of lines) {
    const productId = typeof line.productId === 'string' && line.productId.length > 0
      ? line.productId
      : (typeof line.product_id === 'string' && line.product_id.length > 0 ? line.product_id : null)
    const catalogProductId = typeof line.catalogProductId === 'string' && line.catalogProductId.length > 0
      ? line.catalogProductId
      : (typeof line.catalog_product_id === 'string' && line.catalog_product_id.length > 0 ? line.catalog_product_id : null)
    const quantity = line.quantity === null || line.quantity === undefined ? '' : String(line.quantity).trim()
    if ((!productId && !catalogProductId) || quantity.length === 0) {
      skipped += 1
      continue
    }
    seeds.push({ productId, catalogProductId: productId ? null : catalogProductId, quantity })
  }
  return { lines: seeds, skipped }
}
