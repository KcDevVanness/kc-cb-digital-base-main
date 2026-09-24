import { SKU_PATTERN } from '../../products/data/validators'

/**
 * The rule model — one implementation of "what a code is made of", shared by the generator, the
 * parser and the rule editor.
 *
 * Forward generation and backward parsing must never disagree about a code's shape, so they both read
 * this file: the parser walks the same segment array the generator formatted. A second implementation
 * for "reading" a code is exactly how a breakdown starts lying about what the system issued.
 *
 * Everything here is pure — no ORM, no container — so the rule editor can validate and preview a rule
 * the operator has not saved yet, and the unit tests cover the whole model without a database.
 */

/** One segment of a rule. `serial` is the only segment that carries a counter. */
export type CodeSegment =
  | { kind: 'dictionary'; key: string; dictionaryKey: string; length: number; upper: boolean; join: boolean }
  | { kind: 'serial'; key: 'serial'; length: number; join: boolean }

export type CodeRuleShape = {
  segments: CodeSegment[]
  separator: string
  serialLength: number
}

/** The values one code is built from. `categoryValue` is absent when the rule has no category segment. */
export type CodeValues = {
  brandValue: string
  categoryValue?: string | null
  serial: number
}

/** Why a rule cannot be saved. Each code is stable and rendered as a localized message by the UI. */
export type RuleProblem =
  | 'rule_requires_single_serial'
  | 'rule_segment_invalid'
  | 'rule_separator_invalid'
  | 'rule_value_too_long'
  | 'rule_value_charset_invalid'
  | 'rule_too_long'
  | 'rule_serial_length_invalid'

export const MAX_CODE_LENGTH = 64
export const MIN_SERIAL_LENGTH = 1
export const MAX_SERIAL_LENGTH = 8
export const SEGMENT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/
export const DICTIONARY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/** `-`, `_` or nothing: a separator outside the SKU charset would make every generated code invalid. */
const ALLOWED_SEPARATORS: Record<string, true> = { '-': true, _: true, '': true }

/**
 * Narrows the jsonb column into segments, rejecting anything malformed.
 *
 * Returns `null` rather than throwing: the value can be edited by hand in the database, and a rule
 * that cannot be read must surface as "this rule is unusable" in the editor, not as a crash inside a
 * list query.
 */
export function readSegments(raw: unknown): CodeSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const segments: CodeSegment[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const record = entry as Record<string, unknown>
    const kind = record.kind
    const key = typeof record.key === 'string' ? record.key : ''
    const length = typeof record.length === 'number' ? record.length : Number(record.length)
    if (!SEGMENT_KEY_PATTERN.test(key)) return null
    if (!Number.isInteger(length) || length < 1 || length > MAX_CODE_LENGTH) return null
    if (kind === 'serial') {
      segments.push({ kind: 'serial', key: 'serial', length, join: record.join === true })
      continue
    }
    if (kind !== 'dictionary') return null
    const dictionaryKey = typeof record.dictionaryKey === 'string' ? record.dictionaryKey : ''
    if (!DICTIONARY_KEY_PATTERN.test(dictionaryKey)) return null
    segments.push({
      kind: 'dictionary',
      key,
      dictionaryKey,
      length,
      upper: record.upper === true,
      join: record.join === true,
    })
  }
  return segments
}

/**
 * Validates a rule against the values its dictionaries currently hold.
 *
 * The check is deliberately worst-case rather than average-case: a rule that *can* emit an illegal or
 * over-long code is refused at save time, because the alternative is a rule that works for today's
 * brand list and fails the first time somebody adds a longer value in 字典库 — after numbers have
 * already been issued under it.
 */
export function validateRuleShape(
  shape: CodeRuleShape,
  dictionaryValues: Record<string, readonly string[]>,
): RuleProblem | null {
  const { segments, separator, serialLength } = shape
  if (segments.length === 0) return 'rule_segment_invalid'
  if (ALLOWED_SEPARATORS[separator] !== true) return 'rule_separator_invalid'
  if (!Number.isInteger(serialLength) || serialLength < MIN_SERIAL_LENGTH || serialLength > MAX_SERIAL_LENGTH) {
    return 'rule_serial_length_invalid'
  }

  const serialSegments = segments.filter((segment) => segment.kind === 'serial')
  if (serialSegments.length !== 1) return 'rule_requires_single_serial'

  let worstCase = 0
  for (const [index, segment] of segments.entries()) {
    if (index > 0 && !segment.join) worstCase += separator.length
    if (segment.kind === 'serial') {
      worstCase += Math.max(segment.length, serialLength)
      continue
    }
    const values = dictionaryValues[segment.dictionaryKey] ?? []
    let widest = 0
    for (const value of values) {
      if (value.length > segment.length) return 'rule_value_too_long'
      const shaped = segment.upper ? value.toUpperCase() : value
      if (!SKU_PATTERN.test(shaped)) return 'rule_value_charset_invalid'
      widest = Math.max(widest, shaped.length)
    }
    // An empty dictionary is a configuration gap the generator reports when it is asked to issue a
    // code; it is not a reason to refuse the rule, or a brand-new code list could never be created.
    worstCase += Math.max(widest, segment.length)
  }

  if (worstCase > MAX_CODE_LENGTH) return 'rule_too_long'
  return null
}

/** `001` for `1` at width 3 — the repo's existing numbering convention (`padStart`), applied to codes. */
export function padSerial(serial: number, length: number): string {
  return String(serial).padStart(length, '0')
}

/** The dictionary values a rule reads, resolved to the shape the code needs (upper-cased when asked). */
function segmentValue(segment: Extract<CodeSegment, { kind: 'dictionary' }>, values: CodeValues): string | null {
  const raw = segment.key === 'brand' ? values.brandValue : segment.key === 'category' ? values.categoryValue : null
  if (raw === null || raw === undefined || raw.length === 0) return null
  return segment.upper ? raw.toUpperCase() : raw
}

/**
 * Formats a code. Returns `null` when a segment's value is missing, which is the generator's signal
 * that the caller must ask for it (`brand_required` / `category_required`) instead of guessing.
 *
 * The separator applies **between** segments unless a segment declares `join`: the business's own
 * `SP-CL001` glues the category letters to the serial (`CL` + `001`) while keeping the dash after the
 * brand, so "one separator between every pair" would produce `SP-CL-001` — a code nobody uses.
 */
export function formatCode(shape: CodeRuleShape, values: CodeValues): string | null {
  const parts: string[] = []
  for (const segment of shape.segments) {
    if (segment.kind === 'serial') {
      parts.push(padSerial(values.serial, segment.length || shape.serialLength))
      continue
    }
    const value = segmentValue(segment, values)
    if (value === null) return null
    parts.push(value)
  }
  return parts.reduce(
    (code, part, index) => (index === 0 || shape.segments[index].join ? code + part : code + shape.separator + part),
    '',
  )
}

/** One resolved part of a code, ready to render: the stored value plus its dictionary label. */
export type CodePart = {
  key: string
  kind: CodeSegment['kind']
  value: string
  /** The dictionary label (`PetKit`, `猫砂`); null when the value is not in its dictionary. */
  label: string | null
  known: boolean
}

/**
 * The breakdown of a code, in rule order — what the form, the list and the rule page render.
 *
 * A part whose value is missing from its dictionary keeps its raw value and is marked unknown rather
 * than dropped: the operator must still see *something* where the code has characters.
 */
export function breakdownFor(
  shape: CodeRuleShape,
  values: CodeValues,
  labels: Record<string, Record<string, string>>,
): CodePart[] {
  const parts: CodePart[] = []
  for (const segment of shape.segments) {
    if (segment.kind === 'serial') {
      const width = segment.length || shape.serialLength
      parts.push({ key: segment.key, kind: 'serial', value: padSerial(values.serial, width), label: null, known: true })
      continue
    }
    const value = segmentValue(segment, values) ?? ''
    const label = labels[segment.dictionaryKey]?.[value] ?? null
    parts.push({ key: segment.key, kind: 'dictionary', value, label, known: label !== null })
  }
  return parts
}
