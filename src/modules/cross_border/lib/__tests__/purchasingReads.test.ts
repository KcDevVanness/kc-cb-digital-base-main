import { describe, expect, it } from '@jest/globals'
import {
  allocationExceedsOrderedQuantity,
  sumAllocationQuantities,
} from '../purchasingReads'

/**
 * The over-allocation guard and the allocated-quantity aggregate are the two places where a
 * purchase-order allocation used to be decided by floats (a `+ 1e-6` tolerance and a
 * `parseFloat` sum). Both now run on scaled integers at the allocation quantity scale, so the
 * boundary is exact and the same value decides the same way on every machine.
 */
describe('cross_border allocated quantity sum', () => {
  it('sums exact decimals without float residue', () => {
    expect(sumAllocationQuantities(['0.1', '0.2'])).toBe('0.3000')
    expect(sumAllocationQuantities(['1.5', '2.25', '0.0001'])).toBe('3.7501')
  })

  it('renders the sum at the allocation quantity scale, including the empty case', () => {
    expect(sumAllocationQuantities([])).toBe('0.0000')
    expect(sumAllocationQuantities(['12'])).toBe('12.0000')
    expect(sumAllocationQuantities([null, undefined, '0'])).toBe('0.0000')
  })
})

describe('cross_border allocation over-allocation guard', () => {
  it('accepts an allocation that lands exactly on the ordered quantity', () => {
    expect(allocationExceedsOrderedQuantity('12.0000', '10.0000', '2.0000')).toBe(false)
    expect(allocationExceedsOrderedQuantity('12.0000', '0.0000', '12.0000')).toBe(false)
  })

  it('refuses an allocation a ten-thousandth over what is left of the order', () => {
    expect(allocationExceedsOrderedQuantity('12.0000', '10.0000', '2.0001')).toBe(true)
    expect(allocationExceedsOrderedQuantity('12.0000', '11.9999', '0.0002')).toBe(true)
  })

  it('judges the boundary exactly where float arithmetic would not', () => {
    // The residue the old `committed + Number(quantity) > ordered + 1e-6` guard inherited: with
    // the tolerance the difference was invisible, and without it the string-to-float comparison
    // depends on the machine's arithmetic.
    expect(0.1 + 0.2 > 0.3).toBe(true)
    expect(allocationExceedsOrderedQuantity('0.3000', '0.1000', '0.2000')).toBe(false)
  })
})
