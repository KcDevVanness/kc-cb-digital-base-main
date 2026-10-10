import { describe, expect, it } from '@jest/globals'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from '@/lib/workbook'
import { supplierProductCreateSchema } from '../../../data/validators'
import { buildColumns } from '../columns'
import {
  MAX_FAILURE_REASON_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  buildImportRows,
  describeImportRowIssues,
  normalizeImportCell,
  pickLibraryValues,
  supplierProductExcelImportSchema,
} from '../rows'

/**
 * Row building: what a cell becomes, which rows survive, and how a row is numbered.
 *
 * The numbering is the point of the whole module — a failure is reported against the row the operator
 * sees in the spreadsheet's gutter, so `firstRowNumber` is carried through instead of the built list's
 * own position.
 */
describe('normalizeImportCell', () => {
  it.each([
    ['1,200 PCS', 'moqQuantity', '1200', undefined],
    ['12 pcs', 'moqQuantity', '12', undefined],
    ['3.0', 'moqQuantity', '3', undefined],
    [240, 'cartonQuantity', '240', undefined],
    ['12.5kg', 'unitNetWeight', '12.5', undefined],
    ['0.405 kg', 'unitGrossWeight', '0.405', undefined],
    ['¥1,234.50', 'unitNetWeight', '1234.50', undefined],
    ['USD 3.5', 'unitGrossWeight', '3.5', undefined],
    ['5%', 'discountPercent', '5', undefined],
    ['-5', 'moqQuantity', '-5', undefined],
    ['8471.30.0000', 'hsCode', '8471.30.0000', undefined],
    ['  饮水机\n(无线泵) ', 'name', '饮水机\n(无线泵)', undefined],
    ['3.5', 'moqQuantity', '3.5', 'invalid_integer'],
    ['100-200', 'moqQuantity', '100-200', 'invalid_integer'],
    ['约100个', 'cartonQuantity', '约100个', 'invalid_integer'],
    ['abc', 'unitNetWeight', 'abc', 'invalid_number'],
    ['46.5*46.5*40cm', 'unitVolume', '46.5*46.5*40cm', 'invalid_number'],
    ['9999999999999', 'unitNetWeight', '9999999999999', 'out_of_range'],
    [3000000000, 'moqQuantity', '3000000000', 'out_of_range'],
  ] as const)('reads %s as %s', (value, field, text, error) => {
    expect(normalizeImportCell(value, field)).toEqual(error === undefined ? { text } : { text, error })
  })

  it.each([[''], ['/'], ['-'], ['—'], ['N/A'], ['n.a.'], ['待定'], ['无'], [null]])(
    'treats %s as an empty cell',
    (value) => {
      expect(normalizeImportCell(value, 'moqQuantity')).toEqual({ text: '' })
      expect(normalizeImportCell(value, 'itemNo')).toEqual({ text: '' })
    },
  )

  it('keeps a numeric cell’s own digits', () => {
    expect(normalizeImportCell(12.3456, 'unitNetWeight')).toEqual({ text: '12.3456' })
    expect(normalizeImportCell(0, 'moqQuantity')).toEqual({ text: '0' })
  })
})

describe('buildImportRows', () => {
  const columns = buildColumns(['供应商货号', '品名', '最小起订量', '单价'], [
    'itemNo',
    'name',
    'moqQuantity',
    null,
  ])

  it('numbers rows from the sheet, skipping blanks without shifting the count', () => {
    const result = buildImportRows({
      rows: [
        ['PK-1', '饮水机', '1,200 PCS', '9.90'],
        [null, null, null, '9.90'],
        [],
        ['PK-2', '滤芯', '10', '3.00'],
      ],
      columns,
      firstRowNumber: 3,
    })

    expect(result.rows.map((row) => row.row)).toEqual([3, 6])
    expect(result.rows[0].values).toEqual({ itemNo: 'PK-1', name: '饮水机', moqQuantity: '1200' })
    expect(result.skippedBlankRows).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('does not import a column without a target', () => {
    const built = buildImportRows({ rows: [['PK-1', '饮水机', '10', '9.90']], columns, firstRowNumber: 2 })

    expect(built.rows[0].values).toEqual({ itemNo: 'PK-1', name: '饮水机', moqQuantity: '10' })
  })

  it('keeps a row whose only mapped value is unreadable, with its reason', () => {
    const built = buildImportRows({ rows: [['PK-1', '饮水机', 'N/A later', null]], columns, firstRowNumber: 2 })

    expect(built.rows).toHaveLength(1)
    expect(built.rows[0].cellErrors).toEqual([{ field: 'moqQuantity', code: 'invalid_integer' }])
  })

  it('caps the rows it builds and says so', () => {
    const built = buildImportRows({
      rows: [['PK-1', 'A', '1', null], ['PK-2', 'B', '2', null], ['PK-3', 'C', '3', null]],
      columns,
      firstRowNumber: 2,
      maxRows: 2,
    })

    expect(built.rows.map((row) => row.values.itemNo)).toEqual(['PK-1', 'PK-2'])
    expect(built.truncated).toBe(true)
  })

  it('ignores a column beyond the column cap and says so', () => {
    const wide = buildColumns(['品名'], ['name'])
    wide.push({
      index: MAX_IMPORT_COLUMNS,
      header: '品名（英文）',
      target: 'nameEn',
      confidence: 1,
      matchLevel: 'exact',
    })
    const built = buildImportRows({ rows: [['饮水机']], columns: wide, firstRowNumber: 2 })

    expect(built.rows[0].values).toEqual({ name: '饮水机' })
    expect(built.truncated).toBe(true)
  })

  it('skips every row when nothing is mapped', () => {
    const built = buildImportRows({
      rows: [['PK-1', '饮水机', '10', null]],
      columns: buildColumns(['供应商货号'], [null]),
      firstRowNumber: 2,
    })

    expect(built.rows).toEqual([])
    expect(built.skippedBlankRows).toBe(1)
  })
})

describe('supplierProductExcelImportSchema', () => {
  it('accepts the row shape the builder produces', () => {
    const built = buildImportRows({
      rows: [['PK-1', '饮水机', '1,200 PCS', null]],
      columns: buildColumns(['供应商货号', '品名', '最小起订量', '单价'], ['itemNo', 'name', 'moqQuantity', null]),
      firstRowNumber: 2,
    })
    const parsed = supplierProductExcelImportSchema.parse({
      supplierId: '3f1c2b90-4f5a-4a1f-9f2b-1c2d3e4f5a6b',
      rows: built.rows.map(({ row, values }) => ({ row, values })),
    })

    expect(parsed.rows[0]).toEqual({ row: 2, values: { itemNo: 'PK-1', name: '饮水机', moqQuantity: '1200' } })
  })

  it('rejects an empty batch and a non-string value', () => {
    const supplierId = '3f1c2b90-4f5a-4a1f-9f2b-1c2d3e4f5a6b'
    expect(supplierProductExcelImportSchema.safeParse({ supplierId, rows: [] }).success).toBe(false)
    expect(
      supplierProductExcelImportSchema.safeParse({ supplierId, rows: [{ row: 1, values: { moqQuantity: 12 } }] })
        .success,
    ).toBe(false)
  })
})

describe('pickLibraryValues', () => {
  it('keeps only known fields and drops empty cells so the contract’s defaults apply', () => {
    expect(
      pickLibraryValues({ supplierSku: 'PK-1', name: '', moqQuantity: '10', row: '5', status: 'inactive' }),
    ).toEqual({ supplierSku: 'PK-1', moqQuantity: '10' })
  })

  it('returns nothing for a row without mapped values', () => {
    expect(pickLibraryValues({ row: '5' })).toEqual({})
  })
})

describe('describeImportRowIssues', () => {
  const SUPPLIER_ID = '3f1c2b90-4f5a-4a1f-9f2b-1c2d3e4f5a6b'
  const parseCreateInput = (values: Record<string, unknown>) =>
    supplierProductCreateSchema.safeParse({ supplierId: SUPPLIER_ID, supplierSku: 'PK-1', name: 'Water dispenser', ...values })

  it('names the field a contract message belongs to, once per field', () => {
    const parsed = parseCreateInput({ unitNetWeight: 'abc' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const reason = describeImportRowIssues(parsed.error)
    // The union behind a nullable decimal reports one issue per branch it tried; the first one is the fix.
    expect(reason.startsWith('unitNetWeight: ')).toBe(true)
    expect(reason.split('; ')).toHaveLength(1)
  })

  it('caps the number of reported fields and the length of the reason', () => {
    const parsed = parseCreateInput({
      moqQuantity: 'three',
      cartonQuantity: 'x',
      unitNetWeight: 'abc',
      unitVolume: 'abc',
      discountPercent: 'abc',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const reason = describeImportRowIssues(parsed.error)
    expect(reason.split('; ')).toHaveLength(3)
    expect(reason.length).toBeLessThanOrEqual(MAX_FAILURE_REASON_LENGTH)
  })
})

describe('the import caps', () => {
  it('match the workbook reader’s, so an accepted sheet always fits a request', () => {
    expect(MAX_IMPORT_ROWS).toBe(MAX_SHEET_ROWS)
    expect(MAX_IMPORT_COLUMNS).toBe(MAX_SHEET_COLUMNS)
  })
})
