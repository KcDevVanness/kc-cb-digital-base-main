/**
 * The CNY display layer.
 *
 * Money *formatting* is not implemented here: the framework already owns it
 * (`formatCurrency` in `@open-mercato/ui/utils/format`, what trade_docs, platform_ops and internal_sales
 * have always used). This file adds only what the CNY equivalent needs on top of it — the conversion and
 * the line that makes it auditable — so the app keeps exactly one money formatter.
 */

import { formatCurrency } from '@open-mercato/ui/utils/format'

/** The display currency of the CNY equivalent — the company is China-based (REQ-CNY-001). */
export const CNY_DISPLAY_CURRENCY = 'CNY'

function toNumber(amount: string | number): number | null {
  const numeric = typeof amount === 'number' ? amount : Number.parseFloat(amount)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * `¥153.73` — `amount` converted at `rate` (CNY per one unit of the amount's currency).
 *
 * The rate is applied exactly as stored (an 8-decimal `numeric`); the result is formatted by the shared
 * framework formatter, so a converted figure and a native one render identically. No rounding happens on
 * the stored side: a conversion is display-only (D6), so nothing downstream may read it back.
 */
export function formatCnyEquivalent(amount: string | number, rate: string | number, locale?: string): string {
  const numeric = toNumber(amount)
  const rateNumeric = toNumber(rate)
  if (numeric === null || rateNumeric === null) {
    return formatCurrency(amount, CNY_DISPLAY_CURRENCY, locale) ?? String(amount)
  }
  return formatCurrency(numeric * rateNumeric, CNY_DISPLAY_CURRENCY, locale) ?? String(numeric * rateNumeric)
}

/**
 * `1 USD = 6.7226 CNY · 2026-09-24` — the line that makes a converted figure auditable.
 *
 * A reader who sees an implausible CNY amount can check the pair, the rate and the date without leaving
 * the page; that is the whole reason a conversion is shown at all (D5/REQ-CNY-003).
 */
export function formatRateLine(currencyCode: string, rate: string | number, date: string | Date): string {
  const code = currencyCode.trim().toUpperCase()
  const rateNumeric = toNumber(rate)
  const rateText = rateNumeric === null ? String(rate) : String(Number.parseFloat(rateNumeric.toFixed(6)))
  const day = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10)
  return `1 ${code} = ${rateText} ${CNY_DISPLAY_CURRENCY} · ${day}`
}
