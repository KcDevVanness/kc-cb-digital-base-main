import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  AMOUNT_SCALE,
  subtractExactDecimal,
  toAmountString,
  toScaledUnits,
  type ExactDecimal,
} from '../../trade_docs/lib/money'

const logger = createLogger('platform_ops')

function parseAmount(value: string, field: string): ExactDecimal {
  const parsed = parseExactDecimal(value)
  if (!parsed) throw new Error(`[platform_ops] ${field} is not a finite decimal: ${value}`)
  return parsed
}

export type PlatformAmountInput = {
  grossAmount?: string | number | null
  feeAmount?: string | number | null
  netAmount?: string | number | null
}

/**
 * Quantizes one inbound platform amount to the system's single amount caliber (2 decimals, HALF_UP
 * away from zero).
 *
 * A platform payload is external integration data: unlike a backend form it may legitimately carry
 * more decimals than the amount caliber holds, so it is quantized rather than rejected. The extra
 * precision is reported as a structured warning — the field name and the raw value, nothing else
 * from the payload — so an integration that starts sending finer amounts is visible without ever
 * silently changing a number.
 */
export function quantizePlatformAmount(
  value: string | number | null | undefined,
  field: string,
): string {
  const parsed = parseExactDecimal(value ?? 0)
  if (!parsed) {
    throw new Error(`[platform_ops] ${field} is not a finite decimal: ${String(value)}`)
  }
  if (parsed.scale > AMOUNT_SCALE) {
    logger.warn('platform amount quantized to 2 decimals', {
      field,
      value: String(value),
      scale: parsed.scale,
    })
  }
  return toAmountString(parsed, AMOUNT_SCALE)
}

/**
 * The gross/fee/net trio of one platform order or settlement line, all at the amount caliber.
 *
 * `net` falls back to the exact `gross − fee` only when the payload omits it (some marketplaces do
 * not send a net figure at all). That subtraction runs on the engine's exact decimals — never on
 * floats — and both operands are already 2-decimal, so it is exact and does not round a second time.
 */
export function resolvePlatformAmounts(
  input: PlatformAmountInput,
  context: string,
): { gross: string; fee: string; net: string } {
  const gross = quantizePlatformAmount(input.grossAmount, `${context}.grossAmount`)
  const fee = quantizePlatformAmount(input.feeAmount, `${context}.feeAmount`)
  const net =
    input.netAmount === null || input.netAmount === undefined
      ? toAmountString(
          subtractExactDecimal(parseAmount(gross, `${context}.grossAmount`), parseAmount(fee, `${context}.feeAmount`)),
          AMOUNT_SCALE,
        )
      : quantizePlatformAmount(input.netAmount, `${context}.netAmount`)
  return { gross, fee, net }
}

/**
 * Exact amount comparison: both sides become scaled integers at the amount caliber and are compared
 * as BigInt. Floats are never involved, so a 0.01 difference is always visible and two decimal
 * strings that denote the same amount (`"10"`, `"10.00"`) are always equal.
 */
export function amountsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return toScaledUnits(left, AMOUNT_SCALE) === toScaledUnits(right, AMOUNT_SCALE)
}

export function amountsDiffer(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return !amountsEqual(left, right)
}

export type ReconciliationAmountPair = {
  expectedAmount?: string | null
  actualAmount?: string | null
}

/**
 * The dedup rule for reconciliation items.
 *
 * A fresh item is raised when there is no previous item for the same `(channel, externalRef, kind)`,
 * or when **either** the expected or the actual amount has changed from it. Re-importing an
 * unchanged problem stays silent (so a nightly import cannot resurrect a decision an operator
 * already took), while a problem whose numbers moved is genuinely new and is queued again — the
 * only case where the operator has something new to look at.
 */
export function shouldRaiseReconciliationItem(
  previous: ReconciliationAmountPair | null | undefined,
  next: ReconciliationAmountPair,
): boolean {
  if (!previous) return true
  return (
    !amountsEqual(previous.expectedAmount, next.expectedAmount) ||
    !amountsEqual(previous.actualAmount, next.actualAmount)
  )
}
