import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useCurrencyOptions as useCurrencyDictionaryOptions } from '../../currency_policy/lib/clientOptions'

/**
 * Currency options for this module's own selects.
 *
 * The list, the URL and the merge rule live in one place for the whole app
 * (`currency_policy/lib/clientOptions.ts`, beside the route that serves the seeded currency
 * dictionary); this module only words its own failure message. The FX master is deliberately not
 * used: it drives exchange rates, not pickers.
 */
export {
  CURRENCY_OPTIONS_URL,
  loadCurrencyOptions,
  withCurrentCurrency,
} from '../../currency_policy/lib/clientOptions'

export function useCurrencyOptions(t: TranslateFn): CrudFieldOption[] {
  return useCurrencyDictionaryOptions(t('sourcing.currencyLoadFailed', 'Currencies could not be loaded'))
}
