import { describe, expect, it } from '@jest/globals'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { registerLocales } from '@open-mercato/shared/lib/i18n/locale-registry'
import '@/lib/i18n/register-dictionary-loader'

// `zh` is not a platform baseline locale, so the app has to register it; the
// loader does that at import time for the running app, but jest module isolation
// can load this file first.
registerLocales(['zh'])

const CJK = /[\u4e00-\u9fff]/

/**
 * What a request sees for a locale this deployment does not serve.
 *
 * `detectLocale` is reached without an explicit served set by every route
 * handler that calls `resolveTranslations()` bare, and it falls back to the
 * process-wide registry — which still holds the platform baseline. So `de`,
 * `pl`, `es` and `ko` stay reachable even though no layout would ever render
 * them, and the answer they get has to be a whole language, not a partial one.
 *
 * Keys are read from the loaded English dictionary at runtime instead of being
 * pinned: which keys exist depends on the module set in `src/modules.ts`, so a
 * pinned key stops resolving the moment that set changes — and then the test
 * fails for a reason that has nothing to do with the fallback it guards.
 */
describe('dictionary for an unserved locale', () => {
  it('answers with English module strings rather than raw keys', async () => {
    const english = await loadDictionary('en')
    const dict = await loadDictionary('de')
    const keys = Object.keys(english)

    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      // A whole language, not a partial one: every English string is answered.
      expect(dict[key]).toBe(english[key])
      expect(dict[key]).not.toBe(key)
    }
  })

  it('answers with English app-dictionary strings too', async () => {
    const dict = await loadDictionary('pl')
    expect(dict['api.errors.notFound']).toBe('Not Found')
    expect(dict['api.errors.notFound']).not.toBe('api.errors.notFound')
  })

  it('serves the translation where a served locale has one', async () => {
    const english = await loadDictionary('en')
    const dict = await loadDictionary('zh')
    const translated = Object.keys(dict).filter((key) => dict[key] !== english[key])

    expect(translated.length).toBeGreaterThan(0)
    expect(translated.some((key) => CJK.test(dict[key]))).toBe(true)
  })

  it('keeps the English base layer under a served non-baseline locale', async () => {
    const english = await loadDictionary('en')
    const dict = await loadDictionary('zh')
    const fallingBack = Object.keys(english).find(
      (key) => english[key].trim().length > 0 && dict[key] === english[key],
    )

    expect(fallingBack).toBeDefined()
    // The base layer answers with English text, never with the raw key.
    expect(dict[fallingBack as string]).not.toBe(fallingBack)
  })
})
