import { describe, expect, it } from '@jest/globals'
import {
  NULL_TOKENS,
  isNullToken,
  normalizeWhitespace,
  parseDimensionsCell,
  parseIntegerCell,
  parseMoqCell,
  parseNumberCell,
  slugifySku,
  splitVariantName,
} from '../valueNormalization'

describe('valueNormalization', () => {
  it('treats the placeholders used in real supplier files as empty, and zero as a value', () => {
    for (const token of ['', '   ', '/', '-', '—', 'N/A', 'n.a.', 'TBD', '待定', '无']) {
      expect(isNullToken(token)).toBe(true)
    }
    expect(NULL_TOKENS['/']).toBe(true)
    expect(isNullToken(0)).toBe(false)
    expect(isNullToken('0')).toBe(false)
    expect(isNullToken(false)).toBe(false)
  })

  it('collapses whitespace but keeps the line structure of a multi-line name', () => {
    expect(normalizeWhitespace('  Eversweet 3 Pro \r\n  (Wireless Pump)  ')).toBe('Eversweet 3 Pro\n(Wireless Pump)')
    expect(normalizeWhitespace('Wireless   Pump\n\n 15pcs ')).toBe('Wireless Pump\n15pcs')
  })

  it('parses the numeric shapes the PetKit and WPS files actually contain', () => {
    expect(parseNumberCell(230)).toBe(230)
    expect(parseNumberCell('230')).toBe(230)
    expect(parseNumberCell('1,276.8')).toBe(1276.8)
    expect(parseNumberCell('0.405')).toBe(0.405)
    expect(parseNumberCell(0)).toBe(0)
    expect(parseNumberCell('/')).toBeNull()
    expect(parseNumberCell('')).toBeNull()
    expect(parseNumberCell('tbd')).toBeNull()
    expect(parseNumberCell('Material: ABS')).toBeNull()
    expect(parseNumberCell('￥ 68')).toBe(68)
    expect(parseIntegerCell('10 pallets')).toBe(10)
    expect(parseIntegerCell('19.6')).toBe(20)
  })

  it('normalizes packing sizes to centimetres across both reference files', () => {
    expect(parseDimensionsCell('46.5*46.5*40cm')).toEqual({ length: 46.5, width: 46.5, height: 40, unit: 'cm' })
    expect(parseDimensionsCell('21.9*21.9*18.5')).toEqual({ length: 21.9, width: 21.9, height: 18.5, unit: 'cm' })
    expect(parseDimensionsCell('0.58*0.395*0.455')).toEqual({ length: 58, width: 39.5, height: 45.5, unit: 'cm' })
    expect(parseDimensionsCell('33*2')).toEqual({ length: 33, width: 2, height: null, unit: 'cm' })
    expect(parseDimensionsCell('42*042*41')).toEqual({ length: 42, width: 42, height: 41, unit: 'cm' })
    expect(parseDimensionsCell('48.5 × 46.5 x 20')).toEqual({ length: 48.5, width: 46.5, height: 20, unit: 'cm' })
    expect(parseDimensionsCell('100*120*198')).toEqual({ length: 100, width: 120, height: 198, unit: 'cm' })
    expect(parseDimensionsCell('58*57*63.5')).toEqual({ length: 58, width: 57, height: 63.5, unit: 'cm' })
    expect(parseDimensionsCell('/')).toBeNull()
    expect(parseDimensionsCell('34')).toBeNull()
  })

  it('keeps a non-numeric MOQ raw value while still extracting its quantity', () => {
    expect(parseMoqCell('10 pallets')).toEqual({ quantity: 10, raw: '10 pallets', warning: 'moq_partial' })
    expect(parseMoqCell('500')).toEqual({ quantity: 500, raw: '500' })
    expect(parseMoqCell('500 pcs')).toEqual({ quantity: 500, raw: '500 pcs' })
    expect(parseMoqCell('MOQ 40 pcs')).toEqual({ quantity: 40, raw: 'MOQ 40 pcs', warning: 'moq_partial' })
    expect(parseMoqCell('待定')).toEqual({ quantity: null, raw: '待定', warning: 'moq_not_numeric' })
    expect(parseMoqCell('/')).toEqual({ quantity: null, raw: null })
  })

  it('splits a product name into its base line and variant tokens', () => {
    expect(splitVariantName('Eversweet 3 Pro\n(Wireless Pump)')).toEqual({
      base: 'Eversweet 3 Pro',
      variantTokens: ['Wireless', 'Pump'],
    })
    expect(splitVariantName('Fountain Cube\n5pcs')).toEqual({ base: 'Fountain Cube', variantTokens: ['5pcs'] })
    // A single-line name stays whole: the base is what identifies the product.
    expect(splitVariantName('Wireless Water Pump- heat resistant')).toEqual({
      base: 'Wireless Water Pump- heat resistant',
      variantTokens: [],
    })
    expect(splitVariantName('Purobot Max 3\nSelf-Cleaning Cat Litter Box')).toEqual({
      base: 'Purobot Max 3',
      variantTokens: ['Self-Cleaning', 'Cat', 'Litter', 'Box'],
    })
    expect(splitVariantName(null)).toEqual({ base: '', variantTokens: [] })
  })

  it('slugs only what the SKU character set allows', () => {
    expect(slugifySku('Wireless Water Pump')).toBe('wireless-water-pump')
    expect(slugifySku('Cat Harness/Leash Pink')).toBe('cat-harness-leash-pink')
    expect(slugifySku('Crystal Cat Litter - White 4bags/set')).toBe('crystal-cat-litter-white-4bags-set')
    expect(slugifySku('猫用饮水机')).toBe('')
  })
})
