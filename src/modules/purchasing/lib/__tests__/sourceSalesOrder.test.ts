import { describe, expect, it } from '@jest/globals'

/**
 * The line mapping a purchase-order prefill copies.
 *
 * Its whole point is what it does **not** copy — the sales price, which is what the customer pays —
 * so that is pinned here rather than left to the form. The `?orderKind=&orderId=` parser these
 * entries share lives in `src/lib/orders/__tests__/sourceOrderParams.test.ts`.
 */

import { salesOrderLinesToPurchaseLines } from '../sourceSalesOrder'

describe('salesOrderLinesToPurchaseLines', () => {
  it('copies the product reference and the quantity, and never the sales price', () => {
    const result = salesOrderLinesToPurchaseLines([
      { catalogProductId: 'c-1', quantity: '4', unitPriceNet: '120.00', currencyCode: 'CNY' } as never,
    ])

    expect(result.skipped).toBe(0)
    expect(result.lines).toEqual([{ catalogProductId: 'c-1', quantity: '4' }])
    expect(Object.keys(result.lines[0])).toEqual(['catalogProductId', 'quantity'])
  })

  it('reads the historical productId spelling as the same catalog product id', () => {
    const result = salesOrderLinesToPurchaseLines([{ productId: 'c-1', quantity: '2' }])

    expect(result.lines[0]).toEqual({ catalogProductId: 'c-1', quantity: '2' })
  })

  it('prefers the explicit catalogProductId when a line carries both spellings', () => {
    const result = salesOrderLinesToPurchaseLines([
      { productId: 'old-1', catalogProductId: 'c-1', quantity: '2' },
    ])

    expect(result.lines[0]).toEqual({ catalogProductId: 'c-1', quantity: '2' })
  })

  it('skips a line with no product reference and counts it', () => {
    const result = salesOrderLinesToPurchaseLines([
      { quantity: '1' },
      { catalogProductId: 'c-1', quantity: '1' },
    ])

    expect(result.skipped).toBe(1)
    expect(result.lines).toHaveLength(1)
  })

  it('skips a line whose quantity is missing rather than inventing a number', () => {
    const result = salesOrderLinesToPurchaseLines([{ catalogProductId: 'c-1', quantity: null }])

    expect(result.skipped).toBe(1)
    expect(result.lines).toEqual([])
  })

  it('reads the snake_case keys the installed API returns', () => {
    const result = salesOrderLinesToPurchaseLines([
      { product_id: 'old-2', catalog_product_id: 'c-2', quantity: '7' },
    ])

    expect(result.lines[0]).toEqual({ catalogProductId: 'c-2', quantity: '7' })
  })
})
