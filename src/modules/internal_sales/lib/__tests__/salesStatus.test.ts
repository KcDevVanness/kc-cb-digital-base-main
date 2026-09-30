import { describe, expect, it } from '@jest/globals'
import {
  SALES_STATUS_CANCELED,
  SALES_STATUS_CONFIRMED,
  SALES_STATUS_DRAFT,
  SALES_STATUS_SENT,
  isQuoteExpired,
  salesStatusActions,
  statusEntryIdForValue,
} from '../salesStatus'

/**
 * The status policy is what the list's row actions and the shipment's allocation gate read, so it
 * is pinned as a matrix: which actions each status allows, and the two edges that matter in
 * production — a legacy document with no status at all, and the terminal `canceled`.
 */
describe('sales status actions', () => {
  it('lets only a sent or confirmed quote become an order', () => {
    expect(salesStatusActions('quote', SALES_STATUS_DRAFT).canOrderFrom).toBe(false)
    expect(salesStatusActions('quote', SALES_STATUS_SENT).canOrderFrom).toBe(true)
    expect(salesStatusActions('quote', SALES_STATUS_CONFIRMED).canOrderFrom).toBe(true)
    expect(salesStatusActions('quote', SALES_STATUS_CANCELED).canOrderFrom).toBe(false)
    // A quote written before statuses were stamped keeps its actions — legacy data stays usable.
    expect(salesStatusActions('quote', null).canOrderFrom).toBe(true)
  })

  it('offers every non-terminal quote a send, and nothing to a canceled one', () => {
    expect(salesStatusActions('quote', SALES_STATUS_DRAFT).canSend).toBe(true)
    expect(salesStatusActions('quote', SALES_STATUS_SENT).canSend).toBe(true)
    expect(salesStatusActions('quote', SALES_STATUS_CANCELED).canSend).toBe(false)
    expect(salesStatusActions('quote', SALES_STATUS_CANCELED).canEdit).toBe(false)
    expect(salesStatusActions('quote', SALES_STATUS_CANCELED).canCancel).toBe(false)
  })

  it('confirms every order that is not past confirmation, and gates allocation on it', () => {
    expect(salesStatusActions('order', SALES_STATUS_DRAFT).canConfirm).toBe(true)
    expect(salesStatusActions('order', SALES_STATUS_CONFIRMED).canConfirm).toBe(false)
    // The engine copies a quote's status onto the order it converts into, so a converted `sent`
    // quote arrives as a `sent` order — it must still be confirmable, or the conversion would
    // produce a document this module can never ship.
    expect(salesStatusActions('order', SALES_STATUS_SENT).canConfirm).toBe(true)
    expect(salesStatusActions('order', SALES_STATUS_SENT).canAllocateToShipment).toBe(false)
    expect(salesStatusActions('order', SALES_STATUS_CANCELED).canConfirm).toBe(false)
    expect(salesStatusActions('order', null).canConfirm).toBe(true)
    expect(salesStatusActions('order', SALES_STATUS_DRAFT).canAllocateToShipment).toBe(false)
    expect(salesStatusActions('order', SALES_STATUS_CANCELED).canAllocateToShipment).toBe(false)
    expect(salesStatusActions('order', SALES_STATUS_CONFIRMED).canAllocateToShipment).toBe(true)
    // Past-confirmation statuses stay allocatable once Phase 2 writes them.
    expect(salesStatusActions('order', 'in_fulfillment').canAllocateToShipment).toBe(true)
    expect(salesStatusActions('order', 'fulfilled').canAllocateToShipment).toBe(true)
    // Legacy documents carry no status: they must not vanish from the shipment picker.
    expect(salesStatusActions('order', null).canAllocateToShipment).toBe(true)
  })
})

describe('quote expiry', () => {
  const now = new Date('2026-09-30T12:00:00Z')

  it('expires only a sent quote whose deadline has passed', () => {
    expect(isQuoteExpired(SALES_STATUS_SENT, '2026-09-29T00:00:00Z', now)).toBe(true)
    expect(isQuoteExpired(SALES_STATUS_SENT, '2026-10-05T00:00:00Z', now)).toBe(false)
    // A draft that carries a leftover deadline is not "expired" — it was never sent.
    expect(isQuoteExpired(SALES_STATUS_DRAFT, '2026-09-01T00:00:00Z', now)).toBe(false)
    expect(isQuoteExpired(SALES_STATUS_SENT, null, now)).toBe(false)
    expect(isQuoteExpired(SALES_STATUS_SENT, 'not-a-date', now)).toBe(false)
  })
})

describe('status entry lookup', () => {
  const entries = [
    { id: 'entry-draft', value: 'draft' },
    { id: 'entry-sent', value: 'sent' },
  ]

  it('resolves the dictionary entry id the engine expects, and reports a missing value', () => {
    expect(statusEntryIdForValue(entries, 'draft')).toBe('entry-draft')
    expect(statusEntryIdForValue(entries, 'canceled')).toBeNull()
  })
})
