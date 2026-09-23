import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'

/**
 * The supplier options both quotation panels read (the create panel's picker and the review
 * panel's header select).
 *
 * `purchasing/suppliers` caps `pageSize` at 100 — a larger value answers **400**, not a bigger
 * page — and a rejected request leaves the picker empty with no visible error, so the cap is
 * spelled out here once instead of being guessed per call site.
 */
export const SUPPLIER_OPTION_PAGE_SIZE = 100

export const SUPPLIER_OPTIONS_QUERY_KEY = ['sourcing-supplier-options'] as const

export type SupplierRow = { id: string; name: string }

export async function fetchSupplierRows(): Promise<SupplierRow[]> {
  const payload = await fetchCrudList<SupplierRow>('purchasing/suppliers', {
    pageSize: SUPPLIER_OPTION_PAGE_SIZE,
    isActive: 'true',
    sortField: 'name',
    sortDir: 'asc',
  })
  return payload.items ?? []
}
