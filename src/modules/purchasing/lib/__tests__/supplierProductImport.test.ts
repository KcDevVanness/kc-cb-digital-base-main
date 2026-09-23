import { describe, expect, it } from '@jest/globals'
import {
  changedLibraryFields,
  supplierProductValuesFromLine,
  supplierSkuFromLine,
} from '../supplierProductImport'

const STORED_ROW = {
  itemNo: 'P4108',
  name: 'Eversweet 3 Pro',
  description: 'Material: ABS',
  unit: 'PCS',
  hsCode: '8421219990',
  moqQuantity: 10,
  cartonQuantity: 8,
  unitNetWeight: '1.2800',
  cartonGrossWeight: '15.0000',
  cartonNetWeight: '14.0000',
  innerPacking: { length: 21.9, unit: 'cm' },
  outerPacking: null,
} as never

describe('supplierSkuFromLine', () => {
  it('prefers the derived SKU and trims it', () => {
    expect(supplierSkuFromLine({ derivedSku: '  P4108-UVC ', itemNo: 'P4108' } as never)).toBe('P4108-UVC')
  })

  it('falls back to the supplier item number', () => {
    expect(supplierSkuFromLine({ derivedSku: null, itemNo: ' P4108 ' } as never)).toBe('P4108')
  })

  it('reports a blank code when the line carries neither', () => {
    expect(supplierSkuFromLine({ derivedSku: '   ', itemNo: null } as never)).toBe('')
  })
})

describe('supplierProductValuesFromLine', () => {
  it('maps the wholesale packing cell and drops blank packing parts', () => {
    const values = supplierProductValuesFromLine({
      itemNo: 'P4108',
      productName: ' Eversweet 3 Pro ',
      description: null,
      unit: 'PCS',
      moqQuantity: null,
      innerPacking: { length: 21.9, width: '', height: null, unit: 'cm' },
      outerPacking: { length: '', width: '', height: '', unit: '' },
    } as never)
    expect(values.name).toBe('Eversweet 3 Pro')
    expect(values.innerPacking).toEqual({ length: 21.9, unit: 'cm' })
    expect(values.outerPacking).toBeNull()
  })
})

describe('changedLibraryFields', () => {
  it('never lets a blank source cell erase a stored value', () => {
    const blank = supplierProductValuesFromLine({
      itemNo: null,
      productName: null,
      description: null,
      unit: '',
      hsCode: null,
      moqQuantity: null,
      cartonQuantity: null,
      unitNetWeight: null,
      cartonGrossWeight: null,
      cartonNetWeight: null,
      innerPacking: null,
      outerPacking: null,
    } as never)
    expect(changedLibraryFields(STORED_ROW, blank)).toEqual({})
  })

  it('writes only what differs, comparing decimals numerically and packing deeply', () => {
    const values = supplierProductValuesFromLine({
      itemNo: 'P4108',
      productName: 'Eversweet 3 Pro (2026)',
      unit: 'PCS',
      moqQuantity: 10,
      cartonQuantity: 6,
      unitNetWeight: '1.28',
      cartonGrossWeight: '15.0000',
      innerPacking: { length: 21.9, unit: 'cm' },
      outerPacking: { length: 46.5, unit: 'cm' },
    } as never)
    expect(changedLibraryFields(STORED_ROW, values)).toEqual({
      name: 'Eversweet 3 Pro (2026)',
      cartonQuantity: 6,
      outerPacking: { length: 46.5, unit: 'cm' },
    })
  })
})
