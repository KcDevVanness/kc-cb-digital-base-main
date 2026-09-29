import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { readOptionText } from './shipmentCostOptions'

/**
 * Option loaders for the period-expense surfaces: the type vocabulary from the dictionary this
 * module seeds, and the marketplace channels from the module that owns them (`platform_ops`).
 */
export const EXPENSES_API_PATH = 'finance/expenses'
export const EXPENSES_LIST_HREF = '/backend/finance/expenses'
export const PAYABLES_LIST_HREF = '/backend/finance/payables'
export const RECEIVABLES_LIST_HREF = '/backend/finance/receivables'
export const FINANCE_EXPENSE_TYPE_DICTIONARY_KEY = 'finance_expense_type'

/** Expense types of the `finance_expense_type` dictionary, rendered as `CODE — name`. */
export async function loadExpenseTypeOptions(): Promise<CrudFieldOption[]> {
  const entries = await loadDictionaryEntriesByKey(FINANCE_EXPENSE_TYPE_DICTIONARY_KEY)
  return entries.map((entry) => {
    const label = entry.label.trim()
    return { value: entry.value, label: label && label !== entry.value ? `${entry.value} — ${label}` : entry.value }
  })
}

/** Code → display name of the same dictionary, for the list column. */
export async function loadExpenseTypeLabels(): Promise<Record<string, string>> {
  const entries = await loadDictionaryEntriesByKey(FINANCE_EXPENSE_TYPE_DICTIONARY_KEY)
  return Object.fromEntries(entries.map((entry) => [entry.value, entry.label.trim() || entry.value]))
}

/** Marketplace channels a platform-fee expense can be attributed to. */
export async function loadChannelOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  const term = query?.trim()
  try {
    const payload = await fetchCrudList<Record<string, unknown>>('platform_ops/channels', {
      pageSize: 50,
      sortField: 'name',
      sortDir: 'asc',
      ...(term ? { search: term } : {}),
    })
    return (payload.items ?? [])
      .map((item) => {
        const value = readOptionText(item, 'id')
        const name = readOptionText(item, 'name')
        const code = readOptionText(item, 'code')
        return { value, label: name ? (code ? `${name} — ${code}` : name) : value }
      })
      .filter((option) => option.value.length > 0)
  } catch {
    throw new Error(errorMessage)
  }
}
