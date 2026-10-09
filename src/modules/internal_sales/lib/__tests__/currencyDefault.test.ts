import { describe, expect, it } from '@jest/globals'
import {
  currencyStorageKey,
  readStoredCurrency,
  resolveInitialCurrency,
  writeStoredCurrency,
  type CurrencyStorageWriter,
} from '../currencyDefault'

/**
 * The currency-default contract of a new sales document.
 *
 * Pure: the resolver's priority list and the remembered key's shape. The wiring in the form (read
 * after mount, write on save) is covered by the component; here we pin the decision itself so a
 * wrong default can never be blamed on the storage layer.
 */

function memoryStorage(seed: Record<string, string> = {}): { storage: CurrencyStorageWriter; values: Record<string, string> } {
  const values = { ...seed }
  return {
    values,
    storage: {
      getItem: (key) => (key in values ? values[key]! : null),
      setItem: (key, value) => {
        values[key] = value
      },
    },
  }
}

describe('currencyStorageKey', () => {
  it('scopes the memory to one organization and one trade type', () => {
    expect(currencyStorageKey('org-1', 'internal')).toBe('om:internalSales:currency:org-1:internal')
    expect(currencyStorageKey('org-1', 'external')).toBe('om:internalSales:currency:org-1:external')
    expect(currencyStorageKey('org-2', 'internal')).not.toBe(currencyStorageKey('org-1', 'internal'))
  })
})

describe('resolveInitialCurrency', () => {
  it('prefers the quote over the remembered currency', () => {
    expect(resolveInitialCurrency({ quoteCurrency: 'USD', storedCurrency: 'CNY', fallback: 'RUB' })).toBe('USD')
  })

  it('prefers the remembered currency over the fallback', () => {
    expect(resolveInitialCurrency({ quoteCurrency: null, storedCurrency: 'CNY', fallback: 'RUB' })).toBe('CNY')
  })

  it('falls back when neither the quote nor the memory carries one', () => {
    expect(resolveInitialCurrency({ quoteCurrency: null, storedCurrency: null, fallback: 'RUB' })).toBe('RUB')
  })

  it('ignores blank entries instead of letting them shadow a lower-priority value', () => {
    expect(resolveInitialCurrency({ quoteCurrency: '   ', storedCurrency: 'CNY', fallback: 'RUB' })).toBe('CNY')
    expect(resolveInitialCurrency({ quoteCurrency: '', storedCurrency: '\t', fallback: 'RUB' })).toBe('RUB')
  })

  it('normalizes a code to the upper-case the dictionary uses', () => {
    expect(resolveInitialCurrency({ quoteCurrency: ' cny ' })).toBe('CNY')
  })

  it('resolves to an empty string when nothing is available', () => {
    expect(resolveInitialCurrency({})).toBe('')
  })
})

describe('readStoredCurrency / writeStoredCurrency', () => {
  it('round-trips through the injected storage, upper-casing on the way in and out', () => {
    const { storage, values } = memoryStorage()
    const key = currencyStorageKey('org-1', 'internal')
    writeStoredCurrency(key, ' cny ', storage)
    expect(values[key]).toBe('CNY')
    expect(readStoredCurrency(key, storage)).toBe('CNY')
  })

  it('reads an empty string for a missing key or missing storage', () => {
    expect(readStoredCurrency('missing', memoryStorage().storage)).toBe('')
    expect(readStoredCurrency('missing', null)).toBe('')
  })

  it('never writes a blank code and survives a throwing store', () => {
    const { storage, values } = memoryStorage()
    writeStoredCurrency('k', '   ', storage)
    expect(values).toEqual({})
    const throwing: CurrencyStorageWriter = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    expect(() => writeStoredCurrency('k', 'CNY', throwing)).not.toThrow()
    expect(() => readStoredCurrency('k', throwing)).not.toThrow()
  })
})
