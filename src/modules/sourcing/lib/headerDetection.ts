/**
 * Detects where a supplier sheet's header, data rows, category banners and footer live.
 *
 * Rules are written against the two reference files and are deliberately conservative —
 * every rejected row is reported with a reason so the wizard can show the operator what
 * was skipped instead of silently dropping rows:
 *
 * - Header row: the first 30 rows compete; a candidate needs at least three filled cells
 *   covering most of the sheet's widest row and must be mostly text. Candidates are scored
 *   by how many distinct target fields their cells map to, with a large bonus when a cell
 *   names the item no. or the product name (that also resolves the invoice-style two-row
 *   header, where the unit row never carries the identity columns).
 * - Unit row: a short, purely textual row directly under the header whose cells fold into
 *   the header labels (`Unit Price` + `CNY/PC`), because the `.xls` invoice splits its
 *   header over two lines (`Quantity` / `PCS`, `qty/box`).
 * - Banner row: exactly one filled cell, at most 40 characters, followed within three rows
 *   by a data row. It labels the rows beneath it until the next banner.
 * - Blank and merge-continuation rows are skipped but never end the table: the PetKit
 *   workbook has a three-row vertically merged item in the middle of its list.
 * - The table ends at the first footer row (a row whose first filled cell starts with
 *   `TOTAL`, `Subtotal`, `Remark`, `LEAD TIME`, `TERMS`, `PAYMENT`, `Bank`, `Account`, …),
 *   which is where the `.xls` invoice stops before its payment terms and bank details.
 */

import { detectColumnMappings } from './columnMapping'
import { cellToText, isNullToken } from './valueNormalization'
import type { CellValue } from './workbook'

export type StructureWarning =
  | 'unit_row_folded'
  | 'blank_rows_skipped'
  | 'merged_continuation_rows_skipped'
  | 'footer_rows_skipped'
  | 'metadata_rows_skipped'

export type DetectedSection = { rowIndex: number; label: string }

export type RejectedRowReason = 'banner' | 'blank' | 'merged_continuation' | 'footer' | 'after_footer' | 'metadata'

export type RejectedRow = { rowIndex: number; reason: RejectedRowReason; preview?: string }

export type SheetStructure = {
  headerRowIndex: number
  unitRowIndex: number | null
  dataStartRow: number
  dataEndRow: number | null
  headerCells: string[]
  dataRowIndexes: number[]
  sections: DetectedSection[]
  rejectedRows: RejectedRow[]
  warnings: StructureWarning[]
}

export type StructureDetectionResult =
  | { ok: true; structure: SheetStructure }
  | { ok: false; reason: 'empty_sheet' | 'header_not_found' }

const HEADER_SEARCH_LIMIT = 30
const BANNER_MAX_LENGTH = 40
const BANNER_LOOKAHEAD = 3
const UNIT_ROW_MAX_CELL_LENGTH = 16

const FOOTER_PATTERN =
  /^(total|subtotal|grand total|remark|remarks|note|notes|lead time|terms|terms of payment|payment|payment terms|bank|account|beneficiary|swift|amount in words|say total|合计|总计|小计|备注|说明|银行|账户|收款|付款条件|交期)/i

type PreparedRow = {
  index: number
  values: string[]
  filled: number[]
  text: string[]
}

function prepareRow(row: readonly CellValue[] | undefined, index: number): PreparedRow {
  const values: string[] = []
  const filled: number[] = []
  const text: string[] = []
  if (row) {
    for (let column = 0; column < row.length; column += 1) {
      const value = row[column]
      const asText = cellToText(value)
      values.push(asText)
      if (!isNullToken(value) && asText.length > 0) {
        filled.push(column)
        text.push(asText)
      }
    }
  }
  return { index, values, filled, text }
}

function looksNumeric(value: string): boolean {
  return /^[-+]?[\d,]+(?:\.\d+)?$/.test(value.trim())
}

/** A candidate header row must describe columns, not carry values. */
function textRatio(row: PreparedRow): number {
  if (row.filled.length === 0) return 0
  const textual = row.filled.filter((column) => {
    const value = row.values[column]
    return !looksNumeric(value) && value.length <= 60
  })
  return textual.length / row.filled.length
}

function headerScore(row: PreparedRow): { score: number; claimedFields: number } {
  const { columnMap } = detectColumnMappings({ headers: row.values })
  const claimedFields = Object.keys(columnMap).length
  const identity = Object.keys(columnMap).some((key) => key === 'item_no' || key === 'product_name')
  return { score: claimedFields + (identity ? 1000 : 0), claimedFields }
}

/**
 * Detects the structure of one sheet. `continuationCells` carries the `row:column` keys the
 * merge expansion filled in, which is what separates a real data row from a merged spacer.
 *
 * `headerRowIndex` forces the header row when the operator overrides the detection; every other
 * rule (unit row, banners, footer) still runs against that choice.
 */
export function detectStructure(input: {
  rows: readonly (readonly CellValue[])[] | undefined
  continuationCells: ReadonlySet<string>
  headerRowIndex?: number
}): StructureDetectionResult {
  const rawRows = input.rows ?? []
  const prepared = rawRows.map((row, index) => prepareRow(row, index))
  if (prepared.every((row) => row.filled.length === 0)) return { ok: false, reason: 'empty_sheet' }

  let chosenHeaderRowIndex: number
  if (input.headerRowIndex === undefined) {
    const searchLimit = Math.min(prepared.length, HEADER_SEARCH_LIMIT)
    const widest = prepared.slice(0, searchLimit).reduce((max, row) => Math.max(max, row.filled.length), 0)
    let best: { rowIndex: number; score: number } | null = null
    for (let index = 0; index < searchLimit; index += 1) {
      const row = prepared[index]
      if (row.filled.length < 3) continue
      if (row.filled.length < Math.ceil(widest * 0.6)) continue
      if (textRatio(row) < 0.6) continue
      const { score, claimedFields } = headerScore(row)
      if (claimedFields < 2) continue
      if (!best || score > best.score) best = { rowIndex: index, score }
    }
    if (!best) return { ok: false, reason: 'header_not_found' }
    chosenHeaderRowIndex = best.rowIndex
  } else {
    const forced = prepared[input.headerRowIndex]
    if (!forced || forced.filled.length === 0) return { ok: false, reason: 'header_not_found' }
    chosenHeaderRowIndex = input.headerRowIndex
  }

  const headerRowIndex = chosenHeaderRowIndex
  const headerCells = prepared[headerRowIndex].values.slice()
  const warnings: StructureWarning[] = []
  const rejectedRows: RejectedRow[] = []
  for (let index = 0; index < headerRowIndex; index += 1) {
    if (prepared[index].filled.length > 0) rejectedRows.push({ rowIndex: index, reason: 'metadata' })
  }

  let unitRowIndex: number | null = null
  const nextRow = prepared[headerRowIndex + 1]
  const rowAfter = prepared[headerRowIndex + 2]
  const nextLooksLikeUnits =
    nextRow !== undefined &&
    nextRow.filled.length >= 2 &&
    nextRow.filled.every((column) => {
      const value = nextRow.values[column]
      return value.length > 0 && value.length <= UNIT_ROW_MAX_CELL_LENGTH && !looksNumeric(value)
    }) &&
    rowAfter !== undefined &&
    rowAfter.filled.length >= 2
  if (nextLooksLikeUnits) {
    unitRowIndex = headerRowIndex + 1
    warnings.push('unit_row_folded')
    for (const column of nextRow.filled) {
      const unitLabel = nextRow.values[column]
      const existing = headerCells[column] ?? ''
      headerCells[column] = existing.length > 0 ? `${existing} ${unitLabel}` : unitLabel
    }
  }

  const dataStartRow = headerRowIndex + (unitRowIndex === null ? 1 : 2)
  const accepted: number[] = []
  const banners: DetectedSection[] = []
  let footerReached = false
  let blankSkipped = 0
  let continuationSkipped = 0
  let footerSkipped = 0
  for (let index = dataStartRow; index < prepared.length; index += 1) {
    const row = prepared[index]
    if (footerReached) {
      if (row.filled.length > 0) rejectedRows.push({ rowIndex: index, reason: 'after_footer' })
      continue
    }
    if (row.filled.length === 0) {
      blankSkipped += 1
      rejectedRows.push({ rowIndex: index, reason: 'blank' })
      continue
    }
    const firstValue = row.values[row.filled[0]]
    if (FOOTER_PATTERN.test(firstValue.trim())) {
      footerReached = true
      footerSkipped += 1
      rejectedRows.push({ rowIndex: index, reason: 'footer', preview: firstValue.slice(0, 60) })
      continue
    }
    const mergedOnly = row.filled.every((column) => input.continuationCells.has(`${index}:${column}`))
    if (mergedOnly) {
      continuationSkipped += 1
      rejectedRows.push({ rowIndex: index, reason: 'merged_continuation' })
      continue
    }
    // A section banner is one logical cell. After merge expansion the PetKit banners carry
    // their label in all thirteen columns of the row, so "one cell" means either a single
    // filled cell or a single value repeated across a merged range.
    const distinctValues = new Set(row.filled.map((column) => row.values[column].trim().toLowerCase()))
    const repeatedOverMerge = row.filled.every(
      (column, position) => position === 0 || input.continuationCells.has(`${index}:${column}`),
    )
    const bannerCandidate = distinctValues.size === 1 ? row.values[row.filled[0]].trim() : ''
    if (bannerCandidate.length > 0 && bannerCandidate.length <= BANNER_MAX_LENGTH && (row.filled.length === 1 || repeatedOverMerge)) {
      banners.push({ rowIndex: index, label: bannerCandidate })
      rejectedRows.push({ rowIndex: index, reason: 'banner', preview: bannerCandidate })
      continue
    }
    if (row.filled.length < 2) {
      rejectedRows.push({ rowIndex: index, reason: 'metadata', preview: row.text[0]?.slice(0, 60) })
      continue
    }
    accepted.push(index)
  }

  const acceptedSet = new Set(accepted)
  const bannerRowIndexes = new Set(banners.map((banner) => banner.rowIndex))
  // A one-cell row is only a section label when content still follows it; the trailing
  // "Remark …" row of the PetKit sheet is a one-cell row too, but nothing follows it.
  const sections = banners.filter((banner) =>
    Array.from({ length: BANNER_LOOKAHEAD }, (_, offset) => banner.rowIndex + offset + 1).some(
      (candidate) => acceptedSet.has(candidate) || bannerRowIndexes.has(candidate),
    ),
  )
  const sectionRowIndexes = new Set(sections.map((section) => section.rowIndex))
  const finalRejectedRows: RejectedRow[] = rejectedRows.map((row) =>
    row.reason === 'banner' && !sectionRowIndexes.has(row.rowIndex) ? { ...row, reason: 'metadata' } : row,
  )

  if (blankSkipped > 0) warnings.push('blank_rows_skipped')
  if (continuationSkipped > 0) warnings.push('merged_continuation_rows_skipped')
  if (footerSkipped > 0) warnings.push('footer_rows_skipped')
  if (finalRejectedRows.some((row) => row.reason === 'metadata')) warnings.push('metadata_rows_skipped')

  return {
    ok: true,
    structure: {
      headerRowIndex,
      unitRowIndex,
      dataStartRow,
      dataEndRow: accepted.length > 0 ? accepted[accepted.length - 1] : null,
      headerCells,
      dataRowIndexes: accepted,
      sections,
      rejectedRows: finalRejectedRows,
      warnings,
    },
  }
}

/** The banner label that applies to a data row (the nearest banner above it), if any. */
export function resolveSectionLabel(sections: readonly DetectedSection[], rowIndex: number): string | null {
  let label: string | null = null
  for (const section of sections) {
    if (section.rowIndex < rowIndex) label = section.label
    else break
  }
  return label
}
