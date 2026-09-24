import { deriveLineSkus, sanitizeSkuCandidate, variantSuffix } from '../skuDerivation'
import { describe, expect, it } from '@jest/globals'

describe('skuDerivation', () => {
  it('keeps the Item No. for the first row of a group and appends the variant token for the rest', () => {
    expect(variantSuffix('Eversweet 3 Pro- UVC\n(Wireless Pump)', 'Eversweet 3 Pro\n(Wireless Pump)')).toBe('UVC')
    expect(variantSuffix('Fountain Cube\n5pcs', 'Fountain Cube\n3pcs')).toBe('5PCS')
    expect(variantSuffix('Urine Monitor Cat Litter\n \n4bags', 'Urine Monitor Cat Litter \n\n2bags')).toBe('4BAGS')
    expect(variantSuffix(' Eversweet Max 2', ' Eversweet Max 2 -')).toBeNull()
  })

  it('derives the SKUs of the duplicate Item No. groups found in the PetKit quotation', () => {
    const derived = deriveLineSkus([
      { itemNo: 'P4108', productName: 'Eversweet 3 Pro\n(Wireless Pump)' },
      { itemNo: 'P4108', productName: 'Eversweet 3 Pro- UVC\n(Wireless Pump)' },
      { itemNo: 'P41171', productName: 'Fountain Cube\n3pcs' },
      { itemNo: 'P41171', productName: 'Fountain Cube\n5pcs' },
      { itemNo: 'PKCL10', productName: 'Urine Monitor Cat Litter \n\n2bags' },
      { itemNo: 'PKCL10', productName: 'Urine Monitor Cat Litter\n \n4bags' },
      { itemNo: 'P4113', productName: 'Wireless Water Pump ' },
      { itemNo: 'P4113', productName: 'Wireless Water Pump UVC' },
      { itemNo: 'P4116', productName: ' Eversweet Max 2 -' },
      { itemNo: 'P4116', productName: ' Eversweet Max 2' },
    ])
    expect(derived.map((entry) => entry.sku)).toEqual([
      'P4108',
      'P4108-UVC',
      'P41171',
      'P41171-5PCS',
      'PKCL10',
      'PKCL10-4BAGS',
      'P4113',
      'P4113-UVC',
      'P4116',
      'P4116-2',
    ])
    expect(derived[9].warnings).toContain('sku_suffix_fallback')
    expect(derived[3].variantLabel).toBe('5PCS')
    expect(derived[1].warnings).toEqual([])
  })

  it('falls back to a name slug when the Item No. is a placeholder, and blocks unusable names', () => {
    const derived = deriveLineSkus([
      { itemNo: '/', productName: 'Mixed Cat Litter\n4 bags' },
      { itemNo: null, productName: '猫砂 4 袋' },
      { itemNo: '/', productName: 'Cat Waste Bag' },
    ])
    expect(derived[0]).toEqual({ sku: 'mixed-cat-litter-4-bags', variantLabel: null, warnings: ['sku_from_name'], generated: true })
    expect(derived[1]).toEqual({ sku: null, variantLabel: null, warnings: ['sku_required'], generated: false })
    expect(derived[2].sku).toBe('cat-waste-bag')
  })

  it('suffixes a collision inside one file so the unique SKU index cannot be violated', () => {
    const derived = deriveLineSkus([
      { itemNo: null, productName: 'Cat Waste Bag' },
      { itemNo: null, productName: 'Cat Waste Bag' },
      { itemNo: 'P99022', productName: 'Litter Sifter Set L1RC' },
      { itemNo: 'P99022', productName: 'Litter Sifter Set L1RC' },
    ])
    expect(derived.map((entry) => entry.sku)).toEqual(['cat-waste-bag', 'cat-waste-bag-2', 'P99022', 'P99022-2'])
    expect(derived[1].warnings).toContain('duplicate_sku_in_file')
    // Two rows of the same Item No. whose names carry no distinguishing token get the ordinal
    // fallback instead, which is the warning the operator has to act on.
    expect(derived[3].warnings).toContain('sku_suffix_fallback')
  })

  it('sanitizes Item No. values into the characters a SKU accepts', () => {
    expect(sanitizeSkuCandidate(' P4108 ')).toBe('P4108')
    expect(sanitizeSkuCandidate('P4117/1')).toBe('P4117/1')
    expect(sanitizeSkuCandidate('PK 2301')).toBe('PK2301')
    expect(sanitizeSkuCandidate('P99026。')).toBe('P99026')
    expect(sanitizeSkuCandidate('/')).toBeNull()
    expect(sanitizeSkuCandidate('')).toBeNull()
    expect(sanitizeSkuCandidate(null)).toBeNull()
  })
})
