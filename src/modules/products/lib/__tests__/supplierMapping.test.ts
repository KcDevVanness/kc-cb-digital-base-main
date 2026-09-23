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
    dimensions: null,
    cartonQuantity: null,
    cartonDimensions: null,
    cartonGrossWeight: null,
    cartonNetWeight: null,
  }

  const purchaseRow = (overrides: Partial<DesiredPriceRow> = {}): DesiredPriceRow => ({
    priceTier: 'purchase',
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
      dimensions: null, cartonQuantity: null, cartonDimensions: null, cartonGrossWeight: null, cartonNetWeight: null,
    })).toEqual({})
    const values = {
      name: 'New name', nameEn: null, specSummary: null, hsCode: null, unit: null, netWeight: null,
      dimensions: null, cartonQuantity: null, cartonDimensions: null, cartonGrossWeight: null, cartonNetWeight: null,
    }
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'Old name' }, values)).toEqual({ name: 'New name' })
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'New name' }, values)).toEqual({})
  })

  it('compares decimal strings numerically instead of textually', () => {
    const values = {
      name: null, nameEn: null, specSummary: null, hsCode: null, unit: null, netWeight: '1.28',
      dimensions: null, cartonQuantity: null, cartonDimensions: null, cartonGrossWeight: null, cartonNetWeight: null,
    }
    expect(changedProductFields({ ...EMPTY_PRODUCT, netWeight: '1.2800' }, values)).toEqual({})
    expect(changedProductFields({ ...EMPTY_PRODUCT, netWeight: '0.9000' }, values)).toEqual({ netWeight: '1.28' })
  })

  it('collapses a multi-line supplier description into the master spec summary', () => {
    expect(toSpecSummary('Material: ABS, SUS304\nCapacity: 1.8L\n\nPower: 5V 1A')).toBe(
      'Material: ABS, SUS304 / Capacity: 1.8L / Power: 5V 1A',
    )
    expect(toSpecSummary('   ')).toBeNull()
  })

  it('merges the purchase row into the existing price set without touching other tiers', () => {
    const existing = [
      { id: 'p1', priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: '230.000000', startsAt: null, endsAt: null, isActive: true },
      { id: 'i1', priceTier: 'internal', currencyCode: 'CNY', minQuantity: 1, unitPrice: '310.500000', startsAt: null, endsAt: null, isActive: true },
      { id: 'e1', priceTier: 'export', currencyCode: 'USD', minQuantity: 1, unitPrice: '49.900000', startsAt: null, endsAt: null, isActive: true },
    ]
    const updated = mergePriceRows(existing, purchaseRow({ unitPrice: '244.750000' }))
    expect(updated.changed).toBe(true)
    expect(updated.rows).toHaveLength(3)
    expect(updated.rows.find((row) => row.id === 'p1')).toMatchObject({ unitPrice: '244.750000', isActive: true })
    // the other tiers are submitted unchanged, which is what keeps `replace` from deactivating them
    expect(updated.rows.find((row) => row.id === 'i1')).toMatchObject({ priceTier: 'internal', unitPrice: '310.500000', isActive: true })
    expect(updated.rows.find((row) => row.id === 'e1')).toMatchObject({ priceTier: 'export', currencyCode: 'USD', isActive: true })

    // a new MOQ rung is appended rather than replacing the existing one
    const secondRung = mergePriceRows(existing, purchaseRow({ minQuantity: 1, unitPrice: '250.000000' }))
    expect(secondRung.rows).toHaveLength(4)
    expect(secondRung.rows.filter((row) => row.priceTier === 'purchase')).toHaveLength(2)
  })

  it('reports no change when the quoted price already matches the stored one', () => {
    const existing = [
      { id: 'p1', priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: '230.000000', startsAt: null, endsAt: null, isActive: true },
    ]
    const same = mergePriceRows(existing, purchaseRow({ unitPrice: '230' }))
    expect(same.changed).toBe(false)
    expect(same.rows).toHaveLength(1)
    // an inactive row is not resurrected silently by a matching price
    const inactive = mergePriceRows([{ ...existing[0], isActive: false }], purchaseRow({ unitPrice: '230' }))
    expect(inactive.changed).toBe(true)
  })
})
