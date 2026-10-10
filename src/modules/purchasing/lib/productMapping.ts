/**
 * The rule that turns a **supplier library row** into catalog-product values.
 *
 * The store-side half (non-empty/changed values, the whole price set) lives in
 * `products/lib/supplierMapping.ts`, shared with the quotation promotion; this file owns only what
 * a library row contributes.
 */

import type { PurchasingSupplierProduct } from '../data/entities'
import type { StoreDimensions } from '../../products/lib/store'
import { asRecord, toSpecSummary, type ProductFieldValues } from '../../products/lib/supplierMapping'

/**
 * Narrows the library row's loose `inner_packing` jsonb onto the store's dimensions shape.
 *
 * A blank or unparseable axis reads as `null`, so a half-filled sheet never writes a zero dimension.
 * The library stores the item's own size under the same `{length,width,height,unit}` keys the store
 * reads back, so no axis renaming happens here.
 */
export function storeDimensionsFromRecord(
  value: Record<string, unknown> | null | undefined,
): StoreDimensions | null {
  const record = asRecord(value ?? null)
  if (!record) return null
  const readNumber = (key: string): number | null => {
    const raw = record[key]
    if (raw === null || raw === undefined || raw === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  const unit = record.unit
  return {
    length: readNumber('length'),
    width: readNumber('width'),
    height: readNumber('height'),
    unit: typeof unit === 'string' && unit.length > 0 ? unit : null,
  }
}

export function supplierProductToProductFields(product: PurchasingSupplierProduct): ProductFieldValues {
  const nameZh = product.nameZh?.trim() ?? ''
  const nameEn = product.nameEn?.trim() ?? ''
  return {
    // Our own name wins over the supplier's raw one: the catalog product is the *internal* record,
    // and the supplier's wording stays on the library row where it was transcribed.
    name: nameZh.length > 0 ? nameZh : product.name && product.name.trim().length > 0 ? product.name.trim() : null,
    nameEn: nameEn.length > 0 ? nameEn : null,
    specSummary: toSpecSummary(product.description),
    hsCode: product.hsCode && product.hsCode.trim().length > 0 ? product.hsCode.trim() : null,
    unit: product.unit && product.unit.trim().length > 0 ? product.unit.trim() : null,
    netWeight: product.unitNetWeight ?? null,
    grossWeight: product.unitGrossWeight ?? null,
    volume: product.unitVolume ?? null,
    dimensions: storeDimensionsFromRecord(product.innerPacking),
    cartonQuantity: product.cartonQuantity ?? null,
  }
}
