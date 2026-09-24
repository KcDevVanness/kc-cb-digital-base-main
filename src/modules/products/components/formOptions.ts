import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'

/**
 * Picking one of this module's products from another surface.
 *
 * The product master owns how it is listed, so every picker in the app (contract lines, invoice
 * lines, internal sales lines) reads it through this one function instead of each form writing its
 * own query. It is a plain `fetchCrudList` call against the module's own list route, which means the
 * caller inherits the route's scope rules: a product outside the caller's organization cannot be
 * offered, and `organizationId` narrows the list to the organization being written to.
 */

const PRODUCTS_API_PATH = 'products/items'

export type ProductOption = {
  value: string
  label: string
  name: string
  sku: string
  model: string
  spec: string
  unit: string
  /**
   * The product's optional link to the installed catalog product.
   *
   * Callers that must write a *variant* reference (the sales chain books fulfilment per variant)
   * resolve it from this id; a product without the link simply has no variant to offer.
   */
  catalogProductId: string
}

function toProductOption(item: Record<string, unknown>): ProductOption {
  const value = String(item.id ?? '')
  const sku = typeof item.sku === 'string' ? item.sku : ''
  const name = typeof item.name === 'string' ? item.name : ''
  return {
    value,
    label: sku ? `${sku} — ${name}` : name,
    name,
    sku,
    model: typeof item.manufacturerModel === 'string' ? item.manufacturerModel : '',
    spec: typeof item.specSummary === 'string' ? item.specSummary : '',
    unit: typeof item.unit === 'string' ? item.unit : '',
    catalogProductId: typeof item.catalogProductId === 'string' ? item.catalogProductId : '',
  }
}

/** Suggestions for a product picker; `query` is the operator's search text. */
export async function loadProductOptions(
  errorMessage: string,
  query?: string,
  organizationId?: string | null,
): Promise<ProductOption[]> {
  const search = typeof query === 'string' ? query.trim() : ''
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(PRODUCTS_API_PATH, {
      status: 'active',
      pageSize: 50,
      sortField: 'name',
      sortDir: 'asc',
      ...(search.length > 0 ? { search } : {}),
      ...(organizationId ? { organizationId } : {}),
    })
    return (payload.items ?? []).map(toProductOption)
  } catch {
    // The picker shows this message instead of the raw failure: a caller-localized string beats
    // the transport error for an operator staring at a search box.
    throw new Error(errorMessage)
  }
}

/** One product by id, for a row saved before the picker was populated. */
export async function loadProductOption(
  productId: string,
  errorMessage: string,
  organizationId?: string | null,
): Promise<ProductOption | null> {
  const payload = await fetchCrudList<Record<string, unknown>>(PRODUCTS_API_PATH, {
    ids: productId,
    pageSize: 1,
    ...(organizationId ? { organizationId } : {}),
  })
  const item = payload.items?.[0]
  return item ? toProductOption(item) : null
}
