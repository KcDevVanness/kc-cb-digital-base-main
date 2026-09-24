/**
 * Workbook reading for supplier quotations — the only place in the app that touches the
 * `xlsx` dependency.
 *
 * The repository has no spreadsheet reader of its own (`buildXlsx` in `@open-mercato/core`
 * only writes), and the two reference files are different formats: the PetKit quotation is
 * OOXML while `订单表-2026 EXW.xls` is a legacy BIFF8 compound document written by WPS.
 * SheetJS reads both, which is why it is a dependency; nothing else here depends on it.
 *
 * Everything in this module is server-side only (Node `crypto` for the layout signature);
 * the detection, mapping and normalization modules stay browser-safe because the mapping UI
 * imports their catalogs.
 */

import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'

export type CellValue = string | number | boolean | Date | null

export type MergeRange = {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

export type ParsedSheet = {
  name: string
  index: number
  rows: CellValue[][]
  merges: MergeRange[]
  /** `row:column` keys whose value came from a merged range rather than the cell itself. */
  continuationCells: Set<string>
}

export type ParsedWorkbook = {
  sheets: ParsedSheet[]
}

export const MAX_WORKBOOK_SHEETS = 20
export const MAX_SHEET_ROWS = 20000
export const MAX_SHEET_COLUMNS = 256

export type WorkbookFailureReason = 'unreadable' | 'too_many_sheets' | 'sheet_too_large'

export class WorkbookReadError extends Error {
  readonly reason: WorkbookFailureReason

  constructor(reason: WorkbookFailureReason, message: string) {
    super(message)
    this.name = 'WorkbookReadError'
    this.reason = reason
  }
}

/**
 * Reads a workbook buffer into plain sheets. Bounded on purpose: a 25 MB attachment may
 * expand into an enormous grid, so sheet count, row count and column count are capped and a
 * breach is reported as a readable failure rather than an out-of-memory crash.
 */
export function readWorkbook(buffer: Buffer): ParsedWorkbook {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    throw new WorkbookReadError('unreadable', `The workbook could not be read (${reason}).`)
  }
  const sheetNames = workbook.SheetNames ?? []
  if (sheetNames.length === 0) {
    throw new WorkbookReadError('unreadable', 'The workbook contains no worksheets.')
  }
  if (sheetNames.length > MAX_WORKBOOK_SHEETS) {
    throw new WorkbookReadError('too_many_sheets', `The workbook has ${sheetNames.length} worksheets; at most ${MAX_WORKBOOK_SHEETS} are supported.`)
  }

  const sheets: ParsedSheet[] = []
  sheetNames.forEach((name, index) => {
    const worksheet = workbook.Sheets[name]
    const rows = worksheet
      ? (XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: true,
        }) as CellValue[][])
      : []
    if (rows.length > MAX_SHEET_ROWS) {
      throw new WorkbookReadError('sheet_too_large', `Worksheet "${name}" has ${rows.length} rows; at most ${MAX_SHEET_ROWS} are supported.`)
    }
    const widest = rows.reduce((max, row) => Math.max(max, row ? row.length : 0), 0)
    if (widest > MAX_SHEET_COLUMNS) {
      throw new WorkbookReadError('sheet_too_large', `Worksheet "${name}" has ${widest} columns; at most ${MAX_SHEET_COLUMNS} are supported.`)
    }
    const merges: MergeRange[] = (worksheet?.['!merges'] ?? []).map((merge) => ({
      startRow: merge.s.r,
      startColumn: merge.s.c,
      endRow: merge.e.r,
      endColumn: merge.e.c,
    }))
    const expanded = expandMerges({ rows, merges })
    sheets.push({ name, index, rows: expanded.rows, merges, continuationCells: expanded.continuationCells })
  })

  // SheetJS falls back to CSV/text parsing, so a buffer that is not a spreadsheet at all can
  // still produce a workbook shell. An import must fail loudly instead of yielding no lines.
  const hasContent = sheets.some((sheet) =>
    sheet.rows.some((row) => (row ?? []).some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')),
  )
  if (!hasContent) {
    throw new WorkbookReadError('unreadable', 'The workbook contains no readable cell values.')
  }

  return { sheets }
}

/**
 * Fills every cell of a merged range with the range's top-left value. The PetKit workbook
 * merges the Item No., HS code and description cells of a two-row variant
 * (`Fountain Cube 3pcs` / `Fountain Cube 5pcs`), and `sheet_to_json` leaves the covered
 * cells empty — without this the second row loses its identity columns.
 */
export function expandMerges(input: {
  rows: readonly (readonly CellValue[])[] | undefined
  merges: readonly MergeRange[]
}): { rows: CellValue[][]; continuationCells: Set<string> } {
  const rows: CellValue[][] = (input.rows ?? []).map((row) => (row ? [...row] : []))
  const continuationCells = new Set<string>()
  for (const merge of input.merges) {
    const anchor = rows[merge.startRow]?.[merge.startColumn] ?? null
    for (let rowIndex = merge.startRow; rowIndex <= merge.endRow; rowIndex += 1) {
      if (!rows[rowIndex]) rows[rowIndex] = []
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        if (rowIndex === merge.startRow && column === merge.startColumn) continue
        rows[rowIndex][column] = anchor
        continuationCells.add(`${rowIndex}:${column}`)
      }
    }
  }
  return { rows, continuationCells }
}

/**
 * Stable fingerprint of a sheet layout: worksheet name plus the normalized header labels.
 * A saved mapping profile is found by this value, so a supplier adding a column or renaming
 * one invalidates the profile and forces the operator to confirm the mapping again.
 */
export function layoutSignature(sheetName: string, headerCells: readonly string[]): string {
  const normalized = headerCells.map((cell) => cell.trim().replace(/\s+/g, ' ').toLowerCase()).join('\u0001')
  return createHash('sha256').update(`${sheetName.trim().toLowerCase()}\u0000${normalized}`).digest('hex').slice(0, 16)
}
