import { describe, expect, it } from '@jest/globals'
import { changedProductFields } from '../../../products/lib/supplierMapping'
import { categoryCodeFromSection, desiredPriceRow, quoteLineToProductFields } from '../productMapping'

/**
 * The quotation line's own half of the master mapping: which columns feed the product fields and
 * how the line's price row is built. The master-side half (non-empty/changed values, the whole
 * price set) is pinned in `products/lib/__tests__/supplierMapping.test.ts`.
 */
describe('sourcing productMapping', () => {
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
    // a line never proposes our English name: it does not know one
    expect(fields.nameEn).toBeNull()
  })

  it('never sends an empty line value over an existing product field', () => {
    const values = quoteLineToProductFields({ productName: null, description: null, hsCode: null, unit: '', outerPacking: null } as never)
    expect(changedProductFields(EMPTY_PRODUCT, values)).toEqual({})
    const partial = quoteLineToProductFields({ productName: 'New name', description: null } as never)
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'Old name' }, partial)).toEqual({ name: 'New name' })
    expect(changedProductFields({ ...EMPTY_PRODUCT, name: 'New name' }, partial)).toEqual({})
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

  it('turns a section banner into a category code, or refuses one it cannot slug', () => {
    expect(categoryCodeFromSection('FEEDING')).toBe('feeding')
    expect(categoryCodeFromSection('ACCESSORY & PARTS')).toBe('accessory_parts')
    expect(categoryCodeFromSection('猫砂')).toBeNull()
    expect(categoryCodeFromSection(null)).toBeNull()
  })
})
