/**
 * The fixed rule that turns a **quotation line** into product-master values.
 *
 * The master-side half of the rule (non-empty/changed values, the whole price set) lives in
 * `products/lib/supplierMapping.ts`, because the supplier library's sync obeys the same contract;
 * this file owns only what a quotation line contributes and how its price row is built from the
 * line's own currency and MOQ, so the ladder lands in the catalog price table's minimum-quantity
 * column (`catalog_product_variant_prices.min_quantity`), where the product store already models it.
 */

import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { PRICE_SCALE, toAmountString } from '../../trade_docs/lib/money'
import type { SourcingQuoteLine } from '../data/entities'
import {
  asRecord,
  toSpecSummary,
  type DesiredPriceRow,
  type ProductFieldValues,
} from '../../products/lib/supplierMapping'

/**
 * Non-empty product values a line can contribute; nothing here returns an empty string.
 *
 * Only single-unit data crosses over: the master takes the per-unit weight (`unitNetWeight`), the
 * unit's own size (`innerPacking`, the item size the supplier quotes) and the Qty/Box, and never a
 * whole-carton weight or a carton outer size — the quotation line no longer carries those at all
 * (owner decision 2026-09-23).
 */
export function quoteLineToProductFields(line: SourcingQuoteLine): ProductFieldValues {
  return {
    name: line.productName && line.productName.trim().length > 0 ? line.productName.trim() : null,
    // A quotation line carries one name only, so it never proposes our English name: clearing it
    // would contradict the rule that an import may not blank a curated master field.
    nameEn: null,
    specSummary: toSpecSummary(line.description),
    hsCode: line.hsCode && line.hsCode.trim().length > 0 ? line.hsCode.trim() : null,
    unit: line.unit && line.unit.trim().length > 0 ? line.unit.trim() : null,
    netWeight: line.unitNetWeight ?? null,
    // A quotation line carries no G.W. column (the carton figures left the quotation layer on
    // 2026-09-23), so it never proposes one: `changedProductFields` drops the null.
    grossWeight: null,
    // The line carries no volume column either (the carton 体积 left the quotation layer on
    // 2026-09-23); only the library row proposes one.
    volume: null,
    dimensions: asRecord(line.innerPacking ?? null),
    cartonQuantity: line.cartonQuantity ?? null,
  }
}

/** The `purchase` price row a line asks for: the line's currency and MOQ, falling back to the quotation's. */
export function desiredPriceRow(line: SourcingQuoteLine, quoteCurrency: string): DesiredPriceRow {
  const lineCurrency = line.currencyCode && /^[A-Za-z]{3}$/.test(line.currencyCode) ? line.currencyCode : quoteCurrency
  return {
    tier: 'purchase',
    currencyCode: lineCurrency.toUpperCase(),
    minQuantity: line.moqQuantity && line.moqQuantity >= 1 ? Math.round(line.moqQuantity) : 1,
    // The products validator now rejects a price finer than 4 decimals, so a legacy line (or one
    // written before the caliber changed) is quantized here, HALF_UP away from zero, rather than
    // making the promotion fail with a 400. A line with no cost keeps the row's `0`.
    unitPrice: priceString(line.unitCost),
    startsAt: null,
    endsAt: null,
    isActive: true,
  }
}

/**
 * A line's cost at the price caliber (4 decimals, HALF_UP) — the only conversion a promoted price
 * goes through. A line with no cost keeps the row's former `0` fallback.
 */
function priceString(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim().length === 0) return '0'
  const parsed = parseExactDecimal(value)
  return parsed ? toAmountString(parsed, PRICE_SCALE) : '0'
}
