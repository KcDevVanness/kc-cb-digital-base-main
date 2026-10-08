import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  loadDictionaryEntriesByKey,
  type DictionaryEntryOption,
} from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { SALES_STATUS_DICTIONARY_KEY, statusEntryIdForValue } from './salesStatus'

/**
 * The tenant's sales status entries (`sales.order_status`), as the list, the form and the status
 * actions all need them.
 *
 * Two consumers, one cache entry: the list renders labels/colors from `entries`, and every status
 * **write** resolves its `statusEntryId` here — the engine takes the dictionary entry id, never a
 * bare label, so a tenant that renames or disables a value keeps control of its own vocabulary.
 */
export type SalesStatusEntriesState = {
  entries: DictionaryEntryOption[]
  isLoading: boolean
  /** The dictionary read failed — distinct from a tenant that simply lacks the value. */
  failed: boolean
  /** The entry id for a value, or `null` when this tenant's dictionary lacks that value. */
  entryIdFor: (value: string) => string | null
}

export function useSalesStatusEntries(): SalesStatusEntriesState {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['internal-sales-status-options', scopeVersion],
    queryFn: () => loadDictionaryEntriesByKey(SALES_STATUS_DICTIONARY_KEY),
    staleTime: 5 * 60 * 1000,
  })
  // Referentially stable while the query has no data: consumers put `entries` into memo
  // dependency arrays, and a fresh `[]` per render would re-run their effects forever.
  const entries = React.useMemo<DictionaryEntryOption[]>(() => query.data ?? [], [query.data])
  const entryIdFor = React.useCallback(
    (value: string) => statusEntryIdForValue(entries, value),
    [entries],
  )
  return { entries, isLoading: query.isLoading, failed: query.isError, entryIdFor }
}
