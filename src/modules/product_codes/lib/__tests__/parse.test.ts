import { describe, expect, it } from '@jest/globals'
import { parseCode, type ParseRule } from '../parse'

/**
 * Reverse parsing — the half that makes legacy codes liveable.
 *
 * The rule that matters most here is the negative one: a code no rule describes must come back as
 * `none` with no error, because the PetKit-era codes are exactly that, and refusing to explain them
 * would make every legacy row look broken.
 */

const RULE: ParseRule = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'SKU 型号',
  isActive: true,
  separator: '-',
  serialLength: 3,
  segments: [
    { kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 2, upper: true, join: false },
    { kind: 'dictionary', key: 'category', dictionaryKey: 'product_category', length: 2, upper: true, join: false },
    { kind: 'serial', key: 'serial', length: 3, join: true },
  ],
}

const VALUES = { product_brand: ['SP', 'PK'], product_category: ['CL', 'TP'] }
const LABELS = { product_brand: { PK: 'PetKit', SP: 'Super pawers' }, product_category: { CL: '猫砂', TP: '尿片' } }

const parse = (code: string, ledgerHit: Parameters<typeof parseCode>[0]['ledgerHit'] = null) =>
  parseCode({ code, ledgerHit, rules: [RULE], values: VALUES, labels: LABELS })

describe('parseCode', () => {
  it('reports an issued code from the ledger row, not from re-reading the characters', () => {
    const result = parse('PK-CL007', {
      ruleId: RULE.id,
      brandValue: 'PK',
      categoryValue: 'CL',
      serial: 7,
    })
    expect(result.status).toBe('issued')
    expect(result.source).toBe('generated')
    expect(result.parts.map((part) => [part.value, part.label])).toEqual([
      ['PK', 'PetKit'],
      ['CL', '猫砂'],
      ['007', null],
    ])
  })

  it('recognises a hand-typed code that matches the rule with every value registered', () => {
    const result = parse('SP-TP012')
    expect(result.status).toBe('full')
    expect(result.source).toBe('unissued')
    expect(result.ruleName).toBe('SKU 型号')
  })

  it('marks an unregistered value instead of failing the whole code', () => {
    const result = parse('ZZ-CL012')
    expect(result.status).toBe('partial')
    expect(result.parts[0]).toEqual({ key: 'brand', kind: 'dictionary', value: 'ZZ', label: null, known: false })
    expect(result.parts[1]?.label).toBe('猫砂')
  })

  it('explains a PetKit-era code as 沿用旧码 without an error', () => {
    const result = parse('P4108-UVC')
    expect(result.status).toBe('none')
    expect(result.parts).toEqual([])
    expect(result.ruleId).toBeNull()
  })

  it('ignores an inactive rule', () => {
    const result = parseCode({
      code: 'PK-CL007',
      ledgerHit: null,
      rules: [{ ...RULE, isActive: false }],
      values: VALUES,
      labels: LABELS,
    })
    expect(result.status).toBe('none')
  })

  it('reads a separator-less rule by declared widths', () => {
    const noSeparator: ParseRule = {
      ...RULE,
      separator: '',
      segments: [
        { kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 2, upper: true, join: false },
        { kind: 'serial', key: 'serial', length: 3, join: true },
      ],
    }
    const result = parseCode({ code: 'PK007', ledgerHit: null, rules: [noSeparator], values: VALUES, labels: LABELS })
    expect(result.status).toBe('full')
    expect(result.parts.map((part) => part.value)).toEqual(['PK', '007'])
  })
})
