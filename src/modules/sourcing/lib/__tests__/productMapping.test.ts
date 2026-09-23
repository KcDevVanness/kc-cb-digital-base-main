import { describe, expect, it } from '@jest/globals'
import {
  categoryCodeFromSection,
  changedProductFields,
  desiredPriceRow,
  mergePriceRows,
  quoteLineToProductFields,
} from '../productMapping'

const EMPTY_PRODUCT = {
  name: null,
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

describe('productMapping', () => {
  it('collapses a multi-line description into the product spec summary', () => {
    const fields = quoteLineToProductFields({
      productName: 'Eversweet 3 Pro',
      description: 'Material: ABS, SUS304\nCapacity: 1.8L\n\nPower: 5V 1A',
      hsCode: '8421219990',
      unit: 'PCS',
      unitNetWeight: '1.2800',
      innerPacking: { length: 21.9, width: 21.9, height: 18.5, unit: 'cm' },
      outerPacking: { length: 46.5, width: 46.5, height: 40, unit: 'cm' },
      cartonQuantity: 8,
      cartonGrossWeight: '15.0000',
      cartonNetWeight: '14.0000',
    } as never)
    expect(fields.specSummary).toBe('Material: ABS, SUS304 / Capacity: 1.8L / Power: 5V 1A')
    expect(fields.netWeight).toBe('1.2800')
    expect(fields.dimensions).toEqual({ length: 21.9, width: 21.9, height: 18.5, unit: 'cm' })
    expect(fields.cartonDimensions).toEqual({ length: 46.5, width: 46.5, height: 40, unit: 'cm' })
    expect(fields.cartonQuantity).toBe(8)
  })

  it('never sends an empty value over an existing product field', () => {
    const values = quoteLineToProductFields({ productName: null, description: null, hsCode: null, unit: '', outerPacking: null } as never)
    expect(changedProductFields(EMPTY_PRODUCT, values)).toEqual({})
    const partial = quoteLineToProductFields({ productName: 'New name', description: null } as never)
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'Old name' }, partial)).toEqual({ name: 'New name' })
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'New name' }, partial)).toEqual({})
  })

  it('compares decimal strings numerically instead of textually', () => {
    const values = quoteLineToProductFields({ productName: null, unitNetWeight: '1.28' } as never)
    expect(changedProductFields({ ...EMPTY_PRODUCT, netWeight: '1.2800' }, values)).toEqual({})
    expect(changedProductFields({ ...EMPTY_PRODUCT, netWeight: '0.9000' }, values)).toEqual({ netWeight: '1.28' })
  })

  it('asks for the line currency and MOQ, falling back to the quotation currency and 1', () => {
    expect(desiredPriceRow({ currencyCode: 'usd', moqQuantity: 500, unitCost: '230.000000' } as never, 'CNY')).toMatchObject({
      currencyCode: 'USD',
      minQuantity: 500,
      unitPrice: '230.000000',
    })
    expect(desiredPriceRow({ currencyCode: null, moqQuantity: null, unitCost: null } as never, 'CNY')).toMatchObject({
      currencyCode: 'CNY',
      minQuantity: 1,
      unitPrice: '0',
    })
  })

  it('merges the purchase row into the existing price set without touching other tiers', () => {
    const existing = [
      { id: 'p1', priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: '230.000000', startsAt: null, endsAt: null, isActive: true },
      { id: 'i1', priceTier: 'internal', currencyCode: 'CNY', minQuantity: 1, unitPrice: '310.500000', startsAt: null, endsAt: null, isActive: true },
      { id: 'e1', priceTier: 'export', currencyCode: 'USD', minQuantity: 1, unitPrice: '49.900000', startsAt: null, endsAt: null, isActive: true },
    ]
    const desired = desiredPriceRow({ currencyCode: 'CNY', moqQuantity: 500, unitCost: '244.750000' } as never, 'CNY')

    const updated = mergePriceRows(existing, desired)
    expect(updated.changed).toBe(true)
    expect(updated.rows).toHaveLength(3)
    expect(updated.rows.find((row) => row.id === 'p1')).toMatchObject({ unitPrice: '244.750000', isActive: true })
    // the other tiers are submitted unchanged, which is what keeps `replace` from deactivating them
    expect(updated.rows.find((row) => row.id === 'i1')).toMatchObject({ priceTier: 'internal', unitPrice: '310.500000', isActive: true })
    expect(updated.rows.find((row) => row.id === 'e1')).toMatchObject({ priceTier: 'export', currencyCode: 'USD', isActive: true })

    // a new MOQ rung is appended rather than replacing the existing one
    const secondRung = mergePriceRows(existing, desiredPriceRow({ currencyCode: 'CNY', moqQuantity: 1, unitCost: '250.000000' } as never, 'CNY'))
    expect(secondRung.rows).toHaveLength(4)
    expect(secondRung.rows.filter((row) => row.priceTier === 'purchase')).toHaveLength(2)
  })

  it('reports no change when the quoted price already matches the stored one', () => {
    const existing = [
      { id: 'p1', priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 500, unitPrice: '230.000000', startsAt: null, endsAt: null, isActive: true },
    ]
    const same = mergePriceRows(existing, desiredPriceRow({ currencyCode: 'CNY', moqQuantity: 500, unitCost: '230' } as never, 'CNY'))
    expect(same.changed).toBe(false)
    expect(same.rows).toHaveLength(1)
    // an inactive row is not resurrected silently by a matching price
    const inactive = mergePriceRows([{ ...existing[0], isActive: false }], desiredPriceRow({ currencyCode: 'CNY', moqQuantity: 500, unitCost: '230' } as never, 'CNY'))
    expect(inactive.changed).toBe(true)
  })

  it('turns a section banner into a category code, or refuses one it cannot slug', () => {
    expect(categoryCodeFromSection('FEEDING')).toBe('feeding')
    expect(categoryCodeFromSection('ACCESSORY & PARTS')).toBe('accessory_parts')
    expect(categoryCodeFromSection('猫砂')).toBeNull()
    expect(categoryCodeFromSection(null)).toBeNull()
  })
})
