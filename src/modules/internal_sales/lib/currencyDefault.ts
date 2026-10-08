import type { SalesTradeType } from './tradeType'

/**
 * The currency a new sales document starts with, remembered per organization and trade type.
 *
 * Reducing entry friction must not guess *what* the operator wants — it only carries over what they
 * already chose. The rule (`resolveInitialCurrency`) is a pure priority list:
 *
 * 1. the currency of the quote loaded through `?fromQuote=` (the document is born from it);
 * 2. otherwise the last currency the operator used for this organization **and trade type**;
 * 3. otherwise the form's own default.
 *
 * The remembered half lives in `localStorage` behind an injectable reader/writer so the resolver and
 * the key shape are unit-testable without a browser (`__tests__/currencyDefault.test.ts`).
 */

const KEY_PREFIX = 'om:internalSales:currency'

/** A code is compared and stored upper-cased — the dictionary's option values are upper-case too. */
function normalizeCurrency(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

/**
 * The remembered-currency key: one bucket per organization **and** trade type, so an operator's two
 * entries (对内 / 对外) never share a default. An unscoped caller (no organization selected yet) keys
 * an empty segment — the default simply is not remembered per organization in that case.
 */
export function currencyStorageKey(organizationId: string | null | undefined, tradeType: SalesTradeType): string {
  return `${KEY_PREFIX}:${organizationId ?? ''}:${tradeType}`
}

/** The slice of `Storage` this module needs — structural, so tests inject a plain object. */
export type CurrencyStorageReader = { getItem(key: string): string | null }
export type CurrencyStorageWriter = CurrencyStorageReader & { setItem(key: string, value: string): void }

/**
 * The browser store, or `null` during SSR (and when storage is blocked) — localStorage is not
 * available while the page is server-rendered, so callers read after mount.
 */
function defaultStorage(): CurrencyStorageWriter | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The remembered currency for a key; `''` when nothing was stored (or storage is unavailable). */
export function readStoredCurrency(
  key: string,
  storage: CurrencyStorageReader | null = defaultStorage(),
): string {
  if (!storage) return ''
  try {
    return normalizeCurrency(storage.getItem(key))
  } catch {
    return ''
  }
}

/** Write the currency just used. An empty code is not written — it would only clear a real memory. */
export function writeStoredCurrency(
  key: string,
  currency: string,
  storage: CurrencyStorageWriter | null = defaultStorage(),
): void {
  const normalized = normalizeCurrency(currency)
  if (!normalized || !storage) return
  try {
    storage.setItem(key, normalized)
  } catch {
    // A full/blocked store is not worth failing a save over; the default simply is not remembered.
  }
}

/**
 * The starting currency: the quote's, else the remembered one, else the fallback. Blank/whitespace
 * entries are ignored at every step, so a stored empty string never shadows the fallback.
 */
export function resolveInitialCurrency(input: {
  quoteCurrency?: string | null
  storedCurrency?: string | null
  fallback?: string | null
}): string {
  return normalizeCurrency(input.quoteCurrency) || normalizeCurrency(input.storedCurrency) || normalizeCurrency(input.fallback)
}
