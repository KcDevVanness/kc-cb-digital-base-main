import type {
  RateProvider,
  RateProviderResult,
} from '@open-mercato/core/modules/currencies/services/providers/base'
import { fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('currency_policy').child({ component: 'open-er-api' })

/**
 * The provider source string, stored on every rate row it produces. Stable: it is how a rate on the
 * 汇率页 says where it came from, and how a fetch can be asked for this provider alone.
 */
export const OPEN_ER_API_SOURCE = 'OPEN_ER_API'

const DEFAULT_TIMEOUT_MS = 15_000
const BASE_URL = 'https://open.er-api.com/v6/latest/CNY'

type OpenErApiResponse = {
  result?: string
  base_code?: string
  time_last_update_unix?: number
  rates?: Record<string, number>
}

/**
 * CNY-based reference rates from the ExchangeRate-API open endpoint.
 *
 * **Why this provider exists.** The two providers the installed `currencies` module ships are Polish
 * (NBP, Raiffeisen Polska): both publish `PLN↔XXX` only, NBP skips itself unless `PLN` is a known
 * currency, and `RateFetchingService` stores provider-returned pairs without triangulating — so in a
 * deployment that trades CNY against USD/HKD/TWD/VND/… they can never produce the pair the business
 * actually needs. This one speaks **CNY as its base**, which is the axis every rate in this app is read
 * against (`BASE_CURRENCY_CODE` answers a different question — see
 * `.ai/specs/2026-09-24-cny-equivalent-amounts.md`, D1/D2).
 *
 * **Coverage.** One unauthenticated call returns every currency the endpoint knows, which includes all
 * fifteen non-CNY currencies `currency_policy` enables (ECB-based sources miss eight of them: TWD, VND,
 * MOP, BND, KHR, LAK, MMK, RUB — the reason this endpoint was chosen, D3).
 *
 * **Both directions are emitted on purpose.** The fetch service stores exactly the pairs a provider
 * returns and never triangulates, so a consumer that wants `USD→CNY` must find that direction stored —
 * the display layer only ever inverts as a fallback (D7).
 *
 * The API is public and needs no credentials; a fetch failure is thrown so the installed service
 * records it per provider (`byProvider[source].errors`, `last_sync_status`) instead of silently
 * producing an empty successful run.
 */
/**
 * The pair set this provider publishes, as a pure function of the endpoint's table.
 *
 * Split out from the fetch so the rule can be unit-tested without a network stub: both directions per
 * currency, only currencies the organization actually knows, and no pair at all when CNY itself is
 * missing from that set (every rate here is CNY-based, so without it there is nothing to build).
 *
 * A currency the endpoint does not know, or one it quotes as 0, simply contributes no pair — the fetch
 * stays a success and the gap shows up as a missing rate rather than an invented one.
 */
export function buildCnyRatePairs(
  table: Record<string, number>,
  availableCurrencies: ReadonlySet<string>,
  effectiveDate: Date,
): RateProviderResult[] {
  if (!availableCurrencies.has('CNY')) return []

  const results: RateProviderResult[] = []
  for (const code of availableCurrencies) {
    if (code === 'CNY') continue
    const cnyPerUnit = table[code]
    if (typeof cnyPerUnit !== 'number' || !Number.isFinite(cnyPerUnit) || cnyPerUnit <= 0) continue

    // 1 CNY = `cnyPerUnit` of `code` → the two directions the app may need, both stored.
    results.push({
      fromCurrencyCode: 'CNY',
      toCurrencyCode: code,
      rate: cnyPerUnit.toString(),
      source: OPEN_ER_API_SOURCE,
      date: effectiveDate,
      type: null,
    })
    results.push({
      fromCurrencyCode: code,
      toCurrencyCode: 'CNY',
      rate: (1 / cnyPerUnit).toString(),
      source: OPEN_ER_API_SOURCE,
      date: effectiveDate,
      type: null,
    })
  }
  return results
}

export const openErApiProvider: RateProvider = {
  name: 'ExchangeRate-API (open endpoint, CNY base)',
  source: OPEN_ER_API_SOURCE,
  providerBaseCurrency: 'CNY',

  isAvailable() {
    return true
  },

  async fetchRates(
    date: Date,
    _scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>,
  ): Promise<RateProviderResult[]> {
    if (!availableCurrencies.has('CNY')) {
      logger.debug('Skipping: CNY not found in available currencies')
      return []
    }

    const rawTimeout = process.env.CURRENCY_RATE_FETCH_TIMEOUT_MS
    const timeoutMs = resolveTimeoutMs(rawTimeout ? Number.parseInt(rawTimeout, 10) : undefined, DEFAULT_TIMEOUT_MS)
    const response = await fetchWithTimeout(BASE_URL, { timeoutMs })
    if (!response.ok) {
      throw new Error(`ExchangeRate-API error: ${response.status} ${response.statusText}`)
    }

    const payload = (await response.json()) as OpenErApiResponse
    if (payload.result && payload.result !== 'success') {
      throw new Error(`ExchangeRate-API answered result=${payload.result}`)
    }

    // The provider's own update time is the truthful date for these rates; the requested date is only a
    // fallback (the same choice the NBP provider makes with the table's effective date).
    const effectiveDate = payload.time_last_update_unix
      ? new Date(payload.time_last_update_unix * 1000)
      : new Date(date.getTime())

    const results = buildCnyRatePairs(payload.rates ?? {}, availableCurrencies, effectiveDate)
    logger.info('Fetched CNY rates', { count: results.length, currencies: availableCurrencies.size })
    return results
  },
}

export default openErApiProvider
