import { describe, expect, it } from '@jest/globals'
import { buildCnyRatePairs } from '../providers/openErApi'

/**
 * The pair set the CNY feed publishes.
 *
 * The endpoint quotes everything against CNY (`1 CNY = 0.148751 USD`), while every reader of the app
 * wants the other direction (`1 USD = 6.7226 CNY`) — so both are emitted, and the inversion is pinned
 * here because getting it backwards is a silent factor-of-45 error on every dollar figure.
 */
const TABLE = { USD: 0.148751, HKD: 1.166593, TWD: 4.728132, EUR: 0.12 }
const DATE = new Date('2026-09-24T00:02:32.000Z')

describe('buildCnyRatePairs', () => {
  it('emits both directions for every currency the organization knows', () => {
    const pairs = buildCnyRatePairs(TABLE, new Set(['CNY', 'USD', 'HKD']), DATE)
    expect(pairs.map((pair) => `${pair.fromCurrencyCode}→${pair.toCurrencyCode}`).sort()).toEqual([
      'CNY→HKD',
      'CNY→USD',
      'HKD→CNY',
      'USD→CNY',
    ])
    const usdToCny = pairs.find((pair) => pair.fromCurrencyCode === 'USD')
    expect(Number(usdToCny?.rate)).toBeCloseTo(6.7226, 3)
    const cnyToUsd = pairs.find((pair) => pair.toCurrencyCode === 'USD')
    expect(cnyToUsd?.rate).toBe('0.148751')
  })

  it('skips currencies the organization does not have, and quotes no pair for CNY itself', () => {
    const pairs = buildCnyRatePairs(TABLE, new Set(['CNY', 'USD']), DATE)
    expect(pairs.every((pair) => pair.fromCurrencyCode !== 'EUR' && pair.toCurrencyCode !== 'EUR')).toBe(true)
    expect(pairs.every((pair) => pair.fromCurrencyCode !== 'CNY' || pair.toCurrencyCode !== 'CNY')).toBe(true)
  })

  it('has nothing to say without CNY, and nothing for an unknown or zero quote', () => {
    expect(buildCnyRatePairs(TABLE, new Set(['USD', 'HKD']), DATE)).toEqual([])
    expect(buildCnyRatePairs({ USD: 0 }, new Set(['CNY', 'USD']), DATE)).toEqual([])
    expect(buildCnyRatePairs({}, new Set(['CNY', 'USD']), DATE)).toEqual([])
  })

  it('stamps the provider source and the effective date on every pair', () => {
    const pairs = buildCnyRatePairs(TABLE, new Set(['CNY', 'USD']), DATE)
    expect(pairs).toHaveLength(2)
    for (const pair of pairs) {
      expect(pair.source).toBe('OPEN_ER_API')
      expect(pair.date.toISOString()).toBe(DATE.toISOString())
    }
  })
})
