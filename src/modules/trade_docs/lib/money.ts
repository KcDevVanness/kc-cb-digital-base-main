import {
  addExactDecimal,
  compareExactDecimal,
  exactDecimalToString,
  parseExactDecimal,
  type ExactDecimal,
} from '@open-mercato/core/modules/dashboards/lib/exactDecimal'

/**
 * The money engine — the **single** place where an amount is rounded.
 *
 * One caliber, system-wide: **an amount is always 2 decimals, HALF_UP (away from zero)**. A unit
 * price keeps 4 decimals and is never re-rounded after entry. The only rounding point in the whole
 * system is the line amount, `HALF_UP(quantity × unit_price, 2)`; a total is the **exact sum of
 * already-rounded line amounts** and is never rounded a second time.
 *
 * `Number.toFixed` is **not** usable here: `(1.005).toFixed(2)` is `"1.00"` because 1.005 is really
 * 1.00499999999999989, so a contract would print a cent less than the parties' own arithmetic. The
 * platform's `exactDecimal` primitives carry `{ units, scale }` but have no multiply/quantize/
 * divide, so the missing operations live here rather than in a framework file.
 *
 * Amounts travel as decimal strings (MikroORM `numeric` columns) and are parsed only here.
 */

/** Every amount in the system is 2 decimals: storage, API, export and print. */
export const AMOUNT_SCALE = 2

/** Unit prices (product/purchase/quote/sales) are 4 decimals and are not re-rounded. */
export const PRICE_SCALE = 4

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
 * Scaled-integer units of an amount at `scale`. Every money comparison and ratio goes through
 * scaled integers: comparing decimal strings as floats would lose cents beyond 2^53 and would make
 * a total depend on the machine's arithmetic. An unparseable or absent value is `0n`.
 */
export function toScaledUnits(value: string | number | null | undefined, scale: number): bigint {
  const parsed = parseExactDecimal(value)
  return parsed ? quantizeExactDecimal(parsed, scale).units : 0n
}

/** Scaled-integer division, half away from zero — the only rounding this engine performs. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n
  const negative = (numerator < 0n) !== (denominator < 0n)
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator
  let quotient = absNumerator / absDenominator
  if ((absNumerator % absDenominator) * 2n >= absDenominator) quotient += 1n
  return negative ? -quotient : quotient
}

export type LineAmountInput = {
  quantity: string | number
  unitPrice: string | number
}

export type LineAmounts = {
  /** The amount finance reconciles against the invoice. */
  financeAmount: string
  /** The amount printed on the signed contract. */
  contractAmount: string
}

/**
 * Both calibers for one line, each `HALF_UP(quantity × unit_price, 2)` — the one rounding point.
 *
 * The two fields are kept because the contract page prints them side by side, but they now share a
 * single scale; the only difference they can show going forward comes from an invoice *overriding*
 * the financial amount, never from the currency's decimal places.
 */
export function computeLineAmounts(input: LineAmountInput): LineAmounts {
  const quantity = parseAmount(input.quantity, 'quantity')
  const unitPrice = parseAmount(input.unitPrice, 'unitPrice')
  const gross = multiplyExactDecimal(quantity, unitPrice)
  const amount = toAmountString(gross, AMOUNT_SCALE)
  return { financeAmount: amount, contractAmount: amount }
}

/**
 * Sums decimal strings exactly and renders the result at the amount scale (2 decimals).
 *
 * The sum is taken over already-quantized line values, so the head equals what a reader gets by
 * adding the printed column; rendering at the amount scale is a no-op for those values and never a
 * second rounding of a total.
 *
 * A value that cannot be parsed throws instead of being skipped: a silently dropped line would
 * understate a contract total, and every caller already holds validated rows.
 */
export function sumAmounts(values: Array<string | number>): string {
  let total: ExactDecimal = { units: 0n, scale: 0 }
  for (const value of values) {
    total = addExactDecimal(total, parseAmount(value, 'amount'))
  }
  return toAmountString(total, AMOUNT_SCALE)
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
    differenceTotal: toAmountString(difference, AMOUNT_SCALE),
  }
}

/** True when `left` is greater than `right`; used by guards that must not rely on floats. */
export function isAmountGreaterThan(left: string | number, right: string | number): boolean {
  return compareExactDecimal(parseAmount(left, 'left'), parseAmount(right, 'right')) > 0
}

export type { ExactDecimal }
