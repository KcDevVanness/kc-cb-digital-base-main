import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { asValue } from 'awilix'
import { registerCurrencyRateProvider } from '@open-mercato/core/modules/currencies/services/providers/registry'
import { OPEN_ER_API_SOURCE, openErApiProvider } from './lib/providers/openErApi'

/** DI token for this module's provider, exported so tests and callers name it once. */
export const CURRENCY_POLICY_RATE_PROVIDER = 'currencyPolicyRateProvider' as const

/**
 * Registers the module's CNY-based rate provider.
 *
 * The installed `currencies` DI factory reads this registry when it builds `rateFetchingService`
 * (`for (const provider of listCurrencyRateProviders()) service.registerProvider(provider)`), which is
 * why registering here is enough for both `POST /api/currencies/fetch-rates` and
 * `yarn mercato currencies fetch-rates` to pick the provider up — no fork of the installed module.
 *
 * The registration is idempotent by `source` (the registry is a `Map` keyed by it), so a re-run of this
 * registrar — a hot reload, a second bootstrap — replaces the same entry instead of duplicating it.
 */
export function register(container: AppContainer) {
  container.register({ [CURRENCY_POLICY_RATE_PROVIDER]: asValue(openErApiProvider) })
  registerCurrencyRateProvider(openErApiProvider)
}

export { OPEN_ER_API_SOURCE }
