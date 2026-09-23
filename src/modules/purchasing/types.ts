/**
 * Client-facing shapes of the purchasing module's supplier product library.
 *
 * The library moved here from `sourcing` on 2026-09-23: the entity, commands, API and pages all
 * live in this module, and `sourcing` only *feeds* it through
 * `purchasing.supplier-products.import-from-quote`.
 */

export type SupplierProductStatus = 'active' | 'inactive'
export type SupplierProductSource = 'manual' | 'quote'

/**
 * One row of the supplier product library as the API projects it.
 *
 * `productSku`/`productName` are resolved live from the product master for the page's rows, so the
 * list can render 关联商品 without a second request; `updatedAt` is the optimistic-lock version the
 * edit form sends back.
 */
export type SupplierProductListRow = {
  id: string
  supplierId: string
  supplierName: string | null
  supplierSku: string
  itemNo: string | null
  name: string
  nameZh: string | null
  nameEn: string | null
  description: string | null
  declarationElements: string | null
  unit: string
  hsCode: string | null
  /**
   * The item's base price per kind, attached by the list route's `afterList` hook: `null` when the
   * item quotes no price of that kind (or only deactivated ones).
   */
  supplierCostPrice: SupplierProductPriceCell | null
  companyOfferPrice: SupplierProductPriceCell | null
  imageAttachmentIds: string[]
  moqQuantity: number | null
  cartonQuantity: number | null
  unitNetWeight: string | null
  innerPacking: Record<string, unknown> | null
  productId: string | null
  productSku: string | null
  productName: string | null
  /**
   * `productId` is set but no live product resolves for it (deleted since the link, or not readable
   * in this scope). The list renders 已关联的商品已删除 instead of a name, and the write actions that
   * would fail (建档 skips it, 同步字段 refuses it) are withdrawn.
   */
  productDeleted: boolean
  status: SupplierProductStatus
  source: SupplierProductSource
  lastQuoteId: string | null
  notes: string | null
  updatedAt: string | null
}

/** One price as the list and the form show it: an amount and the currency it is quoted in. */
export type SupplierProductPriceCell = {
  currencyCode: string
  unitPrice: string
  minQuantity: number
}

export type SupplierProductPromotionResult = {
  productId: string
  action: 'created' | 'updated' | 'skipped'
  priceSkipped: boolean
}

/**
 * The outcome of feeding quotation lines into a supplier's library.
 *
 * Counts rather than a status: a run reports what it did per line and names the lines it could not
 * take, so the operator repairs those rows instead of re-running the whole import.
 */
export type SupplierProductImportResult = {
  created: number
  updated: number
  skipped: number
  failed: { lineId: string; lineNumber: number; message: string }[]
}
