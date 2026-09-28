import { describe, expect, it } from '@jest/globals'
import { platformOrderInputSchema, settlementLineInputSchema } from '../validators'

/**
 * The platform_ops amount fields: external integration data, so numbers and decimal strings are
 * both accepted and normalized to a decimal string — never rounded, so a finer-than-caliber payload
 * keeps its digits for the command to quantize (and warn about).
 */
describe('platform_ops amount validators', () => {
  const order = (grossAmount: unknown) =>
    platformOrderInputSchema.safeParse({ externalOrderId: 'E1', grossAmount })

  it('normalizes JSON numbers and decimal strings to a decimal string', () => {
    expect(order(12.5).data?.grossAmount).toBe('12.5')
    expect(order(12).data?.grossAmount).toBe('12')
    expect(order('12.50').data?.grossAmount).toBe('12.50')
  })

  it('keeps digits beyond the amount caliber instead of truncating them', () => {
    expect(order('10.005').data?.grossAmount).toBe('10.005')
    expect(settlementLineInputSchema.parse({ externalOrderId: 'E1', feeAmount: 0.123456 }).feeAmount).toBe(
      '0.123456',
    )
  })

  it('rejects non-finite values and negatives', () => {
    expect(order('not-a-number').success).toBe(false)
    expect(order(Number.POSITIVE_INFINITY).success).toBe(false)
    expect(order(-1).success).toBe(false)
    expect(settlementLineInputSchema.safeParse({ externalOrderId: 'E1', grossAmount: '-0.01' }).success).toBe(false)
  })
})
