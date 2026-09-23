import { describe, expect, it } from '@jest/globals'
import {
  computeContractTotals,
  computeLineAmounts,
  isAmountGreaterThan,
  multiplyExactDecimal,
  quantizeExactDecimal,
  resolveCurrencyScale,
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

  it('sums at the stored amount scale', () => {
    expect(sumAmounts(['0.01', '0.02'])).toBe('0.0300')
    expect(sumAmounts(['100.0000', '0.0050'])).toBe('100.0050')
  })

  it('refuses a value that is not a finite decimal instead of dropping the line', () => {
    expect(() => sumAmounts(['1.00', 'n/a'])).toThrow(/not a finite decimal/)
  })

  it('compares without binary floating point', () => {
    expect(isAmountGreaterThan('0.30', '0.3')).toBe(false)
    expect(isAmountGreaterThan('3601.20', '3600.00')).toBe(true)
  })
})

describe('resolveCurrencyScale', () => {
  it('falls back to two decimals for a missing or non-numeric value', () => {
    expect(resolveCurrencyScale(null)).toBe(2)
    expect(resolveCurrencyScale(undefined)).toBe(2)
    expect(resolveCurrencyScale(Number.NaN)).toBe(2)
  })

  it('honours a zero-decimal currency and clamps the extremes', () => {
    expect(resolveCurrencyScale(0)).toBe(0)
    expect(resolveCurrencyScale(3)).toBe(3)
    expect(resolveCurrencyScale(99)).toBe(8)
    expect(resolveCurrencyScale(-4)).toBe(0)
  })
})

describe('computeLineAmounts', () => {
  it('rounds a half-cent up in both calibers', () => {
    const amounts = computeLineAmounts({ quantity: '1', unitPrice: '0.005', currencyScale: 2 })
    expect(amounts.contractAmount).toBe('0.01')
    expect(amounts.financeAmount).toBe('0.01')
  })

  it('does not inherit the binary floating point error that toFixed would produce', () => {
    // The reason this engine exists: the float path loses the cent.
    expect((1.005).toFixed(2)).toBe('1.00')
    expect(computeLineAmounts({ quantity: '1', unitPrice: '1.005', currencyScale: 2 }).contractAmount).toBe('1.01')
  })

  it('truncates the fourth decimal with a half-up rule, never banker’s rounding', () => {
    const amounts = computeLineAmounts({ quantity: '2.5', unitPrice: '0.125', currencyScale: 2 })
    expect(amounts.contractAmount).toBe('0.31')
    expect(amounts.financeAmount).toBe('0.31')
  })

  it('keeps the two calibers independent on a finer unit price', () => {
    const amounts = computeLineAmounts({ quantity: '3', unitPrice: '12.3456', currencyScale: 2 })
    expect(amounts.contractAmount).toBe('37.04')
    expect(amounts.financeAmount).toBe('37.04')
  })

  it('quantizes the financial caliber to a zero-decimal currency while the contract keeps two', () => {
    const amounts = computeLineAmounts({ quantity: '3', unitPrice: '1200.4', currencyScale: 0 })
    expect(amounts.financeAmount).toBe('3601')
    expect(amounts.contractAmount).toBe('3601.20')
  })

  it('quantizes a three-decimal currency at three places', () => {
    const amounts = computeLineAmounts({ quantity: '2', unitPrice: '1.0005', currencyScale: 3 })
    expect(amounts.financeAmount).toBe('2.001')
    expect(amounts.contractAmount).toBe('2.00')
  })
})

describe('computeContractTotals', () => {
  it('adds the quantized line calibers and keeps the difference', () => {
    const totals = computeContractTotals([
      { contractAmount: '0.01', financeAmount: '0.01' },
      { contractAmount: '0.02', financeAmount: '0.02' },
    ])
    expect(totals.contractTotal).toBe('0.0300')
    expect(totals.financeTotal).toBe('0.0300')
    expect(totals.differenceTotal).toBe('0.0000')
  })

  it('reports the discrepancy once an invoice line takes over the financial caliber', () => {
    const totals = computeContractTotals([{ contractAmount: '100.01', financeAmount: '100.00' }])
    expect(totals.contractTotal).toBe('100.0100')
    expect(totals.financeTotal).toBe('100.0000')
    expect(totals.differenceTotal).toBe('0.0100')
  })

  it('signs the difference when finance exceeds the contract', () => {
    const totals = computeContractTotals([{ contractAmount: '3601.20', financeAmount: '3620.00' }])
    expect(totals.differenceTotal).toBe('-18.8000')
  })

  it('renders zero totals for a contract without lines', () => {
    expect(computeContractTotals([])).toEqual({
      contractTotal: '0.0000',
      financeTotal: '0.0000',
      differenceTotal: '0.0000',
    })
  })
})
