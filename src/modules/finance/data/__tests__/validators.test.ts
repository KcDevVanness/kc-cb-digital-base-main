import { describe, expect, it } from '@jest/globals'
import { expenseCreateSchema, shipmentCostCreateSchema } from '../validators'

/**
 * The finance module's cost amounts.
 *
 * Owner rule (2026-09-28): a cost is an amount, so it is 2 decimals (`numeric(18,2)`) and strictly
 * positive; the exchange rate keeps its own `numeric(18,8)` caliber. Every bound is compared as
 * scaled integers, so a value exactly at the bound passes and a float artifact cannot slip past it.
 */
describe('finance cost validators', () => {
  const cost = {
    shipmentId: '11111111-1111-4111-8111-111111111111',
    costType: 'ocean_freight',
  }

  it('normalizes a cost amount to 2 decimals', () => {
    const parsed = shipmentCostCreateSchema.parse({ ...cost, amount: '1234.56' })
    expect(parsed.amount).toBe('1234.56')
    expect(shipmentCostCreateSchema.parse({ ...cost, amount: '1234.5' }).amount).toBe('1234.50')
    expect(shipmentCostCreateSchema.parse({ ...cost, amount: 900 }).amount).toBe('900.00')
  })

  it('refuses a third decimal, a non-decimal and a negative cost', () => {
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '1234.567' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '0.001' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '1234,56' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '1e3' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '-1.00' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '' }).success).toBe(false)
  })

  it('requires a strictly positive cost amount', () => {
    expect(shipmentCostCreateSchema.safeParse({ ...cost }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '0' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '0.00' }).success).toBe(false)
    // The bound is inclusive and compared exactly: one cent is a cost, a hundredth of it is not.
    expect(shipmentCostCreateSchema.parse({ ...cost, amount: '0.01' }).amount).toBe('0.01')
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '0.009' }).success).toBe(false)
  })

  it('keeps the exchange rate at 8 decimals, positive and non-null when given', () => {
    const parsed = shipmentCostCreateSchema.parse({ ...cost, amount: '10', exchangeRate: '7.12345678' })
    expect(parsed.exchangeRate).toBe('7.12345678')
    expect(shipmentCostCreateSchema.parse({ ...cost, amount: '10', exchangeRate: '7' }).exchangeRate).toBe('7.00000000')
    expect(shipmentCostCreateSchema.parse({ ...cost, amount: '10', exchangeRate: null }).exchangeRate).toBeNull()
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '10', exchangeRate: '7.123456789' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '10', exchangeRate: '0' }).success).toBe(false)
    expect(shipmentCostCreateSchema.safeParse({ ...cost, amount: '10', exchangeRate: '-1' }).success).toBe(false)
  })

  it('holds an expense amount to the same caliber', () => {
    const expense = { expenseType: 'office', periodStart: '2026-09-01', periodEnd: '2026-09-30' }
    expect(expenseCreateSchema.parse({ ...expense, amount: '100.5' }).amount).toBe('100.50')
    expect(expenseCreateSchema.safeParse({ ...expense, amount: '100.555' }).success).toBe(false)
    expect(expenseCreateSchema.safeParse({ ...expense, amount: '0' }).success).toBe(false)
    expect(expenseCreateSchema.parse({ ...expense, amount: '0.01' }).amount).toBe('0.01')
  })
})
