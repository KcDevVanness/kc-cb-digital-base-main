/**
 * Cell-level value normalization for supplier quotations.
 *
 * Every rule here exists because a real supplier file needed it:
 * `PETKIT Quotation Sheet-2026_NEW.xlsx` uses `/` for "no value", spells MOQ as
 * `10 pallets`, and writes packing sizes as `46.5*46.5*40cm`; `订单表-2026 EXW.xls`
 * writes the same sizes as `0.46*0.47*0.41` (metres, no unit suffix). The normalized
 * fields power the review grid; the raw text stays on the quotation line, so a
 * heuristic that guesses wrong is always recoverable by the operator.
 */

/** Text that means "no value" in the supplier files rather than a literal value. */
export const NULL_TOKENS: Record<string, true> = {
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

/** Units that may trail a MOQ value without making it a non-numeric quantity. */
const MOQ_UNIT_WORDS: Record<string, true> = {
  pc: true,
  pcs: true,
  piece: true,
  pieces: true,
  unit: true,
  units: true,
  set: true,
  sets: true,
  bag: true,
  bags: true,
}

/** Currency noise stripped before number parsing. */
const CURRENCY_PREFIX_PATTERN = /(?:rmb|cny|usd|eur|rub|hkd|jpy|us\$|cn¥|¥|￥|\$|€|₽)\s*/gi

export type Dimensions = {
  length: number | null
  width: number | null
  height: number | null
  unit: string
}

export type MoqParseResult = {
  quantity: number | null
  raw: string | null
  warning?: 'moq_partial' | 'moq_not_numeric'
}

/**
 * True when the value is absent or one of the "no value" tokens. Numbers and booleans
 * are always real values, so a `0` price survives normalization.
 */
export function isNullToken(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'number' || typeof value === 'boolean') return false
  return NULL_TOKENS[String(value).trim().toLowerCase()] === true
}

/**
 * Collapses whitespace without destroying the line structure: supplier names and
 * descriptions use newlines as separators (`Eversweet 3 Pro\n(Wireless Pump)`), and the
 * variant-suffix rule reads those lines.
 */
export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** Cell value as display text; numbers keep a plain decimal representation. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return normalizeWhitespace(String(value))
}

/**
 * Parses a numeric cell. Handles numbers, numeric strings, thousands separators,
 * currency symbols and a trailing unit word (`230 CNY`, `1,250.5`, `0.405 kg`).
 * Returns null for empty tokens and for values with no usable number.
 */
export function parseNumberCell(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = cellToText(value)
  if (isNullToken(text)) return null
  const cleaned = text.replace(CURRENCY_PREFIX_PATTERN, '').replace(/,/g, '').replace(/\s+/g, ' ').trim()
  const match = cleaned.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Parses an integer cell (MOQ, carton quantity, carton count); fractional values round
 * to the nearest integer because the product master stores those columns as integers.
 */
export function parseIntegerCell(value: unknown): number | null {
  const parsed = parseNumberCell(value)
  if (parsed === null) return null
  return Math.round(parsed)
}

/**
 * Builds a centimetre dimension triple from three separate numbers (the `.xls` invoice keeps
 * `L`/`W`/`H` in their own columns). The metre heuristic is shared with `parseDimensionsCell`:
 * a maximum of 3 or less means the supplier wrote metres, so the values scale to centimetres.
 * Returns null unless both length and width are present.
 */
export function normalizeDimensionTriple(
  length: number | null,
  width: number | null,
  height: number | null,
): Dimensions | null {
  if (length === null || width === null) return null
  const present = [length, width, height].filter((value): value is number => value !== null)
  const scale = Math.max(...present) <= 3 ? 100 : 1
  const toCentimetres = (input: number) => Math.round(input * scale * 100) / 100
  return {
    length: toCentimetres(length),
    width: toCentimetres(width),
    height: height === null ? null : toCentimetres(height),
    unit: 'cm',
  }
}

/**
 * Parses a packing/dimension cell into centimetres.
 *
 * `46.5*46.5*40cm`, `48.5*44*26.3cm`, `33*2`, `0.465*0.465*0.4` and `42*042*41` all occur
 * in the two reference files. Rule: split on `*`, `x` or `×`; honour a trailing unit when
 * present (`cm`/`mm`/`m`), otherwise treat a maximum value of 3 or less as metres (the
 * `.xls` file writes metres with no unit) and everything else as centimetres. Two-value
 * cells are allowed (length, width) with a null height.
 */
export function parseDimensionsCell(value: unknown): Dimensions | null {
  if (value === null || value === undefined) return null
  const text = cellToText(value)
  if (isNullToken(text)) return null
  const cleaned = text.toLowerCase().replace(/\s+/g, '')
  const unitSuffix = cleaned.match(/(cm|mm|m)$/)?.[1] ?? null
  const body = unitSuffix ? cleaned.slice(0, -unitSuffix.length) : cleaned
  const numbers: number[] = []
  for (const part of body.split(/[*x×,]/)) {
    const parsed = parseNumberCell(part)
    if (parsed !== null) numbers.push(parsed)
  }
  if (numbers.length < 2) return null
  if (unitSuffix === 'mm') {
    const toCentimetres = (input: number) => Math.round(input * 10 * 100) / 100
    return {
      length: toCentimetres(numbers[0]),
      width: toCentimetres(numbers[1]),
      height: numbers.length > 2 ? toCentimetres(numbers[2]) : null,
      unit: 'cm',
    }
  }
  const explicitMetres = unitSuffix === 'm'
  const triple = normalizeDimensionTriple(numbers[0], numbers[1], numbers.length > 2 ? numbers[2] : null)
  if (!triple) return null
  if (!explicitMetres || Math.max(...numbers) > 3) return triple
  // An explicit `m` suffix with values above 3 is inconsistent data; the heuristic already scaled it.
  return triple
}

const PUNCTUATION_PLACEHOLDERS: Record<string, true> = { '': true, '/': true, '／': true, '-': true, '－': true, '—': true, '–': true }

/**
 * Parses a MOQ cell. `10 pallets` keeps the raw text, yields quantity 10 and reports
 * `moq_partial`; a value with no digits reports `moq_not_numeric` with a null quantity so the
 * caller falls back to a minimum quantity of 1.
 *
 * Punctuation placeholders carry no information and become null; word placeholders (`TBD`,
 * `待定`) keep their text so the review grid can show what the supplier actually wrote.
 */
export function parseMoqCell(value: unknown): MoqParseResult {
  if (value === null || value === undefined) return { quantity: null, raw: null }
  const text = cellToText(value)
  if (isNullToken(value)) {
    return PUNCTUATION_PLACEHOLDERS[text.trim().toLowerCase()] === true
      ? { quantity: null, raw: null }
      : { quantity: null, raw: text, warning: 'moq_not_numeric' }
  }
  const raw = text
  const digitMatch = raw.match(/\d+(?:[.,]\d+)?/)
  if (!digitMatch) return { quantity: null, raw, warning: 'moq_not_numeric' }
  const quantity = parseIntegerCell(digitMatch[0])
  if (quantity === null) return { quantity: null, raw, warning: 'moq_not_numeric' }
  const remainder = raw
    .replace(digitMatch[0], ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[.,:;*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const leftoverTokens = remainder.split(' ').filter((token) => token.length > 0 && MOQ_UNIT_WORDS[token] !== true)
  return leftoverTokens.length > 0 ? { quantity, raw, warning: 'moq_partial' } : { quantity, raw }
}

/**
 * Splits a product name into a base line and its variant tokens. Names in the reference
 * files look like `Eversweet 3 Pro\n(Wireless Pump)`, `Fountain Cube\n5pcs` and
 * `Wireless Water Pump- heat resistant`.
 */
export function splitVariantName(value: string | null | undefined): { base: string; variantTokens: string[] } {
  const text = value ? normalizeWhitespace(String(value)) : ''
  if (!text) return { base: '', variantTokens: [] }
  const lines = text.split('\n')
  const base = lines[0].replace(/[-–—]\s*$/, '').trim()
  const variantTokens: string[] = []
  for (const line of lines.slice(1)) {
    for (const token of line.replace(/^\((.*)\)$/, '$1').split(/[\s,;]+/)) {
      const cleaned = token.replace(/^[-–—]+/, '').replace(/[-–—]+$/, '').trim()
      if (cleaned.length > 0) variantTokens.push(cleaned)
    }
  }
  return { base, variantTokens }
}

/**
 * Lowercase slug used when a line has no Item No. Only ASCII alphanumerics survive,
 * because `products_products.sku` accepts `[A-Za-z0-9._\-/]`; a CJK-only name therefore
 * slugs to an empty string and the caller flags the line as needing a manual SKU.
 */
export function slugifySku(value: string | null | undefined): string {
  if (!value) return ''
  const slug = normalizeWhitespace(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug.slice(0, 40).replace(/-$/, '')
}
