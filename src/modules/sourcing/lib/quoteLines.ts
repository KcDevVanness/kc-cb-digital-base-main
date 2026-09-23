/**
 * Turns detected sheet rows into quotation lines.
 *
 * Kept free of database and HTTP concerns so the same code runs in unit tests, in the parse
 * command and (later) in any standalone converter. Every raw cell of a data row is preserved in
 * `raw` under its original header text, which is what makes a mis-mapped or unmapped column
 * recoverable: re-running the mapping never needs the operator to re-upload the workbook.
 */

import { resolveSectionLabel, type SheetStructure } from './headerDetection'
import type { ColumnMap } from './columnMapping'
import { deriveLineSkus, type SkuWarning } from './skuDerivation'
import {
  cellToText,
  isNullToken,
  parseDimensionsCell,
  parseMoqCell,
  parseNumberCell,
  type Dimensions,
} from './valueNormalization'
import type { CellValue } from './workbook'

export type QuoteLineWarning = SkuWarning | 'moq_partial' | 'moq_not_numeric' | 'missing_name' | 'section_slug_empty'

export type BuiltQuoteLine = {
  lineNumber: number
  sourceRowNumber: number
  sectionLabel: string | null
  itemNo: string | null
  productName: string | null
  variantLabel: string | null
  derivedSku: string | null
  hsCode: string | null
  description: string | null
  unit: string
  unitCost: string | null
  currencyCode: string | null
  suggestedRsp: string | null
  moqRaw: string | null
  moqQuantity: number | null
  cartonQuantity: number | null
  unitNetWeight: string | null
  innerPacking: Dimensions | null
  raw: Record<string, unknown>
  warnings: QuoteLineWarning[]
  rowStatus: 'ready' | 'invalid'
  selected: boolean
}

/** Decimal string for a numeric column; scale only matters for values in exponent notation. */
function toDecimalString(value: number | null, scale: number): string | null {
  if (value === null) return null
  const plain = String(value)
  if (!plain.includes('e') && !plain.includes('E')) return plain
  return value.toFixed(scale)
}

function readCell(rows: readonly (readonly CellValue[])[], rowIndex: number, columnMap: ColumnMap, field: string): CellValue {
  const entry = columnMap[field]
  if (!entry) return null
  return rows[rowIndex]?.[entry.sourceIndex] ?? null
}

function textCell(rows: readonly (readonly CellValue[])[], rowIndex: number, columnMap: ColumnMap, field: string): string | null {
  const value = readCell(rows, rowIndex, columnMap, field)
  if (isNullToken(value)) return null
  const text = cellToText(value)
  return text.length > 0 ? text : null
}

function numberCell(rows: readonly (readonly CellValue[])[], rowIndex: number, columnMap: ColumnMap, field: string): number | null {
  return parseNumberCell(readCell(rows, rowIndex, columnMap, field))
}

/**
 * Recomputes the status the review grid shows: a line is ready when it carries a name and a
 * derived SKU, and invalid otherwise (the operator can fix either inline and save).
 */
export function resolveLineStatus(line: { productName: string | null; itemNo: string | null; derivedSku: string | null }): 'ready' | 'invalid' {
  if (!line.productName && !line.itemNo) return 'invalid'
  if (!line.derivedSku) return 'invalid'
  return 'ready'
}

export function buildQuoteLines(input: {
  rows: readonly (readonly CellValue[])[]
  structure: SheetStructure
  columnMap: ColumnMap
  defaultUnit?: string
}): { lines: BuiltQuoteLine[]; warnings: string[] } {
  const { rows, structure, columnMap } = input
  const defaultUnit = input.defaultUnit ?? 'PCS'
  const headers = structure.headerCells
  const rawHeaders = structure.dataRowIndexes.map((rowIndex) => {
    const record: Record<string, unknown> = {}
    const row = rows[rowIndex] ?? []
    for (let column = 0; column < row.length; column += 1) {
      const value = row[column]
      if (isNullToken(value)) continue
      const label = (headers[column] ?? '').trim() || `column_${column + 1}`
      record[label] = value
    }
    return record
  })

  const candidates = structure.dataRowIndexes.map((rowIndex) => ({
    itemNo: textCell(rows, rowIndex, columnMap, 'item_no'),
    productName: textCell(rows, rowIndex, columnMap, 'product_name'),
  }))
  const skus = deriveLineSkus(candidates)

  const warnings = new Set<string>()
  const lines: BuiltQuoteLine[] = structure.dataRowIndexes.map((rowIndex, position) => {
    const lineWarnings: QuoteLineWarning[] = [...skus[position].warnings]
    const moq = parseMoqCell(readCell(rows, rowIndex, columnMap, 'moq'))
    if (moq.warning) lineWarnings.push(moq.warning)
    const sectionLabel = textCell(rows, rowIndex, columnMap, 'section') ?? resolveSectionLabel(structure.sections, rowIndex)
    if (sectionLabel && !/[a-z0-9]/i.test(sectionLabel)) lineWarnings.push('section_slug_empty')
    const currency = textCell(rows, rowIndex, columnMap, 'currency')
    const itemNo = candidates[position].itemNo
    const productName = candidates[position].productName
    if (!productName && !itemNo) lineWarnings.push('missing_name')
    const cartonQuantityValue = numberCell(rows, rowIndex, columnMap, 'carton_quantity')
    const line: BuiltQuoteLine = {
      lineNumber: position + 1,
      sourceRowNumber: rowIndex,
      sectionLabel,
      itemNo,
      productName,
      variantLabel: skus[position].variantLabel,
      derivedSku: skus[position].sku,
      hsCode: textCell(rows, rowIndex, columnMap, 'hs_code'),
      description: textCell(rows, rowIndex, columnMap, 'description'),
      unit: textCell(rows, rowIndex, columnMap, 'unit') ?? defaultUnit,
      unitCost: toDecimalString(numberCell(rows, rowIndex, columnMap, 'unit_cost'), 6),
      currencyCode: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null,
      suggestedRsp: toDecimalString(numberCell(rows, rowIndex, columnMap, 'suggested_rsp'), 6),
      moqRaw: moq.raw,
      moqQuantity: moq.quantity,
      cartonQuantity: cartonQuantityValue === null ? null : Math.round(cartonQuantityValue),
      unitNetWeight: toDecimalString(numberCell(rows, rowIndex, columnMap, 'unit_net_weight'), 4),
      innerPacking: parseDimensionsCell(readCell(rows, rowIndex, columnMap, 'inner_packing')),
      raw: rawHeaders[position],
      warnings: lineWarnings,
      rowStatus: 'invalid',
      selected: false,
    }
    line.rowStatus = resolveLineStatus(line)
    line.selected = line.rowStatus === 'ready'
    for (const warning of lineWarnings) warnings.add(warning)
    return line
  })

  return { lines, warnings: [...warnings] }
}
