import { describe, expect, it } from '@jest/globals'

/**
 * The line mapping a purchase-order prefill copies.
 *
 * Its whole point is what it does **not** copy — the sales price, which is what the customer pays —
 * so that is pinned here rather than left to the form. The `?orderKind=&orderId=` parser these
 * entries share lives in `src/lib/orders/__tests__/sourceOrderParams.test.ts`.
 */

import { salesOrderLinesToPurchaseLines } from '../sourceSalesOrder'

/**
 * The line mapping a purchase-order prefill copies. Its whole point is what it does **not** copy —
 * the sales price — so that is pinned here rather than left to the form.
 */

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
