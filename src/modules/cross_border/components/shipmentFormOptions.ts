import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * Option loaders for the shipment form.
 *
 * Container models come from the platform dictionary this module seeds (`container_type`), so the
 * picker reads the same store the dictionary manager edits — a model the operator cannot see there
 * can never be stored on a shipment. A dictionary that is missing, empty or not readable yields no
 * options rather than an error: the field is optional and a blank pick must not block a shipment.
 */
export const CONTAINER_TYPE_DICTIONARY_KEY = 'container_type'

/** Container models of the `container_type` dictionary, keyed by the code a shipment stores. */
export async function loadContainerTypeOptions(query?: string): Promise<CrudFieldOption[]> {
  const entries = await loadDictionaryEntriesByKey(CONTAINER_TYPE_DICTIONARY_KEY)
  const term = query?.trim().toLowerCase() ?? ''
  return entries
    .map((entry) => ({ value: entry.value, label: entry.label }))
    .filter((option) => (term.length ? `${option.value} ${option.label}`.toLowerCase().includes(term) : true))
}
