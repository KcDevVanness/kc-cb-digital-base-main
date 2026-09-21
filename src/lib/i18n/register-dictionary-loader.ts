import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import { registerLocales } from '@open-mercato/shared/lib/i18n/locale-registry'
import { defaultLocale, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { loadI18nModules } from '@/.mercato/generated/modules.i18n.loaders.generated'
import { toAppLocale } from './app-locales'

function registerLoadedLocaleModules(
  localeModules: Module[],
  registrar: typeof registerModules = registerModules,
): void {
  if (localeModules.length > 0) registrar(localeModules)
}

/**
 * The app's own dictionary — the one `src/i18n/<locale>.json` file per served
 * locale. Which locales reach it is `createAppDictionaryLoader`'s decision, not
 * this switch's: one of them has to answer for `pl`/`es`/`de`/`ko` too, and that
 * answer needs the module dictionaries as well.
 */
async function loadAppDictionary(locale: Locale): Promise<Record<string, unknown>> {
  if (locale === 'zh') return import('../../i18n/zh.json').then((module) => module.default)
  return import('../../i18n/en.json').then((module) => module.default)
}

type DictionaryLoaderDependencies = {
  loadLocaleModules?: typeof loadI18nModules
  loadBaseDictionary?: typeof loadAppDictionary
  registerLocaleModules?: typeof registerModules
}

export function createAppDictionaryLoader({
  loadLocaleModules = loadI18nModules,
  loadBaseDictionary = loadAppDictionary,
  registerLocaleModules = registerModules,
}: DictionaryLoaderDependencies = {}) {
  return async (locale: Locale): Promise<Record<string, unknown>> => {
    if (toAppLocale(locale) !== null) {
      const [localeModules, appDictionary] = await Promise.all([
        loadLocaleModules(locale),
        loadBaseDictionary(locale),
      ])
      registerLoadedLocaleModules(localeModules, registerLocaleModules)
      return appDictionary
    }

    // A locale this deployment does not serve still reaches `loadDictionary`
    // from callers that resolve one without a layout's narrowed set — every route
    // handler that calls `resolveTranslations()` bare, a worker replaying a job.
    // `detectLocale` falls back to the process-wide registry for those, and the
    // registry holds the platform baseline, so `pl`/`es`/`de`/`ko` stay reachable
    // even though no layout would render them.
    //
    // Answer them in one whole language. The app dictionary alone is not enough:
    // `loadDictionary` layers the default locale only under locales the platform
    // does *not* ship, and these four are shipped, so their module strings would
    // resolve to nothing and render as raw keys. Folding the default locale's
    // module dictionaries in here makes the answer identical to
    // `loadDictionary('en')`.
    const [defaultModules, appDictionary] = await Promise.all([
      loadLocaleModules(defaultLocale),
      loadBaseDictionary(defaultLocale),
    ])
    // Not handed to `registerLocaleModules`: they are the default locale's
    // dictionaries under the default locale's names, so registering them would
    // only invalidate the dictionary cache on every unserved request.
    const merged: Record<string, unknown> = { ...appDictionary }
    for (const entry of defaultModules) {
      Object.assign(merged, entry.translations?.[defaultLocale] ?? {})
    }
    return merged
  }
}

registerAppDictionaryLoader(createAppDictionaryLoader())

// Registers the one app-served locale beyond the platform baseline (en/pl/es/de/ko).
// Registration is idempotent and must happen at import time — this module is
// pulled in by the root layout and by the bootstrap, before any locale set is
// read. The typing counterpart lives in src/types/i18n.d.ts, and an app-owned
// module's dictionary goes in src/modules/<moduleId>/i18n/zh.json (merged over
// the packaged ones by `yarn generate`).
//
// This only makes `zh` a locale the process *can* serve. Which locales a request
// is actually served is the narrower decision owned by ./app-locales — nothing
// subtracts the unserved platform locales from this set.
registerLocales(['zh'])
