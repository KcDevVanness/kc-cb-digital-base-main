import { describe, expect, it } from '@jest/globals'
import { canonicalize, matchKey, suggestProduct, variantSuffix } from '../skuNormalize'

describe('canonicalize', () => {
  it('uppercases and trims', () => {
    expect(canonicalize('  pk44 ')).toBe('PK44')
  })

  it('strips a Russian variant suffix, with or without a separator', () => {
    expect(canonicalize('PK44 склад')).toBe('PK44')
    expect(canonicalize('PK44склад')).toBe('PK44')
    expect(canonicalize('PK39_2фабрика')).toBe('PK39_2')
    expect(canonicalize('PK39_2PK39sklad')).toBe('PK39_2PK39')
  })

  it('strips the Latin transliteration too', () => {
    expect(canonicalize('pk44-sklad')).toBe('PK44')
  })

  it('keeps a code that is nothing but a suffix', () => {
    expect(canonicalize('склад')).toBe('СКЛАД')
  })

  it('reports the suffix it found', () => {
    expect(variantSuffix('PK44 склад')).toBe('sklad')
    expect(variantSuffix('PK44фабрика')).toBe('fabrika')
    expect(variantSuffix('PK44')).toBeNull()
  })
})

describe('matchKey', () => {
  it('compares letters and digits only, in upper case', () => {
    expect(matchKey('pk-44')).toBe('PK44')
    expect(matchKey('PK 44')).toBe('PK44')
    expect(matchKey('PK_44')).toBe('PK44')
    expect(matchKey('P4108-UVC')).toBe('P4108UVC')
  })

  it('keeps non-Latin identifiers comparable', () => {
    expect(matchKey('РК56')).toBe('РК56')
    expect(matchKey('рк 56')).toBe('РК56')
  })
})

describe('suggestProduct', () => {
  const products = [
    { id: 'p1', sku: 'PK44' },
    { id: 'p2', sku: 'PK39-2' },
    { id: 'p3', sku: 'PK39 2' },
  ]

  it('matches through separators and case', () => {
    expect(suggestProduct('pk44', products, (p) => p.sku)?.id).toBe('p1')
  })

  it('refuses an ambiguous match instead of picking one', () => {
    // `PK39_2` matches both `PK39-2` and `PK39 2`: a wrong binding is worse than an exception row.
    expect(suggestProduct('PK39_2', products, (p) => p.sku)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(suggestProduct('UNKNOWN-CODE-1', products, (p) => p.sku)).toBeNull()
  })
})
