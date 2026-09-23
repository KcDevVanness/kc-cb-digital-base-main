import { describe, expect, it } from '@jest/globals'
import {
  TEMPLATE_COLUMNS,
  TEMPLATE_HEADERS,
  detectColumnMappings,
  inferCurrencyFromHeaders,
  isTemplateHeaderRow,
  mappingsFromColumnMap,
  normalizeHeaderLabel,
  templateColumnMap,
} from '../columnMapping'

/** Header row 4 of `PETKIT Quotation Sheet-2026_NEW.xlsx` (0-based row index 3). */
const PETKIT_HEADERS = [
  'Picture',
  'Item No.& Name',
  'Item No.',
  'HS Code',
  'Description',
  'Inner Packing\n(cm)',
  'Outer Packing\n(cm)',
  'Packing QTY\n(unit)',
  'Unit N.W.\n(kg)',
  'Packing Weight\n(kg)',
  'Unit Cost\nCNY',
  'Suggested RSP',
  'MOQ\npcs',
]

/** Rows 10–12 of `订单表-2026 EXW.xls`: name, CNY/PC price, zero-filled placeholders, real carton data. */
const INVOICE_HEADERS_FOLDED = [
  '  Marks &Nos ',
  null,
  'Descriptions of Goods and Quantities',
  null,
  null,
  'Quantity PCS',
  'Unit Price CNY/PC',
  'Amount CNY',
  '箱数',
  '毛重',
  '净重',
  '体积',
  'G.W.',
  'N.W.',
  'L',
  'W',
  'H',
  'qty/box',
]

const INVOICE_DATA_ROWS = [
  [null, null, 'Eversweet 3 Pro', null, null, null, 230, 0, 0, 0, 0, 0, 14.72, 1.3, 0.46, 0.47, 0.41, 8],
  [null, null, 'Eversweet Max- Wireless', null, null, null, 275, 0, 0, 0, 0, 0, 15.8, 1.33, 0.58, 0.395, 0.455, 8],
  [null, null, 'Cylinder Mat P99038', null, null, null, 68, 0, 0, 0, 0, 0, 10.5, 0.15, 0.46, 0.4, 0.46, 20],
]

function columnMapSummary(headers: (string | null)[], dataRows: readonly (readonly unknown[])[] = []) {
  const result = detectColumnMappings({ headers, dataRows })
  return {
    map: Object.fromEntries(Object.entries(result.columnMap).map(([key, entry]) => [key, entry.sourceIndex])),
    unmapped: result.unmappedColumns,
    duplicates: result.duplicateTargets,
  }
}

describe('columnMapping', () => {
  it('normalizes header labels in English and Chinese', () => {
    expect(normalizeHeaderLabel('  Unit Cost\nCNY ')).toBe('unit cost cny')
    expect(normalizeHeaderLabel('Packing QTY\n(unit)')).toBe('packing qty')
    expect(normalizeHeaderLabel('箱毛重（kg）')).toBe('箱毛重')
    expect(normalizeHeaderLabel('Item No.& Name')).toBe('item no name')
  })

  it('maps the surviving columns of the PetKit quotation sheet and leaves the carton-only ones unmapped', () => {
    const { map, duplicates, unmapped } = columnMapSummary(PETKIT_HEADERS)
    expect(map).toEqual({
      image: 0,
      product_name: 1,
      item_no: 2,
      hs_code: 3,
      description: 4,
      inner_packing: 5,
      carton_quantity: 7,
      unit_net_weight: 8,
      unit_cost: 10,
      suggested_rsp: 11,
      moq: 12,
    })
    expect(duplicates).toEqual([])
    expect(unmapped).toEqual([6, 9])
  })

  it('maps the folded invoice header and leaves the carton-only columns unmapped', () => {
    const { map, duplicates, unmapped } = columnMapSummary(INVOICE_HEADERS_FOLDED, INVOICE_DATA_ROWS)
    expect(map).toEqual({
      marks: 0,
      product_name: 2,
      quantity: 5,
      unit_cost: 6,
      amount: 7,
      // The bare `N.W.` column folds into the surviving per-unit weight field; `G.W.`, `L`/`W`/`H`
      // and the zero-filled 箱数/毛重/净重/体积 placeholders have no surviving target at all.
      unit_net_weight: 13,
      carton_quantity: 17,
    })
    expect(duplicates).toEqual([])
    expect(unmapped).toEqual([8, 9, 10, 11, 12, 14, 15, 16])
  })

  it('reports the confidence of every assignment', () => {
    const columns = detectColumnMappings({ headers: PETKIT_HEADERS }).columns
    expect(columns[0]).toMatchObject({ targetField: 'image', confidence: 'exact', status: 'ignored' })
    expect(columns[10]).toMatchObject({ targetField: 'unit_cost', confidence: 'alias', matchedOn: 'unit cost' })
    expect(columns[12]).toMatchObject({ targetField: 'moq', confidence: 'exact' })
  })

  it('keeps unmapped columns unmapped instead of guessing', () => {
    const { map, unmapped } = columnMapSummary(['Picture', 'Item No.& Name', 'Warranty period', 'Notes about customs'])
    expect(map).toEqual({ image: 0, product_name: 1 })
    expect(unmapped).toEqual([2, 3])
  })

  it('recognizes the standard template header row and its column map', () => {
    expect(isTemplateHeaderRow(TEMPLATE_HEADERS)).toBe(true)
    expect(isTemplateHeaderRow(PETKIT_HEADERS)).toBe(false)
    // The template is the surviving column set: the whole-carton columns are no longer offered.
    expect(TEMPLATE_COLUMNS.map((column) => column.key)).toEqual([
      'item_no',
      'product_name',
      'section',
      'description',
      'hs_code',
      'unit',
      'unit_cost',
      'currency',
      'moq',
      'carton_quantity',
      'unit_net_weight',
      'inner_packing',
    ])
    const columnMap = templateColumnMap(TEMPLATE_HEADERS)
    expect(columnMap.item_no.sourceIndex).toBe(0)
    expect(columnMap.carton_quantity.sourceIndex).toBe(9)
    expect(columnMap.unit_net_weight.sourceIndex).toBe(10)
    expect(columnMap.inner_packing.sourceIndex).toBe(11)
    expect(Object.keys(columnMap)).toHaveLength(TEMPLATE_HEADERS.length)
    // The renamed size header still round-trips through the alias dictionary, not only through the
    // exact template lookup, so a supplier who keeps the label imports without a manual mapping.
    expect(detectColumnMappings({ headers: TEMPLATE_HEADERS }).columnMap.inner_packing.sourceIndex).toBe(11)
  })

  it('re-derives the wizard view for a mapping that came from a saved profile', () => {
    const columnMap = { item_no: { sourceIndex: 2, sourceHeader: 'Item No.' }, unit_cost: { sourceIndex: 10, sourceHeader: 'Unit Cost\nCNY' } }
    const columns = mappingsFromColumnMap(PETKIT_HEADERS, columnMap)
    expect(columns[2]).toMatchObject({ targetField: 'item_no', status: 'mapped' })
    expect(columns[10]).toMatchObject({ targetField: 'unit_cost', status: 'mapped' })
    expect(columns[1]).toMatchObject({ targetField: null, status: 'unmapped' })
  })

  it('infers the quotation currency from header labels', () => {
    expect(inferCurrencyFromHeaders(['Unit Price CNY/PC'])).toBe('CNY')
    expect(inferCurrencyFromHeaders(PETKIT_HEADERS)).toBe('CNY')
    expect(inferCurrencyFromHeaders(['Unit Price USD', 'Amount'])).toBe('USD')
    expect(inferCurrencyFromHeaders(['Item No.', 'Price'])).toBeNull()
  })
})
