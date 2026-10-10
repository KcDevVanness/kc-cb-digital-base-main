import { describe, expect, it } from '@jest/globals'
import { AMOUNT_SCALE } from '../../../trade_docs/lib/money'
import { QUANTITY_SCALE, sumByCurrency, sumQuantities } from '../summary'

/**
 * The cockpit serves two calibers and must not blur them: **money is the system-wide 2 decimals**
 * (`trade_docs/lib/money.ts`, `.ai/specs/2026-09-28-money-scale-2dp-unification.md`) and **quantities
 * keep 4**. The module used to keep a single local `AMOUNT_SCALE = 4` that did double duty, so the
 * API published `"11988.0000"` where the caliber says `"11988.00"`. These assertions pin the string
 * shape, which is the contract every non-UI consumer reads.
 */
describe('sumByCurrency — the money caliber', () => {
  it('renders a summed amount at the canonical 2 decimals, not 4', () => {
    expect(sumByCurrency([{ amount: '11988.0000', currencyCode: 'RUB' }])).toEqual([
      { currencyCode: 'RUB', amount: '11988.00' },
    ])
  })

  it('keeps every money string in the `^-?\\d+\\.\\d{2}$` shape', () => {
    const totals = sumByCurrency([
      { amount: '100.5', currencyCode: 'RUB' },
      { amount: '0.005', currencyCode: 'RUB' },
      { amount: '250', currencyCode: 'USD' },
      { amount: '-0.005', currencyCode: 'USD' },
    ])

    for (const total of totals) {
      expect(total.amount).toMatch(/^-?\d+\.\d{2}$/)
    }
    expect(totals).toEqual([
      { currencyCode: 'RUB', amount: '100.51' },
      { currencyCode: 'USD', amount: '249.99' },
    ])
  })

  it('never adds across currencies and sorts by code', () => {
    expect(
      sumByCurrency([
        { amount: '10.00', currencyCode: 'USD' },
        { amount: '5.00', currencyCode: 'RUB' },
        { amount: '2.00', currencyCode: 'USD' },
      ]),
    ).toEqual([
      { currencyCode: 'RUB', amount: '5.00' },
      { currencyCode: 'USD', amount: '12.00' },
    ])
  })
})

describe('sumQuantities — the quantity caliber', () => {
  it('counts at 4 decimals, independent of the money scale', () => {
    expect(sumQuantities(['1141.0000'])).toBe('1141.0000')
    expect(sumQuantities(['18', '0.5'])).toBe('18.5000')
    expect(sumQuantities([])).toBe('0.0000')
  })

  it('is a scale of its own, deliberately distinct from the money scale', () => {
    expect(AMOUNT_SCALE).toBe(2)
    expect(QUANTITY_SCALE).toBe(4)
    expect(QUANTITY_SCALE).not.toBe(AMOUNT_SCALE)
  })
})
