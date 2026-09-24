/**
 * The two prices a supplier library item lists side by side.
 *
 * `supplier_cost` — what the supplier charges us (the legacy 「PK 单价」 column; PK = Petkit, the
 * supplier's own abbreviation). `company_offer` — what we quote out (the legacy 「KC 单价」 column;
 * KC = the company's own abbreviation).
 *
 * The codes are constants, not a table, and they name **who prices the item**, never a company and
 * never a currency: the supplier's name and the currency are separate columns
 * (`purchasing_supplier_product_prices.currency_code`), so the same list works for the next supplier
 * or a second currency without a schema change. Exactly two codes exist today; a new one is a row,
 * not a column.
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

/** Display order of the price list: the cost we pay first, then what we quote out. */
export const SUPPLIER_PRODUCT_PRICE_KIND_ORDER: readonly SupplierProductPriceKind[] =
  SUPPLIER_PRODUCT_PRICE_KINDS

/** One row is identified by kind + currency + minimum quantity; the API upserts on exactly this. */
export function supplierProductPriceRowKey(row: {
  priceKind: string
  currencyCode: string
  minQuantity: number
}): string {
  return `${row.priceKind}|${row.currencyCode.toUpperCase()}|${row.minQuantity}`
}
