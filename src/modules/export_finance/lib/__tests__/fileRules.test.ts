import { describe, expect, it } from '@jest/globals'
import {
  COLLECTION_OVERDUE_DAYS,
  REFUND_OVERDUE_DAYS,
  isCollectionOverdue,
  isRefundOverdue,
} from '../fileRules'

/**
 * The overdue flags are what turns "the money is still open" into something an operator can scan
 * for, so their edges are pinned: only arrived goods, only an open money status, only past the
 * threshold, and never a guess when the date is missing. The boundary is exclusive — exactly N days
 * old is not overdue yet.
 */
const NOW = new Date('2026-09-30T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

describe('refund overdue', () => {
  it('flags an arrived container whose refund is still open past the threshold', () => {
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: daysAgo(REFUND_OVERDUE_DAYS + 1), taxRefundStatus: 'not_started' }, NOW)).toBe(true)
    expect(isRefundOverdue({ shipmentStatus: 'closed', receivedAt: daysAgo(60), taxRefundStatus: 'applied' }, NOW)).toBe(true)
  })

  it('stays quiet for goods that have not arrived, for money already in, and for recent arrivals', () => {
    expect(isRefundOverdue({ shipmentStatus: 'in_transit', receivedAt: daysAgo(90), taxRefundStatus: 'not_started' }, NOW)).toBe(false)
    expect(isRefundOverdue({ shipmentStatus: 'draft', receivedAt: null, taxRefundStatus: 'unknown' }, NOW)).toBe(false)
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: daysAgo(90), taxRefundStatus: 'completed' }, NOW)).toBe(false)
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: daysAgo(3), taxRefundStatus: 'not_started' }, NOW)).toBe(false)
  })

  it('never invents an age from a missing or unparsable date', () => {
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: null, taxRefundStatus: 'not_started' }, NOW)).toBe(false)
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: 'not-a-date', taxRefundStatus: 'not_started' }, NOW)).toBe(false)
  })

  it('treats the threshold day itself as not yet overdue', () => {
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: daysAgo(REFUND_OVERDUE_DAYS), taxRefundStatus: 'not_started' }, NOW)).toBe(false)
    expect(isRefundOverdue({ shipmentStatus: 'received', receivedAt: new Date(NOW.getTime() - REFUND_OVERDUE_DAYS * 86400000 - 1).toISOString(), taxRefundStatus: 'not_started' }, NOW)).toBe(true)
  })
})

describe('collection overdue', () => {
  it('flags an arrived order whose collection is still open past the threshold', () => {
    expect(isCollectionOverdue({ businessStatus: 'received', receivedAt: daysAgo(COLLECTION_OVERDUE_DAYS + 5), collectionStatus: 'not_received' }, NOW)).toBe(true)
    expect(isCollectionOverdue({ businessStatus: 'closed', receivedAt: daysAgo(120), collectionStatus: 'unknown' }, NOW)).toBe(true)
  })

  it('stays quiet before arrival, once collected, and inside the window', () => {
    expect(isCollectionOverdue({ businessStatus: 'shipped', receivedAt: daysAgo(120), collectionStatus: 'not_received' }, NOW)).toBe(false)
    expect(isCollectionOverdue({ businessStatus: 'placed', receivedAt: null, collectionStatus: 'unknown' }, NOW)).toBe(false)
    expect(isCollectionOverdue({ businessStatus: 'received', receivedAt: daysAgo(120), collectionStatus: 'received' }, NOW)).toBe(false)
    expect(isCollectionOverdue({ businessStatus: 'received', receivedAt: daysAgo(2), collectionStatus: 'not_received' }, NOW)).toBe(false)
  })

  it('never invents an age from a missing or unparsable date', () => {
    expect(isCollectionOverdue({ businessStatus: 'received', receivedAt: null, collectionStatus: 'not_received' }, NOW)).toBe(false)
    expect(isCollectionOverdue({ businessStatus: 'received', receivedAt: 'nope', collectionStatus: 'not_received' }, NOW)).toBe(false)
  })
})
