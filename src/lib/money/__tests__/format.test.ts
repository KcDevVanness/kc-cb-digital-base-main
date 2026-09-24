import { describe, expect, it } from '@jest/globals'
import { formatCnyEquivalent, formatRateLine } from '../format'

/**
 * The CNY display layer.
 *
 * Money formatting itself is the framework's (`formatCurrency`, covered by the UI package), so what is
 * pinned here is only what this app adds: the conversion at a stored rate and the audit line under it.
 */
describe('formatCnyEquivalent', () => {
  it('converts at the stored rate and renders it in the display currency', () => {
    expect(formatCnyEquivalent('21.5', '6.72264388', 'en-US')).toBe('CN¥144.54')
    expect(formatCnyEquivalent('100', '1', 'en-US')).toBe('CN¥100.00')
    expect(formatCnyEquivalent(95, 1, 'en-US')).toBe('CN¥95.00')
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
})
