import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import {
  multiplyExactDecimal,
  subtractExactDecimal,
  sumAmounts,
  toAmountString,
  AMOUNT_SCALE,
  type ExactDecimal,
} from './money'

/**
 * The tax arithmetic of a printed invoice, in one place.
 *
 * `tax_rate`/`price_includes_tax` live on the invoice **lines** and the head's `tax_total` /
 * `gross_total` are derived from them, so both the command layer and the tests read the same
 * functions — a tax figure rounded two different ways is a reconciliation bug nobody can see.
 *
 * `taxRate` is a percentage (`13` = 13%). A `0` rate is a real caliber, not an absence: that is how
 * an export invoice (0%, kept for the tax refund) prints, and it must yield `0` tax while still
 * producing a gross total.
 */

const HUNDRED: ExactDecimal = { units: 100n, scale: 0 }

function decimalOf(value: string | number, label: string): ExactDecimal {
  const parsed = parseExactDecimal(value)
  if (!parsed) throw new Error(`[trade_docs] invoice ${label} is not a finite decimal: ${String(value)}`)
  return parsed
}

/**
 * Round-half-away-from-zero division rendered at `scale` decimals.
 *
 * The platform's exact-decimal primitives carry `{ units, scale }` with multiply/subtract/quantize
 * but no divide, and the inclusive tax caliber needs one (`amount / (1 + rate/100)`). The whole
 * computation stays in BigInt here so no binary float ever touches a tax figure; the quotient is
 * produced exactly at the target scale in a single step, so nothing is rounded twice.
 */
function divideExactDecimal(numerator: ExactDecimal, denominator: ExactDecimal, scale: number): ExactDecimal {
  const shift = denominator.scale + scale - numerator.scale
  let left = numerator.units
  let right = denominator.units
  if (shift >= 0) left *= 10n ** BigInt(shift)
  else right *= 10n ** BigInt(-shift)
  let quotient = left / right
  const remainder = left % right
  if (remainder !== 0n) {
    const twice = (remainder < 0n ? -remainder : remainder) * 2n
    const divisor = right < 0n ? -right : right
    if (twice >= divisor) quotient += left < 0n ? -1n : 1n
  }
  return { units: quotient, scale }
}

export type InvoiceLineTaxInput = {
  /** The printed face amount of the line. */
  amount: string
  /** Percentage, `13` = 13%. */
  taxRate: string
  /** Whether `amount` already contains the tax. */
  priceIncludesTax: boolean
}

export type InvoiceLineTax = {
  /** The tax contained in / added to the printed amount, at the amount scale (2 decimals). */
  taxAmount: string
  /** The amount plus tax — equal to `amount` when the price is tax-inclusive. */
  grossAmount: string
}

/**
 * Tax for one printed line, always derived server-side — the payload never carries an amount:
 * - price-inclusive → `amount − round(amount / (1 + rate/100), 2)`
 * - price-exclusive → `round(amount × rate/100, 2)`
 */
export function computeInvoiceLineTax(input: InvoiceLineTaxInput): InvoiceLineTax {
  const amountDecimal = decimalOf(input.amount, 'line amount')
  const rateDecimal = decimalOf(input.taxRate, 'line tax rate')
  if (rateDecimal.units === 0n) {
    return {
      taxAmount: toAmountString({ units: 0n, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      grossAmount: toAmountString(amountDecimal, AMOUNT_SCALE),
    }
  }
  if (input.priceIncludesTax) {
    // amount × 100 / (100 + rate), then the difference is the contained tax.
    const divisor: ExactDecimal = {
      units: 100n * 10n ** BigInt(rateDecimal.scale) + rateDecimal.units,
      scale: rateDecimal.scale,
    }
    const net = divideExactDecimal(multiplyExactDecimal(amountDecimal, HUNDRED), divisor, AMOUNT_SCALE)
    return {
      taxAmount: toAmountString(subtractExactDecimal(amountDecimal, net), AMOUNT_SCALE),
      grossAmount: toAmountString(amountDecimal, AMOUNT_SCALE),
    }
  }
  const taxAmount = toAmountString(
    divideExactDecimal(multiplyExactDecimal(amountDecimal, rateDecimal), HUNDRED, AMOUNT_SCALE),
    AMOUNT_SCALE,
  )
  return {
    taxAmount,
    grossAmount: sumAmounts([input.amount, taxAmount]),
  }
}

export type InvoiceTotalsLine = { amount: string; taxAmount: string; priceIncludesTax: boolean }

export type InvoiceTotals = {
  subtotal: string
  total: string
  taxTotal: string
  grossTotal: string
}

/**
 * Invoice totals are the sums of the printed line amounts — never of `quantity × unitPrice`.
 *
 * `subtotal`/`total` are the printed face amounts and keep the meaning they always had;
 * `taxTotal` (Σ tax) and `grossTotal` (Σ tax-inclusive amount) are the additive tax calibers.
 */
export function computeInvoiceTotals(lines: InvoiceTotalsLine[]): InvoiceTotals {
  const total = sumAmounts(lines.map((line) => line.amount))
  const taxTotal = sumAmounts(lines.map((line) => line.taxAmount))
  const grossTotal = sumAmounts(
    lines.map((line) => (line.priceIncludesTax ? line.amount : sumAmounts([line.amount, line.taxAmount]))),
  )
  return { subtotal: total, total, taxTotal, grossTotal }
}
