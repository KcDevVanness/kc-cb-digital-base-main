/**
 * The rule that turns a **supplier library row** into product-master values.
 *
 * The master-side half (non-empty/changed values, the whole price set) lives in
 * `products/lib/supplierMapping.ts`, shared with the quotation promotion; this file owns only what
 * a library row contributes.
 */

import type { PurchasingSupplierProduct } from '../data/entities'
import { asRecord, toSpecSummary, type ProductFieldValues } from '../../products/lib/supplierMapping'

export function supplierProductToProductFields(product: PurchasingSupplierProduct): ProductFieldValues {
  const nameZh = product.nameZh?.trim() ?? ''
  const nameEn = product.nameEn?.trim() ?? ''
  return {
    // Our own name wins over the supplier's raw one: the master is the *internal* record, and the
    // supplier's wording stays on the library row where it was transcribed.
    name: nameZh.length > 0 ? nameZh : product.name && product.name.trim().length > 0 ? product.name.trim() : null,
    nameEn: nameEn.length > 0 ? nameEn : null,
    specSummary: toSpecSummary(product.description),
    hsCode: product.hsCode && product.hsCode.trim().length > 0 ? product.hsCode.trim() : null,
    unit: product.unit && product.unit.trim().length > 0 ? product.unit.trim() : null,
    netWeight: product.unitNetWeight ?? null,
    grossWeight: product.unitGrossWeight ?? null,
    volume: product.unitVolume ?? null,
    dimensions: asRecord(product.innerPacking ?? null),
    cartonQuantity: product.cartonQuantity ?? null,
  }
}
