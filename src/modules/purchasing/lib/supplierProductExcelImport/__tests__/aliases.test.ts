import { describe, expect, it } from '@jest/globals'
import {
  SUPPLIER_PRODUCT_IMPORT_ALIASES,
  SUPPLIER_PRODUCT_IMPORT_FIELDS,
  isUnsupportedPriceHeader,
  matchImportHeader,
  normalizeHeaderLabel,
} from '../aliases'

/**
 * The header dictionary.
 *
 * Two properties matter more than any single label: an exact label can never be stolen by another
 * field's synonym (a sheet's 供应商货号 must not be read as our own SKU), and every field of the create
 * contract has at least one canonical label, so "unknown column" always means the sheet really did not
 * name it.
 */
describe('normalizeHeaderLabel', () => {
  it.each([
    ['品名（中文）', '品名中文'],
    ['  品名  （中文） ', '品名中文'],
    ['N.W.', 'nw'],
    ['Single Price (USD)', 'singlepriceusd'],
    ['QTY/CTN', 'qtyctn'],
    ['H.S.编码', 'hs编码'],
  ])('folds %s to a comparable key', (label, expected) => {
    expect(normalizeHeaderLabel(label)).toBe(expected)
  })

  it('is idempotent and empty for blank input', () => {
    expect(normalizeHeaderLabel('   ')).toBe('')
    expect(normalizeHeaderLabel(normalizeHeaderLabel('每箱数量 (PCS)'))).toBe(normalizeHeaderLabel('每箱数量 (PCS)'))
  })
})

describe('matchImportHeader', () => {
  it.each([
    ['供应商货号', 'itemNo', 'exact'],
    ['Supplier Item No', 'itemNo', 'exact'],
    ['货号', 'itemNo', 'alias'],
    ['商品 SKU', 'supplierSku', 'exact'],
    ['SKU', 'supplierSku', 'alias'],
    ['品名（中文）', 'nameZh', 'exact'],
    ['中文品名', 'nameZh', 'exact'],
    ['品名（英文）', 'nameEn', 'exact'],
    ['单位', 'unit', 'exact'],
    ['Unit', 'unit', 'exact'],
    ['每箱数量', 'cartonQuantity', 'exact'],
    ['装箱数', 'cartonQuantity', 'alias'],
    ['最小起订量', 'moqQuantity', 'exact'],
    ['MOQ', 'moqQuantity', 'exact'],
    ['单件净重', 'unitNetWeight', 'exact'],
    ['N.W.', 'unitNetWeight', 'exact'],
    ['G.W.', 'unitGrossWeight', 'exact'],
    ['体积', 'unitVolume', 'alias'],
    ['申报要素', 'declarationElements', 'exact'],
    ['HS编码', 'hsCode', 'alias'],
    ['折扣', 'discountPercent', 'exact'],
  ])('reads %s as %s (%s)', (header, field, level) => {
    expect(matchImportHeader(header)).toMatchObject({ field, level })
  })

  it('never lets a synonym override another field’s exact label', () => {
    // 商品编码 is this business's HS code wording, and 供应商货号 is the supplier's own number.
    expect(matchImportHeader('商品编码')).toMatchObject({ field: 'hsCode' })
    expect(matchImportHeader('供应商货号')).toMatchObject({ field: 'itemNo' })
  })

  it.each([['颜色'], ['Color'], ['备注'], ['工厂交期'], ['']])('ignores an unknown header %s', (header) => {
    expect(matchImportHeader(header)).toBeNull()
  })
})

describe('the catalog itself', () => {
  it('covers every field of the import contract exactly once', () => {
    const catalogFields = SUPPLIER_PRODUCT_IMPORT_ALIASES.map((entry) => entry.field).sort()
    expect(catalogFields).toEqual([...SUPPLIER_PRODUCT_IMPORT_FIELDS].sort())
  })

  it('gives every field a canonical label and no two fields the same one', () => {
    const ownerByLabel = new Map<string, string>()
    for (const entry of SUPPLIER_PRODUCT_IMPORT_ALIASES) {
      expect(entry.exact.length).toBeGreaterThan(0)
      for (const label of entry.exact) {
        const key = normalizeHeaderLabel(label)
        const owner = ownerByLabel.get(key)
        expect(owner === undefined || owner === entry.field).toBe(true)
        ownerByLabel.set(key, entry.field)
        // A canonical label is read at the exact level, never as somebody's synonym.
        expect(matchImportHeader(label)).toEqual({ field: entry.field, level: 'exact' })
      }
    }
  })
})

describe('isUnsupportedPriceHeader', () => {
  it.each([['供货价'], ['单价'], ['单价(元)'], ['Unit Price'], ['报价'], ['含税单价']])(
    'recognizes the price column %s',
    (header) => {
      expect(isUnsupportedPriceHeader(header)).toBe(true)
    },
  )

  it.each([['品名'], ['单位'], ['']])('does not claim %s', (header) => {
    expect(isUnsupportedPriceHeader(header)).toBe(false)
  })
})
