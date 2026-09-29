import { describe, expect, it } from '@jest/globals'
import { collectedAmountSchema, collectionSaveSchema, refundSaveSchema, taxRefundAmountSchema } from '../validators'

/**
 * The export-finance module's recorded amounts (退税金额 / 已收金额).
 *
 * Owner rule (2026-09-28): an amount is 2 decimals, matching the `numeric(18,2)` columns, and
 * strictly positive — "nothing recorded yet" is `null`, which the status enums already say, so a
 * recorded zero is refused rather than stored. Positivity is decided on scaled integers.
 */
describe('export_finance amount validators', () => {
  it('accepts up to two decimals on a tax refund', () => {
    expect(taxRefundAmountSchema.parse('1234.56')).toBe('1234.56')
    expect(taxRefundAmountSchema.parse('1234.5')).toBe('1234.5')
    expect(taxRefundAmountSchema.parse(1234.5)).toBe('1234.5')
    expect(taxRefundAmountSchema.parse('1234')).toBe('1234')
  })

  it('refuses a third decimal, a non-decimal and a negative refund', () => {
    expect(taxRefundAmountSchema.safeParse('1234.567').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('0.009').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('abc').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('1e3').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('12,5').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('-1').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('1.2.3').success).toBe(false)
  })

  it('treats an absent or blank value as "not recorded"', () => {
    expect(taxRefundAmountSchema.parse(undefined)).toBeNull()
    expect(taxRefundAmountSchema.parse(null)).toBeNull()
    expect(taxRefundAmountSchema.parse('')).toBeNull()
    expect(taxRefundAmountSchema.parse('   ')).toBeNull()
  })

  it('requires a strictly positive amount', () => {
    expect(taxRefundAmountSchema.safeParse('0').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse('0.00').success).toBe(false)
    expect(taxRefundAmountSchema.safeParse(0).success).toBe(false)
    expect(taxRefundAmountSchema.parse('0.01')).toBe('0.01')
  })

  it('applies the same shape to the collected amount', () => {
    expect(collectedAmountSchema.parse('500.5')).toBe('500.5')
    expect(collectedAmountSchema.parse(null)).toBeNull()
    expect(collectedAmountSchema.parse('')).toBeNull()
    expect(collectedAmountSchema.safeParse('500.555').success).toBe(false)
    expect(collectedAmountSchema.safeParse('0').success).toBe(false)
    expect(collectedAmountSchema.safeParse('500.5x').success).toBe(false)
  })

  it('carries the amount through the save contracts', () => {
    const collection = collectionSaveSchema.parse({
      purchaseOrderId: '11111111-1111-4111-8111-111111111111',
      collectionStatus: 'received',
      collectedAmount: '500.5',
      collectedAt: '2026-09-20',
    })
    expect(collection.collectedAmount).toBe('500.5')
    expect(collection.currencyCode).toBe('CNY')
    expect(collectionSaveSchema.parse({
      purchaseOrderId: '11111111-1111-4111-8111-111111111111',
      collectionStatus: 'unknown',
      collectedAmount: '',
    }).collectedAmount).toBeNull()

    const refund = refundSaveSchema.parse({
      shipmentId: '22222222-2222-4222-8222-222222222222',
      taxRefundStatus: 'applied',
      taxRefundAmount: '1234.5',
    })
    expect(refund.taxRefundAmount).toBe('1234.5')
    expect(refundSaveSchema.safeParse({
      shipmentId: '22222222-2222-4222-8222-222222222222',
      taxRefundStatus: 'applied',
      taxRefundAmount: '1234.567',
    }).success).toBe(false)
  })
})
