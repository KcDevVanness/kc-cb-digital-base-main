import * as React from 'react'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * The currency picker source, kept beside the route that owns it.
 *
 * `GET /api/currency_policy/currencies` resolves the seeded currency dictionary this app keeps on
 * its policy list, and the write paths assert membership in that same dictionary
 * (`lib/currencyDictionary.ts` in `products`, `purchasing` and `sourcing`) — so a picker reading it
 * can never offer a code the command layer rejects. The FX master is deliberately not used: it
 * drives exchange rates, not pickers.
 */
export const CURRENCY_OPTIONS_URL = '/api/currency_policy/currencies'

export async function loadCurrencyOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  const payload = await readApiResultOrThrow<{ entries?: Array<{ value?: string; label?: string }> }>(
    CURRENCY_OPTIONS_URL,
    undefined,
    { errorMessage },
  )
  return (payload.entries ?? [])
    .map((entry) => {
      const value = typeof entry.value === 'string' ? entry.value.trim().toUpperCase() : ''
      if (!value) return null
      const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : value
      return { value, label: `${value} — ${label}` }
    })
    .filter((option): option is CrudFieldOption => option !== null)
    .sort((left, right) => left.value.localeCompare(right.value))
}

/**
 * A record stored before the dictionary changed keeps its code selectable: without this the trigger
 * would render the placeholder and the field would read as if no currency were set.
 */
export function withCurrentCurrency(options: CrudFieldOption[], current: string): CrudFieldOption[] {
  const code = current.trim().toUpperCase()
  if (!code || options.some((option) => option.value === code)) return options
  return [...options, { value: code, label: code }].sort((left, right) => left.value.localeCompare(right.value))
}

/**
 * Currencies for a panel's own select. The caller passes its own localized failure message, because
 * each surface words the flash for its own context; a failed load leaves the field empty.
 */
export function useCurrencyOptions(failureMessage: string): CrudFieldOption[] {
  const [options, setOptions] = React.useState<CrudFieldOption[]>([])
  React.useEffect(() => {
    let cancelled = false
    loadCurrencyOptions(failureMessage)
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      .catch(() => {
        if (!cancelled) flash(failureMessage, 'error')
      })
    return () => {
      cancelled = true
    }
  }, [failureMessage])
  return options
}
