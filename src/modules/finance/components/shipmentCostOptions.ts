import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * Option loaders for the finance surfaces.
 *
 * The cost-type vocabulary comes from the dictionary this module seeds (`setup.ts`), the container
 * list from the module that owns shipments (`cross_border`), and the counterparty list from the
 * party master's own option source — none of them is re-implemented here, so a value the owning
 * page cannot show is never offered.
 */
export const SHIPMENT_COSTS_API_PATH = 'finance/shipment-costs'
export const SHIPMENT_COSTS_LIST_HREF = '/backend/finance/shipment-costs'
export const LANDED_COSTS_LIST_HREF = '/backend/finance/landed-costs'
export const INVENTORY_VALUE_LIST_HREF = '/backend/finance/inventory-value'
export const SHIPMENT_COST_TYPE_DICTIONARY_KEY = 'shipment_cost_type'

export function readOptionText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** Cost types of the `shipment_cost_type` dictionary, rendered as `CODE — name`. */
export async function loadShipmentCostTypeOptions(): Promise<CrudFieldOption[]> {
  const entries = await loadDictionaryEntriesByKey(SHIPMENT_COST_TYPE_DICTIONARY_KEY)
  return entries.map((entry) => {
    const label = entry.label.trim()
    return { value: entry.value, label: label && label !== entry.value ? `${entry.value} — ${label}` : entry.value }
  })
}

/**
 * Code → display name of the same dictionary, for the list column: the table renders the name a
 * reader recognizes while the row still stores the code (the picker shows `CODE — name`).
 */
export async function loadShipmentCostTypeLabels(): Promise<Record<string, string>> {
  const entries = await loadDictionaryEntriesByKey(SHIPMENT_COST_TYPE_DICTIONARY_KEY)
  return Object.fromEntries(entries.map((entry) => [entry.value, entry.label.trim() || entry.value]))
}

/**
 * Containers a cost can be booked against, read from `cross_border`'s own list route: the label is
 * the container number an operator recognizes, and the route's scope rules decide what is visible.
 */
export async function loadShipmentOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  const term = query?.trim()
  try {
    const payload = await fetchCrudList<Record<string, unknown>>('cross_border/shipments', {
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      ...(term ? { search: term } : {}),
    })
    return (payload.items ?? [])
      .map((item) => {
        const value = readOptionText(item, 'id')
        const number = readOptionText(item, 'number') || value.slice(0, 8)
        const status = readOptionText(item, 'status')
        return { value, label: status ? `${number} — ${status}` : number }
      })
      .filter((option) => option.value.length > 0)
  } catch {
    throw new Error(errorMessage)
  }
}

/** Forwarders and customs brokers from the party master's scoped option source. */
export async function loadPartyOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams()
  const term = query?.trim()
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<{ value?: string; label?: string }> }>(
      `/api/parties/options${params.size > 0 ? `?${params.toString()}` : ''}`,
      undefined,
      { errorMessage },
    )
    return (payload.items ?? []).flatMap((item) =>
      typeof item.value === 'string' && item.value.length > 0
        ? [{ value: item.value, label: typeof item.label === 'string' ? item.label : item.value }]
        : [],
    )
  } catch {
    throw new Error(errorMessage)
  }
}
