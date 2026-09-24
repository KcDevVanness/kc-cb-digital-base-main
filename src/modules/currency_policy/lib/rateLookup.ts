import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * The one implementation of "what is one unit of this currency worth in CNY".
 *
 * Both sides of the display need a *rate*, but only the server ever needs the *direction*: the read
 * route resolves it here and hands the client a number to multiply. That is deliberate — a second
 * direction implementation in a component is how a USD price ends up divided instead of multiplied
 * (see `.ai/specs/2026-09-24-cny-equivalent-amounts.md`, D7).
 */

/** The display currency. Fixed by policy, not by the master's `is_base` (D1). */
export const CNY_DISPLAY_CURRENCY = 'CNY' as const

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
  /** CNY per **one unit** of `currencyCode` — `6.7226` for USD. */
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
  const numeric = Number.parseFloat(chosen.rate)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const rate = direct ? numeric : 1 / numeric
  if (!Number.isFinite(rate) || rate <= 0) return null

  return {
    currencyCode: code,
    // `numeric(18,8)` is the column's scale; the conversion keeps more digits than any display needs.
    rate: rate.toString(),
    date: chosen.date,
    source: chosen.source,
    inverted: !direct,
  }
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
