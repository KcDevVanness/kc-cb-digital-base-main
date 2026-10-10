import { describe, expect, it } from '@jest/globals'
import { changedProductFields, mergePriceRows, toSpecSummary, type DesiredPriceRow } from '../supplierMapping'

/**
 * The master's write contract for supplier-sourced fields, shared by the quotation promotion
 * (`sourcing`) and the library sync (`purchasing`). These cases are the ones both paths depend on:
 * a blank supplier value never erases a curated field, and a price submission keeps the tiers it
 * does not mention.
 */
describe('supplierMapping', () => {
  const EMPTY_PRODUCT = {
    name: null,
    nameEn: null,
    specSummary: null,
    hsCode: null,
    unit: null,
    netWeight: null,
    grossWeight: null,
    volume: null,
    dimensions: null,
    cartonQuantity: null,
  }

  const purchaseRow = (overrides: Partial<DesiredPriceRow> = {}): DesiredPriceRow => ({
    tier: 'purchase',
    currencyCode: 'CNY',
    minQuantity: 500,
    unitPrice: '230.000000',
    startsAt: null,
    endsAt: null,
    isActive: true,
    ...overrides,
  })

  it('never sends an empty value over an existing product field', () => {
    expect(changedProductFields(EMPTY_PRODUCT, {
      name: null, nameEn: null, specSummary: null, hsCode: null, unit: null, netWeight: null,
      grossWeight: null, volume: null, dimensions: null, cartonQuantity: null,
    })).toEqual({})
    const values = {
      name: 'New name', nameEn: null, specSummary: null, hsCode: null, unit: null, netWeight: null,
      grossWeight: null, volume: null, dimensions: null, cartonQuantity: null,
    }
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'Old name' }, values)).toEqual({ name: 'New name' })
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'New name' }, values)).toEqual({})
  })

  it('compares decimal strings numerically instead of textually', () => {
    const values = {
      name: null, nameEn: null, specSummary: null, hsCode: null, unit: null, netWeight: '1.28',
      grossWeight: '1.8400', volume: '88642', dimensions: null, cartonQuantity: null,
    }
    expect(changedProductFields({
      ...EMPTY_PRODUCT, netWeight: '1.2800', grossWeight: '1.8400', volume: '88642',
    }, values)).toEqual({})
    expect(changedProductFields({ ...EMPTY_PRODUCT, netWeight: '0.9000', grossWeight: null }, values)).toEqual({
      netWeight: '1.28',
      grossWeight: '1.8400',
      volume: '88642',
    })
  })

  it('sends a carton quantity only when it differs from the stored one', () => {
    const values = {
      name: null, nameEn: null, specSummary: null, hsCode: null, unit: null, netWeight: null,
      grossWeight: null, volume: null, dimensions: null, cartonQuantity: 12,
    }
    expect(changedProductFields({ ...EMPTY_PRODUCT, cartonQuantity: 12 }, values)).toEqual({})
    expect(changedProductFields({ ...EMPTY_PRODUCT, cartonQuantity: 6 }, values)).toEqual({ cartonQuantity: 12 })
  })

  it('collapses a multi-line supplier description into the master spec summary', () => {
    expect(toSpecSummary('Material: ABS, SUS304\nCapacity: 1.8L\n\nPower: 5V 1A')).toBe(
      'Material: ABS, SUS304 / Capacity: 1.8L / Power: 5V 1A',
    )
    expect(toSpecSummary('   ')).toBeNull()
  })

  it('merges the purchase row into the existing price set without touching other tiers', () => {
    const existing = [
      { id: 'p1', tier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: '230.000000', startsAt: null, endsAt: null, isActive: true },
      { id: 'i1', tier: 'internal', currencyCode: 'CNY', minQuantity: 1, unitPrice: '310.500000', startsAt: null, endsAt: null, isActive: true },
      { id: 'e1', tier: 'export', currencyCode: 'USD', minQuantity: 1, unitPrice: '49.900000', startsAt: null, endsAt: null, isActive: true },
    ]
    const updated = mergePriceRows(existing, purchaseRow({ unitPrice: '244.750000' }))
    expect(updated.changed).toBe(true)
    expect(updated.rows).toHaveLength(3)
    // The payload identifies a row by `(tier, currency, min quantity)`: no id is echoed.
    expect(updated.rows.every((row) => !('id' in row))).toBe(true)
    expect(updated.rows.find((row) => row.tier === 'purchase' && row.minQuantity === 500)).toMatchObject({
      unitPrice: '244.750000',
      isActive: true,
    })
    // the other tiers are submitted unchanged, which is what keeps `replace` from closing them
    expect(updated.rows.find((row) => row.tier === 'internal')).toMatchObject({ unitPrice: '310.500000', isActive: true })
    expect(updated.rows.find((row) => row.tier === 'export')).toMatchObject({ currencyCode: 'USD', isActive: true })

    // a new MOQ rung is appended rather than replacing the existing one
    const secondRung = mergePriceRows(existing, purchaseRow({ minQuantity: 1, unitPrice: '250.000000' }))
    expect(secondRung.rows).toHaveLength(4)
    expect(secondRung.rows.filter((row) => row.tier === 'purchase')).toHaveLength(2)
  })

  it('compares prices as exact scaled integers, never as floats', () => {
    const huge = '10000000000000.0001'
    const next = '10000000000000.0002'
    // The trap the old `Number(a) === Number(b)` comparison fell into: these are two different
    // prices, but they are the same IEEE double.
    expect(Number(huge) === Number(next)).toBe(true)

    const existing = [
      { id: 'p1', tier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: huge, startsAt: null, endsAt: null, isActive: true },
    ]
    expect(mergePriceRows(existing, purchaseRow({ unitPrice: next })).changed).toBe(true)
    // the same price spelled with a finer scale is not rewritten
    expect(mergePriceRows(existing, purchaseRow({ unitPrice: '10000000000000.00010' })).changed).toBe(false)
  })

  it('reports no change when the quoted price already matches the stored one', () => {
    const existing = [
      { id: 'p1', tier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: '230.000000', startsAt: null, endsAt: null, isActive: true },
    ]
    const same = mergePriceRows(existing, purchaseRow({ unitPrice: '230' }))
    expect(same.changed).toBe(false)
    expect(same.rows).toHaveLength(1)
    // an inactive row is not resurrected silently by a matching price
    const inactive = mergePriceRows([{ ...existing[0], isActive: false }], purchaseRow({ unitPrice: '230' }))
    expect(inactive.changed).toBe(true)
  })
})
