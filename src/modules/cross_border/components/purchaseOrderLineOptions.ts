/**
 * One purchase-order line as `/api/purchasing/purchase-orders/lines` projects it, reduced to what the
 * shipment form needs.
 *
 * The mapping is a **contract with a server projection**, and it is the key the contract-line
 * reference dialog matches on: the shipment's purchase allocations and the contract's lines are
 * paired by the product they both point at. Since the single-store cutover that reference travels as
 * **`catalogProductId`** — the `product_id` column on `purchasing_purchase_order_lines` was dropped
 * (`Migration20261010081054_purchasing.ts`) and the projection carries no `productId` key at all —
 * so reading the old key yields an empty reference for every line, the candidate map is empty, and
 * 「从合同引用商品行」 silently offers nothing. Nothing raises an error in that failure mode, which is
 * why this mapper lives in its own module with its own test instead of inline in the form.
 *
 * `node_modules`' own sales-side projection still uses `product_id`; the snake-case fallback here is
 * only for an older payload shape, not for a second source.
 */

export type PurchaseOrderLineOption = {
  id: string
  lineNumber: number
  /** Owned-master reference; the contract-line match key (empty when the line has no product). */
  productId: string
  catalogProductId: string
  productTitle: string | null
  productSku: string | null
  supplierSku: string | null
  quantity: string
  receivedQuantity: string
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function readOptionalText(source: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readText(source, ...keys)
  return value.length > 0 ? value : null
}

export function toPurchaseOrderLineOption(item: Record<string, unknown>): PurchaseOrderLineOption {
  return {
    id: readText(item, 'id'),
    lineNumber: Number(item.lineNumber ?? 0),
    productId: readText(item, 'catalogProductId', 'catalog_product_id'),
    catalogProductId: readText(item, 'catalogProductId', 'catalog_product_id'),
    productTitle: readOptionalText(item, 'productTitle', 'product_title'),
    productSku: readOptionalText(item, 'productSku', 'product_sku'),
    supplierSku: readOptionalText(item, 'supplierSku', 'supplier_sku'),
    quantity: readText(item, 'quantity') || '0',
    receivedQuantity: readText(item, 'receivedQuantity', 'received_quantity') || '0',
  }
}
