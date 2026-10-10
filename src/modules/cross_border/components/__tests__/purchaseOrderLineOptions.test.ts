import { describe, expect, it } from '@jest/globals'
import { toPurchaseOrderLineOption } from '../purchaseOrderLineOptions'

/**
 * The mapping the contract-line reference dialog matches on.
 *
 * Regression: the purchase-order line projection renamed its owned-master reference to
 * `catalogProductId` in the single-store cutover (the `product_id` column is dropped), and this
 * mapper kept reading `productId`. Every candidate then carried an empty `productId`, the candidate
 * map stayed empty, and 「从合同引用商品行」 silently offered no purchase line — a no-op with no error.
 */
describe('toPurchaseOrderLineOption', () => {
  it('reads the catalog reference from the key the projection actually sends', () => {
    const option = toPurchaseOrderLineOption({
      id: 'line-1',
      lineNumber: 2,
      catalogProductId: '11111111-1111-1111-1111-111111111111',
      productTitle: 'Steel bracket',
      productSku: 'SKU-9',
      supplierSku: 'SUP-1',
      quantity: '5.0000',
      receivedQuantity: '0.0000',
    })

    expect(option.productId).toBe('11111111-1111-1111-1111-111111111111')
    expect(option.catalogProductId).toBe('11111111-1111-1111-1111-111111111111')
    expect(option.productSku).toBe('SKU-9')
    expect(option.supplierSku).toBe('SUP-1')
    expect(option.quantity).toBe('5.0000')
  })

  it('tolerates the snake_case shape but never invents a reference', () => {
    const snake = toPurchaseOrderLineOption({ id: 'line-2', catalog_product_id: '22222222-2222-2222-2222-222222222222' })
    expect(snake.productId).toBe('22222222-2222-2222-2222-222222222222')

    // A supplier-only line (no owned master) must stay empty: the dialog then shows it as unmatched
    // instead of pairing it with some other product.
    const supplierOnly = toPurchaseOrderLineOption({ id: 'line-3', supplierProductId: 'row-1', supplierSku: 'SUP-2' })
    expect(supplierOnly.productId).toBe('')
    expect(supplierOnly.catalogProductId).toBe('')
    expect(supplierOnly.quantity).toBe('0')
  })
})
