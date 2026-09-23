import * as React from 'react'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import {
  loadDictionaryEntriesByKey,
  type DictionaryEntryOption,
} from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * The app's unit-of-measure vocabulary, as the pickers see it.
 *
 * The list lives in the `supplier_product_unit` dictionary this app seeds
 * (`src/modules/purchasing/setup.ts`, the module that owns the supplier product library): its codes
 * are what a customs declaration, a quotation and the product master all print, so the product form
 * and the trade-document lines read that one store instead of each keeping a copy. The installed
 * `catalog` module seeds a **different** list under the key `unit` (engineering units for catalog
 * pricing, lowercase codes); it is deliberately not read here, because a product's unit must match
 * the trade vocabulary rather than the catalog's.
 *
 * A dictionary that is missing, empty or not readable yields no options rather than an error — the
 * field keeps the value it already holds, so an unreadable list never blocks a save.
 */
export const UNIT_DICTIONARY_KEY = 'supplier_product_unit'

let cachedOptions: CrudFieldOption[] | null = null

function toOptions(entries: DictionaryEntryOption[]): CrudFieldOption[] {
  // `CODE — name`: the dictionary label is the display name alone (one language, no code glued to
  // it), and the code — the thing the record actually stores and the customs paperwork prints — is
  // put in front of it by the picker. Same shape as the currency picker.
  return entries.map((entry) => {
    const label = entry.label.trim()
    return { value: entry.value, label: label && label !== entry.value ? `${entry.value} — ${label}` : entry.value }
  })
}

/**
 * Entries are cached once they arrive: a combobox asks on focus and again on every keystroke, and
 * the dictionary changes only through the dictionary manager. An empty result is never cached, so
 * a scope that has not been seeded yet is retried on the next open.
 */
async function loadUnitEntries(): Promise<CrudFieldOption[]> {
  if (cachedOptions) return cachedOptions
  const options = toOptions(await loadDictionaryEntriesByKey(UNIT_DICTIONARY_KEY))
  if (options.length > 0) cachedOptions = options
  return options
}

/**
 * Unit options for a picker, optionally narrowed to what the operator typed and always including
 * the unit the record already carries (`current`): a `Select` can only show a value that is among
 * its items, so without the merge a row whose unit the dictionary does not list would render an
 * empty trigger while the record still holds the code. `undefined` (no query) returns the whole
 * list, which is what a field wanting "show me everything on focus" needs.
 */
export async function loadUnitOptions(query?: string, current?: string): Promise<CrudFieldOption[]> {
  const options = withCurrentUnit(await loadUnitEntries(), current ?? '')
  const term = query?.trim().toLowerCase() ?? ''
  if (!term.length) return options
  return options.filter((option) => `${option.value} ${option.label}`.toLowerCase().includes(term))
}

/**
 * The same list as component state, for grids that render their own `Select` rather than a CrudForm
 * field. A load failure is not surfaced: the loader returns no options and the row keeps whatever
 * unit it already carries.
 */
export function useUnitOptions(): CrudFieldOption[] {
  const [options, setOptions] = React.useState<CrudFieldOption[]>([])
  React.useEffect(() => {
    let cancelled = false
    loadUnitOptions()
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return options
}

/**
 * A `Select` can only show a value that is among its items, so a row whose unit the dictionary does
 * not list keeps that unit as an option of its own — otherwise opening a document would render an
 * empty trigger while the record still holds the code.
 */
export function withCurrentUnit(options: CrudFieldOption[], current: string): CrudFieldOption[] {
  const code = current.trim()
  if (!code || options.some((option) => option.value === code)) return options
  return [...options, { value: code, label: code }]
}
