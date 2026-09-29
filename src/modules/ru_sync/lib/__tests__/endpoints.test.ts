import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@jest/globals'
import {
  SUPPLY_ENDPOINTS,
  supplyNaturalKey,
  supplyPageSchema,
  supplyRowUpdatedAt,
  type SupplyEndpoint,
} from '../endpoints/supply'

const FIXTURE_FILES: Record<SupplyEndpoint, string> = {
  skus: 'skus.json',
  sku_mappings: 'sku-mappings.json',
  stock: 'stock.json',
  in_transit: 'in-transit.json',
  unrecognized_inbound: 'unrecognized-inbound.json',
  plan: 'plan.json',
  shipments: 'shipments.json',
  params: 'params.json',
}

function fixture(endpoint: SupplyEndpoint): Record<string, unknown> {
  const path = join(__dirname, '..', '..', '__tests__', 'fixtures', 'supply', FIXTURE_FILES[endpoint])
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('supply page schemas', () => {
  it('accepts every fixture as a valid page', () => {
    for (const endpoint of SUPPLY_ENDPOINTS) {
      const parsed = supplyPageSchema(endpoint).safeParse(fixture(endpoint))
      expect([endpoint, parsed.success]).toEqual([endpoint, true])
    }
  })

  it('refuses a page without as_of', () => {
    const page = { ...fixture('stock') }
    delete page.as_of
    const parsed = supplyPageSchema('stock').safeParse(page)
    expect(parsed.success).toBe(false)
  })

  it('refuses money as a JSON number', () => {
    // §0.4/§0.6: amounts are decimal strings. A number here is a contract violation, not a nicety.
    const page = fixture('stock') as { items: Array<Record<string, unknown>> }
    page.items[0].stock_value = { amount: 1100000, currency: 'RUB' }
    expect(supplyPageSchema('stock').safeParse(page).success).toBe(false)
  })

  it('refuses an amount with a scale other than two', () => {
    const page = fixture('stock') as { items: Array<Record<string, unknown>> }
    page.items[0].stock_value = { amount: '1100000.000', currency: 'RUB' }
    expect(supplyPageSchema('stock').safeParse(page).success).toBe(false)
  })

  it('refuses an unknown enum code', () => {
    const page = fixture('plan') as { items: Array<Record<string, unknown>> }
    page.items[0].status = 'в пути'
    expect(supplyPageSchema('plan').safeParse(page).success).toBe(false)
  })

  it('refuses an unknown key, which is how a withdrawn `_label` field surfaces', () => {
    // §0.5 withdrew the `_label` mechanism; a payload still carrying one is a contract violation and
    // must not be stored silently.
    const page = fixture('skus') as { items: Array<Record<string, unknown>> }
    page.items[0].name_label = 'Автоматический лоток'
    expect(supplyPageSchema('skus').safeParse(page).success).toBe(false)
  })

  it('accepts a row without updated_at but never invents one', () => {
    const page = fixture('skus') as { items: Array<Record<string, unknown>> }
    delete page.items[0].updated_at
    // The contract marks `updated_at` required, so a row without one fails the page rather than
    // being silently stored with a guessed watermark.
    expect(supplyPageSchema('skus').safeParse(page).success).toBe(false)
    expect(supplyRowUpdatedAt({ updated_at: '2026-09-27T10:00:00+03:00' })).toBe('2026-09-27T10:00:00+03:00')
    expect(supplyRowUpdatedAt({})).toBeNull()
  })
})

describe('natural keys', () => {
  it('uses the key the contract declares', () => {
    expect(supplyNaturalKey('skus', { sku: 'PK44' })).toBe('PK44')
    expect(supplyNaturalKey('stock', { sku: 'PK44' })).toBe('PK44')
    expect(supplyNaturalKey('in_transit', { sku: 'PK44' })).toBe('PK44')
    expect(supplyNaturalKey('plan', { sku: 'PK44' })).toBe('PK44')
    expect(supplyNaturalKey('sku_mappings', { ru_code: 'РК56' })).toBe('РК56')
    expect(supplyNaturalKey('shipments', { number: 'PK26H07P248SJ' })).toBe('PK26H07P248SJ')
    expect(supplyNaturalKey('params', { version: '2026-09-27' })).toBe('2026-09-27')
  })

  it('falls back to the returned sku for §4, whose natural key the contract never declares', () => {
    expect(supplyNaturalKey('unrecognized_inbound', { sku: 'РК56' })).toBe('РК56')
  })
})
