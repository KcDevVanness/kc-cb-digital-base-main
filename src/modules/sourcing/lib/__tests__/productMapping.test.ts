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
    grossWeight: null,
    volume: null,
    dimensions: null,
    cartonQuantity: null,
  }

  it('collapses a multi-line description into the product spec summary', () => {
    const fields = quoteLineToProductFields({
      productName: 'Eversweet 3 Pro',
      description: 'Material: ABS, SUS304\nCapacity: 1.8L\n\nPower: 5V 1A',
      hsCode: '8421219990',
      unit: 'PCS',
      unitNetWeight: '1.2800',
      innerPacking: { length: 21.9, width: 21.9, height: 18.5, unit: 'cm' },
      cartonQuantity: 8,
    } as never)
    expect(fields.specSummary).toBe('Material: ABS, SUS304 / Capacity: 1.8L / Power: 5V 1A')
    expect(fields.netWeight).toBe('1.2800')
    // a line has no G.W. column of its own, so it never proposes a gross weight for the master
    expect(fields.grossWeight).toBeNull()
    // nor a volume: the per-unit cm³ is a library-row column
    expect(fields.volume).toBeNull()
    expect(fields.dimensions).toEqual({ length: 21.9, width: 21.9, height: 18.5, unit: 'cm' })
    expect(fields.cartonQuantity).toBe(8)
    // the master is single-unit data only: a line carries no carton size and no carton weights at
    // all, so nothing carton-shaped beyond Qty/Box can reach a product
    expect(fields).not.toHaveProperty('cartonDimensions')
    // a line never proposes our English name: it does not know one
    expect(fields.nameEn).toBeNull()
  })

  it('never sends an empty line value over an existing product field', () => {
    const values = quoteLineToProductFields({
      productName: null,
      description: null,
      hsCode: null,
      unit: '',
      unitNetWeight: null,
      innerPacking: null,
      cartonQuantity: null,
    } as never)
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
