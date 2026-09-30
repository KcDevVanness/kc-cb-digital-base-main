/**
 * Status vocabulary of the installed sales documents (quote / order), and the policy that decides
 * which actions a status allows.
 *
 * The vocabulary itself belongs to the tenant dictionary — the engine stores one per tenant
 * (`sales.order_status`, seeded with `draft/sent/confirmed/canceled/…`) and every write goes
 * through a dictionary **entry id** (`statusEntryId`), never a bare label. This module therefore
 * only fixes the *values* it writes, and derives the rest from the tenant's own entries.
 *
 * `null` is a first-class value here: documents written before this module started stamping a
 * status carry none, and the policy keeps them usable (see `salesStatusActions`) instead of
 * locking existing data behind a state it never had.
 */

/**
 * The tenant dictionary the installed sales chain keeps quote/order statuses in.
 *
 * Shared by the list's status column and the source-quote preview drawer, so the two surfaces
 * cannot drift onto different dictionaries (the engine stores one status vocabulary per tenant).
 */
export const SALES_STATUS_DICTIONARY_KEY = 'sales.order_status'

/**
 * The values this module writes. Note `canceled` with a single `l` — that is the seeded dictionary
 * value (the engine accepts `cancelled` too when *reading*, but only the seeded spelling resolves
 * to a dictionary entry).
 */
export const SALES_STATUS_DRAFT = 'draft'
export const SALES_STATUS_SENT = 'sent'
export const SALES_STATUS_CONFIRMED = 'confirmed'
export const SALES_STATUS_CANCELED = 'canceled'

/** Statuses that mean "the order is past confirmation" — the ones a shipment may allocate. */
const ALLOCATABLE_ORDER_STATUSES: readonly string[] = [
  SALES_STATUS_CONFIRMED,
  'in_fulfillment',
  'fulfilled',
]

/** A document status as the API reports it: a dictionary value, or `null` when never stamped. */
export type SalesStatusValue = string | null

export type SalesDocumentKind = 'quote' | 'order'

/**
 * Which actions a document in this status allows. Everything is derived from the status alone, so
 * the list's row actions, the dialogs and the tests cannot disagree about a transition.
 */
export type SalesStatusActions = {
  /** Quote only: send (or re-send) it to the buyer — the engine refuses only `canceled`. */
  canSend: boolean
  /** Quote only: build/convert an order from it — an un-sent draft must not be ordered. */
  canOrderFrom: boolean
  /** Whether the edit page should still be offered. */
  canEdit: boolean
  /** Order only: move `draft` → `confirmed`. */
  canConfirm: boolean
  /** Move to `canceled` (any non-terminal status). */
  canCancel: boolean
  /** Order only: may it be allocated to a shipment. */
  canAllocateToShipment: boolean
}

export function salesStatusActions(kind: SalesDocumentKind, status: SalesStatusValue): SalesStatusActions {
  const canceled = status === SALES_STATUS_CANCELED
  const allocatable = status === null || ALLOCATABLE_ORDER_STATUSES.includes(status)
  if (kind === 'quote') {
    return {
      // A sent quote may be re-sent (the engine refreshes validity and the acceptance token);
      // only the terminal status is refused.
      canSend: !canceled,
      // Draft (and anything else that is not sent/confirmed) must not become an order — that is
      // the guard against ordering a quote the buyer has not accepted. `null` is legacy data.
      canOrderFrom: status === null || status === SALES_STATUS_SENT || status === SALES_STATUS_CONFIRMED,
      canEdit: !canceled,
      canConfirm: false,
      canCancel: !canceled,
      canAllocateToShipment: false,
    }
  }
  return {
    canSend: false,
    canOrderFrom: false,
    canEdit: !canceled,
    canConfirm: status === null || status === SALES_STATUS_DRAFT,
    canCancel: !canceled,
    canAllocateToShipment: allocatable,
  }
}

/** Quote only: a `sent` quote whose validity already ran out. Unmarked/other statuses never expire. */
export function isQuoteExpired(
  status: SalesStatusValue,
  validUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (status !== SALES_STATUS_SENT) return false
  if (typeof validUntil !== 'string' || validUntil.trim().length === 0) return false
  const deadline = new Date(validUntil)
  if (Number.isNaN(deadline.getTime())) return false
  return deadline.getTime() < now.getTime()
}

/** The dictionary entry id for a value, or `null` when the tenant's dictionary lacks it. */
export function statusEntryIdForValue(
  entries: readonly { id: string; value: string }[],
  value: string,
): string | null {
  const entry = entries.find((candidate) => candidate.value === value)
  return entry ? entry.id : null
}
