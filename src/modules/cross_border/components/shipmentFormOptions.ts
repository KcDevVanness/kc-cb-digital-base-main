import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * Option loaders for the shipment form.
 *
 * Container models, ports and carriers come from the dictionaries this module seeds
 * (`src/modules/cross_border/setup.ts`), so the pickers read the same store the dictionary library
 * edits — a value the operator cannot see there is never offered. A dictionary that is missing,
 * empty or not readable yields no options rather than an error: every one of these fields is
 * optional and stays typable, so a blank list must not block a shipment.
 */
export const CONTAINER_TYPE_DICTIONARY_KEY = 'container_type'
export const PORT_DICTIONARY_KEY = 'port'
export const CARRIER_DICTIONARY_KEY = 'carrier'

async function loadDictionaryOptions(key: string, query?: string): Promise<CrudFieldOption[]> {
  const entries = await loadDictionaryEntriesByKey(key)
  const term = query?.trim().toLowerCase() ?? ''
  return entries
    .map((entry) => ({ value: entry.value, label: entry.label }))
    .filter((option) => (term.length ? `${option.value} ${option.label}`.toLowerCase().includes(term) : true))
}

/** Container models of the `container_type` dictionary, keyed by the code a shipment stores. */
export function loadContainerTypeOptions(query?: string): Promise<CrudFieldOption[]> {
  return loadDictionaryOptions(CONTAINER_TYPE_DICTIONARY_KEY, query)
}

/** Ports of the `port` dictionary; the contract header's 目的地 reuses the same list. */
export function loadPortOptions(query?: string): Promise<CrudFieldOption[]> {
  return loadDictionaryOptions(PORT_DICTIONARY_KEY, query)
}

/** Carriers of the `carrier` dictionary. */
export function loadCarrierOptions(query?: string): Promise<CrudFieldOption[]> {
  return loadDictionaryOptions(CARRIER_DICTIONARY_KEY, query)
}
