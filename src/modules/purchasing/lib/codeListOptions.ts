import * as React from 'react'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import {
  loadDictionaryEntriesByKey,
  type DictionaryEntryOption,
} from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * The two code lists a generated product code is built from, as the pickers see them.
 *
 * Both live in the dictionaries `product_codes` seeds (`product_brand`, `product_category`) and both
 * are read through one loader because they are the same kind of thing: a short value a rule segment
 * pastes into a code, plus a label the operator reads. The pickers offer **exactly** the dictionary's
 * values and no free typing — a value the list does not carry cannot produce a code, so the refusal
 * belongs at the picker, not in a 400 after 生成 is clicked (which is what the category field did
 * while it was a text input). A stored value the dictionary no longer lists still renders as itself
 * (`withCurrentCodeListValue`), so opening a record can never blank its brand.
 *
 * A dictionary that is missing or unreadable yields no options rather than an error: the field keeps
 * the value it already holds.
 */

/** Entries are cached per dictionary key: the list changes only through the dictionary manager. */
const cachedOptions: Record<string, CrudFieldOption[]> = {}

function toOptions(entries: DictionaryEntryOption[]): CrudFieldOption[] {
  // `CODE — name`, the app's picker convention: the record stores the code (`PK`), the operator reads
  // the name (`PetKit`), and the code leads because it is what the generated code will contain.
  return entries.map((entry) => {
    const label = entry.label.trim()
    return { value: entry.value, label: label && label !== entry.value ? `${entry.value} — ${label}` : entry.value }
  })
}

async function loadEntries(key: string): Promise<CrudFieldOption[]> {
  const cached = cachedOptions[key]
  if (cached) return cached
  const options = toOptions(await loadDictionaryEntriesByKey(key))
  if (options.length > 0) cachedOptions[key] = options
  return options
}

/** The whole list, plus the value the record already carries so a `Select` can always show it. */
export async function loadCodeListOptions(key: string, current?: string): Promise<CrudFieldOption[]> {
  return withCurrentCodeListValue(await loadEntries(key), current ?? '')
}

/**
 * The same list as component state, for surfaces that render their own `Select` rather than a
 * CrudForm field. `loading` distinguishes "the dictionary is empty" from "the request has not
 * answered yet", so a picker can hold its empty-state hint back until it knows.
 */
export function useCodeListOptions(key: string): { options: CrudFieldOption[]; loading: boolean } {
  const [state, setState] = React.useState<{ options: CrudFieldOption[]; loading: boolean }>({
    options: [],
    loading: true,
  })
  React.useEffect(() => {
    let cancelled = false
    loadCodeListOptions(key)
      .then((next) => {
        if (!cancelled) setState({ options: next, loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [key])
  return state
}

export function withCurrentCodeListValue(options: CrudFieldOption[], current: string): CrudFieldOption[] {
  const code = current.trim()
  if (!code || options.some((option) => option.value === code)) return options
  return [...options, { value: code, label: code }]
}
