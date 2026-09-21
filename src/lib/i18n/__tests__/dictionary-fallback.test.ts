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
 */
describe('dictionary for an unserved locale', () => {
  it('answers with English module strings rather than raw keys', async () => {
    const dict = await loadDictionary('de')

    // Translated in src/modules/catalog/i18n/zh.json, present in the packaged
    // English dictionary, absent from every German dictionary this app ships.
    expect(dict['catalog.bulkDelete.error']).toBe('Failed to delete products.')
    expect(dict['catalog.bulkDelete.confirm']).toBe('Delete')
    expect(dict['catalog.bulkDelete.error']).not.toBe('catalog.bulkDelete.error')
  })

  it('answers with English app-dictionary strings too', async () => {
    const dict = await loadDictionary('pl')
    expect(dict['api.errors.notFound']).toBe('Not Found')
    expect(dict['api.errors.notFound']).not.toBe('api.errors.notFound')
  })

  it('serves the translation where a served locale has one', async () => {
    const dict = await loadDictionary('zh')
    expect(dict['catalog.bulkDelete.confirm']).toBe('删除')
    expect(dict['catalog.bulkDelete.error']).toMatch(CJK)
  })

  it('keeps the English base layer under a served non-baseline locale', async () => {
    // The key is chosen at runtime instead of pinned: the served dictionary always carries the
    // English base layer, so "untranslated" means "the value still equals the English one" — a
    // hard-coded key stops exercising the fallback the moment somebody translates it (which is
    // what happened to `catalog.audit.categories.create` once the ERP overlays landed).
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
