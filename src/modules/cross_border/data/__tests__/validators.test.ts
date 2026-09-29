import { describe, expect, it } from '@jest/globals'
import { ALLOCATION_QUANTITY_SCALE, shipmentCreateSchema } from '../validators'

const PURCHASE_LINE_ID = '11111111-1111-4111-8111-111111111111'
const SALES_ORDER_ID = '22222222-2222-4222-8222-222222222222'
const SALES_LINE_ID = '33333333-3333-4333-8333-333333333333'
const CATALOG_PRODUCT_ID = '44444444-4444-4444-8444-444444444444'

const allocation = (quantity: unknown) => ({
  purchaseOrderLineId: PURCHASE_LINE_ID,
  quantity,
})

const salesAllocation = (quantity: unknown, unitPrice: unknown = null) => ({
  salesOrderId: SALES_ORDER_ID,
  salesOrderLineId: SALES_LINE_ID,
  catalogProductId: CATALOG_PRODUCT_ID,
  quantity,
  unitPrice,
})

const create = (allocations: unknown[], salesAllocations: unknown[] = []) =>
  shipmentCreateSchema.safeParse({ allocations, salesAllocations })

/**
 * The two quantity paths (purchase-order allocation and internal-sales allocation) share one
 * caliber: at most 4 decimals, normalized onto the column's scale, and an over-precise value is a
 * 400 rather than a silently rounded quantity. These cases pin that contract for the command and
 * the form, which both rely on the validator's normalized string.
 */
describe('cross_border purchase allocation quantity validator', () => {
  it('normalizes strings and numbers onto the quantity column scale', () => {
    expect(ALLOCATION_QUANTITY_SCALE).toBe(4)
    const parsed = create([allocation('12'), allocation('1.5'), allocation(7), allocation('0.0001')])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.allocations.map((row) => row.quantity)).toEqual([
      '12.0000',
      '1.5000',
      '7.0000',
      '0.0001',
    ])
  })

  it('rejects a quantity with a fifth decimal instead of rounding it', () => {
    const parsed = create([allocation('12.34567')])
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(JSON.stringify(parsed.error.issues)).toContain('at most 4 decimal places')
  })

  it('rejects float artifacts and exponent strings instead of reading them through a float', () => {
    for (const quantity of [0.30000000000000004, '1e-7', '1.00005', 'abc', '']) {
      expect(create([allocation(quantity)]).success).toBe(false)
    }
  })

  it('rejects a zero or negative quantity, since a shipment allocates at least one unit', () => {
    for (const quantity of ['0', '0.0000', -1, '-0.0001']) {
      expect(create([allocation(quantity)]).success).toBe(false)
    }
  })
})

describe('cross_border sales allocation decimal validator', () => {
  it('keeps the quantity exact at the quantity scale and the unit price at the 4-decimal price scale', () => {
    const parsed = create([allocation('1')], [salesAllocation('1.5', '65.5916')])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.salesAllocations[0].quantity).toBe('1.5000')
    expect(parsed.data.salesAllocations[0].unitPrice).toBe('65.5916')
  })

  it('rejects a unit price finer than the 4-decimal price scale, including the old 6-decimal caliber', () => {
    // The column and the contract both hold 4 decimals; the pre-unification 6-decimal price is
    // now over-precise input and must be refused rather than rounded.
    expect(create([allocation('1')], [salesAllocation('1', '341.238200')]).success).toBe(false)
    expect(create([allocation('1')], [salesAllocation('1', '65.59165')]).success).toBe(false)
    expect(create([allocation('1')], [salesAllocation('1', '65.5916')]).success).toBe(true)
  })
})
