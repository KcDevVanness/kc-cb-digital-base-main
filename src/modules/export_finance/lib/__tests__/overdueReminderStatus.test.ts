import { describe, expect, it } from '@jest/globals'
import { parseReminderGroupKey } from '../overdueReminderStatus'

describe('parseReminderGroupKey', () => {
  it('reads the three parts the reminder command writes', () => {
    expect(parseReminderGroupKey('collection_overdue:2b4c03f4-e3de-4d57-80a7-7d6713a8adc9:2026-09-15')).toEqual({
      kind: 'collection_overdue',
      resourceId: '2b4c03f4-e3de-4d57-80a7-7d6713a8adc9',
      lateOn: '2026-09-15',
    })
    expect(parseReminderGroupKey('refund_overdue:shipment-1:2026-09-15')?.kind).toBe('refund_overdue')
  })

  it('ignores anything that is not one of this module\'s keys', () => {
    // Another module's key, a malformed date, a missing part, and the empty case.
    expect(parseReminderGroupKey('finance.reminder.payment_overdue')).toBeNull()
    expect(parseReminderGroupKey('collection_overdue:abc:2026-9-5')).toBeNull()
    expect(parseReminderGroupKey('collection_overdue:abc')).toBeNull()
    expect(parseReminderGroupKey('refund_overdue::2026-09-15')).toBeNull()
    expect(parseReminderGroupKey(null)).toBeNull()
  })
})
