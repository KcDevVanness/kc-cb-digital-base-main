import {
  addExactDecimal,
  compareExactDecimal,
  exactDecimalToString,
  parseExactDecimal,
  type ExactDecimal,
} from '@open-mercato/core/modules/dashboards/lib/exactDecimal'

/**
 * The money engine for contracts and invoices — the **single** place where a contract amount is
 * rounded.
 *
 * Two calibers exist side by side and are both derived from `quantity × unit_price`:
 *
 * - **financial amount** — quantized to the currency's decimal places (`Currency.decimalPlaces`,
 *   typically 2, sometimes 0 or 3). This is the number finance reconciles against the invoice.
 * - **contract amount** — quantized to 2 decimals. This is the number printed on the signed
 *   contract.
 *
 * Quantization is BigInt `HALF_UP` (away from zero). `Number.toFixed` is **not** usable here:
 * `(1.005).toFixed(2)` is `"1.00"` because 1.005 is really 1.00499999999999989, so a contract
 * would print a cent less than the parties' own arithmetic. The platform's
 * `exactDecimal` primitives carry `{ units, scale }` but have no multiply/quantize, so the two
 * missing operations live here rather than in a framework file.
 *
 * Amounts travel as decimal strings (MikroORM `numeric` columns) and are parsed only here.
 */

/** Contract amounts are always printed with two decimals. */
export const CONTRACT_AMOUNT_SCALE = 2

/** Amounts persisted on the contract head and on lines: `numeric(18,4)`. */
export const STORED_AMOUNT_SCALE = 4

/** `Currency.decimalPlaces` bounds; anything outside is a data error, not a rounding rule. */
const MIN_CURRENCY_SCALE = 0
const MAX_CURRENCY_SCALE = 8

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

function parseAmount(value: unknown, label: string): ExactDecimal {
  const parsed = parseExactDecimal(value)
  if (!parsed) {
    throw new Error(`[money] ${label} is not a finite decimal: ${String(value)}`)
  }
  return parsed
}

/**
 * `units * units`, `scale + scale`. Exact: no rounding happens here, so the quantization step
 * downstream is the only place a value can lose digits.
 */
export function multiplyExactDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return { units: left.units * right.units, scale: left.scale + right.scale }
}

export function subtractExactDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return addExactDecimal(left, { units: -right.units, scale: right.scale })
}

/**
 * Rounds to `scale` decimals, half away from zero.
 *
 * `0.005` at 2 decimals → `0.01`, `-0.005` → `-0.01`; `0.0049` → `0.00`. Scaling **up**
 * (a value already finer than the target, e.g. `12.3456` at 2 decimals) truncates the digit
 * string and then applies the same half-up rule to the remainder, so `12.3456` → `12.35` and
 * `2.5 × 0.125 = 0.3125` → `0.31` (never banker's rounding).
 */
export function quantizeExactDecimal(value: ExactDecimal, scale: number): ExactDecimal {
  const target = Math.max(0, Math.trunc(scale))
  if (value.scale === target) return value
  if (value.scale < target) {
    return { units: value.units * pow10(target - value.scale), scale: target }
  }

  const divisor = pow10(value.scale - target)
  let quotient = value.units / divisor
  const remainder = value.units % divisor
  if (remainder !== 0n) {
    const doubled = (remainder < 0n ? -remainder : remainder) * 2n
    if (doubled >= divisor) {
      quotient += value.units < 0n ? -1n : 1n
    }
  }
  return { units: quotient, scale: target }
}

/** Fixed-decimal string for a `numeric` column: quantize, then render exactly `scale` places. */
export function toAmountString(value: ExactDecimal, scale: number): string {
  return exactDecimalToString(quantizeExactDecimal(value, scale))
}

/**
 * Rounding scale for a currency. A missing or nonsensical `Currency.decimalPlaces` falls back to
 * 2 — the value every invoice in this business uses — rather than failing a contract.
 */
export function resolveCurrencyScale(decimalPlaces: number | null | undefined): number {
  if (typeof decimalPlaces !== 'number' || !Number.isFinite(decimalPlaces)) return 2
  const truncated = Math.trunc(decimalPlaces)
  if (truncated < MIN_CURRENCY_SCALE) return MIN_CURRENCY_SCALE
  if (truncated > MAX_CURRENCY_SCALE) return MAX_CURRENCY_SCALE
  return truncated
}

export type LineAmountInput = {
  quantity: string | number
  unitPrice: string | number
  /** `Currency.decimalPlaces` for the contract currency. */
  currencyScale: number
}

export type LineAmounts = {
  /** Quantized to the currency scale. */
  financeAmount: string
  /** Quantized to 2 decimals for the printed contract. */
  contractAmount: string
}

/**
 * Both calibers for one line. Each is quantized **from the raw product**, never from the other
 * caliber: an amount that satisfies the contract's rounding must not inherit the financial
 * amount's fractional cents.
 */
export function computeLineAmounts(input: LineAmountInput): LineAmounts {
  const quantity = parseAmount(input.quantity, 'quantity')
  const unitPrice = parseAmount(input.unitPrice, 'unitPrice')
  const gross = multiplyExactDecimal(quantity, unitPrice)
  return {
    financeAmount: toAmountString(gross, resolveCurrencyScale(input.currencyScale)),
    contractAmount: toAmountString(gross, CONTRACT_AMOUNT_SCALE),
  }
}

/**
 * Sums decimal strings exactly and renders the result at the stored amount scale (4 decimals).
 *
 * A value that cannot be parsed throws instead of being skipped: a silently dropped line would
 * understate a contract total, and every caller already holds validated rows.
 */
export function sumAmounts(values: Array<string | number>): string {
  let total: ExactDecimal = { units: 0n, scale: 0 }
  for (const value of values) {
    total = addExactDecimal(total, parseAmount(value, 'amount'))
  }
  return toAmountString(total, STORED_AMOUNT_SCALE)
}

export type ContractTotalsInput = {
  contractAmount: string
  financeAmount: string
}

export type ContractTotals = {
  contractTotal: string
  financeTotal: string
  /** `contractTotal − financeTotal`, signed; negative means finance exceeds the contract. */
  differenceTotal: string
}

/**
 * Head totals: the sums of the per-line calibers, and the difference between them.
 *
 * The sums are taken over already-quantized line values (never re-quantized as one blob), so the
 * head always equals what a reader gets by adding the printed column.
 */
export function computeContractTotals(lines: ContractTotalsInput[]): ContractTotals {
  const financeTotal = sumAmounts(lines.map((line) => line.financeAmount))
  const contractTotal = sumAmounts(lines.map((line) => line.contractAmount))
  const difference = subtractExactDecimal(
    parseAmount(contractTotal, 'contractTotal'),
    parseAmount(financeTotal, 'financeTotal'),
  )
  return {
    contractTotal,
    financeTotal,
    differenceTotal: toAmountString(difference, STORED_AMOUNT_SCALE),
  }
}

/** True when `left` is greater than `right`; used by guards that must not rely on floats. */
export function isAmountGreaterThan(left: string | number, right: string | number): boolean {
  return compareExactDecimal(parseAmount(left, 'left'), parseAmount(right, 'right')) > 0
}

export type { ExactDecimal }
