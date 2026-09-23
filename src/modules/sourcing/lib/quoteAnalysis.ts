/**
 * Workbook-level orchestration: summarize the sheets, pick one, detect its structure, resolve
 * the column mapping (saved profile → standard template → alias dictionary) and hand the pieces
 * to the line builder. Nothing here touches the database, so the parse and remap commands share
 * exactly one code path and the whole flow is unit-testable from a buffer.
 */

import {
  TEMPLATE_HEADERS,
  detectColumnMappings,
  inferCurrencyFromHeaders,
  isTemplateHeaderRow,
  mappingsFromColumnMap,
  templateColumnMap,
  type ColumnMap,
  type DetectedColumnMapping,
} from './columnMapping'
import { detectStructure, type DetectedSection, type RejectedRow, type SheetStructure, type StructureWarning } from './headerDetection'
import { buildQuoteLines, type BuiltQuoteLine } from './quoteLines'
import { cellToText, isNullToken } from './valueNormalization'
import { layoutSignature, type CellValue, type ParsedSheet, type ParsedWorkbook } from './workbook'

export type SheetSummary = {
  name: string
  index: number
  rowCount: number
  filledRowCount: number
  headerCandidates: number[]
  sampleRows: string[][]
}

export type SheetAnalysis = {
  sheetName: string
  sheetIndex: number
  headerRowIndex: number
  unitRowIndex: number | null
  headerCells: string[]
  /** First data rows as text, for the wizard preview and the AI mapping request. */
  sampleRows: string[][]
  dataRowCount: number
  sections: DetectedSection[]
  rejectedRows: RejectedRow[]
  structureWarnings: StructureWarning[]
  columns: DetectedColumnMapping[]
  duplicateTargets: string[]
  unmappedColumns: number[]
  columnMap: ColumnMap
  layoutSignature: string
  detectedCurrency: string | null
  matchedProfileId: string | null
  templateMatched: boolean
  lines: BuiltQuoteLine[]
  lineWarnings: string[]
}

export type SheetAnalysisFailureReason = 'sheet_not_found' | 'header_not_found' | 'empty_sheet'

export type SheetAnalysisResult = { ok: true; analysis: SheetAnalysis } | { ok: false; reason: SheetAnalysisFailureReason }

export type ProfileLike = {
  id: string
  columnMap: ColumnMap
  headerRowIndex: number
  sheetName: string | null
  sectionRules?: Record<string, unknown> | null
}

/** Per-sheet preview the wizard shows before the operator picks one. */
export function summarizeWorkbook(workbook: ParsedWorkbook): SheetSummary[] {
  return workbook.sheets.map((sheet) => {
    const filled = sheet.rows.filter((row) => (row ?? []).some((cell) => !isNullToken(cell) && cellToText(cell).length > 0))
    const detection = detectStructure({ rows: sheet.rows, continuationCells: sheet.continuationCells })
    const headerCandidates: number[] = []
    if (detection.ok) headerCandidates.push(detection.structure.headerRowIndex)
    const firstRowIndex = sheet.rows.findIndex((row) => (row ?? []).some((cell) => !isNullToken(cell)))
    const sampleRows: string[][] = []
    if (firstRowIndex >= 0) {
      for (let rowIndex = firstRowIndex; rowIndex < Math.min(firstRowIndex + 5, sheet.rows.length); rowIndex += 1) {
        const row = sheet.rows[rowIndex] ?? []
        sampleRows.push(row.slice(0, 12).map((cell: CellValue) => cellToText(cell)))
      }
    }
    return {
      name: sheet.name,
      index: sheet.index,
      rowCount: sheet.rows.length,
      filledRowCount: filled.length,
      headerCandidates,
      sampleRows,
    }
  })
}

function filledRowCount(sheet: ParsedSheet): number {
  return sheet.rows.filter((row) => (row ?? []).some((cell) => !isNullToken(cell) && cellToText(cell).length > 0)).length
}

/** Without an explicit name, the busiest sheet wins — a cover sheet never has the data. */
function pickSheet(workbook: ParsedWorkbook, sheetName?: string): ParsedSheet | null {
  if (sheetName) return workbook.sheets.find((sheet) => sheet.name === sheetName) ?? null
  const ranked = [...workbook.sheets].sort((left, right) => filledRowCount(right) - filledRowCount(left) || left.index - right.index)
  return ranked[0] ?? null
}

/**
 * Analyzes one sheet of a workbook: structure, mapping and the resulting lines. `profile` wins
 * over the alias dictionary; the standard template wins over the dictionary too but loses to an
 * explicit profile, and a `headerRowIndex` from the operator wins over everything.
 */
export function analyzeSheet(input: {
  workbook: ParsedWorkbook
  sheetName?: string
  headerRowIndex?: number
  profile?: ProfileLike | null
}): SheetAnalysisResult {
  const sheet = pickSheet(input.workbook, input.sheetName)
  if (!sheet) return { ok: false, reason: 'sheet_not_found' }
  const profile = input.profile ?? null
  // A saved profile is only trustworthy for the sheet and header row it was saved from; any
  // other combination falls back to detection so a renamed column cannot be mis-mapped.
  const profileApplies =
    profile !== null &&
    (!profile.sheetName || profile.sheetName === sheet.name) &&
    (input.headerRowIndex === undefined || input.headerRowIndex === profile.headerRowIndex)
  const detection = detectStructure({
    rows: sheet.rows,
    continuationCells: sheet.continuationCells,
    headerRowIndex: input.headerRowIndex ?? (profileApplies && profile ? profile.headerRowIndex : undefined),
  })
  if (!detection.ok) return { ok: false, reason: detection.reason }
  const structure: SheetStructure = detection.structure
  const dataRows = structure.dataRowIndexes.map((rowIndex) => sheet.rows[rowIndex] ?? [])

  const templateMatched = isTemplateHeaderRow(structure.headerCells)
  let columnMap: ColumnMap
  let columns: DetectedColumnMapping[]
  let duplicateTargets: string[] = []
  let unmappedColumns: number[] = []
  let matchedProfileId: string | null = null
  if (profileApplies && profile) {
    columnMap = profile.columnMap
    columns = mappingsFromColumnMap(structure.headerCells, columnMap)
    matchedProfileId = profile.id
    unmappedColumns = columns
      .filter((column) => column.status === 'unmapped' && column.sourceHeader.trim().length > 0)
      .map((column) => column.sourceIndex)
  } else if (templateMatched) {
    columnMap = templateColumnMap(structure.headerCells)
    columns = mappingsFromColumnMap(structure.headerCells, columnMap)
    unmappedColumns = columns
      .filter((column) => column.status === 'unmapped' && column.sourceHeader.trim().length > 0)
      .map((column) => column.sourceIndex)
  } else {
    const detected = detectColumnMappings({ headers: structure.headerCells, dataRows })
    columnMap = detected.columnMap
    columns = detected.columns
    duplicateTargets = detected.duplicateTargets
    unmappedColumns = detected.unmappedColumns
  }

  const built = buildQuoteLines({ rows: sheet.rows, structure, columnMap })
  const sampleRows = structure.dataRowIndexes
    .slice(0, 3)
    .map((rowIndex) => (sheet.rows[rowIndex] ?? []).slice(0, 16).map((cell: CellValue) => cellToText(cell)))
  const analysis: SheetAnalysis = {
    sheetName: sheet.name,
    sheetIndex: sheet.index,
    headerRowIndex: structure.headerRowIndex,
    unitRowIndex: structure.unitRowIndex,
    headerCells: structure.headerCells,
    sampleRows,
    dataRowCount: structure.dataRowIndexes.length,
    sections: structure.sections,
    rejectedRows: structure.rejectedRows,
    structureWarnings: structure.warnings,
    columns,
    duplicateTargets,
    unmappedColumns,
    columnMap,
    layoutSignature: layoutSignature(sheet.name, structure.headerCells),
    detectedCurrency: inferCurrencyFromHeaders(structure.headerCells),
    matchedProfileId,
    templateMatched,
    lines: built.lines,
    lineWarnings: built.warnings,
  }
  return { ok: true, analysis }
}

/** Header labels the standard template expects, exposed so the wizard can explain a template miss. */
export const STANDARD_TEMPLATE_HEADERS: readonly string[] = TEMPLATE_HEADERS
