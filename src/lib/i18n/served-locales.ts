import { resolveTenantSupportedLocales } from '@open-mercato/core/modules/translations/lib/supported-locales'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import {
  registerSupportedLocalesResolver,
  resolveSupportedLocalesForRequest,
} from '@open-mercato/shared/lib/i18n/locale-registry'
import { enabledModules } from '@/modules'
import { appLocales, toAppLocale } from './app-locales'

/**
 * The served set for the current request — what both layouts hand to
 * `detectLocale`, `resolveTranslations` and `I18nProvider`.
 *
 * Deleting the dictionaries alone would not have been enough: `loadDictionary`
 * falls back to the default locale, so a `de` cookie or `Accept-Language: de`
 * would have rendered an English page whose own language switcher still offered
 * German. Filtering here rejects both — `detectLocale` only matches a cookie or
 * header entry that is inside the set it is given — and the switcher then lists
 * exactly `appLocales`.
 *
 * A filter rather than a replacement for `resolveSupportedLocalesForRequest` on
 * purpose: it holds even on a process where the resolver below has not been
 * registered yet, which is the one thing the root layout cannot wait for.
 */
export async function resolveServedLocales(): Promise<readonly Locale[]> {
  const supported = await resolveSupportedLocalesForRequest()
  const served = supported.filter((locale) => toAppLocale(locale) !== null)
  return served.length > 0 ? served : [...appLocales]
}

const REGISTERED_KEY = '__kcDigitalBaseMinServedLocalesResolverRegistered__'

/**
 * Owns the framework's single supported-locales resolver slot.
 *
 * The slot answers "which locales has this tenant opted into", and the platform's
 * `translations` module fills it with that lookup. This deployment serves English
 * and Chinese to every tenant and never the rest of the shipped baseline, which
 * no tenant selection can express — a tenant that has never saved a selection
 * gets the full baseline back, because `resolveSupportedLocalesForRequest` reads
 * an absent one as "no opinion". So the app takes the slot and answers with the
 * app's own set, narrowed by the tenant's selection when this deployment enables
 * that module: replacing the slot is what drops the lookup, so whoever takes it
 * has to keep answering the question.
 *
 * Called from the app DI registrar, the one hook that runs after every module DI
 * registrar: the `translations` module fills this single slot at import time, so
 * registering any earlier would be overwritten by it. Route handlers that resolve
 * the set without a layout's narrowed input (`POST /api/auth/locale` validates
 * the code it writes into the `locale` cookie against it) reach this through
 * `bootstrap()` at their module scope, which runs the registrar before they do.
 *
 * Reads `src/modules.ts` rather than the runtime module registry so the answer
 * cannot depend on how far bootstrapping has progressed.
 */
export function registerServedLocalesResolver(): void {
  const scope = globalThis as Record<string, unknown>
  if (scope[REGISTERED_KEY] === true) return
  scope[REGISTERED_KEY] = true

  registerSupportedLocalesResolver(async () => {
    if (!enabledModules.some((entry) => entry.id === 'translations')) return [...appLocales]

    const selected = await resolveTenantSupportedLocales()
    if (!selected) return [...appLocales]

    const served = selected.map((code) => toAppLocale(code)).filter((locale) => locale !== null)
    // An empty result means the tenant's selection is entirely outside what this
    // deployment ships. Serving the app's set is the honest answer — handing back
    // an empty array would be read upstream as "no opinion" and would serve the
    // whole platform baseline instead.
    return served.length > 0 ? served : [...appLocales]
  })
}
