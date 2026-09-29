import { describe, expect, it } from '@jest/globals'
import { ALLOCATION_QUANTITY_SCALE, documentCreateSchema, documentUpdateSchema, shipmentCreateSchema } from '../validators'

const PURCHASE_LINE_ID = '11111111-1111-4111-8111-111111111111'
const SALES_ORDER_ID = '22222222-2222-4222-8222-222222222222'
const SALES_LINE_ID = '33333333-3333-4333-8333-333333333333'
const CATALOG_PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const SECOND_CONTRACT_ID = '77777777-7777-4777-8777-777777777777'

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

describe('cross_border shipment contract links', () => {
  const CONTRACT_ID = '55555555-5555-4555-8555-555555555555'

  it('defaults to no links and accepts a list of contract ids', () => {
    const withoutLinks = create([allocation('1')])
    expect(withoutLinks.success).toBe(true)
    if (!withoutLinks.success) return
    expect(withoutLinks.data.contracts).toEqual([])

    const withLinks = shipmentCreateSchema.safeParse({
      allocations: [allocation('1')],
      contracts: [{ contractId: CONTRACT_ID }, { contractId: SECOND_CONTRACT_ID }],
    })
    expect(withLinks.success).toBe(true)
    if (!withLinks.success) return
    expect(withLinks.data.contracts.map((row) => row.contractId)).toEqual([CONTRACT_ID, SECOND_CONTRACT_ID])
  })

  it('refuses a link that is not an id', () => {
    const parsed = shipmentCreateSchema.safeParse({
      allocations: [allocation('1')],
      contracts: [{ contractId: 'PC-2026-0001' }],
    })
    expect(parsed.success).toBe(false)
  })
})

describe('cross_border packing-list line validator', () => {
  const DOCUMENT_BASE = {
    shipmentId: '66666666-6666-4666-8666-666666666666',
    docType: 'packing_list' as const,
  }

  it('defaults to no lines and normalizes each measurement onto its column scale', () => {
    const withoutLines = documentCreateSchema.safeParse(DOCUMENT_BASE)
    expect(withoutLines.success).toBe(true)
    if (!withoutLines.success) return
    expect(withoutLines.data.lines).toEqual([])

    const parsed = documentCreateSchema.safeParse({
      ...DOCUMENT_BASE,
      lines: [
        {
          name: 'Fresh Element',
          sku: 'P570',
          quantity: '12',
          cartons: 3,
          grossWeight: '1.5',
          netWeight: '1.2500',
          volume: 88642,
        },
      ],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.lines[0]).toMatchObject({
      quantity: '12.0000',
      cartons: '3',
      grossWeight: '1.5000',
      netWeight: '1.2500',
      volume: '88642',
    })
  })

  it('refuses a fractional carton or volume and an over-precise quantity', () => {
    for (const line of [
      { cartons: '3.5' },
      { volume: '100.5' },
      { quantity: '1.23456' },
      { grossWeight: '1.23456' },
    ]) {
      expect(documentCreateSchema.safeParse({ ...DOCUMENT_BASE, lines: [{ name: 'x', ...line }] }).success).toBe(false)
    }
  })

  it('keeps the line set untouched when an update omits it and replaces the whole set when present', () => {
    const omitted = documentUpdateSchema.safeParse({ id: DOCUMENT_BASE.shipmentId })
    expect(omitted.success).toBe(true)
    if (!omitted.success) return
    expect(omitted.data.lines).toBeUndefined()

    const cleared = documentUpdateSchema.safeParse({ id: DOCUMENT_BASE.shipmentId, lines: [] })
    expect(cleared.success).toBe(true)
    if (!cleared.success) return
    expect(cleared.data.lines).toEqual([])
  })
})
