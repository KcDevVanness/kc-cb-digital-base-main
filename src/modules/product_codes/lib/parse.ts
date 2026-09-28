import type { ProductCodeLedgerEntry, ProductCodeRule } from '../data/entities'
import { breakdownFor, readSegments, type CodePart, type CodeRuleShape, type CodeSegment } from './ruleModel'

/**
 * Reverse parsing — reading a code the system did not necessarily issue.
 *
 * The rule shapes come from the same `ruleModel` the generator formats with, so a breakdown can never
 * disagree with the code that was produced. Three outcomes, and none of them is an error:
 *
 * - `issued` — the ledger holds this code. The breakdown is rebuilt from the ledger row itself
 *   (its brand/category/serial), so it stays truthful even if the rule was edited afterwards.
 * - `full` — a rule's shape matches and every value is in its dictionary.
 * - `partial` — the shape matches but at least one value is not registered (shown as-is, marked 未登记).
 * - `none` — no rule's shape matches: a legacy or hand-typed code, displayed as 沿用旧码.
 *
 * This is what lets the PetKit-era codes live next to generated ones: they are data, not a failure, and
 * nothing about reading them writes to the database.
 */

export type ParseStatus = 'issued' | 'full' | 'partial' | 'none'

export type ParseResult = {
  code: string
  status: ParseStatus
  /** `generated` when the ledger issued it; `unissued` for anything else. */
  source: 'generated' | 'unissued'
  ruleId: string | null
  ruleName: string | null
  parts: CodePart[]
}

export type ParseRule = Pick<ProductCodeRule, 'id' | 'name' | 'segments' | 'separator' | 'serialLength' | 'isActive'>

export type ParseLedgerHit = Pick<ProductCodeLedgerEntry, 'ruleId' | 'brandValue' | 'categoryValue' | 'serial'>

function shapeOf(rule: ParseRule): CodeRuleShape | null {
  const segments = readSegments(rule.segments)
  if (!segments) return null
  return { segments, separator: rule.separator, serialLength: rule.serialLength }
}

/**
 * Segments grouped into the tokens a separator actually separates: a segment that declares `join`
 * belongs to the previous segment's token (`SP` + `-` + `CL001`). Reading a code means undoing the
 * same grouping the formatter applied, which is why this walks the rule rather than guessing.
 */
function groupSegments(segments: CodeSegment[]): CodeSegment[][] {
  const groups: CodeSegment[][] = []
  for (const segment of segments) {
    if (segment.join && groups.length > 0) groups[groups.length - 1].push(segment)
    else groups.push([segment])
  }
  return groups
}

/**
 * One structural reading of a code against one rule. Returns the parts when the shape fits, and
 * `null` when it does not — a rule that cannot describe the code must not be forced to.
 */
function matchShape(
  code: string,
  shape: CodeRuleShape,
  values: Record<string, string[]>,
  labels: Record<string, Record<string, string>>,
): { parts: CodePart[]; known: number } | null {
  const groups = groupSegments(shape.segments)
  const pieces = shape.separator.length > 0 ? code.split(shape.separator) : [code]
  if (pieces.length !== groups.length) return null

  const parts: CodePart[] = []
  let known = 0
  for (const [index, group] of groups.entries()) {
    const token = pieces[index]
    let offset = 0
    for (const [position, segment] of group.entries()) {
      const isLastInToken = position === group.length - 1
      // Leading segments of a token are fixed width (that is what `length` declares); the last one
      // absorbs the remainder, which is what lets a counter outgrow its padding (`CL1000`).
      const text = isLastInToken ? token.slice(offset) : token.slice(offset, offset + segment.length)
      offset += text.length
      if (text.length === 0) return null
      if (segment.kind === 'serial') {
        if (!/^\d+$/.test(text)) return null
        parts.push({ key: segment.key, kind: 'serial', value: text, label: null, known: true })
        continue
      }
      const dictionary = values[segment.dictionaryKey] ?? []
      const candidates = new Set(dictionary.map((value) => (segment.upper ? value.toUpperCase() : value)))
      // `known` is membership; `label` is what the operator reads. Both come from the same code list,
      // so an unregistered value keeps its raw characters and is marked unknown rather than dropped.
      const registered = candidates.has(text)
      if (registered) known += 1
      parts.push({
        key: segment.key,
        kind: 'dictionary',
        value: text,
        label: registered ? labels[segment.dictionaryKey]?.[text] ?? text : null,
        known: registered,
      })
    }
    if (offset !== token.length) return null
  }
  return { parts, known }
}

/**
 * Explains one code. `ledgerHit` is the row the caller already looked up (a code is issued at most
 * once, so the lookup is a single indexed read).
 */
export function parseCode(input: {
  code: string
  ledgerHit: ParseLedgerHit | null
  rules: readonly ParseRule[]
  values: Record<string, string[]>
  labels: Record<string, Record<string, string>>
}): ParseResult {
  const { code, ledgerHit, rules, values, labels } = input

  if (ledgerHit) {
    const rule = rules.find((candidate) => candidate.id === ledgerHit.ruleId) ?? null
    const shape = rule ? shapeOf(rule) : null
    const parts = shape
      ? breakdownFor(
          shape,
          { brandValue: ledgerHit.brandValue, categoryValue: ledgerHit.categoryValue, serial: ledgerHit.serial },
          labels,
        )
      : []
    return { code, status: 'issued', source: 'generated', ruleId: rule?.id ?? null, ruleName: rule?.name ?? null, parts }
  }

  let partial: { rule: ParseRule; parts: CodePart[] } | null = null
  for (const rule of rules) {
    if (rule.isActive !== true) continue
    const shape = shapeOf(rule)
    if (!shape) continue
    const match = matchShape(code, shape, values, labels)
    if (!match) continue
    if (match.known === shape.segments.filter((segment) => segment.kind === 'dictionary').length) {
      return { code, status: 'full', source: 'unissued', ruleId: rule.id, ruleName: rule.name, parts: match.parts }
    }
    // Keep the first shape that fits structurally; a later rule matching only loosely would not be a
    // better explanation of the same characters.
    partial ??= { rule, parts: match.parts }
  }

  if (partial) {
    return {
      code,
      status: 'partial',
      source: 'unissued',
      ruleId: partial.rule.id,
      ruleName: partial.rule.name,
      parts: partial.parts,
    }
  }
  return { code, status: 'none', source: 'unissued', ruleId: null, ruleName: null, parts: [] }
}
