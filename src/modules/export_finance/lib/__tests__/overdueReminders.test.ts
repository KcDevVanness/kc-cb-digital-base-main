import { describe, expect, it } from '@jest/globals'
import { becameLateOn, buildOverdueReminders } from '../overdueReminders'
import { COLLECTION_OVERDUE_DAYS, REFUND_OVERDUE_DAYS } from '../fileRules'

const NOW = Date.parse('2026-09-30T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

const order = (overrides: Partial<Parameters<typeof buildOverdueReminders>[0]['orders'][number]> = {}) => ({
  purchaseOrderId: 'order-1',
  number: 'PO-2026-0001',
  businessNumber: null,
  receivedAt: daysAgo(60),
  collectionStatus: 'not_received',
  collectionOverdue: true,
  ...overrides,
})

const container = (overrides: Partial<Parameters<typeof buildOverdueReminders>[0]['containers'][number]> = {}) => ({
  shipmentId: 'shipment-1',
  shipmentNumber: 'SHIP-1',
  receivedAt: daysAgo(60),
  taxRefundStatus: 'applied',
  refundOverdue: true,
  ...overrides,
})

describe('becameLateOn', () => {
  it('is the arrival date plus the rule threshold, not the day the command ran', () => {
    // 2026-08-01 + 45 days = 2026-09-15, whatever today is.
    expect(becameLateOn('2026-08-01T00:00:00.000Z', COLLECTION_OVERDUE_DAYS)).toBe('2026-09-15')
    expect(becameLateOn('2026-08-01T00:00:00.000Z', REFUND_OVERDUE_DAYS)).toBe('2026-09-15')
  })

  it('answers null for a missing or unreadable date instead of inventing one', () => {
    expect(becameLateOn(null, 45)).toBeNull()
    expect(becameLateOn('not-a-date', 45)).toBeNull()
  })
})

describe('buildOverdueReminders', () => {
  it('raises one reminder per late row with the facts the dictionary renders', () => {
    const reminders = buildOverdueReminders({ orders: [order()], containers: [container()] }, NOW)
    expect(reminders).toEqual([
      {
        kind: 'collection_overdue',
        groupKey: 'collection_overdue:order-1:',
        subject: 'PO-2026-0001',
        days: 60,
        status: 'not_received',
        sourceEntityId: 'order-1',
      },
      {
        kind: 'refund_overdue',
        groupKey: 'refund_overdue:shipment-1:',
        subject: 'SHIP-1',
        days: 60,
        status: 'applied',
        sourceEntityId: 'shipment-1',
      },
    ].map((reminder) => ({ ...reminder, groupKey: `${reminder.groupKey}2026-09-15` })))
  })

  it('ignores rows the rule did not flag, however old they are', () => {
    const reminders = buildOverdueReminders(
      { orders: [order({ collectionOverdue: false })], containers: [container({ refundOverdue: false })] },
      NOW,
    )
    expect(reminders).toEqual([])
  })

  it('keeps the key stable across runs on the same day and across later days', () => {
    const first = buildOverdueReminders({ orders: [order()], containers: [] }, NOW)
    const laterSameDay = buildOverdueReminders({ orders: [order()], containers: [] }, NOW + 3 * 60 * 60 * 1000)
    const nextDay = buildOverdueReminders({ orders: [order()], containers: [] }, NOW + 24 * 60 * 60 * 1000)
    expect(laterSameDay[0].groupKey).toBe(first[0].groupKey)
    expect(nextDay[0].groupKey).toBe(first[0].groupKey)
    // Only the reported age moves.
    expect(nextDay[0].days).toBe(first[0].days + 1)
  })

  it('prefers the business number for the subject and falls back to the id', () => {
    const reminders = buildOverdueReminders(
      {
        orders: [order({ businessNumber: 'KC-2026-0007', number: 'PO-2026-0001' }), order({ purchaseOrderId: 'order-2', number: null, businessNumber: null })],
        containers: [container({ shipmentNumber: null })],
      },
      NOW,
    )
    expect(reminders.map((reminder) => reminder.subject)).toEqual(['KC-2026-0007', 'order-2', 'shipment-1'])
  })
})
