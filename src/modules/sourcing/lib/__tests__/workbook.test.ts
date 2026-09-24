import * as XLSX from 'xlsx'
import { detectStructure } from '../headerDetection'
import { WorkbookReadError, layoutSignature, readWorkbook } from '../workbook'
import { describe, expect, it } from '@jest/globals'

const SHEET_NAME = 'quotation sheet'

function buildWorkbookBuffer(bookType: 'xlsx' | 'biff8'): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Product Quotation from PETKIT'],
    ['Item No.& Name', 'Item No.', 'Unit Cost\nCNY', 'MOQ\npcs'],
    ['Eversweet 3 Pro\n(Wireless Pump)', 'P4108', 230, 500],
    ['Fountain Cube\n3pcs', 'P41171', 42, 100],
    ['Fountain Cube\n5pcs', null, 69, 100],
    ['FEEDING'],
    ['Fresh Element SOLO Smart Pet Feeder', 'P570', 250, 200],
    ['TOTAL', null, 0, 0],
  ])
  worksheet['!merges'] = [{ s: { r: 3, c: 1 }, e: { r: 4, c: 1 } }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME)
  return XLSX.write(workbook, { bookType, type: 'buffer' }) as Buffer
}

describe('readWorkbook', () => {
  it.each(['xlsx', 'biff8'] as const)('reads a %s workbook and expands its merges', (bookType) => {
    const parsed = readWorkbook(buildWorkbookBuffer(bookType))
    expect(parsed.sheets).toHaveLength(1)
    const sheet = parsed.sheets[0]
    expect(sheet.name).toBe(SHEET_NAME)
    expect(sheet.merges).toEqual([{ startRow: 3, startColumn: 1, endRow: 4, endColumn: 1 }])
    expect(sheet.rows[3][1]).toBe('P41171')
    expect(sheet.rows[4][1]).toBe('P41171')
    expect(sheet.continuationCells.has('4:1')).toBe(true)
    expect(sheet.continuationCells.has('3:1')).toBe(false)
    expect(sheet.rows[3][2]).toBe(42)
    expect(sheet.rows[5][0]).toBe('FEEDING')
  })

  it('rejects a buffer with no readable cell values', () => {
    for (const buffer of [Buffer.alloc(0), Buffer.from('   \n  \n')]) {
      let caught: unknown
      try {
        readWorkbook(buffer)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(WorkbookReadError)
      expect((caught as WorkbookReadError).reason).toBe('unreadable')
    }
  })

  it('lets sheet detection reject a binary blob that parses as a one-cell text sheet', () => {
    // SheetJS reads unknown bytes as text, so the guard against silently importing junk is
    // structure detection: a workbook without a recognizable header yields no lines.
    const parsed = readWorkbook(Buffer.from([0x00, 0x01, 0x02, 0x03]))
    expect(parsed.sheets).toHaveLength(1)
    expect(detectStructure({ rows: parsed.sheets[0].rows, continuationCells: parsed.sheets[0].continuationCells })).toEqual({
      ok: false,
      reason: 'header_not_found',
    })
  })

  it('refuses a workbook with more sheets than the import supports', () => {
    const workbook = XLSX.utils.book_new()
    for (let index = 0; index < 21; index += 1) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[`sheet ${index}`]]), `sheet-${index}`)
    }
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer
    expect(() => readWorkbook(buffer)).toThrow(/at most 20/)
  })

  it('fingerprints the layout so an unchanged sheet keeps its mapping profile', () => {
    const headers = ['Item No.& Name', 'Item No.', 'Unit Cost\nCNY', 'MOQ\npcs']
    expect(layoutSignature(SHEET_NAME, headers)).toBe(layoutSignature(' Quotation Sheet ', ['item no.& name', 'ITEM NO.', 'unit  cost cny', 'moq pcs']))
    expect(layoutSignature(SHEET_NAME, headers)).not.toBe(layoutSignature(SHEET_NAME, [...headers, 'Picture']))
    expect(layoutSignature(SHEET_NAME, headers)).not.toBe(layoutSignature('price list', headers))
  })
})
