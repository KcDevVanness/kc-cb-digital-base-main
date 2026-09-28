import { describe, expect, it } from '@jest/globals'
import {
  computeContractTotals,
  computeLineAmounts,
  isAmountGreaterThan,
  multiplyExactDecimal,
  quantizeExactDecimal,
  subtractExactDecimal,
  sumAmounts,
  toAmountString,
} from '../money'

describe('quantizeExactDecimal', () => {
  it('rounds half away from zero, not to the nearest even digit', () => {
    // 0.025 at two decimals is 0.03 — a banker's-rounding implementation answers 0.02.
    expect(toAmountString({ units: 25n, scale: 3 }, 2)).toBe('0.03')
    expect(toAmountString({ units: 35n, scale: 3 }, 2)).toBe('0.04')
    expect(toAmountString({ units: -15n, scale: 3 }, 2)).toBe('-0.02')
  })

  it('rounds a half away from zero in both directions', () => {
    expect(toAmountString({ units: 5n, scale: 3 }, 2)).toBe('0.01')
    expect(toAmountString({ units: -5n, scale: 3 }, 2)).toBe('-0.01')
  })

  it('truncates a finer value and still half-rounds the remainder', () => {
    // The fourth decimal of 12.3456 is dropped and then rounds the second up.
    expect(toAmountString({ units: 123456n, scale: 4 }, 2)).toBe('12.35')
    // 0.3125 has exactly the half at the third decimal: 0.31, never banker's 0.31/0.32 drift.
    expect(toAmountString({ units: 3125n, scale: 4 }, 2)).toBe('0.31')
  })

  it('leaves a value below the half step unchanged', () => {
    expect(toAmountString({ units: 4999n, scale: 5 }, 2)).toBe('0.05')
    expect(toAmountString({ units: 4949n, scale: 5 }, 2)).toBe('0.05')
  })

  it('scales up without rounding when the target is coarser than the value', () => {
    expect(toAmountString({ units: 5n, scale: 0 }, 4)).toBe('5.0000')
    expect(quantizeExactDecimal({ units: 7n, scale: 1 }, 0)).toEqual({ units: 1n, scale: 0 })
  })
})

describe('exact decimal primitives', () => {
  it('multiplies by adding scales and multiplying units', () => {
    expect(multiplyExactDecimal({ units: 25n, scale: 1 }, { units: 125n, scale: 3 })).toEqual({
      units: 3125n,
      scale: 4,
    })
  })

  it('subtracts exactly, including across different scales', () => {
    expect(subtractExactDecimal({ units: 10001n, scale: 2 }, { units: 10000n, scale: 2 })).toEqual({
      units: 1n,
      scale: 2,
    })
  })

  it('sums at the amount scale (2 decimals)', () => {
    expect(sumAmounts(['0.01', '0.02'])).toBe('0.03')
    expect(sumAmounts(['100.0000', '0.0050'])).toBe('100.01')
  })

  it('refuses a value that is not a finite decimal instead of dropping the line', () => {
    expect(() => sumAmounts(['1.00', 'n/a'])).toThrow(/not a finite decimal/)
  })

  it('compares without binary floating point', () => {
    expect(isAmountGreaterThan('0.30', '0.3')).toBe(false)
    expect(isAmountGreaterThan('3601.20', '3600.00')).toBe(true)
  })
})

describe('computeLineAmounts', () => {
  it('rounds a half-cent up in both calibers', () => {
    const amounts = computeLineAmounts({ quantity: '1', unitPrice: '0.005' })
    expect(amounts.contractAmount).toBe('0.01')
    expect(amounts.financeAmount).toBe('0.01')
  })

  it('does not inherit the binary floating point error that toFixed would produce', () => {
    // The reason this engine exists: the float path loses the cent.
    expect((1.005).toFixed(2)).toBe('1.00')
    expect(computeLineAmounts({ quantity: '1', unitPrice: '1.005' }).contractAmount).toBe('1.01')
  })

  it('truncates the fourth decimal with a half-up rule, never banker’s rounding', () => {
    const amounts = computeLineAmounts({ quantity: '2.5', unitPrice: '0.125' })
    expect(amounts.contractAmount).toBe('0.31')
    expect(amounts.financeAmount).toBe('0.31')
  })

  it('quantizes a four-decimal unit price to a two-decimal amount', () => {
    const amounts = computeLineAmounts({ quantity: '3', unitPrice: '12.3456' })
    expect(amounts.contractAmount).toBe('37.04')
    expect(amounts.financeAmount).toBe('37.04')
  })

  it('gives both calibers the same amount scale whatever the currency', () => {
    const amounts = computeLineAmounts({ quantity: '3', unitPrice: '1200.4' })
    expect(amounts.financeAmount).toBe('3601.20')
    expect(amounts.contractAmount).toBe('3601.20')
  })
})

describe('computeContractTotals', () => {
  it('adds the quantized line calibers and keeps the difference', () => {
    const totals = computeContractTotals([
      { contractAmount: '0.01', financeAmount: '0.01' },
      { contractAmount: '0.02', financeAmount: '0.02' },
    ])
    expect(totals.contractTotal).toBe('0.03')
    expect(totals.financeTotal).toBe('0.03')
    expect(totals.differenceTotal).toBe('0.00')
  })

  it('reports the discrepancy once an invoice line takes over the financial caliber', () => {
    const totals = computeContractTotals([{ contractAmount: '100.01', financeAmount: '100.00' }])
    expect(totals.contractTotal).toBe('100.01')
    expect(totals.financeTotal).toBe('100.00')
    expect(totals.differenceTotal).toBe('0.01')
  })

  it('signs the difference when finance exceeds the contract', () => {
    const totals = computeContractTotals([{ contractAmount: '3601.20', financeAmount: '3620.00' }])
    expect(totals.differenceTotal).toBe('-18.80')
  })

  it('renders zero totals for a contract without lines', () => {
    expect(computeContractTotals([])).toEqual({
      contractTotal: '0.00',
      financeTotal: '0.00',
      differenceTotal: '0.00',
    })
  })
})
