/**
 * The company-order create form's link-picker value protocol.
 *
 * The two "link an existing document" multi-selects store their picks as plain strings. A purchase
 * order's kind is fixed by the picker; a sales order's kind travels **inside** the value
 * (`<kind>:<refId>`) because the same list offers both internal and external orders and the kind is
 * derived from the order's own channel. The payload builder turns those values back into the
 * command's `links: [{ kind, refId }]` — malformed entries are dropped rather than sent, and empty
 * selections produce an empty array (the caller omits the key).
 *
 * Pure and app-level: the form and its test share this one implementation so the separator and the
 * accepted kinds cannot drift.
 */

export type CompanyOrderLinkKind = 'internal_sales_order' | 'external_sales_order' | 'purchase_order'

export type CompanyOrderLinkEntry = { kind: CompanyOrderLinkKind; refId: string }

/** Decode a sales-order picker value; `null` when the shape is not ``<sales kind>:<uuid>``. */
export function parseSalesLinkRef(raw: string): CompanyOrderLinkEntry | null {
  const value = typeof raw === 'string' ? raw : ''
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const kind = value.slice(0, separator)
  const refId = value.slice(separator + 1).trim()
  if (kind !== 'internal_sales_order' && kind !== 'external_sales_order') return null
  if (!refId) return null
  return { kind, refId }
}

/** The picked children as the command's `links`; empty/invalid picks are omitted. */
export function buildCompanyOrderLinks(values: {
  salesLinkRefs?: readonly string[]
  purchaseLinkRefs?: readonly string[]
}): CompanyOrderLinkEntry[] {
  const links: CompanyOrderLinkEntry[] = []
  for (const raw of values.salesLinkRefs ?? []) {
    const parsed = parseSalesLinkRef(raw)
    if (parsed) links.push(parsed)
  }
  for (const raw of values.purchaseLinkRefs ?? []) {
    const refId = typeof raw === 'string' ? raw.trim() : ''
    if (refId) links.push({ kind: 'purchase_order', refId })
  }
  return links
}
