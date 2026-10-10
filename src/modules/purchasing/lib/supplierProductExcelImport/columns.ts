/**
 * Header row detection and column mapping for the supplier product library's Excel import.
 *
 * Both are pure functions over the sheet as `readWorkbook` hands it over: nothing here touches the
 * filesystem, the database or the DOM, so the browser mapping table can rebuild the mapping and the
 * preview from the same code the server used to suggest it.
 *
 * The rules are deliberately small:
 * - the header row is the first 20 rows' row with the most recognized columns; a tie keeps the earlier
 *   row, because a supplier's title block is above the table and never below it;
 * - one target field is imported from exactly one column — the strongest claim wins (exact label before
 *   alias, then the leftmost column), and a losing duplicate is reported as ignored rather than
 *   imported twice.
 */

import type { CellValue } from '@/lib/workbook'
import {
  CONFIDENCE_BY_MATCH_LEVEL,
  MANUAL_MAPPING_CONFIDENCE,
  isUnsupportedPriceHeader,
  matchImportHeader,
  type AliasMatchLevel,
  type SupplierProductImportField,
} from './aliases'
import { cellToText } from './rows'

/** How far into the sheet a header row may sit — a supplier's title block is a few rows, not thirty. */
export const MAX_HEADER_SCAN_ROWS = 20

export type DetectedColumn = {
  /** Position in the sheet's row. Data rows are read through the same index. */
  index: number
  /** The header cell as written, trimmed. */
  header: string
  target: SupplierProductImportField | null
  confidence: number
  matchLevel: AliasMatchLevel | 'none'
  /**
   * The column that already claimed this header's field: this column matched, but importing the same
   * field twice is not allowed, so it is ignored. Shown in the mapping table, never silently dropped.
   */
  duplicateOf?: number
  /** A price column: recognized, but this round's import cannot decide its price kind and currency. */
  unsupported?: 'price'
}

export type HeaderDetectionResult =
  | {
      ok: true
      headerRowIndex: number
      headerCells: string[]
      columns: DetectedColumn[]
      /** How many distinct fields the row names — the score the row won with. */
      matchedTargets: number
    }
  | { ok: false; reason: 'empty_sheet' | 'header_not_found' }

type ColumnCandidate = {
  index: number
  header: string
  target: SupplierProductImportField | null
  level: AliasMatchLevel | 'none'
}

function candidateFor(index: number, header: string): ColumnCandidate {
  const match = matchImportHeader(header)
  if (!match) return { index, header, target: null, level: 'none' }
  return { index, header, target: match.field, level: match.level }
}

/** Exact claims before alias claims, then left to right — the order that decides who wins a field. */
function byClaimPriority(left: ColumnCandidate, right: ColumnCandidate): number {
  if (left.level !== right.level) return left.level === 'exact' ? -1 : 1
  return left.index - right.index
}

/**
 * The suggested target per column, one field at most once.
 *
 * A header that names no field reads as `null` (ignore). When two columns name the same field the
 * stronger claim keeps it and the other is left at `null` — see `buildColumns` for the column that
 * reports *why*.
 */
export function suggestTargets(headerCells: readonly string[]): (SupplierProductImportField | null)[] {
  const candidates = headerCells.map((header, index) => candidateFor(index, header))
  const winnerByField: Record<string, number> = Object.create(null)
  for (const candidate of [...candidates].sort(byClaimPriority)) {
    if (!candidate.target) continue
    if (winnerByField[candidate.target] === undefined) winnerByField[candidate.target] = candidate.index
  }
  return candidates.map((candidate) =>
    candidate.target && winnerByField[candidate.target] === candidate.index ? candidate.target : null,
  )
}

/**
 * The columns the mapping table renders: the confirmed targets plus everything else the operator needs
 * to judge the mapping (how sure the match was, and why an unmatched column is unmatched).
 *
 * A field is imported from one column at most, so a duplicate is reported rather than dropped in
 * silence: two columns whose headers name the same field show the left one as the owner and the other
 * as `duplicateOf`. The default targets `suggestTargets` returns already resolve the duplicate (the
 * loser is `null`); this function is what makes the reason visible, and it holds for the operator's
 * own choices too.
 */
export function buildColumns(
  headerCells: readonly string[],
  targets: readonly (SupplierProductImportField | null)[],
): DetectedColumn[] {
  const claimedBy: Record<string, number> = Object.create(null)
  const headerClaimBy: Record<string, number> = Object.create(null)
  const columns: DetectedColumn[] = []
  headerCells.forEach((header, index) => {
    const candidate = candidateFor(index, header)
    const requested = targets[index] ?? null
    if (candidate.target && headerClaimBy[candidate.target] === undefined) headerClaimBy[candidate.target] = index

    if (requested) {
      const claimed = claimedBy[requested]
      if (claimed === undefined) claimedBy[requested] = index
      columns.push({
        index,
        header,
        target: claimed === undefined ? requested : null,
        confidence: claimed === undefined ? confidenceFor(candidate, requested) : 0,
        matchLevel: candidate.level,
        ...(claimed === undefined ? {} : { duplicateOf: claimed }),
      })
      return
    }

    // No target for this column: either an earlier column already names the same field, or the header is
    // unknown to the dictionary, or it is a price column this round cannot write.
    const headerOwner = candidate.target ? headerClaimBy[candidate.target] : undefined
    if (headerOwner !== undefined && headerOwner !== index) {
      columns.push({
        index,
        header,
        target: null,
        confidence: 0,
        matchLevel: candidate.level,
        duplicateOf: headerOwner,
      })
      return
    }
    if (candidate.level === 'none' && isUnsupportedPriceHeader(header)) {
      columns.push({ index, header, target: null, confidence: 0, matchLevel: 'none', unsupported: 'price' })
      return
    }
    columns.push({ index, header, target: null, confidence: 0, matchLevel: candidate.level })
  })
  return columns
}

/** How much the mapping table trusts one column: its own header hit, or the operator's word for it. */
function confidenceFor(candidate: ColumnCandidate, requested: SupplierProductImportField): number {
  if (candidate.level !== 'none' && candidate.target === requested) return CONFIDENCE_BY_MATCH_LEVEL[candidate.level]
  return MANUAL_MAPPING_CONFIDENCE
}

/**
 * Detects the header row of a sheet and suggests its mapping.
 *
 * Fails loudly instead of guessing: a sheet whose first 20 rows name no known column has no header
 * this import can work from, and a wrong guess would import the supplier's title block as data.
 */
export function detectHeaderRow(
  rows: readonly (readonly CellValue[])[],
  options: { maxScanRows?: number } = {},
): HeaderDetectionResult {
  const scanLimit = Math.min(rows.length, Math.max(1, options.maxScanRows ?? MAX_HEADER_SCAN_ROWS))
  let sawContent = false
  let best: { index: number; cells: string[]; matchedTargets: number } | null = null

  for (let index = 0; index < scanLimit; index += 1) {
    const cells = (rows[index] ?? []).map((cell) => cellToText(cell))
    if (cells.some((cell) => cell.length > 0)) sawContent = true
    const matchedTargets = suggestTargets(cells).filter((target) => target !== null).length
    if (matchedTargets === 0) continue
    // Strictly greater, so a tie keeps the row found first.
    if (!best || matchedTargets > best.matchedTargets) best = { index, cells, matchedTargets }
  }

  if (!best) return { ok: false, reason: sawContent ? 'header_not_found' : 'empty_sheet' }

  // A padded header row ends with empty cells; they name nothing, so they are not columns the operator
  // should have to look at. Indices are untouched, so the data rows still line up.
  let lastNamed = best.cells.length - 1
  while (lastNamed > 0 && best.cells[lastNamed].length === 0) lastNamed -= 1
  const headerCells = best.cells.slice(0, lastNamed + 1)

  return {
    ok: true,
    headerRowIndex: best.index,
    headerCells,
    columns: buildColumns(headerCells, suggestTargets(headerCells)),
    matchedTargets: best.matchedTargets,
  }
}
