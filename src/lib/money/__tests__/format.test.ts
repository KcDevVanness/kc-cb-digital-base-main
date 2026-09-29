import { describe, expect, it } from '@jest/globals'
import { formatCnyEquivalent, formatMoneyAmount, formatRateLine } from '../format'

/**
 * The CNY display layer.
 *
 * Money formatting itself is the framework's (`formatCurrency`, covered by the UI package); what is
 * pinned here is what this app adds: the fixed two-decimal money format, the conversion at a stored rate
 * and the audit line under it.
 */
describe('formatMoneyAmount', () => {
  it('always prints two decimals, even for a currency whose CLDR default is zero', () => {
    expect(formatMoneyAmount('1000', 'JPY', 'en-US')).toBe('¥1,000.00')
    expect(formatMoneyAmount(1234.5, 'USD', 'en-US')).toBe('$1,234.50')
  })

  it('falls back to plain two-decimal number formatting for a code that is not ISO-shaped', () => {
    expect(formatMoneyAmount('1234.5', 'ZZZZ', 'en-US')).toBe('1,234.50')
    expect(formatMoneyAmount('1234.5', '', 'en-US')).toBe('1,234.50')
  })

  it('has no display value for empty or non-numeric input', () => {
    expect(formatMoneyAmount('', 'USD', 'en-US')).toBeNull()
    expect(formatMoneyAmount(null, 'USD', 'en-US')).toBeNull()
    expect(formatMoneyAmount('nope', 'USD', 'en-US')).toBeNull()
    expect(formatMoneyAmount(Number.NaN, 'USD', 'en-US')).toBeNull()
  })
})

describe('formatCnyEquivalent', () => {
  it('converts at the stored rate and renders it in the display currency', () => {
    expect(formatCnyEquivalent('21.5', '6.72264388', 'en-US')).toBe('CN¥144.54')
    expect(formatCnyEquivalent('100', '1', 'en-US')).toBe('CN¥100.00')
    expect(formatCnyEquivalent(95, 1, 'en-US')).toBe('CN¥95.00')
  })

  it('rounds the product HALF_UP at 2 decimals through the engine, not through a binary float', () => {
    // 0.145 as a double is 0.14499999999999999…, which Intl would render as CN¥0.14.
    expect(formatCnyEquivalent('0.145', '1', 'en-US')).toBe('CN¥0.15')
    expect(formatCnyEquivalent('0.005', '1', 'en-US')).toBe('CN¥0.01')
    expect(formatCnyEquivalent('1.005', '1', 'en-US')).toBe('CN¥1.01')
  })

  it('falls back to the unconverted amount when the rate is unparseable', () => {
    expect(formatCnyEquivalent('21.5', 'nope', 'en-US')).toBe('CN¥21.50')
  })
})

describe('formatRateLine', () => {
  it('names the pair, the rate and the day it was published', () => {
    expect(formatRateLine('USD', '6.72264388', '2026-09-24T00:02:32.000Z')).toBe(
      '1 USD = 6.722644 CNY · 2026-09-24',
    )
    expect(formatRateLine('hkd', '0.85719698', new Date('2026-09-24T00:00:00.000Z'))).toBe(
      '1 HKD = 0.857197 CNY · 2026-09-24',
    )
  })

  it('prints the rate at six decimals, quantized by the engine', () => {
    // The rate is stored at eight decimals; the line shows six, half away from zero, without trailing-zero loss.
    expect(formatRateLine('USD', '7', '2026-09-24T00:00:00.000Z')).toBe('1 USD = 7.000000 CNY · 2026-09-24')
    expect(formatRateLine('USD', '0.99999999', '2026-09-24T00:00:00.000Z')).toBe(
      '1 USD = 1.000000 CNY · 2026-09-24',
    )
    // An unparseable rate is echoed, never silently replaced by a number.
    expect(formatRateLine('USD', 'nope', '2026-09-24T00:00:00.000Z')).toBe('1 USD = nope CNY · 2026-09-24')
  })
})
