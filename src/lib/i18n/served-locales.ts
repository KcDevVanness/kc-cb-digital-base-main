import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import {
  registerSupportedLocalesResolver,
  resolveSupportedLocalesForRequest,
} from '@open-mercato/shared/lib/i18n/locale-registry'
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
 */
export async function resolveServedLocales(): Promise<readonly Locale[]> {
  const supported = await resolveSupportedLocalesForRequest()
  const served = supported.filter((locale) => toAppLocale(locale) !== null)
  return served.length > 0 ? served : [...appLocales]
}

const REGISTERED_KEY = '__kcDigitalBaseMinServedLocalesResolverRegistered__'

/**
 * Narrows the process-wide per-request set too, so callers that resolve it
 * without an explicit set agree with what the layouts render. The platform's
 * `translations` module owns that slot and would narrow it to the tenant's
 * Settings → Translations selection — this app does not enable that module, so
 * without a registration the slot stays empty and every route handler (e.g.
 * `POST /api/auth/locale`, which validates the code it writes into the `locale`
 * cookie against this set) would keep accepting the platform baseline.
 *
 * Called from the app DI registrar, the one hook that runs after every module DI
 * registrar.
 */
export function registerServedLocalesResolver(): void {
  const scope = globalThis as Record<string, unknown>
  if (scope[REGISTERED_KEY] === true) return
  scope[REGISTERED_KEY] = true

  registerSupportedLocalesResolver(async () => [...appLocales])
}
