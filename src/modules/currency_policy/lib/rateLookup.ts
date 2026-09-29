import type { EntityManager } from '@mikro-orm/postgresql'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { divideHalfUp, toAmountString } from '../../trade_docs/lib/money'

/**
 * The one implementation of "what is one unit of this currency worth in CNY".
 *
 * Both sides of the display need a *rate*, but only the server ever needs the *direction*: the read
 * route resolves it here and hands the client a decimal string to multiply. That is deliberate — a second
 * direction implementation in a component is how a USD price ends up divided instead of multiplied
 * (see `.ai/specs/2026-09-24-cny-equivalent-amounts.md`, D7).
 *
 * Rates are money-adjacent and therefore never touch a binary float: the direct direction is the stored
 * string, the inverse goes through the BigInt engine (`divideHalfUp`) and is quantized HALF_UP to
 * `RATE_SCALE` — `1 / Number(...)` would make the converted amount depend on the machine's arithmetic.
 */

/** The display currency. Fixed by policy, not by the master's `is_base` (D1). */
export const CNY_DISPLAY_CURRENCY = 'CNY' as const

/**
 * The scale of `exchange_rates.rate` (`numeric(18,8)`) — and of every rate this lookup returns.
 *
 * A rate is not an amount (amounts are always 2 decimals, see
 * `.ai/specs/2026-09-28-money-scale-2dp-unification.md`): it keeps its column scale so a converted
 * amount is computed from the exact stored figure.
 */
export const RATE_SCALE = 8

/** One stored rate row, as the lookup needs it. */
type RateRow = {
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: Date
  source: string
}

export type CnyRate = {
  currencyCode: string
  /** CNY per **one unit** of `currencyCode`, an exact `RATE_SCALE`-decimal string — `6.72264388` for USD. */
  rate: string
  /** When the rate was published (`exchange_rates.date`), so the display can print it. */
  date: Date
  source: string
  /** True when the stored row was the opposite direction and had to be inverted. */
  inverted: boolean
}

/**
 * Picks the rate for one currency out of its stored rows.
 *
 * `X→CNY` wins; a stored `CNY→X` is inverted as the fallback, which is what makes a hand-entered row
 * usable without the operator having to know which direction the app prefers. Newest first, then the
 * source name for a stable tie-break (two providers may quote the same day).
 *
 * Returns `null` when neither direction is stored — the caller must render nothing rather than invent a
 * rate (D5).
 */
export function resolveCnyRate(currencyCode: string, rows: readonly RateRow[]): CnyRate | null {
  const code = currencyCode.trim().toUpperCase()
  if (code.length === 0 || code === CNY_DISPLAY_CURRENCY) return null

  const candidates = rows
    .filter(
      (row) =>
        (row.fromCurrencyCode === code && row.toCurrencyCode === CNY_DISPLAY_CURRENCY) ||
        (row.fromCurrencyCode === CNY_DISPLAY_CURRENCY && row.toCurrencyCode === code),
    )
    .sort((left, right) => {
      const byDirection = Number(left.fromCurrencyCode !== code) - Number(right.fromCurrencyCode !== code)
      if (byDirection !== 0) return byDirection
      const byDate = right.date.getTime() - left.date.getTime()
      return byDate !== 0 ? byDate : left.source.localeCompare(right.source)
    })

  const chosen = candidates[0]
  if (!chosen) return null

  const direct = chosen.fromCurrencyCode === code
  // Direct: the stored `numeric(18,8)` string is used verbatim. Inverse: the engine's exact division.
  const rate = direct ? chosen.rate.trim() : invertRate(chosen.rate)
  if (!rate) return null

  // A stored rate is trusted only when it parses as a positive decimal; a broken row means "no rate".
  const parsed = parseExactDecimal(rate)
  if (!parsed || parsed.units <= 0n) return null

  return {
    currencyCode: code,
    rate,
    date: chosen.date,
    source: chosen.source,
    inverted: !direct,
  }
}

/**
 * `1 / rate` at `RATE_SCALE` decimals, half away from zero — and `null` when `rate` is not a positive
 * decimal.
 *
 * `rate = units / 10^scale`, so `1 / rate = 10^scale / units` and the scaled result is
 * `round(10^(scale + RATE_SCALE) / units)`: one BigInt division with no intermediate float. The stored
 * rate is authoritative, so its own scale (not a fixed 8) drives the numerator — `0.148751` inverts to
 * `6.72264388`, the same figure the direct USD row carries.
 *
 * Exported because the feed needs the same inversion when it publishes the `X→CNY` direction of a
 * `CNY→X` quote (`lib/providers/openErApi.ts`); a float `1 / n` at the source would let the two write
 * paths disagree in the ninth decimal.
 */
export function invertRate(rate: string | number): string | null {
  const stored = parseExactDecimal(rate)
  if (!stored || stored.units <= 0n) return null
  const units = divideHalfUp(10n ** BigInt(stored.scale + RATE_SCALE), stored.units)
  return toAmountString({ units, scale: RATE_SCALE }, RATE_SCALE)
}

/**
 * The stored rates for a set of currencies, newest first, scoped to the caller's organization.
 *
 * One query for both directions of every requested code: the direction decision belongs to
 * `resolveCnyRate`, and a page's whole rate need is a single indexed read. Soft-deleted rows are
 * skipped, as are rows dated in the future (a rate is not a prediction).
 */
export async function loadRateRows(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  currencyCodes: readonly string[],
): Promise<RateRow[]> {
  const codes = [...new Set(currencyCodes.map((code) => code.trim().toUpperCase()))].filter(
    (code) => code.length > 0 && code !== CNY_DISPLAY_CURRENCY,
  )
  if (codes.length === 0) return []

  const rows = await em.fork().getConnection().execute<RateRow[]>(
    `select from_currency_code as "fromCurrencyCode",
            to_currency_code   as "toCurrencyCode",
            rate,
            date,
            source
       from exchange_rates
      where tenant_id = ?
        and organization_id = ?
        and is_active = true
        and deleted_at is null
        and date <= now()
        and (
          (from_currency_code = ? and to_currency_code in (?)) or
          (to_currency_code = ? and from_currency_code in (?))
        )
      order by date desc`,
    [scope.tenantId, scope.organizationId, CNY_DISPLAY_CURRENCY, codes, CNY_DISPLAY_CURRENCY, codes],
  )
  return rows.map((row) => ({
    fromCurrencyCode: String(row.fromCurrencyCode),
    toCurrencyCode: String(row.toCurrencyCode),
    rate: String(row.rate),
    date: row.date instanceof Date ? row.date : new Date(String(row.date)),
    source: String(row.source),
  }))
}
