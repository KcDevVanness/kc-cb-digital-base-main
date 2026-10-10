/**
 * Cell and row normalization for the supplier product library's Excel import.
 *
 * The parse step hands the mapping table raw cells; when the operator confirms a mapping, the same
 * rows are turned into import rows here. Everything is pure and browser-safe: the dialog imports this
 * module to rebuild its preview after a mapping change, and the command validates the same payload
 * again on the server (`supplierProductExcelImportSchema`) — the client's preview and the server's
 * validation must agree on what a row is, which is why both read this file.
 *
 * Normalization is deliberately conservative. A cell that cannot be read as the number its column
 * claims keeps its raw text and carries a reason: the row still goes to the server, where the library's
 * own create contract rejects it by name, and the operator sees one failed row instead of a file that
 * silently imported nothing.
 */

import { z } from 'zod'
import type { CellValue } from '@/lib/workbook'
import { SUPPLIER_PRODUCT_IMPORT_FIELDS, type SupplierProductImportField } from './aliases'
import type { DetectedColumn } from './columns'

/**
 * Caps mirroring the workbook reader's (`MAX_SHEET_ROWS` / `MAX_SHEET_COLUMNS` in `@/lib/workbook`).
 *
 * Copies, not imports: that module loads `xlsx` and Node's `crypto`, and this one is bundled into the
 * mapping table. A sheet the reader accepted therefore always fits an import request.
 */
export const MAX_IMPORT_ROWS = 20000
export const MAX_IMPORT_COLUMNS = 256

/** `numeric(16,4)` and `integer` in the library's own table — beyond these the row would fail at the driver. */
const MAX_DECIMAL_INTEGER_DIGITS = 12
const MAX_INTEGER_VALUE = 2147483647

/** Text that means "no value" on a supplier sheet rather than a literal value. */
const NULL_TOKENS: Record<string, true> = {
  '': true,
  '/': true,
  '／': true,
  '-': true,
  '－': true,
  '—': true,
  '–': true,
  'n/a': true,
  na: true,
  'n.a.': true,
  none: true,
  null: true,
  tbd: true,
  tba: true,
  待定: true,
  无: true,
  暂无: true,
  不详: true,
}

/** Currency noise that may precede an amount (`¥1,200`, `USD 3.5`). */
const CURRENCY_PREFIX_PATTERN = /(?:us\$|cn¥|rmb|cny|usd|eur|rub|hkd|jpy|¥|￥|\$|€|₽)/gi

/**
 * A number, optionally followed by a unit and nothing else that contains a digit.
 *
 * `1,200 PCS` and `12.5kg` are quantities; `100-200` and `46.5*46.5*40cm` are not, and reading their
 * first number would invent a value the sheet never stated.
 */
const NUMBER_WITH_UNIT_PATTERN = /^([-+]?\d+(?:\.\d+)?)([^\d]*)$/

const WHOLE_NUMBER_PATTERN = /^([+-]?\d+)(?:\.0+)?$/

/** Which normalization a mapped column goes through when it becomes an import row. */
const FIELD_KINDS: Record<SupplierProductImportField, 'text' | 'integer' | 'decimal'> = {
  supplierSku: 'text',
  itemNo: 'text',
  brandValue: 'text',
  name: 'text',
  nameZh: 'text',
  nameEn: 'text',
  description: 'text',
  declarationElements: 'text',
  unit: 'text',
  // Text on purpose: the form keeps a leading zero and its grouping dots (`8471.30.0000`).
  hsCode: 'text',
  moqQuantity: 'integer',
  cartonQuantity: 'integer',
  unitNetWeight: 'decimal',
  unitGrossWeight: 'decimal',
  unitVolume: 'decimal',
  discountPercent: 'decimal',
}

/** One cell that could not be read as its column's kind. */
export type ImportCellErrorCode = 'invalid_number' | 'invalid_integer' | 'out_of_range'

export type ImportRowCellError = { field: SupplierProductImportField; code: ImportCellErrorCode }

export type ImportRow = {
  /** 1-based row number as the spreadsheet shows it, so a failure names the line the operator sees. */
  row: number
  values: Partial<Record<SupplierProductImportField, string>>
  /** Client-side preview only: the server re-validates the row through the library's create contract. */
  cellErrors: ImportRowCellError[]
}

/**
 * A cell as display text: numbers keep a plain decimal form, blank tokens become `''`, and inner runs of
 * spaces are collapsed while line breaks survive (descriptions use them as separators).
 *
 * Exported because the header detector reads header cells through it too — one function decides what a
 * cell says, so a header and a value can never disagree about the same cell.
 */
export function cellToText(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

export type NormalizedImportCell = { text: string; error?: ImportCellErrorCode }

/**
 * One cell, normalized for its column's kind: thousands separators and a trailing unit are stripped
 * from numbers, text fields are kept as printed, and an unreadable value keeps its raw text so the
 * server can report it against the field it belongs to.
 */
export function normalizeImportCell(value: CellValue, field: SupplierProductImportField): NormalizedImportCell {
  const raw = cellToText(value)
  if (NULL_TOKENS[raw.toLowerCase()] === true) return { text: '' }
  const kind = FIELD_KINDS[field]
  if (kind === 'text') return { text: raw }

  const match = NUMBER_WITH_UNIT_PATTERN.exec(
    raw.replace(CURRENCY_PREFIX_PATTERN, '').replace(/,/g, '').replace(/\s+/g, ' ').trim(),
  )
  if (!match) return { text: raw, error: kind === 'integer' ? 'invalid_integer' : 'invalid_number' }
  const token = match[1]

  if (kind === 'decimal') {
    const integerPart = token.replace(/^[-+]/, '').split('.')[0] ?? ''
    if (integerPart.length > MAX_DECIMAL_INTEGER_DIGITS) return { text: raw, error: 'out_of_range' }
    return { text: token.replace(/^\+/, '') }
  }

  const whole = WHOLE_NUMBER_PATTERN.exec(token)
  if (!whole) return { text: raw, error: 'invalid_integer' }
  const normalized = whole[1].replace(/^\+/, '')
  if (Number(normalized.replace(/^-/, '')) > MAX_INTEGER_VALUE) return { text: raw, error: 'out_of_range' }
  return { text: normalized }
}

export type BuildImportRowsInput = {
  /** Data rows below the header, as the sheet (or the parse response) holds them. */
  rows: readonly (readonly CellValue[])[]
  /** The confirmed mapping. Columns without a target are ignored; indices address the cells above. */
  columns: readonly DetectedColumn[]
  /** 1-based spreadsheet row number of `rows[0]`; every built row keeps that numbering. */
  firstRowNumber: number
  maxRows?: number
}

export type BuildImportRowsResult = {
  rows: ImportRow[]
  /** Rows that carried no mapped value at all — the sheet's spacer and total rows, normally. */
  skippedBlankRows: number
  /** True when row or column caps cut the file down; the operator is told, never left guessing. */
  truncated: boolean
}

/**
 * Turns the sheet into the rows an import request carries.
 *
 * A row is kept when at least one mapped cell has a value — including a value that failed normalization,
 * because the operator needs to see that row fail rather than have it disappear. Blank rows are counted
 * instead of submitted: a sheet's spacer rows would otherwise become N identical failures.
 */
export function buildImportRows(input: BuildImportRowsInput): BuildImportRowsResult {
  const maxRows = Math.max(1, input.maxRows ?? MAX_IMPORT_ROWS)
  const mapped = input.columns
    .filter((column) => column.index < MAX_IMPORT_COLUMNS)
    .flatMap((column) => (column.target === null ? [] : [{ index: column.index, target: column.target }]))

  const rows: ImportRow[] = []
  let skippedBlankRows = 0
  // Only a *mapped* column beyond the cap loses data; a column the operator ignored loses nothing.
  let truncated = input.columns.some((column) => column.index >= MAX_IMPORT_COLUMNS && column.target !== null)

  for (let index = 0; index < input.rows.length; index += 1) {
    const cells = input.rows[index] ?? []
    const values: Partial<Record<SupplierProductImportField, string>> = {}
    const cellErrors: ImportRowCellError[] = []
    for (const column of mapped) {
      const normalized = normalizeImportCell(cells[column.index] ?? null, column.target)
      if (normalized.error) cellErrors.push({ field: column.target, code: normalized.error })
      if (normalized.text.length > 0) values[column.target] = normalized.text
    }
    if (Object.keys(values).length === 0) {
      skippedBlankRows += 1
      continue
    }
    if (rows.length >= maxRows) {
      truncated = true
      break
    }
    rows.push({ row: input.firstRowNumber + index, values, cellErrors })
  }

  return { rows, skippedBlankRows, truncated }
}

/** One row of an import request: the built values plus the spreadsheet row they came from. */
export const supplierProductImportRowPayloadSchema = z.object({
  row: z.number().int().min(1),
  values: z.record(z.string(), z.string().max(2000)),
})

export type SupplierProductImportRowPayload = z.infer<typeof supplierProductImportRowPayloadSchema>

/**
 * The command's input: the supplier plus the rows to create, bounded by the workbook reader's own cap.
 * The client already built the rows from the confirmed mapping, so no mapping travels with them.
 */
export const supplierProductExcelImportSchema = z.object({
  supplierId: z.string().uuid(),
  rows: z.array(supplierProductImportRowPayloadSchema).min(1).max(MAX_IMPORT_ROWS),
})

export type SupplierProductExcelImportInput = z.infer<typeof supplierProductExcelImportSchema>

/**
 * The mapped values, filtered to the library's own field list.
 *
 * Two things are load-bearing: a stray key in the payload can never reach the create contract, and an
 * empty cell stays *absent* rather than becoming `''` — the contract's own defaults (`unit` → `PCS`,
 * `status` → `active`) apply to an omitted field but an empty string would overwrite the default.
 */
export function pickLibraryValues(values: Record<string, string>): Partial<Record<SupplierProductImportField, string>> {
  const picked: Partial<Record<SupplierProductImportField, string>> = {}
  for (const field of SUPPLIER_PRODUCT_IMPORT_FIELDS) {
    const value = values[field]
    if (typeof value === 'string' && value.length > 0) picked[field] = value
  }
  return picked
}

export const MAX_FAILURE_REASON_LENGTH = 300
const MAX_REPORTED_ISSUES = 3

/**
 * The create contract's own messages, named by field and capped, because `failed: [{ row, reason }]` has
 * room for a sentence and a zod union reports one issue per branch it tried. The first issue per field
 * wins: `unitNetWeight: value must be a decimal number` already says what to fix.
 */
export function describeImportRowIssues(error: z.ZodError): string {
  const seen = new Set<string>()
  const messages: string[] = []
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : 'row'
    if (seen.has(field)) continue
    seen.add(field)
    messages.push(`${field}: ${issue.message}`)
    if (messages.length >= MAX_REPORTED_ISSUES) break
  }
  const reason = messages.join('; ') || 'the row was refused by the supplier product contract'
  return reason.length > MAX_FAILURE_REASON_LENGTH ? `${reason.slice(0, MAX_FAILURE_REASON_LENGTH - 1)}…` : reason
}
