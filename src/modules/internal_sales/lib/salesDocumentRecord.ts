/**
 * The list projection of a sales document, shared by the list and the order hub.
 *
 * Moved out of the table unchanged: the hub renders the same head facts (number, buyer, currency,
 * total, status, version) as the list row it was opened from, and two mappings would drift the moment
 * one of them learned a new snapshot key.
 */
export type SalesDocumentKind = 'quote' | 'order'

/** Reads the first non-empty string among `keys`; the list projections differ per kind. */
function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export type DocumentRecord = {
  id: string
  number: string | null
  currencyCode: string
  total: string
  customerName: string | null
  /** The buyer address `quotes/send` needs; the list carries the snapshot, so the dialog can pre-check. */
  buyerEmail: string | null
  status: string | null
  /** Quote only: the deadline `quotes/send` wrote (ISO date, `null` when never sent). */
  validUntil: string | null
  /** Carried for the optimistic lock every status write sends (`buildOptimisticLockHeader`). */
  updatedAt: string | null
  lineItemCount: number
  createdAt: string | null
}

export function toDocumentRecord(item: Record<string, unknown>, kind: SalesDocumentKind): DocumentRecord {
  const snapshot = item.customerSnapshot ?? item.customer_snapshot
  const customerName = snapshot && typeof snapshot === 'object'
    ? readText(snapshot as Record<string, unknown>, 'name') || null
    : null
  // The same two keys the engine's `resolveQuoteEmail` reads, so the dialog can block a send the
  // route would refuse anyway (and say why) instead of letting the operator discover it by 400.
  const snapshotRecord = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : null
  const contact = snapshotRecord?.contact
  const customer = snapshotRecord?.customer
  const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : null
  const buyerEmail = (contact && typeof contact === 'object' && !Array.isArray(contact)
    ? readText(contact as Record<string, unknown>, 'email')
    : '')
    || (customer && typeof customer === 'object' && !Array.isArray(customer)
      ? readText(customer as Record<string, unknown>, 'primaryEmail')
      : '')
    // Third key of the engine's own resolution chain (`resolveQuoteEmail`): an address another
    // surface may have frozen into the document metadata.
    || (metadata ? readText(metadata, 'customerEmail') : '')
  const total = item.grandTotalNetAmount ?? item.grand_total_net_amount ?? item.grandTotalGrossAmount
  return {
    id: String(item.id),
    number: readText(item, kind === 'quote' ? 'quoteNumber' : 'orderNumber') || null,
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    total: typeof total === 'number' ? String(total) : typeof total === 'string' ? total : '0',
    customerName,
    buyerEmail: buyerEmail || null,
    status: readText(item, 'status') || null,
    validUntil: readText(item, 'validUntil', 'valid_until') || null,
    updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
    lineItemCount: Number(item.lineItemCount ?? item.line_item_count ?? 0),
    createdAt: (item.createdAt ?? item.created_at ?? null) as string | null,
  }
}
