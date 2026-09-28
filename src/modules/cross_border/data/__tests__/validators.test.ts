import { describe, expect, it } from '@jest/globals'
import { ALLOCATION_QUANTITY_SCALE, shipmentCreateSchema } from '../validators'

const PURCHASE_LINE_ID = '11111111-1111-4111-8111-111111111111'

const allocation = (quantity: unknown) => ({
  purchaseOrderLineId: PURCHASE_LINE_ID,
  quantity,
})

const create = (allocations: unknown[]) => shipmentCreateSchema.safeParse({ allocations })

/**
 * The purchase-order allocation quantity path: at most 4 decimals, normalized onto the column's
 * scale, and an over-precise value is a 400 rather than a silently rounded quantity. These cases
 * pin that contract for the command and the form, which both rely on the validator's normalized
 * string.
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
