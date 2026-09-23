import { detectStructure, resolveSectionLabel } from '../headerDetection'
import { expandMerges, type CellValue } from '../workbook'
import { describe, expect, it } from '@jest/globals'

/**
 * Shape of `PETKIT Quotation Sheet-2026_NEW.xlsx`, rebuilt from the real cell values:
 * three merged letterhead rows, the header on row index 3, a section banner, a vertically
 * merged two-row variant, a three-row merged item that leaves two blank spacer rows, and a
 * trailing one-cell remark row.
 */
function petkitRows(): CellValue[][] {
  const header: CellValue[] = [
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
  const dataRow = (name: string, itemNo: string | null, cost: number | null, moq: string): CellValue[] => [
    null,
    name,
    itemNo,
    '8421219990',
    'Material: ABS, SUS304 stainless steel',
    '21.9*21.9*18.5',
    '46.5*46.5*40',
    8,
    1.28,
    15,
    cost,
    69.99,
    moq,
  ]
  return [
    ['        Product Quotation from PETKIT Network Technology (Shanghai) Co., Ltd.', null, null, null],
    ['Contact Person: Ms. Joyce', null, null, null],
    ['Add: Building 4, No.118 Rongke Road', null, null, null],
    header,
    dataRow('Eversweet 3 Pro\n(Wireless Pump)', 'P4108', 230, '500'),
    dataRow('Eversweet 3 Pro- UVC\n(Wireless Pump)', 'P4108', 270, '500'),
    dataRow('Fountain Cube\n3pcs', 'P41171', 42, '100'),
    [null, 'Fountain Cube\n5pcs', null, null, null, '23.2*10.35*3.1', '49*32.5*34.5', 60, 0.675, '/', 69, 19.99, '100'],
    ['FEEDING'],
    dataRow('Fresh Element SOLO Smart Pet Feeder', 'P570', 250, '200'),
    ['Mixed Cat Litter\n4 bags', '/', '1404909090', '67.66% Tofu litter', '23*50.5*8', '100*120*198', 336, 3.8, 1276.8, 64, 49.99, '10 pallets'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    dataRow('Magnetic Cat Litter Remover\n2pcs', 'P99021', 21, '50'),
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    dataRow('Pet Odor Eliminator N60', 'P9224', 50, '80'),
    ['Remark\n1. Payment term: 30%T/T in advance, 70% before shipment. 2. Lead time 45 days.'],
  ]
}

const PETKIT_MERGES = [
  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 12 },
  { startRow: 3, startColumn: 0, endRow: 3, endColumn: 0 },
  { startRow: 6, startColumn: 0, endRow: 7, endColumn: 0 },
  { startRow: 6, startColumn: 2, endRow: 7, endColumn: 2 },
  { startRow: 6, startColumn: 3, endRow: 7, endColumn: 3 },
  { startRow: 6, startColumn: 4, endRow: 7, endColumn: 4 },
  { startRow: 10, startColumn: 0, endRow: 12, endColumn: 0 },
  { startRow: 10, startColumn: 1, endRow: 12, endColumn: 1 },
]

/** Shape of `订单表-2026 EXW.xls`: two-row header with the units on the second line, footer block. */
function invoiceRows(): CellValue[][] {
  return [
    ['  PETKIT Network Technology (Shanghai) Co., Ltd.'],
    ['Contact Person: Ms.Joyce'],
    ['Tel: + 86 (021) 51355856'],
    ['Add: Building 4, No.118 Rongke Road'],
    ['PROFORMA INVOICE'],
    ['TO: ', 'Guangzhou K.C. International Trade Co., Ltd.', null, null, null, null, 'INVOICE NO.:'],
    [null, 'Add:Room 1101, No. 393, Linjiang Avenue'],
    [null, 'Guangzhou (part: self compiled07)', null, null, null, null, 'DATE: ', '22nd July, 2026'],
    [null],
    ['  Marks &Nos ', null, '     Descriptions of Goods and Quantities', null, null, 'Quantity', 'Unit Price', 'Amount ', '箱数', '毛重', '净重', '体积'],
    [null, null, null, null, null, 'PCS', 'CNY/PC', 'CNY', null, null, null, null, 'G.W.', 'N.W.', 'L', 'W', 'H', 'qty/box'],
    [null, null, 'Eversweet 3 Pro', null, null, null, 230, 0, 0, 0, 0, 0, 14.72, 1.3, 0.46, 0.47, 0.41, 8],
    [null, null, 'Eversweet 3 Pro-UVC', null, null, null, 270, 0, 0, 0, 0, 0, 15, 1.3, 0.465, 0.465, 0.4, 8],
    [null, null, 'Eversweet Max 2', null, null, null, 275, 0, 0, 0, 0, 0, 15.8, 1.33, 0.58, 0.395, 0.455, 8],
    [null, null, null, 'TOTAL', null, 0, null, 0],
    [null, null, 'Subtotal with 3% MKT FEE', null, null, null, null, 0, 0, 0, 0, 0],
    ['LEAD TIME: PRODUCTION FINISHED WITHIN 30 DAYS AFTER DEPOSIT'],
    ['TERMS OF PAYMENT: 30%T/T DEPOSIT AND 70% BEFORE SHIPMENT'],
    ['Account Name: 小佩网络科技（上海）有限公司'],
    ['Account No.: 121915278010501'],
  ]
}

describe('headerDetection', () => {
  it('finds the PetKit header, its section banners and the real data rows', () => {
    const rows = petkitRows()
    const { rows: expanded, continuationCells } = expandMerges({ rows, merges: PETKIT_MERGES })
    const result = detectStructure({ rows: expanded, continuationCells })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { structure } = result
    expect(structure.headerRowIndex).toBe(3)
    expect(structure.unitRowIndex).toBeNull()
    expect(structure.headerCells).toHaveLength(13)
    expect(structure.dataRowIndexes).toEqual([4, 5, 6, 7, 9, 10, 13, 15])
    expect(structure.sections).toEqual([{ rowIndex: 8, label: 'FEEDING' }])
    expect(resolveSectionLabel(structure.sections, 7)).toBeNull()
    expect(resolveSectionLabel(structure.sections, 9)).toBe('FEEDING')
    const reasons = structure.rejectedRows.map((row) => row.reason)
    // Rows 11 and 12 are the spacer rows of the three-row merged item: every one of their
    // cells comes from the merge above, so they are continuation rows, not blank rows.
    expect(reasons.filter((reason) => reason === 'merged_continuation')).toHaveLength(2)
    // The blank row inside the body does not end the table (the real PetKit sheet has two
    // blank spacer rows in the middle of its list, and rows continue after them).
    expect(reasons.filter((reason) => reason === 'blank')).toHaveLength(1)
    expect(reasons.filter((reason) => reason === 'banner')).toHaveLength(1)
    // Rows 0–2 are the letterhead; the trailing one-cell remark row ends the table as a footer.
    expect(reasons.filter((reason) => reason === 'metadata')).toHaveLength(3)
    expect(result.structure.rejectedRows.find((row) => row.rowIndex === 16)).toMatchObject({ reason: 'footer' })
    expect(structure.warnings).toEqual(
      expect.arrayContaining([
        'blank_rows_skipped',
        'merged_continuation_rows_skipped',
        'footer_rows_skipped',
        'metadata_rows_skipped',
      ]),
    )
  })

  it('keeps the body of the merged multi-row item and drops only its spacer rows', () => {
    const rows = petkitRows()
    const { rows: expanded, continuationCells } = expandMerges({ rows, merges: PETKIT_MERGES })
    const result = detectStructure({ rows: expanded, continuationCells })
    if (!result.ok) throw new Error('structure expected')
    expect(expanded[7][2]).toBe('P41171')
    expect(continuationCells.has('7:2')).toBe(true)
    expect(result.structure.dataRowIndexes).toContain(7)
    expect(result.structure.rejectedRows.find((row) => row.rowIndex === 11)).toMatchObject({ reason: 'merged_continuation' })
    expect(result.structure.dataRowIndexes).toContain(13)
    expect(result.structure.dataRowIndexes).toContain(15)
  })

  it('folds the invoice unit row into the header and stops at the footer block', () => {
    const result = detectStructure({ rows: invoiceRows(), continuationCells: new Set<string>() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { structure } = result
    expect(structure.headerRowIndex).toBe(9)
    expect(structure.unitRowIndex).toBe(10)
    expect(structure.dataStartRow).toBe(11)
    expect(structure.headerCells[6]).toBe('Unit Price CNY/PC')
    expect(structure.headerCells[12]).toBe('G.W.')
    expect(structure.headerCells[17]).toBe('qty/box')
    expect(structure.dataRowIndexes).toEqual([11, 12, 13])
    expect(structure.sections).toEqual([])
    expect(structure.rejectedRows).toEqual(
      expect.arrayContaining([
        { rowIndex: 14, reason: 'footer', preview: 'TOTAL' },
        { rowIndex: 15, reason: 'after_footer' },
        { rowIndex: 19, reason: 'after_footer' },
      ]),
    )
    expect(structure.warnings).toContain('unit_row_folded')
    expect(structure.warnings).toContain('footer_rows_skipped')
  })

  it('reports an unusable sheet instead of inventing a header', () => {
    const empty = detectStructure({ rows: [[null, null], [null, null]], continuationCells: new Set<string>() })
    expect(empty).toEqual({ ok: false, reason: 'empty_sheet' })
    const noHeader = detectStructure({
      rows: [
        ['only a single note'],
        [null, null],
      ],
      continuationCells: new Set<string>(),
    })
    expect(noHeader).toEqual({ ok: false, reason: 'header_not_found' })
  })
})
