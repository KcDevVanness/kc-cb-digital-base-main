/**
 * Maps a supplier sheet's header cells onto the quotation-line target fields.
 *
 * Three signals, in order of trust: an exact normalized-alias hit, a containment hit
 * (longest alias wins, so `Unit Price` beats `Unit`), then a Dice-coefficient fuzzy hit.
 * A target field is awarded to exactly one column — the winner is the most confident,
 * then the most filled column (a real file repeats a field in two columns, e.g. the same
 * weight spelled both in words and in an abbreviation, where only one carries values)
 * and finally the leftmost.
 *
 * The catalog is imported by client components (the mapping table renders every target
 * field), so this module must stay free of Node-only imports.
 */

import { SOURCE_FIELDS, SOURCE_FIELD_BY_KEY, type SourceFieldKey } from './fieldAliases'
import { isNullToken, parseNumberCell } from './valueNormalization'

export type MappingConfidence = 'exact' | 'alias' | 'fuzzy' | 'none'
export type MappingStatus = 'mapped' | 'ignored' | 'unmapped'
export type MappingReason =
  | 'duplicate_target'
  | 'all_zero_values'
  | 'ignored_by_catalog'
  | 'no_alias_match'

export type DetectedColumnMapping = {
  sourceIndex: number
  sourceHeader: string
  targetField: SourceFieldKey | null
  confidence: MappingConfidence
  status: MappingStatus
  matchedOn?: string
  reason?: MappingReason
  duplicateOfField?: SourceFieldKey
}

/** Profile-shaped column map: target field → the source column it reads. */
export type ColumnMap = Record<string, { sourceIndex: number; sourceHeader: string }>

export type ColumnDetectionResult = {
  columns: DetectedColumnMapping[]
  columnMap: ColumnMap
  duplicateTargets: SourceFieldKey[]
  unmappedColumns: number[]
}

/** Canonical bilingual header row of the downloadable standard template. */
export const TEMPLATE_COLUMNS: readonly { key: SourceFieldKey; header: string }[] = [
  { key: 'item_no', header: 'SKU / 货号' },
  { key: 'product_name', header: '品名 Product Name' },
  { key: 'section', header: '分类 Section' },
  { key: 'description', header: '规格 Description' },
  { key: 'hs_code', header: 'HS编码 HS Code' },
  { key: 'unit', header: '单位 Unit' },
  { key: 'unit_cost', header: '单价 Unit Cost' },
  { key: 'currency', header: '币种 Currency' },
  { key: 'moq', header: 'MOQ 起订量' },
  { key: 'carton_quantity', header: '装箱数 Qty per Carton' },
  { key: 'unit_net_weight', header: '单重 Unit N.W.(kg)' },
  { key: 'inner_packing', header: '产品尺寸 Product Size(cm)' },
]

export const TEMPLATE_HEADERS: readonly string[] = TEMPLATE_COLUMNS.map((column) => column.header)

const CURRENCY_TOKENS: readonly { code: string; tokens: readonly string[] }[] = [
  { code: 'CNY', tokens: ['cny', 'rmb', '人民币', '¥', '￥', 'cn¥'] },
  { code: 'USD', tokens: ['usd', 'us$', '美元', '$'] },
  { code: 'EUR', tokens: ['eur', '欧元', '€'] },
  { code: 'RUB', tokens: ['rub', '卢布', '₽'] },
  { code: 'HKD', tokens: ['hkd', '港币'] },
  { code: 'JPY', tokens: ['jpy', '日元', '円'] },
]

type AliasEntry = { key: SourceFieldKey; alias: string; normalized: string }

const ALIAS_INDEX: readonly AliasEntry[] = SOURCE_FIELDS.flatMap((field) =>
  field.aliases.map((alias) => ({ key: field.key, alias, normalized: normalizeHeaderLabel(alias) })),
).filter((entry) => entry.normalized.length > 0)

/**
 * Folds a header cell into a comparable label: whitespace and newlines collapse, the text
 * lowercases, brackets with unit hints (`(cm)`, `（PCS）`) and punctuation disappear, so
 * `Unit Cost\nCNY`, `unit cost cny` and `Unit Cost (CNY)` all compare equal.
 */
export function normalizeHeaderLabel(value: string | null | undefined): string {
  if (!value) return ''
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[（(【[]([^）)】\]]*)[）)】\]]/g, ' ')
    .toLowerCase()
    .replace(/[.,:;*|/\\_'"«»、]/g, ' ')
    .replace(/&/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sørensen–Dice similarity over character bigrams; used only as the last-resort signal. */
function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const bigrams = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const bigram = left.slice(index, index + 2)
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1)
  }
  let overlap = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2)
    const remaining = bigrams.get(bigram) ?? 0
    if (remaining > 0) {
      bigrams.set(bigram, remaining - 1)
      overlap += 1
    }
  }
  return (2 * overlap) / (left.length - 1 + (right.length - 1))
}

type ColumnClaim = {
  sourceIndex: number
  sourceHeader: string
  key: SourceFieldKey
  confidence: MappingConfidence
  matchedOn: string
  score: number
  fillRate: number
}

const CONFIDENCE_RANK: Record<MappingConfidence, number> = { exact: 3, alias: 2, fuzzy: 1, none: 0 }

function isNumericText(value: string): boolean {
  return /^[-+]?[\d,]+(?:\.\d+)?\s*(?:kg|g|m|cm|mm|pcs|ctn|箱|个)?$/i.test(value.trim())
}

/**
 * Share of data rows that carry a real value in a column. A placeholder zero counts as
 * empty here: supplier sheets zero-fill the columns they do not use, so a column of zeros
 * is a decoy and must lose the tiebreak to the column that actually carries the figures.
 */
function columnFillRate(dataRows: readonly (readonly unknown[])[], sourceIndex: number): number {
  if (dataRows.length === 0) return 1
  let filled = 0
  for (const row of dataRows) {
    const value = row[sourceIndex]
    if (isNullToken(value)) continue
    const text = typeof value === 'string' ? value : ''
    if (value === 0) continue
    if (text.length > 0 && isNumericText(text) && parseNumberCell(text) === 0) continue
    filled += 1
  }
  return filled / dataRows.length
}

function claimsForColumn(sourceIndex: number, sourceHeader: string, fillRate: number): ColumnClaim[] {
  const normalized = normalizeHeaderLabel(sourceHeader)
  if (!normalized) return []
  const claims: ColumnClaim[] = []
  for (const entry of ALIAS_INDEX) {
    if (entry.normalized === normalized) {
      claims.push({
        sourceIndex,
        sourceHeader,
        key: entry.key,
        confidence: 'exact',
        matchedOn: entry.alias,
        score: entry.normalized.length,
        fillRate,
      })
    }
  }
  if (claims.length > 0) return claims
  for (const entry of ALIAS_INDEX) {
    if (entry.normalized.length >= 3 && normalized.includes(entry.normalized)) {
      claims.push({
        sourceIndex,
        sourceHeader,
        key: entry.key,
        confidence: 'alias',
        matchedOn: entry.alias,
        score: entry.normalized.length,
        fillRate,
      })
      continue
    }
    if (normalized.length >= 3 && entry.normalized.includes(normalized)) {
      claims.push({
        sourceIndex,
        sourceHeader,
        key: entry.key,
        confidence: 'alias',
        matchedOn: entry.alias,
        score: normalized.length * 0.9,
        fillRate,
      })
    }
  }
  if (claims.length > 0) return claims
  for (const entry of ALIAS_INDEX) {
    const similarity = diceCoefficient(normalized, entry.normalized)
    if (similarity >= 0.8) {
      claims.push({
        sourceIndex,
        sourceHeader,
        key: entry.key,
        confidence: 'fuzzy',
        matchedOn: entry.alias,
        score: similarity,
        fillRate,
      })
    }
  }
  return claims
}

function compareClaims(left: ColumnClaim, right: ColumnClaim): number {
  if (CONFIDENCE_RANK[left.confidence] !== CONFIDENCE_RANK[right.confidence]) {
    return CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence]
  }
  if (left.score !== right.score) return right.score - left.score
  if (left.fillRate !== right.fillRate) return right.fillRate - left.fillRate
  return left.sourceIndex - right.sourceIndex
}

/**
 * Detects the target field of every source column. `dataRows` is optional — without it the
 * fill-rate tiebreak cannot run and ties resolve to the leftmost column.
 */
export function detectColumnMappings(options: {
  headers: readonly (string | null | undefined)[]
  dataRows?: readonly (readonly unknown[])[]
}): ColumnDetectionResult {
  const headers = options.headers.map((header) => (header == null ? '' : String(header)))
  const dataRows = options.dataRows ?? []
  const claimsByField = new Map<SourceFieldKey, ColumnClaim[]>()
  const columnClaims = new Map<number, ColumnClaim>()
  for (let sourceIndex = 0; sourceIndex < headers.length; sourceIndex += 1) {
    const sourceHeader = headers[sourceIndex]
    if (!sourceHeader.trim()) continue
    const fillRate = columnFillRate(dataRows, sourceIndex)
    const claims = claimsForColumn(sourceIndex, sourceHeader, fillRate)
    if (claims.length === 0) continue
    claims.sort(compareClaims)
    const best = claims[0]
    columnClaims.set(sourceIndex, best)
    const existing = claimsByField.get(best.key) ?? []
    existing.push(best)
    claimsByField.set(best.key, existing)
  }

  const winnerByField = new Map<SourceFieldKey, ColumnClaim>()
  const duplicateTargets: SourceFieldKey[] = []
  for (const [key, claims] of claimsByField) {
    const sorted = Array.from(claims).sort(compareClaims)
    winnerByField.set(key, sorted[0])
    if (sorted.length > 1) duplicateTargets.push(key)
  }
  const winnerByColumn = new Map<number, ColumnClaim>()
  for (const claim of winnerByField.values()) winnerByColumn.set(claim.sourceIndex, claim)

  const columns: DetectedColumnMapping[] = []
  const columnMap: ColumnMap = {}
  const unmappedColumns: number[] = []
  for (let sourceIndex = 0; sourceIndex < headers.length; sourceIndex += 1) {
    const sourceHeader = headers[sourceIndex]
    const claim = columnClaims.get(sourceIndex)
    const winner = winnerByColumn.get(sourceIndex)
    if (!claim) {
      columns.push({
        sourceIndex,
        sourceHeader,
        targetField: null,
        confidence: 'none',
        status: 'unmapped',
        reason: 'no_alias_match',
      })
      if (sourceHeader.trim()) unmappedColumns.push(sourceIndex)
      continue
    }
    const field = SOURCE_FIELD_BY_KEY[claim.key]
    if (winner && winner.key === claim.key) {
      if (field.kind !== 'ignored' && claim.fillRate === 0) {
        columns.push({
          sourceIndex,
          sourceHeader,
          targetField: null,
          confidence: claim.confidence,
          status: 'unmapped',
          reason: 'all_zero_values',
          matchedOn: claim.matchedOn,
        })
        unmappedColumns.push(sourceIndex)
        continue
      }
      columns.push({
        sourceIndex,
        sourceHeader,
        targetField: claim.key,
        confidence: claim.confidence,
        status: field.kind === 'ignored' ? 'ignored' : 'mapped',
        matchedOn: claim.matchedOn,
        reason: field.kind === 'ignored' ? 'ignored_by_catalog' : undefined,
      })
      columnMap[claim.key] = { sourceIndex, sourceHeader }
      continue
    }
    columns.push({
      sourceIndex,
      sourceHeader,
      targetField: null,
      confidence: claim.confidence,
      status: 'unmapped',
      reason: 'duplicate_target',
      matchedOn: claim.matchedOn,
      duplicateOfField: claim.key,
    })
    unmappedColumns.push(sourceIndex)
  }

  return { columns, columnMap, duplicateTargets, unmappedColumns }
}

/** Rebuilds the detection view for a mapping the operator (or a saved profile) supplied. */
export function mappingsFromColumnMap(
  headers: readonly (string | null | undefined)[],
  columnMap: ColumnMap,
): DetectedColumnMapping[] {
  const fieldByColumn = new Map<number, SourceFieldKey>()
  for (const [key, entry] of Object.entries(columnMap)) {
    if (entry && Number.isInteger(entry.sourceIndex)) fieldByColumn.set(entry.sourceIndex, key as SourceFieldKey)
  }
  return headers.map((header, sourceIndex) => {
    const sourceHeader = header == null ? '' : String(header)
    const key = fieldByColumn.get(sourceIndex)
    if (!key) {
      return { sourceIndex, sourceHeader, targetField: null, confidence: 'none', status: 'unmapped', reason: 'no_alias_match' }
    }
    const field = SOURCE_FIELD_BY_KEY[key]
    const claims = claimsForColumn(sourceIndex, sourceHeader, 1)
    const matched = claims.find((claim) => claim.key === key)
    return {
      sourceIndex,
      sourceHeader,
      targetField: key,
      confidence: matched?.confidence ?? 'alias',
      status: field && field.kind === 'ignored' ? 'ignored' : 'mapped',
      matchedOn: matched?.matchedOn,
      reason: field && field.kind === 'ignored' ? 'ignored_by_catalog' : undefined,
    }
  })
}

/** True when every canonical template header is present in the sheet's header row. */
export function isTemplateHeaderRow(headers: readonly (string | null | undefined)[]): boolean {
  const present = new Set(headers.map((header) => normalizeHeaderLabel(header ?? '')).filter((header) => header.length > 0))
  return TEMPLATE_HEADERS.every((header) => present.has(normalizeHeaderLabel(header)))
}

/** Column map of a workbook that uses the standard template. */
export function templateColumnMap(headers: readonly (string | null | undefined)[]): ColumnMap {
  const lookup = new Map<string, number>()
  headers.forEach((header, index) => {
    const normalized = normalizeHeaderLabel(header ?? '')
    if (normalized && !lookup.has(normalized)) lookup.set(normalized, index)
  })
  const columnMap: ColumnMap = {}
  for (const column of TEMPLATE_COLUMNS) {
    const sourceIndex = lookup.get(normalizeHeaderLabel(column.header))
    if (sourceIndex === undefined) continue
    columnMap[column.key] = { sourceIndex, sourceHeader: String(headers[sourceIndex] ?? column.header) }
  }
  return columnMap
}

/**
 * Best-effort currency detection from header labels (`Unit Cost CNY`, `CNY/PC`) so the
 * operator does not have to type it. Returns null when no label names a currency; the
 * quotation then keeps its own default.
 */
export function inferCurrencyFromHeaders(headers: readonly (string | null | undefined)[]): string | null {
  for (const header of headers) {
    const normalized = normalizeHeaderLabel(header ?? '')
    if (!normalized) continue
    const upper = String(header ?? '').toUpperCase()
    if (/\bCNY\b|\bRMB\b|人民币|￥|¥/.test(upper)) return 'CNY'
    if (/\bUSD\b|US\$|美元/.test(upper)) return 'USD'
    if (/\bEUR\b|欧元|€/.test(upper)) return 'EUR'
    if (/\bRUB\b|卢布|₽/.test(upper)) return 'RUB'
    if (/\bHKD\b|港币/.test(upper)) return 'HKD'
    if (/\bJPY\b|日元|円/.test(upper)) return 'JPY'
    for (const entry of CURRENCY_TOKENS) {
      if (entry.tokens.some((token) => normalized.includes(normalizeHeaderLabel(token)))) return entry.code
    }
  }
  return null
}
