/**
 * RU SKU 归一化 — the two functions that decide whether two codes mean the same thing.
 *
 * The RU side has no code rules: case is inconsistent (`PK44` / `pk44`), a variant carries a
 * `склад`/`фабрика` suffix written in Russian, and a suffix may be glued to the code with or
 * without a separator. Two functions, deliberately separate:
 *
 * - {@link canonicalize} produces the human/target form of a RU code (suffix stripped, uppercase)
 *   and is what a suggestion is displayed as;
 * - {@link matchKey} produces the comparison key used against `products_products.sku` — letters and
 *   digits only, uppercase — so `PK-44`, `pk44` and `PK 44` all collide.
 *
 * Neither function guesses: a code that cannot be normalized to a unique candidate stays unmapped
 * and lands in the exception list instead of being silently merged into another SKU.
 */

/** Variant suffixes, in both writings the contract allows (Russian原文 and its Latin transliteration). */
const VARIANT_SUFFIXES = ['склад', 'фабрика', 'sklad', 'fabrika'] as const

/** Everything that is neither a letter nor a digit, in any script. */
const NON_IDENTIFIER = /[^\p{L}\p{N}]+/gu

/**
 * Strips a trailing variant suffix and normalizes case.
 *
 * The separator between the code and the suffix is optional (`PK39_2PK39sklad` as well as
 * `PK44 склад`), so the suffix is removed by walking the candidate strings from the end rather than
 * by splitting on a separator that may not be there.
 */
export function canonicalize(raw: string): string {
  let value = raw.trim()
  let changed = true
  while (changed) {
    changed = false
    const withoutSeparators = value.replace(/[_\-\s.]+$/u, '')
    for (const suffix of VARIANT_SUFFIXES) {
      const lower = withoutSeparators.toLowerCase()
      if (!lower.endsWith(suffix)) continue
      const head = withoutSeparators.slice(0, withoutSeparators.length - suffix.length)
      // A suffix must follow something; `склад` alone is the whole code, not a suffix.
      if (head.trim().length === 0) continue
      value = head
      changed = true
      break
    }
  }
  return value.replace(/[_\-\s.]+$/u, '').toUpperCase()
}

/** The comparison key: letters and digits only, uppercase. */
export function matchKey(code: string): string {
  return code.normalize('NFKC').replace(NON_IDENTIFIER, '').toUpperCase()
}

/**
 * The suffix a code carries, normalized to the canonical English spelling the contract uses
 * (`sklad` / `fabrika`), or `null` when it carries none.
 */
export function variantSuffix(raw: string): 'sklad' | 'fabrika' | null {
  const value = raw.trim().toLowerCase()
  for (const suffix of VARIANT_SUFFIXES) {
    if (!value.endsWith(suffix)) continue
    const head = value.slice(0, value.length - suffix.length).replace(/[_\-\s.]+$/u, '')
    if (head.length === 0) continue
    if (suffix === 'склад' || suffix === 'sklad') return 'sklad'
    return 'fabrika'
  }
  return null
}

/**
 * Suggests the single product a RU code resolves to.
 *
 * A hit is accepted only when exactly one candidate matches; zero candidates (a code nothing was
 * created for yet) and several candidates (two products that differ only in separators) both stay
 * unmapped, because a wrong automatic binding is worse than an entry in the exception list.
 */
export function suggestProduct<T>(raw: string, candidates: readonly T[], readCode: (candidate: T) => string): T | null {
  const key = matchKey(raw)
  if (key.length === 0) return null
  const hits: T[] = []
  for (const candidate of candidates) {
    if (matchKey(readCode(candidate)) === key) hits.push(candidate)
    if (hits.length > 1) return null
  }
  return hits[0] ?? null
}
