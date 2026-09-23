/**
 * The fixed rule that turns a **quotation line** into product-master values.
 *
 * The master-side half of the rule (non-empty/changed values, the whole price set) lives in
 * `products/lib/supplierMapping.ts`, because the supplier library's sync obeys the same contract;
 * this file owns only what a quotation line contributes and how its price row is built from the
 * line's own currency and MOQ, so the ladder lands in `products_prices.min_quantity` where the
 * product module already models it.
 */

import type { SourcingQuoteLine } from '../data/entities'
import {
  asRecord,
  toSpecSummary,
  type DesiredPriceRow,
  type ProductFieldValues,
} from '../../products/lib/supplierMapping'
import { slugifySku } from './valueNormalization'

/** Non-empty product values a line can contribute; nothing here returns an empty string. */
export function quoteLineToProductFields(line: SourcingQuoteLine): ProductFieldValues {
  const dimensions = asRecord(line.outerPacking ?? null)
  return {
    name: line.productName && line.productName.trim().length > 0 ? line.productName.trim() : null,
    // A quotation line carries one name only, so it never proposes our English name: clearing it
    // would contradict the rule that an import may not blank a curated master field.
    nameEn: null,
    specSummary: toSpecSummary(line.description),
    hsCode: line.hsCode && line.hsCode.trim().length > 0 ? line.hsCode.trim() : null,
    unit: line.unit && line.unit.trim().length > 0 ? line.unit.trim() : null,
    netWeight: line.unitNetWeight ?? null,
    dimensions: asRecord(line.innerPacking ?? null),
    cartonQuantity: line.cartonQuantity ?? null,
    cartonDimensions: dimensions,
    cartonGrossWeight: line.cartonGrossWeight ?? null,
    cartonNetWeight: line.cartonNetWeight ?? null,
  }
}

/** The `purchase` price row a line asks for: the line's currency and MOQ, falling back to the quotation's. */
export function desiredPriceRow(line: SourcingQuoteLine, quoteCurrency: string): DesiredPriceRow {
  const lineCurrency = line.currencyCode && /^[A-Za-z]{3}$/.test(line.currencyCode) ? line.currencyCode : quoteCurrency
  return {
    priceTier: 'purchase',
    currencyCode: lineCurrency.toUpperCase(),
    minQuantity: line.moqQuantity && line.moqQuantity >= 1 ? Math.round(line.moqQuantity) : 1,
    unitPrice: line.unitCost ?? '0',
    startsAt: null,
    endsAt: null,
    isActive: true,
  }
}

/** Category code for a section banner (`FEEDING` → `feeding`); null when nothing usable is left. */
export function categoryCodeFromSection(label: string | null | undefined): string | null {
  if (!label) return null
  const slug = slugifySku(label).replace(/-/g, '_')
  return /^[a-z0-9_]{1,64}$/.test(slug) ? slug : null
}
