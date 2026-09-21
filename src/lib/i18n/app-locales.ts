import { normalizeLocaleCode } from '@open-mercato/shared/lib/i18n/locale-set'

/**
 * The languages this deployment serves. Every other locale the platform ships
 * (`pl`, `es`, `de`, `ko`) is removed from the product, not merely untranslated.
 *
 * Nothing in the platform can express this as a set subtraction: `locales` is
 * the shipped baseline and `registerLocales` only ever adds, so each seam that
 * decides what a request may render narrows on its own. This module is the one
 * owner of the list; `./served-locales` holds the request-facing half, and the
 * dictionary loader in `./register-dictionary-loader` the resolution half.
 *
 * Kept free of server imports on purpose: the dictionary loader needs the
 * predicate, and it must not pull the DI container behind
 * `resolveTenantSupportedLocales` into its module graph to get it.
 */
export const appLocales = ['en', 'zh'] as const

type AppLocale = (typeof appLocales)[number]

/** `zh-CN` → `zh`; `DE` → `de`; anything unserved → `null`. */
export function toAppLocale(code: string): AppLocale | null {
  const normalized = normalizeLocaleCode(code)
  return (appLocales as readonly string[]).includes(normalized) ? (normalized as AppLocale) : null
}
