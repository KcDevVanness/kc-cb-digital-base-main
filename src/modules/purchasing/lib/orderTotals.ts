import {
  addExactDecimal,
  parseExactDecimal,
  type ExactDecimal,
} from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import {
  AMOUNT_SCALE,
  PRICE_SCALE,
  divideHalfUp,
  multiplyExactDecimal,
  quantizeExactDecimal,
  subtractExactDecimal,
  sumAmounts,
  toAmountString,
  toScaledUnits,
} from '../../trade_docs/lib/money'

/**
 * Money and payment-state derivations for purchase orders, on the system-wide caliber.
 *
 * Every amount here is **2 decimals, HALF_UP (away from zero)**, and every arithmetic path runs
 * through the BigInt engine in `trade_docs/lib/money.ts` — no `Number`, no `toFixed`, no `Math.round`
 * touches an amount. The one rounding point for a line is its amount `HALF_UP(quantity × unit_price,
 * 2)`; the net/tax split is derived **from that rounded figure** so `netTotal + taxAmount ===
 * lineTotal` holds to the cent, and a total is the exact sum of the already-rounded line values, never
 * a second rounding of an unrounded blob.
 *
 * The pure functions sit here so the command layer, the API projection, and any future worker all
 * agree on the same arithmetic. Amounts travel as decimal strings (MikroORM `numeric` columns).
 */

/** Purchasing quantities are `numeric(18,4)` (see the money-scale spec's non-goals). */
export const QUANTITY_SCALE = 4

/** Percentages (tax rate, deposit percent) keep their `numeric(6,3)` scale. */
export const PERCENT_SCALE = 3

/**
 * Rounds `numerator / denominator × 10^scale` half away from zero, kept entirely in BigInt.
 *
 * The engine's `divideHalfUp` divides scaled integers; this lifts the operands' own scales into the
 * integer world first, so a tax-inclusive net (`base ÷ (1 + rate)`) loses digits exactly once, at
 * `scale`, and never in a float.
 */
function divideToScale(numerator: ExactDecimal, denominator: ExactDecimal, scale: number): ExactDecimal {
  const exponent = denominator.scale - numerator.scale + scale
  if (exponent >= 0) {
    return { units: divideHalfUp(numerator.units * 10n ** BigInt(exponent), denominator.units), scale }
  }
  return { units: divideHalfUp(numerator.units, denominator.units * 10n ** BigInt(-exponent)), scale }
}

/** Renders a validated decimal input at `scale` through the engine. Throws on an unparseable value. */
export function quantizeAmount(value: string | number, scale: number = AMOUNT_SCALE): string {
  const parsed = parseExactDecimal(value)
  if (!parsed) throw new Error(`[purchasing] not a finite decimal: ${String(value)}`)
  return toAmountString(parsed, scale)
}

export type OrderLineInput = {
  quantity: string | number
  unitPrice: string | number
  taxRate: string | number
  priceIncludesTax: boolean
}

export type OrderLineTotals = {
  netTotal: string
  taxAmount: string
  lineTotal: string
}

/**
 * Splits one line into net, tax, and gross — each 2 decimals, with `netTotal + taxAmount === lineTotal`
 * exact by construction.
 *
 * `priceIncludesTax` decides the direction: when the supplier quoted a tax-inclusive price, the
 * quoted amount is the gross and the net is derived from it (`gross ÷ (1 + rate)`), with the tax taken
 * as the exact remainder; otherwise the quoted amount is the net and the tax is added on top. In both
 * directions only one branch value is rounded — the line amount `HALF_UP(quantity × unit_price, 2)` —
 * and the other component follows by subtraction, so the two components can never round apart from the
 * line total.
 */
export function computeLineTotals(line: OrderLineInput): OrderLineTotals {
  const quantityUnits = toScaledUnits(line.quantity, QUANTITY_SCALE)
  const unitPriceUnits = toScaledUnits(line.unitPrice, PRICE_SCALE)
  const base: ExactDecimal = {
    units: quantityUnits * unitPriceUnits,
    scale: QUANTITY_SCALE + PRICE_SCALE,
  }
  const rate = parseExactDecimal(line.taxRate) ?? { units: 0n, scale: 0 }

  if (line.priceIncludesTax) {
    const gross = quantizeExactDecimal(base, AMOUNT_SCALE)
    // `net = base ÷ (1 + rate) = base × 100 ÷ (100 + taxRate)`, with both operands lifted to
    // scaled integers so the division is the single rounding point:
    // `HALF_UP(base × 100 ÷ (100 + taxRate), 2)`.
    const onePlusRate: ExactDecimal = { units: 100n * 10n ** BigInt(rate.scale) + rate.units, scale: rate.scale }
    const net = divideToScale(multiplyExactDecimal(base, { units: 100n, scale: 0 }), onePlusRate, AMOUNT_SCALE)
    const tax = subtractExactDecimal(gross, net)
    return {
      netTotal: toAmountString(net, AMOUNT_SCALE),
      taxAmount: toAmountString(tax, AMOUNT_SCALE),
      lineTotal: toAmountString(gross, AMOUNT_SCALE),
    }
  }

  const net = quantizeExactDecimal(base, AMOUNT_SCALE)
  const tax = divideToScale(multiplyExactDecimal(net, rate), { units: 100n, scale: 0 }, AMOUNT_SCALE)
  const gross = addExactDecimal(net, tax)
  return {
    netTotal: toAmountString(net, AMOUNT_SCALE),
    taxAmount: toAmountString(tax, AMOUNT_SCALE),
    lineTotal: toAmountString(gross, AMOUNT_SCALE),
  }
}

export type OrderTotals = {
  subtotal: string
  taxTotal: string
  total: string
}

/**
 * Head totals: the exact sum of the already-rounded per-line values, through the engine's
 * `sumAmounts`.
 *
 * `total` is the sum of the line totals (equivalently of `subtotal + taxTotal`, since each line's
 * components add up exactly); nothing is re-quantized, so a head equals what a reader gets by adding
 * the printed column.
 */
export function computeOrderTotals(lines: OrderLineTotals[]): OrderTotals {
  return {
    subtotal: sumAmounts(lines.map((line) => line.netTotal)),
    taxTotal: sumAmounts(lines.map((line) => line.taxAmount)),
    total: sumAmounts(lines.map((line) => line.lineTotal)),
  }
}

/**
 * The planned deposit for a percentage term: `HALF_UP(total × percent ÷ 100, 2)`.
 *
 * The division by 100 is folded into the percentage's scale (+2) instead of dividing, so the whole
 * computation stays in scaled integers and the engine rounds it once — `20 %` of `6000.005` is
 * `1200.00`, never a float artefact. A null/absent percentage (nobody planned a deposit as a
 * percentage) reads as 0 %, and a zero total is a legitimate `0.00`; an unparseable **total or
 * non-null percentage** throws rather than being silently treated as zero.
 */
export function computeDepositAmount(total: string | number, percent: string | number | null | undefined): string {
  const totalDecimal = parseExactDecimal(total)
  if (!totalDecimal) {
    throw new Error(`[purchasing] deposit needs a finite total: ${String(total)}`)
  }
  const percentDecimal =
    percent === null || percent === undefined ? { units: 0n, scale: 0 } : parseExactDecimal(percent)
  if (!percentDecimal) {
    throw new Error(`[purchasing] deposit needs a finite percent: ${String(percent)}`)
  }
  const shiftedPercent: ExactDecimal = { units: percentDecimal.units, scale: percentDecimal.scale + 2 }
  return toAmountString(multiplyExactDecimal(totalDecimal, shiftedPercent), AMOUNT_SCALE)
}

/**
 * The receipt arithmetic, exact to the quantity's fourth decimal.
 *
 * `alreadyReceived + incoming` is summed as scaled integers and compared to the ordered ceiling the
 * same way, so an over-receipt is refused rather than silently clamped and a difference of one unit
 * in the last place is never lost to a float epsilon.
 */
export function applyReceiptQuantity(
  ordered: string | number,
  alreadyReceived: string | number,
  incoming: string | number,
): { receivedQuantity: string; exceedsOrdered: boolean } {
  const receivedUnits = toScaledUnits(alreadyReceived, QUANTITY_SCALE) + toScaledUnits(incoming, QUANTITY_SCALE)
  return {
    receivedQuantity: toAmountString({ units: receivedUnits, scale: QUANTITY_SCALE }, QUANTITY_SCALE),
    exceedsOrdered: receivedUnits > toScaledUnits(ordered, QUANTITY_SCALE),
  }
}

export type PaymentRow = { stage: string; amount: string | number }
export type StagePaidTotals = {
  /** Sum of the payments whose stage is `deposit`. */
  paidDeposit: string
  /** Sum of the payments whose stage is `balance`. */
  paidBalance: string
}

/**
 * The **recorded** deposit and balance: the sums of the payments filed under `stage='deposit'` and
 * `stage='balance'`, not the planned terms (`depositAmount` / `depositPercent`). A stage with no
 * payment yet reads as `0.00`, and an `other` payment is deliberately excluded — the two columns
 * answer "how much of this stage has been paid", not "how much money arrived".
 *
 * Summed as scaled integers like the rest of the module, so cents carry exactly.
 */
export function stagePaidTotals(payments: PaymentRow[]): StagePaidTotals {
  let depositUnits = 0n
  let balanceUnits = 0n
  for (const payment of payments) {
    if (payment.stage === 'deposit') depositUnits += toScaledUnits(payment.amount, AMOUNT_SCALE)
    else if (payment.stage === 'balance') balanceUnits += toScaledUnits(payment.amount, AMOUNT_SCALE)
  }
  return {
    paidDeposit: toAmountString({ units: depositUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
    paidBalance: toAmountString({ units: balanceUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
  }
}

export type OrderPaymentState = {
  paidTotal: string
  outstanding: string
  paymentStatus: 'unpaid' | 'deposit_paid' | 'partially_paid' | 'paid'
}

/**
 * Derives the payment state from the payment rows instead of storing it, so deleting or
 * correcting a payment can never leave the order claiming a state its rows contradict.
 *
 * Every amount is summed as scaled integers and the difference is taken there too, so the
 * outstanding balance is cent-exact regardless of how many installments arrive.
 *
 * `deposit_paid` means "the deposit stage is covered and nothing else has been paid";
 * any mix of stages, or more than one deposit installment, is `partially_paid`.
 */
export function derivePaymentState(total: string | number, payments: PaymentRow[]): OrderPaymentState {
  const totalUnits = toScaledUnits(total, AMOUNT_SCALE)
  let paidUnits = 0n
  let depositPayments = 0
  let balancePayments = 0
  for (const payment of payments) {
    paidUnits += toScaledUnits(payment.amount, AMOUNT_SCALE)
    if (payment.stage === 'deposit') depositPayments += 1
    if (payment.stage === 'balance') balancePayments += 1
  }

  const outstandingUnits = totalUnits - paidUnits
  let paymentStatus: OrderPaymentState['paymentStatus'] = 'unpaid'
  if (paidUnits > 0n) {
    if (outstandingUnits <= 0n) paymentStatus = 'paid'
    else if (depositPayments === 1 && balancePayments === 0) paymentStatus = 'deposit_paid'
    else paymentStatus = 'partially_paid'
  }

  return {
    paidTotal: toAmountString({ units: paidUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
    outstanding: toAmountString(
      { units: outstandingUnits > 0n ? outstandingUnits : 0n, scale: AMOUNT_SCALE },
      AMOUNT_SCALE,
    ),
    paymentStatus,
  }
}
