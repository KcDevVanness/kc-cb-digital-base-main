import { describe, expect, it } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichers, type CnyEquivalentValue } from '../enrichers'

/**
 * The server-side half of the CNY column.
 *
 * The enricher is what puts the converted number on the wire, so what is pinned here is the amount
 * caliber: `HALF_UP(amount × rate, 2)` through the shared engine — a six-decimal float product (the old
 * shape) would leave `144.536843` on the wire and a double product of `0.145` would round the wrong way.
 */
const emWithRateRows = (rows: unknown[]): EntityManager =>
  ({
    fork: () => ({ getConnection: () => ({ execute: async () => rows }) }),
  }) as unknown as EntityManager

const context = (em: EntityManager): EnricherContext => ({
  em,
  container: {},
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
})

const usdRow = {
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'CNY',
  rate: '6.72264388',
  date: new Date('2026-09-24T00:00:00.000Z'),
  source: 'OPEN_ER_API',
}

describe('currency_policy cny-equivalent enricher', () => {
  it('converts the gross amount as HALF_UP(amount × rate, 2)', async () => {
    const records = [{ id: '1', currencyCode: 'USD', grandTotalGrossAmount: '21.5' }]
    const [enriched] = await enrichers[0]!.enrichMany!(records, context(emWithRateRows([usdRow])))

    const value = (enriched as { _currency_policy: { cnyEquivalent: CnyEquivalentValue } })._currency_policy
      .cnyEquivalent
    expect(value.amount).toBe('144.54')
    expect(value.currencyCode).toBe('USD')
    expect(value.rate).toBe('6.72264388')
    expect(value.date).toBe('2026-09-24T00:00:00.000Z')
    expect(value.source).toBe('OPEN_ER_API')
  })

  it('rounds the product half away from zero, not through a binary float', async () => {
    const records = [{ id: '1', currencyCode: 'EUR', grandTotalGrossAmount: '0.145' }]
    const rows = [{ ...usdRow, fromCurrencyCode: 'EUR', rate: '1' }]
    const [enriched] = await enrichers[0]!.enrichMany!(records, context(emWithRateRows(rows)))

    const value = (enriched as { _currency_policy: { cnyEquivalent: CnyEquivalentValue } })._currency_policy
      .cnyEquivalent
    // `0.145` as a double is 0.14499999999999999…, which rounds to `0.14`.
    expect(value.amount).toBe('0.15')
  })

  it('stays null when there is no rate, when the amount is unusable, or for CNY itself', async () => {
    const records = [
      { id: '1', currencyCode: 'TWD', grandTotalGrossAmount: '5' },
      { id: '2', currencyCode: 'USD', grandTotalGrossAmount: null },
      { id: '3', currencyCode: 'CNY', grandTotalGrossAmount: '10.00' },
    ]
    const enriched = await enrichers[0]!.enrichMany!(records, context(emWithRateRows([usdRow])))

    for (const record of enriched) {
      expect((record as { _currency_policy: { cnyEquivalent: unknown } })._currency_policy.cnyEquivalent).toBeNull()
    }
  })
})
