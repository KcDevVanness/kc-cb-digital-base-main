import { describe, expect, it } from '@jest/globals'
import { isSourceSalesOrderKind, parseSourceOrderParams } from '../sourceOrderParams'

/**
 * The `?orderKind=&orderId=` pair, parsed once for every "create something for this order" entry
 * (the purchase-order form, the shipment form, the contract form). Each decision is pinned here
 * because all three callers act on it: an unusable pair opens an empty form and says so.
 */

const params = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
})

describe('parseSourceOrderParams', () => {
  it('reads a usable pair', () => {
    expect(parseSourceOrderParams(params({ orderKind: 'internal_sales_order', orderId: '0f8fad5b-d9cb-469f-a165-70867728950e' })))
      .toEqual({ status: 'ok', kind: 'internal_sales_order', id: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  })

  it('reports "none" when the page was opened without the parameters', () => {
    expect(parseSourceOrderParams(params({}))).toEqual({ status: 'none' })
  })

  it('refuses an unknown kind instead of guessing a trade type', () => {
    expect(parseSourceOrderParams(params({ orderKind: 'vendor_order', orderId: '0f8fad5b-d9cb-469f-a165-70867728950e' })))
      .toEqual({ status: 'invalid', reason: 'kind' })
  })

  it('refuses an id that is not a uuid', () => {
    expect(parseSourceOrderParams(params({ orderKind: 'external_sales_order', orderId: 'ORDER-2026-0001' })))
      .toEqual({ status: 'invalid', reason: 'id' })
  })

  it('refuses half a pair', () => {
    expect(parseSourceOrderParams(params({ orderKind: 'internal_sales_order' })))
      .toEqual({ status: 'invalid', reason: 'incomplete' })
    expect(parseSourceOrderParams(params({ orderId: '0f8fad5b-d9cb-469f-a165-70867728950e' })))
      .toEqual({ status: 'invalid', reason: 'incomplete' })
  })

  it('accepts the kinds it publishes and nothing else', () => {
    expect(isSourceSalesOrderKind('internal_sales_order')).toBe(true)
    expect(isSourceSalesOrderKind('external_sales_order')).toBe(true)
    expect(isSourceSalesOrderKind('internal')).toBe(false)
    expect(isSourceSalesOrderKind(null)).toBe(false)
  })
})

