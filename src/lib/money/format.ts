/**
 * The app's money display layer.
 *
 * The locale rendering itself stays the framework's (`formatCurrency` in `@open-mercato/ui/utils/format`,
 * what trade_docs, platform_ops and internal_sales have always used) plus the app's own fixed
 * two-decimal `Intl` format; what this file adds is the fixed two-decimal wrapper, the CNY conversion and
 * the line that makes it auditable. No caller needs a second money formatter.
 *
 * Amounts are 2 decimals everywhere (`.ai/specs/2026-09-28-money-scale-2dp-unification.md`), so the
 * conversion runs through the shared BigInt engine (`trade_docs/lib/money.ts`) rather than a float
 * product: `0.145 CNY` must round to `0.15`, which `0.145` as a double does not.
 */

import { formatCurrency } from '@open-mercato/ui/utils/format'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import {
  AMOUNT_SCALE,
  multiplyExactDecimal,
  quantizeExactDecimal,
  toAmountString,
} from '../../modules/trade_docs/lib/money'

/** The display currency of the CNY equivalent — the company is China-based (REQ-CNY-001). */
export const CNY_DISPLAY_CURRENCY = 'CNY'

/** The rate line prints 6 decimals (the rate itself is stored at 8). */
const RATE_LINE_SCALE = 6

/** The shape of an ISO 4217 code as the policy stores it. */
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/

/**
 * `¥1,000.00` — a money amount in `currencyCode` at the system's decimal caliber: 2 for amounts,
 * 4 for unit prices (callers pass `PRICE_SCALE`).
 *
 * The framework's `formatCurrency` lets `Intl` apply the currency's CLDR default, which renders a
 * zero-decimal currency such as JPY as `¥1,000` — wrong under this app's hard 2-decimal rule. Forcing
 * `minimumFractionDigits`/`maximumFractionDigits` keeps every amount on every surface identical,
 * whatever the currency.
 *
 * A code that is not three letters falls back to plain number formatting at the same caliber
 * (mirroring the framework's fallback, minus the CLDR currency default). Empty, `null`, non-finite
 * and non-numeric input has no display value and returns `null`.
 */
export function formatMoneyAmount(
  amount: string | number | null | undefined,
  currencyCode: string,
  locale?: string,
  fractionDigits: number = AMOUNT_SCALE,
): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  // `Intl` takes a number, so the display boundary is the one place a decimal string becomes a double —
  // exactly as in the framework formatter. No amount is ever *computed* here.
  const numeric = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(numeric)) return null

  const code = typeof currencyCode === 'string' && CURRENCY_CODE_PATTERN.test(currencyCode.trim())
    ? currencyCode.trim().toUpperCase()
    : undefined

  const decimals = { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits } as const
  if (code) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code, ...decimals }).format(numeric)
    } catch {
      // An unknown-but-well-formed code is not fatal: fall through to the plain format, like the framework.
    }
  }
  const formatted = new Intl.NumberFormat(locale, decimals).format(numeric)
  return code ? `${formatted} ${code}` : formatted
}

/**
 * `¥153.73` — `amount` converted at `rate` (CNY per one unit of the amount's currency).
 *
 * The rate is used exactly as stored (an 8-decimal `numeric`) and the product is the system's one
 * rounding point — `HALF_UP(amount × rate, 2)`, computed by the shared engine. No rounding happens on
 * the stored side: a conversion is display-only (D6), so nothing downstream may read it back.
 */
export function formatCnyEquivalent(amount: string | number, rate: string | number, locale?: string): string {
  const parsedAmount = parseExactDecimal(amount)
  const parsedRate = parseExactDecimal(rate)
  if (!parsedAmount || !parsedRate) {
    return formatCurrency(amount, CNY_DISPLAY_CURRENCY, locale) ?? String(amount)
  }
  const converted = toAmountString(multiplyExactDecimal(parsedAmount, parsedRate), AMOUNT_SCALE)
  return formatMoneyAmount(converted, CNY_DISPLAY_CURRENCY, locale) ?? converted
}

/**
 * `1 USD = 6.722644 CNY · 2026-09-24` — the line that makes a converted figure auditable.
 *
 * A reader who sees an implausible CNY amount can check the pair, the rate and the date without leaving
 * the page; that is the whole reason a conversion is shown at all (D5/REQ-CNY-003). The rate is printed
 * at `RATE_LINE_SCALE` decimals, quantized by the engine — never by a float `toFixed`.
 */
export function formatRateLine(currencyCode: string, rate: string | number, date: string | Date): string {
  const code = currencyCode.trim().toUpperCase()
  const parsedRate = parseExactDecimal(rate)
  const rateText = parsedRate ? toAmountString(quantizeExactDecimal(parsedRate, RATE_LINE_SCALE), RATE_LINE_SCALE) : String(rate)
  const day = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10)
  return `1 ${code} = ${rateText} ${CNY_DISPLAY_CURRENCY} · ${day}`
}
