import { describe, expect, it } from '@jest/globals'
import { comparePriceBaseRows, netUnitPrice, pickBasePriceRow, trimDecimalText } from '../priceKinds'

/**
 * The 折后价 arithmetic.
 *
 * One implementation sits behind three readers that must agree: the form's live preview, the list's
 * 供应商供货价 column and the promotion's write into the product master's 成本价 tier. Its rounding
 * rule and its "no price yet" answer are therefore the two things every one of them depends on.
 */
describe('netUnitPrice', () => {
  it('applies the discount to the supply price at the six decimals `unit_price` carries', () => {
    expect(netUnitPrice('100', '5')).toBe('95.000000')
    expect(netUnitPrice('12.5', '0')).toBe('12.500000')
    expect(netUnitPrice('12.5', null)).toBe('12.500000')
    expect(netUnitPrice(12.5, 3.75)).toBe('12.031250')
    // 12.345678 × 0.95 = 11.7283941 — rounded to the column's scale, not to float noise.
    expect(netUnitPrice('12.345678', '5')).toBe('11.728394')
  })

  it('has no net for a missing or unparseable price, and never invents a zero', () => {
    expect(netUnitPrice('', '5')).toBeNull()
    expect(netUnitPrice('   ', '5')).toBeNull()
    expect(netUnitPrice(null, '5')).toBeNull()
    expect(netUnitPrice(undefined, '5')).toBeNull()
    expect(netUnitPrice('abc', '5')).toBeNull()
  })

  it('reads a missing or unparseable discount as "no discount", never as a silent factor', () => {
    expect(netUnitPrice('10', 'abc')).toBe('10.000000')
    expect(netUnitPrice('10', '')).toBe('10.000000')
    expect(netUnitPrice('10', undefined)).toBe('10.000000')
  })
})

describe('pickBasePriceRow', () => {
  it('resolves the row the single price field edits: lowest ladder step, ties by currency code', () => {
    expect(
      pickBasePriceRow([
        { minQuantity: 10, currencyCode: 'CNY' },
        { minQuantity: 1, currencyCode: 'USD' },
        { minQuantity: 1, currencyCode: 'CNY' },
      ]),
    ).toEqual({ minQuantity: 1, currencyCode: 'CNY' })
    // A ladder that starts above 1 still resolves — the lowest step is the one shown and edited.
    expect(pickBasePriceRow([{ minQuantity: 5, currencyCode: 'CNY' }, { minQuantity: 2, currencyCode: 'USD' }])).toEqual({
      minQuantity: 2,
      currencyCode: 'USD',
    })
    expect(pickBasePriceRow([])).toBeNull()
  })

  it('orders two rows the same way the readers do, never flipping on equal data', () => {
    expect(comparePriceBaseRows({ minQuantity: 1, currencyCode: 'CNY' }, { minQuantity: 2, currencyCode: 'CNY' })).toBeLessThan(0)
    expect(comparePriceBaseRows({ minQuantity: 2, currencyCode: 'CNY' }, { minQuantity: 1, currencyCode: 'CNY' })).toBeGreaterThan(0)
    expect(comparePriceBaseRows({ minQuantity: 1, currencyCode: 'CNY' }, { minQuantity: 1, currencyCode: 'CNY' })).toBe(0)
  })
})

describe('trimDecimalText', () => {
  it('renders a numeric(7,4) percentage the way the operator typed it', () => {
    expect(trimDecimalText('5.0000')).toBe('5')
    expect(trimDecimalText('3.7500')).toBe('3.75')
    expect(trimDecimalText('0.0000')).toBe('0')
    expect(trimDecimalText('5')).toBe('5')
  })
})
