import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@jest/globals'
import { ADS_ENDPOINTS, adsNaturalKey, adsPageSchema, type AdsEndpoint } from '../endpoints/ads'
import { groupOrderLines } from '../adsIngest'

const FIXTURE_FILES: Record<AdsEndpoint, string> = {
  ads_overview: 'overview.json',
  ads_orders: 'orders.json',
  ads_site_sales: 'site-sales.json',
  ads_mp_sales: 'mp-sales.json',
  ads_summary: 'summary.json',
  ads_settlements: 'settlements.json',
  ads_ad_types: 'ad-types.json',
  ads_prices: 'prices.json',
  ads_costs: 'costs.json',
}

function fixture(endpoint: AdsEndpoint): Record<string, unknown> {
  const path = join(__dirname, '..', '..', '__tests__', 'fixtures', 'ads', FIXTURE_FILES[endpoint])
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('ads page schemas', () => {
  it('accepts every fixture as a valid page', () => {
    for (const endpoint of ADS_ENDPOINTS) {
      const parsed = adsPageSchema(endpoint).safeParse(fixture(endpoint))
      expect([endpoint, parsed.success]).toEqual([endpoint, true])
    }
  })

  it('refuses a page without as_of', () => {
    const page = { ...fixture('ads_summary') }
    delete page.as_of
    expect(adsPageSchema('ads_summary').safeParse(page).success).toBe(false)
  })

  it('refuses a price that is not four decimals', () => {
    // §10/§17: unit prices are four-decimal `{ price, currency }` objects, money is two-decimal.
    const page = fixture('ads_prices') as { items: Array<Record<string, unknown>> }
    page.items[0].cost = { price: '29149.00', currency: 'RUB' }
    expect(adsPageSchema('ads_prices').safeParse(page).success).toBe(false)
  })

  it('refuses a money object with a JSON number', () => {
    const page = fixture('ads_overview') as { items: Array<Record<string, unknown>> }
    page.items[0].net_revenue = { amount: 5006199, currency: 'RUB' }
    expect(adsPageSchema('ads_overview').safeParse(page).success).toBe(false)
  })

  it('refuses an unknown order status rather than storing a code nobody defined', () => {
    const page = fixture('ads_orders') as { items: Array<Record<string, unknown>> }
    page.items[0].status = 'в пути'
    expect(adsPageSchema('ads_orders').safeParse(page).success).toBe(false)
  })

  it('refuses an unknown settlement fee type', () => {
    const page = fixture('ads_settlements') as { items: Array<Record<string, unknown>> }
    const lines = page.items[0].lines as Array<Record<string, unknown>>
    lines[0].fee_type = 'неизвестно'
    expect(adsPageSchema('ads_settlements').safeParse(page).success).toBe(false)
  })

  it('accepts a settlement line without amounts — they are optional per the contract', () => {
    const page = fixture('ads_settlements') as { items: Array<Record<string, unknown>> }
    const lines = page.items[0].lines as Array<Record<string, unknown>>
    delete lines[0].fee_amount
    expect(adsPageSchema('ads_settlements').safeParse(page).success).toBe(true)
  })
})

describe('ads natural keys', () => {
  it('follows the contract keys', () => {
    expect(adsNaturalKey('ads_overview', { period_start: '2026-09-15', period_end: '2026-09-28' })).toBe(
      '2026-09-15|2026-09-28',
    )
    expect(adsNaturalKey('ads_orders', { channel: 'ozon', external_order_id: '115236', sku: 'PK44' })).toBe(
      'ozon|115236|PK44',
    )
    expect(adsNaturalKey('ads_summary', { channel: 'total', month: '2026-09', view: 'opiu', metric: 'sales' })).toBe(
      'total|2026-09|opiu|sales',
    )
    expect(adsNaturalKey('ads_prices', { sku: 'PK44', platform: 'ozon' })).toBe('PK44|ozon')
  })

  it('keeps §18 fee-rate rows, which carry no SKU, under a key of their own', () => {
    expect(adsNaturalKey('ads_costs', { sku: null, fee_rates: { acquiring_percent: 4.41 } })).toBe('__fee_rates__')
    expect(adsNaturalKey('ads_costs', { sku: 'PK44' })).toBe('PK44')
  })
})

describe('order grouping for the platform_ops mirror', () => {
  it('sums the line totals of one order into a single mirror row', () => {
    const page = fixture('ads_orders') as { items: Array<Record<string, unknown>> }
    const grouped = groupOrderLines(page.items)
    expect(grouped.size).toBe(1)
    const order = grouped.get('ozon|115236')
    expect(order?.channel).toBe('ozon')
    // 57658.00 + 60000.00 — the discount-adjusted line totals, not the list prices.
    expect(order?.order.netAmount).toBe('117658.00')
    expect(order?.order.currencyCode).toBe('RUB')
    expect(order?.order.status).toBe('DELIVERED')
    expect(order?.order.placedAt).toBe('2026-09-26T18:15:58+03:00')
  })
})
