import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * Re-exported from the product master, which owns how its own products are listed.
 *
 * Contract and invoice line pickers go through the same function as every other product picker in
 * the app, so a change to the list route or the option shape lands in one place.
 */
export { loadProductOption, loadProductOptions, type ProductOption } from '../../products/components/formOptions'

/**
 * Units of measure, from the vocabulary the product master and the supplier library share: a
 * contract line prints the same code the product master stores, so the picker reads that list
 * instead of letting each document type its own spelling.
 */
export { loadUnitOptions, useUnitOptions, withCurrentUnit } from '../../products/lib/unitOptions'

/**
 * Ports of the logistics module's own dictionary: a contract's 目的地 and a shipment's 出口口岸 are
 * the same places, so both read one list instead of each keeping a copy.
 */
export { loadPortOptions } from '../../cross_border/components/shipmentFormOptions'

export const PAYMENT_TERM_DICTIONARY_KEY = 'payment_terms'
export const SHIPPING_METHOD_DICTIONARY_KEY = 'shipping_method'

/**
 * Suggestions from one of this module's own dictionaries (payment terms, shipping methods). These
 * headers print the wording a deal was signed with, so the field keeps `allowCustomValues`: the list
 * is a shortcut, never a constraint, and an unreadable dictionary simply yields no suggestions.
 */
async function loadDictionaryOptions(key: string, query?: string): Promise<CrudFieldOption[]> {
  const entries = await loadDictionaryEntriesByKey(key)
  const term = query?.trim().toLowerCase() ?? ''
  return entries
    .map((entry) => ({ value: entry.value, label: entry.label }))
    .filter((option) => (term.length ? `${option.value} ${option.label}`.toLowerCase().includes(term) : true))
}

export function loadPaymentTermOptions(query?: string): Promise<CrudFieldOption[]> {
  return loadDictionaryOptions(PAYMENT_TERM_DICTIONARY_KEY, query)
}

export function loadShippingMethodOptions(query?: string): Promise<CrudFieldOption[]> {
  return loadDictionaryOptions(SHIPPING_METHOD_DICTIONARY_KEY, query)
}

/**
 * Option loaders shared by the contract and invoice forms.
 *
 * Every picker is backed by the owning module's own scoped option source, so a form can only offer
 * records the caller may actually open: currencies come from the app-owned `currency_policy`
 * dictionary route, suppliers from `purchasing`, counterparties from the app-owned `parties`
 * master, contracts and their lines from this module, and products from the app-owned `products`
 * module.
 */

const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'
const SUPPLIERS_API_PATH = 'purchasing/suppliers'
const PARTIES_OPTIONS_URL = '/api/parties/options'
const PRODUCTS_API_PATH = 'products/items'
const CONTRACTS_API_PATH = 'trade_docs/contracts'
const CONTRACT_LINES_API_PATH = 'trade_docs/contracts/lines'

export function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export async function loadCurrencyOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  const payload = await readApiResultOrThrow<{ entries?: Array<{ value?: string; label?: string }> }>(
    CURRENCY_DICTIONARY_URL,
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
 * Suppliers and customer companies in one option list.
 *
 * Both kinds are offered together because the picker's field cannot depend on the sibling
 * `counterpartyKind` field's live value (the form field contract passes no other field values to
 * `loadOptions`), and an operator signing a sales contract should not first have to change a
 * toggle to see the buyer. Each option is prefixed with its kind's localized label so the two
 * namespaces stay distinguishable.
 */
export async function loadCounterpartyOptions(options: {
  supplierLabel: string
  customerLabel: string
  errorMessage: string
  organizationId?: string | null
}): Promise<CrudFieldOption[]> {
  const scope = options.organizationId ? { organizationId: options.organizationId } : {}
  const partiesUrl = options.organizationId
    ? `${PARTIES_OPTIONS_URL}?organizationId=${encodeURIComponent(options.organizationId)}`
    : PARTIES_OPTIONS_URL
  const [suppliers, parties] = await Promise.all([
    fetchCrudList<Record<string, unknown>>(SUPPLIERS_API_PATH, {
      // 100 is the supplier list's `pageSize` cap — a larger value answers 400, not a bigger page
      // (same limit `purchasing/components/orderFormOptions.ts` documents), which used to make the
      // whole counterparty picker reject before it could offer either kind.
      pageSize: 100,
      sortField: 'name',
      sortDir: 'asc',
      isActive: true,
      ...scope,
    }),
    readApiResultOrThrow<{ items?: Array<{ value?: string; label?: string }> }>(
      partiesUrl,
      undefined,
      { errorMessage: options.errorMessage },
    ),
  ])

  const toOptions = (items: Array<Record<string, unknown>>, prefix: string, withCode: boolean) =>
    items.map((item) => {
      const id = String(item.id ?? '')
      const name = readText(item, 'name', 'displayName', 'display_name') || id
      const code = withCode ? readText(item, 'code') : ''
      const label = code ? `${code} — ${name}` : name
      return { value: id, label: `${prefix}: ${label}` }
    })

  // The parties option source already renders `code — name`, so it only needs the kind prefix.
  const partyOptions = (parties.items ?? [])
    .map((item) => ({
      value: String(item.value ?? ''),
      label: `${options.customerLabel}: ${String(item.label ?? '')}`,
    }))
    .filter((option) => option.value.length > 0)

  return [
    ...toOptions(suppliers.items ?? [], options.supplierLabel, true),
    ...partyOptions,
  ].sort((left, right) => left.label.localeCompare(right.label))
}

/** Contracts an invoice may be bound to; an issued contract is the useful choice, drafts are shown too. */
export async function loadContractOptions(
  errorMessage: string,
  organizationId?: string | null,
): Promise<CrudFieldOption[]> {
  const payload = await fetchCrudList<Record<string, unknown>>(CONTRACTS_API_PATH, {
    pageSize: 200,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(organizationId ? { organizationId } : {}),
  })
  return (payload.items ?? []).map((item) => {
    const id = String(item.id ?? '')
    const number = readText(item, 'number')
    const direction = readText(item, 'direction')
    const counterparty = readText(item, 'counterpartyName')
    const label = [number || id.slice(0, 8), counterparty].filter((part) => part.length > 0).join(' · ')
    return { value: id, label: direction === 'sales' ? `${label} (销售)` : label }
  })
}

export type ContractLineOption = {
  value: string
  label: string
}

/** The contract's own lines, so an invoice line can be bound to the line it settles. */
export async function loadContractLineOptions(
  contractId: string,
  errorMessage: string,
): Promise<ContractLineOption[]> {
  const payload = await fetchCrudList<Record<string, unknown>>(CONTRACT_LINES_API_PATH, {
    contractId,
    pageSize: 500,
  })
  return (payload.items ?? []).map((item) => {
    const value = String(item.id ?? '')
    const lineNumber = Number(item.lineNumber ?? 0)
    const name = readText(item, 'name')
    const quantity = readText(item, 'quantity')
    const unitPrice = readText(item, 'unitPrice')
    return {
      value,
      label: `#${lineNumber} ${name} · ${quantity} × ${unitPrice}`.trim(),
    }
  })
}
