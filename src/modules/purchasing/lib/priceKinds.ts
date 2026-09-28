import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { PRICE_SCALE, divideHalfUp, toAmountString, toScaledUnits } from '../../trade_docs/lib/money'

/**
 * The two prices a supplier library item can list side by side.
 *
 * `supplier_cost` — **供应商供货价**, what the supplier charges us. `company_offer` —
 * **本公司报价**, ours: read-only since 2026-09-24, because our own offer is a fact about the
 * *product* (the master's `internal` tier) and a per-supplier copy could only drift from it.
 *
 * The codes are constants, not a table, and they name **who prices the item**, never a company and
 * never a currency: the supplier's name and the currency are separate columns
 * (`purchasing_supplier_product_prices.currency_code`), so the same list works for the next supplier
 * or a second currency without a schema change. Exactly two codes exist today; a new one is a row,
 * not a column.
 *
 * The **stored** set keeps that generality (a second currency or quantity ladder is still a row),
 * while the library form edits one 供货价 — the base row `pickBasePriceRow` resolves below — because
 * the business quotes a single price per supplier item.
 */
export const SUPPLIER_PRODUCT_PRICE_KINDS = ['supplier_cost', 'company_offer'] as const

export type SupplierProductPriceKind = (typeof SUPPLIER_PRODUCT_PRICE_KINDS)[number]

/**
 * Fallback labels for contexts where no i18n translator is available (logs, server errors).
 * Every rendered label goes through the `purchasing.supplierProducts.price.kind.*` keys instead.
 */
export const SUPPLIER_PRODUCT_PRICE_KIND_LABELS: Record<SupplierProductPriceKind, string> = {
  supplier_cost: '供应商供货价',
  company_offer: '本公司报价',
}

export function isSupplierProductPriceKind(value: unknown): value is SupplierProductPriceKind {
  return typeof value === 'string' && (SUPPLIER_PRODUCT_PRICE_KINDS as readonly string[]).includes(value)
}

/**
 * The order two rows of one kind compete in when only one can be shown: the **lowest** minimum
 * quantity wins, ties (two currencies at the same step) are broken by currency code so a column —
 * or the form's single price field — can never flip between renders on equal data. Negative when
 * `left` comes first.
 *
 * One rule behind two readers that must agree: the list column / promotion resolve the base
 * `supplier_cost` row with it (`lib/supplierProductPrices.ts`), and the library form edits exactly
 * that row.
 */
export function comparePriceBaseRows(
  left: { minQuantity: number; currencyCode: string },
  right: { minQuantity: number; currencyCode: string },
): number {
  if (left.minQuantity !== right.minQuantity) return left.minQuantity - right.minQuantity
  return left.currencyCode.localeCompare(right.currencyCode)
}

/** The single base row of a set, or `null` when the set is empty (`comparePriceBaseRows` folded). */
export function pickBasePriceRow<T extends { minQuantity: number; currencyCode: string }>(
  rows: readonly T[],
): T | null {
  let base: T | null = null
  for (const row of rows) {
    if (!base || comparePriceBaseRows(row, base) < 0) base = row
  }
  return base
}

/** One row is identified by kind + currency + minimum quantity; the API upserts on exactly this. */
export function supplierProductPriceRowKey(row: {
  priceKind: string
  currencyCode: string
  minQuantity: number
}): string {
  return `${row.priceKind}|${row.currencyCode.toUpperCase()}|${row.minQuantity}`
}

/**
 * `5.0000` → `5`, `3.7500` → `3.75`: a `numeric(7,4)` percentage as the operator typed it, not as the
 * column pads it. Display only — the stored value keeps its scale.
 */
export function trimDecimalText(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 折后价 — the supply price after the item's supplier discount.
 *
 * One implementation for the three places that have to agree: the form's live preview, the list
 * column and the promotion's write into the product master's `purchase` tier. `unit_price` carries the
 * system-wide **4-decimal** price caliber, so the result is `HALF_UP(price × (100 − discount) ÷ 100, 4)`
 * computed in the BigInt money engine (`trade_docs/lib/money.ts`) — never a float, and never a second
 * rounding after the price was entered.
 *
 * A blank discount reads as 0 %. A blank or unparseable price has **no** net (`null`, never `0`), so
 * a caller can tell "no price yet" from "free" — the same distinction the price payload builder makes
 * when it drops an amountless row.
 */
export function netUnitPrice(
  unitPrice: string | number | null | undefined,
  discountPercent: string | number | null | undefined,
): string | null {
  const priceText = unitPrice === null || unitPrice === undefined ? '' : `${unitPrice}`.trim()
  if (!parseExactDecimal(priceText)) return null

  const discountText = discountPercent === null || discountPercent === undefined ? '' : `${discountPercent}`.trim()
  const discountUnits = toScaledUnits(discountText.length === 0 ? '0' : discountText, PRICE_SCALE)

  // price × (100 − discount), with both factors lifted to `PRICE_SCALE` so `(100 − discount)` is a
  // scaled integer; dividing by `100 × 10^PRICE_SCALE` lands the result back on the price scale.
  const priceUnits = toScaledUnits(priceText, PRICE_SCALE)
  const hundredUnits = 100n * 10n ** BigInt(PRICE_SCALE)
  const netUnits = divideHalfUp(priceUnits * (hundredUnits - discountUnits), hundredUnits)
  return toAmountString({ units: netUnits, scale: PRICE_SCALE }, PRICE_SCALE)
}
