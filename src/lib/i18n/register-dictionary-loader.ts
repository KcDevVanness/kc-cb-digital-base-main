import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import { registerLocales } from '@open-mercato/shared/lib/i18n/locale-registry'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
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

async function loadAppDictionary(locale: Locale): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'zh':
      return import('../../i18n/zh.json').then((module) => module.default)
    case 'en':
      return import('../../i18n/en.json').then((module) => module.default)
    default:
      // A platform locale this deployment does not serve (`pl`, `es`, `de`, `ko`)
      // still reaches here whenever a caller resolves one explicitly or hands
      // over a stale cookie. The platform only layers the default locale under
      // locales it does not ship, so an unserved one would otherwise render raw
      // keys — English is the honest answer.
      return import('../../i18n/en.json').then((module) => module.default)
  }
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
    // A locale this deployment does not serve still reaches `loadDictionary`
    // from callers that resolve one without a layout's narrowed set — a route
    // handler reading `Accept-Language: de`, a worker replaying a job. The base
    // dictionary is already English for those (see `loadAppDictionary`), and the
    // packaged module dictionaries behind `loadLocaleModules` are the other half
    // of the answer: without this, half the response would come back in a
    // language the product no longer ships.
    const [localeModules, appDictionary] = await Promise.all([
      toAppLocale(locale) ? loadLocaleModules(locale) : Promise.resolve([]),
      loadBaseDictionary(locale),
    ])
    registerLoadedLocaleModules(localeModules, registerLocaleModules)
    return appDictionary
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
