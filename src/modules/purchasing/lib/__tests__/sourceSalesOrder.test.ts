import { describe, expect, it } from '@jest/globals'
import {
  isSourceSalesOrderKind,
  parseSourceOrderParams,
  salesOrderLinesToPurchaseLines,
} from '../sourceSalesOrder'

/**
 * The two pure pieces of the source anchor: the `?orderKind=&orderId=` pair the hub and the workbench
 * link with, and the line mapping a prefill copies.
 *
 * The mapping's whole point is what it does **not** copy — the sales price — so that is pinned here
 * rather than left to the form.
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

describe('salesOrderLinesToPurchaseLines', () => {
  it('copies the product reference and the quantity, and never the sales price', () => {
    const result = salesOrderLinesToPurchaseLines([
      { productId: 'p-1', quantity: '4', unitPriceNet: '120.00', currencyCode: 'CNY' } as never,
    ])

    expect(result.skipped).toBe(0)
    expect(result.lines).toEqual([{ productId: 'p-1', catalogProductId: null, quantity: '4' }])
    expect(Object.keys(result.lines[0])).toEqual(['productId', 'catalogProductId', 'quantity'])
  })

  it('prefers the app-owned product over the catalog bridge when a line carries both', () => {
    const result = salesOrderLinesToPurchaseLines([
      { productId: 'p-1', catalogProductId: 'c-1', quantity: '2' },
    ])

    expect(result.lines[0]).toEqual({ productId: 'p-1', catalogProductId: null, quantity: '2' })
  })

  it('falls back to the catalog reference on a legacy line', () => {
    const result = salesOrderLinesToPurchaseLines([{ catalogProductId: 'c-1', quantity: 3 }])

    expect(result.lines[0]).toEqual({ productId: null, catalogProductId: 'c-1', quantity: '3' })
  })

  it('skips a line with no product reference and counts it', () => {
    const result = salesOrderLinesToPurchaseLines([
      { quantity: '1' },
      { productId: 'p-1', quantity: '1' },
    ])

    expect(result.skipped).toBe(1)
    expect(result.lines).toHaveLength(1)
  })

  it('skips a line whose quantity is missing rather than inventing a number', () => {
    const result = salesOrderLinesToPurchaseLines([{ productId: 'p-1', quantity: null }])

    expect(result.skipped).toBe(1)
    expect(result.lines).toEqual([])
  })

  it('reads the snake_case keys the installed API returns', () => {
    const result = salesOrderLinesToPurchaseLines([
      { product_id: 'p-2', catalog_product_id: 'c-2', quantity: '7' },
    ])

    expect(result.lines[0]).toEqual({ productId: 'p-2', catalogProductId: null, quantity: '7' })
  })
})
