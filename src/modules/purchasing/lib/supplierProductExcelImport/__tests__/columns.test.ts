import { describe, expect, it } from '@jest/globals'
import { MANUAL_MAPPING_CONFIDENCE } from '../aliases'
import { MAX_HEADER_SCAN_ROWS, buildColumns, detectHeaderRow, suggestTargets } from '../columns'

/**
 * Header row detection and the suggested mapping.
 *
 * A supplier sheet opens with a title block, so the header row is found rather than assumed — and a
 * wrong guess is worse than no guess, which is why a sheet that names nothing known fails with
 * `header_not_found` instead of importing the title block as its first data row.
 */
describe('detectHeaderRow', () => {
  it('finds the header row under a supplier title block', () => {
    const result = detectHeaderRow([
      ['PETKIT 供应商产品表', null, null, null],
      [],
      ['供应商货号', '品名（中文）', '单位', '每箱数量'],
      ['PK-1', '饮水机', 'PCS', 12],
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerRowIndex).toBe(2)
    expect(result.matchedTargets).toBe(4)
    expect(result.headerCells).toEqual(['供应商货号', '品名（中文）', '单位', '每箱数量'])
    expect(result.columns.map((column) => column.target)).toEqual(['itemNo', 'nameZh', 'unit', 'cartonQuantity'])
    expect(result.columns.map((column) => column.matchLevel)).toEqual(['exact', 'exact', 'exact', 'exact'])
  })

  it('prefers the row that names the most columns', () => {
    const result = detectHeaderRow([
      ['产品清单', '单位'],
      ['供应商货号', '品名', '最小起订量'],
      ['PK-1', '饮水机', 100],
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerRowIndex).toBe(1)
    expect(result.matchedTargets).toBe(3)
  })

  it('keeps the earlier row on a tie', () => {
    const result = detectHeaderRow([
      ['品名', '单位'],
      ['品名', '单位'],
      ['饮水机', 'PCS'],
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerRowIndex).toBe(0)
  })

  it('only scans the first rows of the sheet', () => {
    const rows: (string | null)[][] = Array.from({ length: MAX_HEADER_SCAN_ROWS }, () => ['说明文字'])
    rows.push(['供应商货号', '品名'])
    expect(detectHeaderRow(rows)).toEqual({ ok: false, reason: 'header_not_found' })
  })

  it('fails on a sheet that names no known column', () => {
    expect(detectHeaderRow([['颜色', '尺码'], ['红', 'L']])).toEqual({ ok: false, reason: 'header_not_found' })
  })

  it('fails on an empty sheet', () => {
    expect(detectHeaderRow([[null, ''], []])).toEqual({ ok: false, reason: 'empty_sheet' })
    expect(detectHeaderRow([])).toEqual({ ok: false, reason: 'empty_sheet' })
  })

  it('drops padded empty cells at the end of the header row', () => {
    const result = detectHeaderRow([['供应商货号', '品名', null, null], ['PK-1', '饮水机', null, null]])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerCells).toEqual(['供应商货号', '品名'])
    expect(result.columns.map((column) => column.index)).toEqual([0, 1])
  })

  it('reads header cells through the same text normalization as data cells', () => {
    const result = detectHeaderRow([[null, '最小起订量', ' Qty per Carton '], [1, 100, 12]])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerCells).toEqual(['', '最小起订量', 'Qty per Carton'])
    expect(result.columns.map((column) => column.target)).toEqual([null, 'moqQuantity', 'cartonQuantity'])
  })
})

describe('suggestTargets', () => {
  it('gives a field to the stronger claim and ignores the losing duplicate', () => {
    // 品名 is the canonical label of `name`; 商品名称 is only a synonym of the same field.
    const columns = buildColumns(['品名', '商品名称'], suggestTargets(['品名', '商品名称']))

    expect(columns[0]).toMatchObject({ target: 'name', matchLevel: 'exact', confidence: 1 })
    expect(columns[1]).toMatchObject({ target: null, duplicateOf: 0, confidence: 0 })
  })

  it('keeps the leftmost column when both claims are aliases', () => {
    const columns = buildColumns(['货号', 'Item No'], suggestTargets(['货号', 'Item No']))

    expect(columns[0]).toMatchObject({ target: 'itemNo', matchLevel: 'alias' })
    expect(columns[1]).toMatchObject({ target: null, duplicateOf: 0 })
  })

  it('leaves unknown columns unmapped', () => {
    expect(suggestTargets(['颜色', '品名'])).toEqual([null, 'name'])
  })
})

describe('buildColumns', () => {
  it('marks a recognized price column as deliberately unsupported', () => {
    const [sku, price] = buildColumns(['供应商货号', '单价'], [null, null])

    expect(sku).toMatchObject({ target: null, matchLevel: 'exact' })
    expect(price).toEqual({
      index: 1,
      header: '单价',
      target: null,
      confidence: 0,
      matchLevel: 'none',
      unsupported: 'price',
    })
  })

  it('trusts a hand-picked target less than a dictionary hit', () => {
    const [column] = buildColumns(['颜色'], ['description'])

    expect(column).toMatchObject({ target: 'description', matchLevel: 'none', confidence: MANUAL_MAPPING_CONFIDENCE })
  })

  it('carries the operator’s choice through unchanged', () => {
    const [column] = buildColumns(['品名'], ['nameEn'])

    expect(column).toMatchObject({ target: 'nameEn', matchLevel: 'exact', confidence: MANUAL_MAPPING_CONFIDENCE })
  })
})
