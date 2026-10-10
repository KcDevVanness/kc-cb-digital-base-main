import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'

/**
 * Picking one of this module's products from another surface.
 *
 * The product master owns how it is listed, so every picker in the app (contract lines, invoice
 * lines, internal sales lines) reads it through this one function instead of each form writing its
 * own query. It is a plain `fetchCrudList` call against the module's own list route
 * (`GET /api/products/items`), which means the caller inherits the route's scope rules: a product
 * outside the caller's organization cannot be offered.
 *
 * A product **is** the catalog product since the cutover
 * (`.ai/specs/2026-10-10-catalog-single-store.md`), so an option's `catalogProductId` is the product
 * id itself — the field is kept because callers resolve a product's default variant from it.
 *
 * The `organizationId` argument stays in the signature for the callers that pass the organization
 * they are writing to, but it no longer narrows anything: the list is always the caller's selected
 * organization, because the store's read model is organization-private and offers no
 * cross-organization read.
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
   * The catalog product this option stands for — the option's own id, since the product id **is**
   * the catalog product id.
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
    catalogProductId:
      typeof item.catalogProductId === 'string' && item.catalogProductId.length > 0 ? item.catalogProductId : value,
  }
}

/** Suggestions for a product picker; `query` is the operator's search text. */
export async function loadProductOptions(
  errorMessage: string,
  query?: string,
  _organizationId?: string | null,
): Promise<ProductOption[]> {
  const search = typeof query === 'string' ? query.trim() : ''
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(PRODUCTS_API_PATH, {
      status: 'active',
      pageSize: 50,
      ...(search.length > 0 ? { search } : {}),
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
  _organizationId?: string | null,
): Promise<ProductOption | null> {
  const payload = await fetchCrudList<Record<string, unknown>>(PRODUCTS_API_PATH, {
    ids: productId,
    pageSize: 1,
  })
  const item = payload.items?.[0]
  return item ? toProductOption(item) : null
}
