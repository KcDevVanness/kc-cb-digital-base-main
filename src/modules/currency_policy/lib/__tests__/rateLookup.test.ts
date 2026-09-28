import { describe, expect, it } from '@jest/globals'
import { invertRate, resolveCnyRate } from '../rateLookup'

/**
 * The direction rule the whole display rests on.
 *
 * `X→CNY` is what a converted amount multiplies by; a stored `CNY→X` is the fallback and must be
 * inverted. Getting this wrong is a silent factor-of-45 error on a USD price, so the cases below pin the
 * direction, the inversion, the preference order and the "no rate" answer.
 */
const row = (fromCurrencyCode: string, toCurrencyCode: string, rate: string, date = '2026-09-24T00:00:00.000Z', source = 'OPEN_ER_API') => ({
  fromCurrencyCode,
  toCurrencyCode,
  rate,
  date: new Date(date),
  source,
})

describe('resolveCnyRate', () => {
  it('reads a stored X→CNY rate as CNY per one unit of X', () => {
    const resolved = resolveCnyRate('USD', [row('USD', 'CNY', '6.72264388')])
    expect(resolved?.rate).toBe('6.72264388')
    expect(resolved?.inverted).toBe(false)
    expect(resolved?.currencyCode).toBe('USD')
  })

  it('inverts a stored CNY→X rate when the direct direction is absent', () => {
    const resolved = resolveCnyRate('USD', [row('CNY', 'USD', '0.148751')])
    // `1 / 0.148751 = 6.722643881385…` → HALF_UP at 8 decimals — the same figure the direct row carries.
    expect(resolved?.rate).toBe('6.72264388')
    expect(resolved?.inverted).toBe(true)
  })

  it('quantizes the inverted rate to eight decimals through the engine, not a float', () => {
    // 1 / 0.00000001 = 100000000 — an exact 8-decimal string; a float path renders `100000000`.
    expect(resolveCnyRate('HKD', [row('CNY', 'HKD', '0.00000001')])?.rate).toBe('100000000.00000000')
    expect(resolveCnyRate('THB', [row('CNY', 'THB', '3')])?.rate).toBe('0.33333333')
    expect(resolveCnyRate('USD', [row('CNY', 'USD', '0.148751')])?.rate).toMatch(/^-?\d+\.\d{8}$/)
  })

  it('inverts the other direction of the same pair back to a deterministic 8-decimal string', () => {
    // 0.85719698 CNY→HKD mirrors the stored HKD→CNY row: 1.166593 CNY per HKD.
    expect(resolveCnyRate('HKD', [row('CNY', 'HKD', '0.85719698')])?.rate).toBe('1.16659300')
  })

  it('prefers the direct direction over the inverse even when the inverse is newer', () => {
    const resolved = resolveCnyRate('USD', [
      row('USD', 'CNY', '6.7', '2026-09-20T00:00:00.000Z'),
      row('CNY', 'USD', '0.1', '2026-09-24T00:00:00.000Z'),
    ])
    expect(resolved?.rate).toBe('6.7')
    expect(resolved?.inverted).toBe(false)
  })

  it('takes the newest row of the winning direction', () => {
    const resolved = resolveCnyRate('HKD', [
      row('HKD', 'CNY', '0.85', '2026-09-20T00:00:00.000Z'),
      row('HKD', 'CNY', '0.85719698', '2026-09-24T00:00:00.000Z'),
    ])
    expect(resolved?.rate).toBe('0.85719698')
  })

  it('has no rate for CNY itself, for an unknown currency, or for a broken row', () => {
    expect(resolveCnyRate('CNY', [row('USD', 'CNY', '6.7')])).toBeNull()
    expect(resolveCnyRate('TWD', [row('USD', 'CNY', '6.7')])).toBeNull()
    expect(resolveCnyRate('USD', [])).toBeNull()
    expect(resolveCnyRate('USD', [row('USD', 'CNY', '0')])).toBeNull()
    expect(resolveCnyRate('USD', [row('USD', 'CNY', 'not-a-number')])).toBeNull()
    expect(resolveCnyRate('USD', [row('CNY', 'USD', '0')])).toBeNull()
    expect(resolveCnyRate('USD', [row('CNY', 'USD', '-2')])).toBeNull()
    expect(resolveCnyRate('USD', [row('CNY', 'USD', 'nope')])).toBeNull()
  })

  it('normalizes the code it is asked for', () => {
    expect(resolveCnyRate(' usd ', [row('USD', 'CNY', '6.7')])?.currencyCode).toBe('USD')
  })
})

describe('invertRate', () => {
  it('inverts to a deterministic eight-decimal string, half away from zero', () => {
    expect(invertRate('0.148751')).toBe('6.72264388')
    expect(invertRate(4)).toBe('0.25000000')
    expect(invertRate('0.00000001')).toBe('100000000.00000000')
  })

  it('has no inverse for a non-positive or unparseable rate', () => {
    expect(invertRate('0')).toBeNull()
    expect(invertRate('-2')).toBeNull()
    expect(invertRate('')).toBeNull()
    expect(invertRate('nope')).toBeNull()
  })
})
