import { describe, expect, it } from '@jest/globals'
import { breakdownFor, formatCode, padSerial, readSegments, validateRuleShape, type CodeRuleShape } from '../ruleModel'

/**
 * The rule model: what a rule may look like, and what it produces.
 *
 * The interesting cases are the ones that decide whether a *rule* can be saved — a rule that can
 * emit an illegal or over-long code must be refused before any number is issued under it, because
 * afterwards the damage is a code that `products.items.create` rejects at 建档 time.
 */

const SHAPE: CodeRuleShape = {
  segments: [
    { kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 2, upper: true, join: false },
    { kind: 'dictionary', key: 'category', dictionaryKey: 'product_category', length: 2, upper: true, join: false },
    { kind: 'serial', key: 'serial', length: 3, join: true },
  ],
  separator: '-',
  serialLength: 3,
}

const DICTIONARIES = { product_brand: ['SP', 'PK'], product_category: ['CL', 'TP'] }

describe('readSegments', () => {
  it('accepts the shape the rule editor writes', () => {
    expect(readSegments(SHAPE.segments)).toEqual(SHAPE.segments)
  })

  it('rejects a malformed column instead of throwing', () => {
    expect(readSegments(null)).toBeNull()
    expect(readSegments([])).toBeNull()
    expect(readSegments([{ kind: 'serial', key: 'serial', length: 0, join: false }])).toBeNull()
    expect(readSegments([{ kind: 'dictionary', key: 'Brand', dictionaryKey: 'product_brand', length: 2 }])).toBeNull()
  })
})

describe('validateRuleShape', () => {
  it('accepts a rule whose dictionaries fit their declared widths', () => {
    expect(validateRuleShape(SHAPE, DICTIONARIES)).toBeNull()
  })

  it('requires exactly one serial segment', () => {
    const twoSerials: CodeRuleShape = {
      ...SHAPE,
      segments: [...SHAPE.segments, { kind: 'serial', key: 'serial', length: 2, join: false }],
    }
    expect(validateRuleShape(twoSerials, DICTIONARIES)).toBe('rule_requires_single_serial')
  })

  it('refuses a separator outside the SKU charset', () => {
    expect(validateRuleShape({ ...SHAPE, separator: '#' }, DICTIONARIES)).toBe('rule_separator_invalid')
  })

  it('refuses a value the SKU charset cannot carry', () => {
    expect(validateRuleShape(SHAPE, { ...DICTIONARIES, product_brand: ['SP', '猫砂'] })).toBe('rule_value_charset_invalid')
  })

  it('refuses a value wider than its declared segment', () => {
    expect(validateRuleShape(SHAPE, { ...DICTIONARIES, product_brand: ['SUPERPAWERS'] })).toBe('rule_value_too_long')
  })

  it('refuses a rule whose worst case exceeds the SKU length', () => {
    const wide: CodeRuleShape = {
      ...SHAPE,
      serialLength: 8,
      segments: [
        { kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 40, upper: true, join: false },
        { kind: 'dictionary', key: 'category', dictionaryKey: 'product_category', length: 40, upper: true, join: false },
        { kind: 'serial', key: 'serial', length: 8, join: true },
      ],
    }
    expect(validateRuleShape(wide, { product_brand: ['S'.repeat(30)], product_category: ['C'.repeat(30)] })).toBe('rule_too_long')
  })

  it('tolerates an empty dictionary: a new code list must be creatable', () => {
    expect(validateRuleShape(SHAPE, { product_brand: [], product_category: [] })).toBeNull()
  })
})

describe('formatCode', () => {
  it('builds the code the business writes by hand', () => {
    expect(formatCode(SHAPE, { brandValue: 'pk', categoryValue: 'cl', serial: 1 })).toBe('PK-CL001')
  })

  it('reports a missing value instead of inventing one', () => {
    expect(formatCode(SHAPE, { brandValue: '', categoryValue: 'CL', serial: 1 })).toBeNull()
    expect(formatCode(SHAPE, { brandValue: 'PK', categoryValue: null, serial: 1 })).toBeNull()
  })

  it('widens the serial rather than truncating it once the counter passes its width', () => {
    expect(formatCode(SHAPE, { brandValue: 'PK', categoryValue: 'CL', serial: 1234 })).toBe('PK-CL1234')
  })
})

describe('breakdownFor', () => {
  it('carries the dictionary label for every known value', () => {
    const parts = breakdownFor(SHAPE, { brandValue: 'PK', categoryValue: 'CL', serial: 7 }, {
      product_brand: { PK: 'PetKit' },
      product_category: { CL: '猫砂' },
    })
    expect(parts.map((part) => [part.value, part.label, part.known])).toEqual([
      ['PK', 'PetKit', true],
      ['CL', '猫砂', true],
      ['007', null, true],
    ])
  })

  it('keeps an unregistered value visible and marks it unknown', () => {
    const parts = breakdownFor(SHAPE, { brandValue: 'ZZ', categoryValue: 'CL', serial: 7 }, {
      product_brand: { PK: 'PetKit' },
      product_category: { CL: '猫砂' },
    })
    expect(parts[0]).toEqual({ key: 'brand', kind: 'dictionary', value: 'ZZ', label: null, known: false })
  })
})

describe('padSerial', () => {
  it('pads to the rule width and leaves a wider counter alone', () => {
    expect([padSerial(1, 3), padSerial(42, 3), padSerial(1234, 3)]).toEqual(['001', '042', '1234'])
  })
})
