import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * Option loaders for the purchase-order form's reference pickers.
 *
 * Each picker is backed by the owning module's own scoped route, so the form can only offer a
 * record the caller may open: the order description comes from the dictionary this module seeds
 * (`order_product_category`), the purchaser from the platform's user list, the customer from the
 * CRM's company list, and an order line's product from either the product master or a supplier's
 * own library. All but the line's product are optional, so a list that cannot be read yields no
 * options rather than failing the form — an order must stay creatable with a blank pick.
 */

export const PRODUCT_CATEGORY_DICTIONARY_KEY = 'order_product_category'

const USERS_API_PATH = '/api/auth/users'
const COMPANIES_API_PATH = 'customers/companies'
const SUPPLIER_PRODUCTS_API_PATH = '/api/purchasing/supplier-products'
const OWNER_OPTION_PAGE_SIZE = 100
/**
 * `customers/companies` caps `pageSize` at 100 (a larger value is a 400, not a bigger page), so
 * the picker asks for exactly the cap: one request, no error, and the same 100 candidates the
 * other CRM pickers offer.
 */
const CUSTOMER_OPTION_PAGE_SIZE = 100
/** First page of one supplier's library; the operator narrows by typing rather than paging. */
const SUPPLIER_PRODUCT_OPTION_PAGE_SIZE = 50

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

/**
 * CrudForm swallows a loader rejection, so a picker that cannot load would go blank with no
 * explanation. A 401/403 is an ordinary answer for an optional picker — the caller's role may
 * simply not list that resource — and stays silent; anything else is a real fault and is
 * reported once through the same flash channel the form's save errors use.
 */
function reportLoadFailure(errorMessage: string, status: number | null): CrudFieldOption[] {
  if (status !== 401 && status !== 403) flash(errorMessage, 'error')
  return []
}

/** An option that also carries the display snapshot the order freezes onto itself when picked. */
type SnapshotOption = CrudFieldOption & { snapshot: Record<string, unknown> }

/**
 * The snapshot of a chosen option, or `null` when the id is not on the loaded page: a picker
 * only ever holds the first page of its source, so an owner further down the user list simply
 * contributes no snapshot and the stored value is left as it was.
 */
export function findOptionSnapshot(options: CrudFieldOption[], id: string): Record<string, unknown> | null {
  const match = options.find((option) => option.value === id)
  if (!match) return null
  const snapshot = (match as { snapshot?: unknown }).snapshot
  return snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : null
}

/**
 * Order descriptions from the `order_product_category` dictionary this module seeds. The order
 * stores the entry's code, so the select and the list column can never disagree about a label.
 */
export async function loadProductCategoryOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  try {
    const entries = await loadDictionaryEntriesByKey(PRODUCT_CATEGORY_DICTIONARY_KEY)
    return entries.flatMap<CrudFieldOption>((entry) => {
      const value = entry.value.trim()
      if (!value) return []
      return [{ value, label: entry.label.trim() || value }]
    })
  } catch (error) {
    // The dictionary helper answers a missing or unreadable dictionary with an empty list, so a
    // rejection here is a transport fault rather than a configuration gap.
    return reportLoadFailure(errorMessage, readErrorStatus(error))
  }
}

function optionFromUser(item: Record<string, unknown>): SnapshotOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const email = readText(item, 'email')
  const name = readText(item, 'name', 'displayName', 'display_name') || email
  return { value, label: name || value, snapshot: { name: name || value, email: email || null } }
}

/**
 * Purchasers, from the platform's user list restricted to the caller's active organization so a
 * suggestion can actually own the resulting order. A role without `auth.users.list` gets a 403
 * here; the pick is optional, so the field simply stays empty.
 */
export async function loadOwnerOptions(errorMessage: string, search?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({
    scopeToActiveOrganization: '1',
    page: '1',
    pageSize: String(OWNER_OPTION_PAGE_SIZE),
  })
  const term = typeof search === 'string' ? search.trim() : ''
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${USERS_API_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage },
    )
    return (payload.items ?? [])
      .map(optionFromUser)
      .filter((option): option is SnapshotOption => option !== null)
  } catch (error) {
    return reportLoadFailure(errorMessage, readErrorStatus(error))
  }
}

function optionFromCompany(item: Record<string, unknown>): SnapshotOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const name = readText(item, 'name', 'displayName', 'display_name')
  return { value, label: name || value, snapshot: { name: name || value } }
}

/** Customer companies, from the CRM's own scoped list route — the store the customer pages read. */
export async function loadCustomerOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(COMPANIES_API_PATH, {
      pageSize: CUSTOMER_OPTION_PAGE_SIZE,
      sortField: 'name',
      sortDir: 'asc',
    })
    return (payload.items ?? [])
      .map(optionFromCompany)
      .filter((option): option is SnapshotOption => option !== null)
  } catch (error) {
    return reportLoadFailure(errorMessage, readErrorStatus(error))
  }
}

function optionFromSupplierProduct(item: Record<string, unknown>): CrudFieldOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  // The supplier's own item number is what the buyer recognises; the library code is the fallback
  // for a row whose supplier does not issue one.
  const code = readText(item, 'itemNo') || readText(item, 'supplierSku')
  const name = readText(item, 'name')
  const label = code && name ? `${code} — ${name}` : code || name
  return { value, label: label || value }
}

/**
 * One supplier's own item library, from the `sourcing` module's scoped route.
 *
 * The order write resolves a library line in its own organization, so `organizationId` narrows the
 * list the same way the product-master picker does, and only active rows are offered: an inactive
 * row stays readable on the orders that already reference it but is no longer pickable. An empty
 * `supplierId` yields no options — the picker is disabled until the header names a supplier, and a
 * list request without one would return a filtered page the operator cannot use anyway.
 */
export async function loadSupplierProductOptions(
  errorMessage: string,
  forbiddenMessage: string,
  supplierId: string | null,
  query?: string,
  organizationId?: string | null,
): Promise<CrudFieldOption[]> {
  const supplier = (supplierId ?? '').trim()
  if (!supplier) return []
  const params = new URLSearchParams({
    supplierId: supplier,
    status: 'active',
    pageSize: String(SUPPLIER_PRODUCT_OPTION_PAGE_SIZE),
  })
  if (organizationId) params.set('organizationId', organizationId)
  const term = query?.trim()
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${SUPPLIER_PRODUCTS_API_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage },
    )
    return (payload.items ?? [])
      .map(optionFromSupplierProduct)
      .filter((option): option is CrudFieldOption => option !== null)
  } catch (error) {
    // The two line-product pickers are not optional, so a refusal is named instead of swallowed:
    // an empty library otherwise reads as "this supplier has no items".
    const status = readErrorStatus(error)
    flash(status === 401 || status === 403 ? forbiddenMessage : errorMessage, 'error')
    return []
  }
}
