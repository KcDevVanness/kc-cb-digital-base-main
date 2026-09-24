/**
 * Money and payment-state derivations for purchase orders.
 *
 * Kept as pure functions so the command layer, the API projection, and any future worker
 * all agree on the same arithmetic — and so the rounding rule lives in exactly one place.
 * Amounts travel as decimal strings (MikroORM `numeric` columns) and are only parsed here.
 */

const DECIMALS = 4

function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toAmountString(value: number): string {
  return Number.parseFloat(value.toFixed(DECIMALS)).toFixed(DECIMALS)
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
 * Splits one line into net, tax, and gross.
 *
 * `priceIncludesTax` decides the direction: when the supplier quoted a tax-inclusive price,
 * the quoted amount is the gross and the net is derived from it; otherwise the quoted amount
 * is the net and the tax is added on top. Getting this backwards would misstate every total,
 * so the flag is stored per line rather than inferred.
 */
export function computeLineTotals(line: OrderLineInput): OrderLineTotals {
  const quantity = toAmount(line.quantity)
  const quoted = toAmount(line.unitPrice)
  const rate = toAmount(line.taxRate) / 100
  const quotedTotal = quantity * quoted

  const net = line.priceIncludesTax ? (rate > 0 ? quotedTotal / (1 + rate) : quotedTotal) : quotedTotal
  const tax = line.priceIncludesTax ? quotedTotal - net : net * rate

  return {
    netTotal: toAmountString(net),
    taxAmount: toAmountString(tax),
    lineTotal: toAmountString(net + tax),
  }
}

export type OrderTotals = {
  subtotal: string
  taxTotal: string
  total: string
}

export function computeOrderTotals(lines: OrderLineTotals[]): OrderTotals {
  let net = 0
  let tax = 0
  for (const line of lines) {
    net += toAmount(line.netTotal)
    tax += toAmount(line.taxAmount)
  }
  return {
    subtotal: toAmountString(net),
    taxTotal: toAmountString(tax),
    total: toAmountString(net + tax),
  }
}

export type PaymentRow = { stage: string; amount: string | number }

export type OrderPaymentState = {
  paidTotal: string
  outstanding: string
  paymentStatus: 'unpaid' | 'deposit_paid' | 'partially_paid' | 'paid'
}

/**
 * Derives the payment state from the payment rows instead of storing it, so deleting or
 * correcting a payment can never leave the order claiming a state its rows contradict.
 *
 * `deposit_paid` means "the deposit stage is covered and nothing else has been paid";
 * any mix of stages, or more than one deposit installment, is `partially_paid`.
 */
export function derivePaymentState(total: string | number, payments: PaymentRow[]): OrderPaymentState {
  const totalAmount = toAmount(total)
  let paid = 0
  let depositPayments = 0
  let balancePayments = 0
  for (const payment of payments) {
    paid += toAmount(payment.amount)
    if (payment.stage === 'deposit') depositPayments += 1
    if (payment.stage === 'balance') balancePayments += 1
  }

  const outstanding = totalAmount - paid
  let paymentStatus: OrderPaymentState['paymentStatus'] = 'unpaid'
  if (paid > 0) {
    if (outstanding <= 0) paymentStatus = 'paid'
    else if (depositPayments === 1 && balancePayments === 0) paymentStatus = 'deposit_paid'
    else paymentStatus = 'partially_paid'
  }

  return {
    paidTotal: toAmountString(paid),
    outstanding: toAmountString(Math.max(outstanding, 0)),
    paymentStatus,
  }
}
