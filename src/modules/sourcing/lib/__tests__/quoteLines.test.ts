import { describe, expect, it } from '@jest/globals'
import { detectColumnMappings } from '../columnMapping'
import { detectStructure } from '../headerDetection'
import { buildQuoteLines, resolveLineStatus } from '../quoteLines'
import { expandMerges, type CellValue } from '../workbook'
import { normalizeDimensionTriple } from '../valueNormalization'

/** `订单表-2026 EXW.xls` rows 10–12, including the two-row header with the unit line. */
const INVOICE_ROWS: CellValue[][] = [
  ['PROFORMA INVOICE'],
  ['TO: ', 'Guangzhou K.C. International Trade Co., Ltd.', null, null, null, null, 'INVOICE NO.:'],
  ['  Marks &Nos ', null, '     Descriptions of Goods and Quantities', null, null, 'Quantity', 'Unit Price', 'Amount ', '箱数', '毛重', '净重', '体积'],
  [null, null, null, null, null, 'PCS', 'CNY/PC', 'CNY', null, null, null, null, 'G.W.', 'N.W.', 'L', 'W', 'H', 'qty/box'],
  [null, null, 'Eversweet 3 Pro', null, null, null, 230, 0, 0, 0, 0, 0, 14.72, 1.3, 0.46, 0.47, 0.41, 8],
  [null, null, 'Eversweet Max- Wireless', null, null, null, 275, 0, 0, 0, 0, 0, 15.8, 1.33, 0.58, 0.395, 0.455, 8],
  [null, null, null, 'TOTAL', null, 0, null, 0],
]

function buildInvoiceLines() {
  const { rows, continuationCells } = expandMerges({ rows: INVOICE_ROWS, merges: [] })
  const detection = detectStructure({ rows, continuationCells })
  if (!detection.ok) throw new Error(`structure expected, got ${detection.reason}`)
  const structure = detection.structure
  const dataRows = structure.dataRowIndexes.map((rowIndex) => rows[rowIndex] ?? [])
  const mapping = detectColumnMappings({ headers: structure.headerCells, dataRows })
  return { structure, columnMap: mapping.columnMap, lines: buildQuoteLines({ rows, structure, columnMap: mapping.columnMap }).lines }
}

describe('quoteLines', () => {
  it('normalizes the invoice L/W/H columns from metres to centimetres', () => {
    const { lines } = buildInvoiceLines()
    expect(lines).toHaveLength(2)
    expect(lines[0].productName).toBe('Eversweet 3 Pro')
    expect(lines[0].outerPacking).toEqual({ length: 46, width: 47, height: 41, unit: 'cm' })
    expect(lines[1].outerPacking).toEqual({ length: 58, width: 39.5, height: 45.5, unit: 'cm' })
    expect(lines[0].cartonQuantity).toBe(8)
    expect(lines[0].unitCost).toBe('230')
    expect(lines[0].derivedSku).toBe('eversweet-3-pro')
    expect(lines[0].warnings).toContain('sku_from_name')
    expect(lines[0].rowStatus).toBe('ready')
  })

  it('keeps centimetre values unchanged and refuses an incomplete triple', () => {
    expect(normalizeDimensionTriple(46.5, 46.5, 40)).toEqual({ length: 46.5, width: 46.5, height: 40, unit: 'cm' })
    expect(normalizeDimensionTriple(33, 2, null)).toEqual({ length: 33, width: 2, height: null, unit: 'cm' })
    expect(normalizeDimensionTriple(33, null, null)).toBeNull()
  })

  it('keeps a line without a name and an Item No. out of the promotable set', () => {
    expect(resolveLineStatus({ productName: null, itemNo: null, derivedSku: 'x' })).toBe('invalid')
    expect(resolveLineStatus({ productName: 'Thing', itemNo: null, derivedSku: null })).toBe('invalid')
    expect(resolveLineStatus({ productName: 'Thing', itemNo: null, derivedSku: 'thing' })).toBe('ready')
  })
})
