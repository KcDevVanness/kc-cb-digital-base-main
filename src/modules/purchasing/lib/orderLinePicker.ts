/**
 * The purchase-order line picker's value protocol.
 *
 * A line references **either** a supplier product library row **or** a product master row (the
 * command rejects a line that carries two; see `commands/orders.ts`). The editor shows one search
 * box over both lists, so the option's value has to say which list it came from — that prefix is the
 * whole protocol, and it never leaves the form: the payload carries the bare ids.
 *
 * The helpers live here (not in the component) because this mapping is what decides which column the
 * write lands on, and that is worth a unit test. The reference shape is structural on purpose, so
 * this module stays independent of the form component.
 */

const SUPPLIER_PRODUCT_PREFIX = 'supplier-product:'
const PRODUCT_PREFIX = 'product:'

/** The line fields the picker reads and writes. */
export type LinePickerReference = {
  supplierProductId: string
  productId: string
  catalogProductId: string
  productLabel: string
}

/** The picker's current value for a line; a legacy catalog line reads as its master reference. */
export function linePickerValue(line: Pick<LinePickerReference, 'supplierProductId' | 'productId' | 'catalogProductId'>): string {
  if (line.supplierProductId) return toSupplierProductPickerValue(line.supplierProductId)
  const masterId = line.productId || line.catalogProductId
  return masterId ? toProductPickerValue(masterId) : ''
}

/** An option value for a suggestion that came from the supplier's own library. */
export function toSupplierProductPickerValue(id: string): string {
  return `${SUPPLIER_PRODUCT_PREFIX}${id}`
}

/** An option value for a suggestion that came from the product master. */
export function toProductPickerValue(id: string): string {
  return `${PRODUCT_PREFIX}${id}`
}

/**
 * The reference a picked option sets. Exactly one side survives, and the seeded display label is
 * cleared with the other side so a name can never outlive the product it described. An empty value
 * (the picker's clear button) clears every reference.
 */
export function applyLinePickerValue(next: string): Partial<LinePickerReference> {
  if (next.startsWith(SUPPLIER_PRODUCT_PREFIX)) {
    return {
      supplierProductId: next.slice(SUPPLIER_PRODUCT_PREFIX.length),
      productId: '',
      catalogProductId: '',
      productLabel: '',
    }
  }
  if (next.startsWith(PRODUCT_PREFIX)) {
    return {
      productId: next.slice(PRODUCT_PREFIX.length),
      supplierProductId: '',
      catalogProductId: '',
      productLabel: '',
    }
  }
  return { supplierProductId: '', productId: '', catalogProductId: '', productLabel: '' }
}
