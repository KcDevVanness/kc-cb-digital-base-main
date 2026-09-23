import { describe, expect, it } from '@jest/globals'
import { TEMPLATE_HEADERS, detectColumnMappings, templateColumnMap } from '../columnMapping'
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
  it('builds the invoice lines from the surviving columns', () => {
    const { lines } = buildInvoiceLines()
    expect(lines).toHaveLength(2)
    expect(lines[0].productName).toBe('Eversweet 3 Pro')
    expect(lines[0].cartonQuantity).toBe(8)
    expect(lines[0].unitNetWeight).toBe('1.3')
    expect(lines[0].unitCost).toBe('230')
    expect(lines[0].derivedSku).toBe('eversweet-3-pro')
    expect(lines[0].warnings).toContain('sku_from_name')
    expect(lines[0].rowStatus).toBe('ready')
  })

  it('reads the quoted item size from the template column', () => {
    const rows: CellValue[][] = [
      [...TEMPLATE_HEADERS],
      ['P4108', 'Eversweet 3 Pro', 'DRINKING', 'ABS', '8421219990', 'PCS', 230, 'CNY', 500, 8, 1.28, '21.9*21.9*18.5'],
    ]
    const detection = detectStructure({ rows, continuationCells: new Set() })
    if (!detection.ok) throw new Error(`structure expected, got ${detection.reason}`)
    const columnMap = templateColumnMap(detection.structure.headerCells)
    const { lines } = buildQuoteLines({ rows, structure: detection.structure, columnMap })
    expect(lines).toHaveLength(1)
    expect(lines[0].innerPacking).toEqual({ length: 21.9, width: 21.9, height: 18.5, unit: 'cm' })
    expect(lines[0].cartonQuantity).toBe(8)
    expect(lines[0].unitNetWeight).toBe('1.28')
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
