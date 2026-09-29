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
export const INCOTERM_DICTIONARY_KEY = 'incoterms'

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
 * Trade terms (贸易术语) printed on a PI/CI: `EXW`, `FOB`, `CIF`, … — the same `incoterms`
 * dictionary the setup seeds. `loadDictionaryOptions` returns an empty list when the dictionary is
 * missing, so a deployment that has not seeded it simply offers no suggestions instead of throwing;
 * the field keeps `allowCustomValues`, so a negotiated term is still typeable.
 */
export function loadIncotermOptions(query?: string): Promise<CrudFieldOption[]> {
  return loadDictionaryOptions(INCOTERM_DICTIONARY_KEY, query)
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
const SALES_ORDERS_API_PATH = 'sales/orders'
const PURCHASE_ORDERS_API_PATH = 'purchasing/purchase-orders'
const SHIPMENTS_API_PATH = 'cross_border/shipments'
const DOCUMENTS_API_PATH = 'trade_docs/documents'

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

/** Display name inside a jsonb snapshot, tolerating both camelCase and snake_case keys. */
export function snapshotText(snapshot: unknown, key = 'name'): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Internal sales orders a document can be anchored to (the PI's 来源单据 = PO anchor).
 *
 * Read from the installed sales list, so the order is resolved by the module that owns it; the
 * label carries the order number and the buyer so an operator can pick without memorizing ids.
 */
export async function loadSalesOrderOptions(query?: string): Promise<CrudFieldOption[]> {
  const term = query?.trim()
  const payload = await fetchCrudList<Record<string, unknown>>(SALES_ORDERS_API_PATH, {
    pageSize: 50,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  })
  return (payload.items ?? [])
    .map((item) => {
      const value = String(item.id ?? '')
      const number = readText(item, 'orderNumber', 'order_number') || value.slice(0, 8)
      const customer = snapshotText(item.customerSnapshot ?? item.customer_snapshot)
      return { value, label: customer ? `${number} — ${customer}` : number }
    })
    .filter((option) => option.value.length > 0)
}

/**
 * Purchase orders a document can be anchored to.
 *
 * The installed purchasing list, same read the shipment form draws its allocatable orders from; the
 * supplier name comes from the list projection so no second request is needed.
 */
export async function loadPurchaseOrderOptions(query?: string): Promise<CrudFieldOption[]> {
  const term = query?.trim()
  const payload = await fetchCrudList<Record<string, unknown>>(PURCHASE_ORDERS_API_PATH, {
    pageSize: 50,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  })
  return (payload.items ?? [])
    .map((item) => {
      const value = String(item.id ?? '')
      const number = readText(item, 'number') || value.slice(0, 8)
      const supplier = readText(item, 'supplierName', 'supplier_name')
      return { value, label: supplier ? `${number} — ${supplier}` : number }
    })
    .filter((option) => option.value.length > 0)
}

/**
 * Shipments a commercial invoice can be anchored to (the CI's 来源单据 = shipment anchor).
 *
 * Read from the cross-border shipment list, so the shipment is resolved by the module that owns it;
 * the label is its own number, which is what the CI prints as its source.
 */
export async function loadShipmentOptions(query?: string): Promise<CrudFieldOption[]> {
  const term = query?.trim()
  const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, {
    pageSize: 50,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  })
  return (payload.items ?? [])
    .map((item) => {
      const value = String(item.id ?? '')
      const number = readText(item, 'number') || value.slice(0, 8)
      return { value, label: number }
    })
    .filter((option) => option.value.length > 0)
}

/**
 * Documents of one family (`proforma` / `commercial`) offered as one-shot copy sources — the PI →
 * CI → tax-invoice chain. Read from this module's own list route, so the scope and defaults match
 * the list pages the operator already sees; the caller renders `number ?? draft` + counterparty
 * (`DocumentCopyFromDialog`) rather than the loader baking in a display string, so a source without
 * a number still reads as a draft instead of a bare UUID.
 */
export type DocumentOption = {
  value: string
  kind: string
  number: string | null
  counterpartyName: string | null
}

export async function loadDocumentOptions(
  kind: 'proforma' | 'commercial',
  query?: string,
): Promise<DocumentOption[]> {
  const term = query?.trim()
  const payload = await fetchCrudList<Record<string, unknown>>(DOCUMENTS_API_PATH, {
    kind,
    pageSize: 20,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  })
  return (payload.items ?? [])
    .map((item) => {
      const counterpartyName =
        (item.counterpartyName as string | null | undefined) ??
        (snapshotText(item.counterpartySnapshot ?? item.counterparty_snapshot) || null)
      return {
        value: String(item.id ?? ''),
        kind: readText(item, 'kind') || kind,
        number: (item.number ?? null) as string | null,
        counterpartyName,
      }
    })
    .filter((option) => option.value.length > 0)
}

/**
 * The parties master's own option source (`/api/parties/options`).
 *
 * Used by the contract/PI "our party" picker so the printed seller head comes from master data;
 * search is by party code, matching the route's own filter, and an unreadable list rejects with the
 * caller's message so the form can show it instead of silently offering nothing.
 */
export async function loadPartyOptions(
  errorMessage: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  const term = query?.trim()
  const url = term ? `${PARTIES_OPTIONS_URL}?search=${encodeURIComponent(term)}` : PARTIES_OPTIONS_URL
  const payload = await readApiResultOrThrow<{ items?: Array<{ value?: string; label?: string }> }>(
    url,
    undefined,
    { errorMessage },
  )
  return (payload.items ?? [])
    .map((item) => ({ value: String(item.value ?? ''), label: String(item.label ?? '') }))
    .filter((option) => option.value.length > 0)
}

/**
 * Bank accounts of one party, as `GET /api/parties/{id}` projects them, so a contract/PI can print
 * the beneficiary account the master data holds. An account with no number still lists by bank name
 * so the picker is never empty for a party that has one.
 */
export async function loadPartyBankAccountOptions(
  errorMessage: string,
  partyId: string,
): Promise<CrudFieldOption[]> {
  const scopedPartyId = partyId.trim()
  if (!scopedPartyId) return []
  const payload = await readApiResultOrThrow<{
    item?: { bankAccounts?: Array<Record<string, unknown>> }
  }>(`/api/parties/${encodeURIComponent(scopedPartyId)}`, undefined, { errorMessage })
  return (payload.item?.bankAccounts ?? [])
    .map((account) => {
      const value = String(account.id ?? '')
      const bank = readText(account, 'beneficiaryBank', 'beneficiary_bank')
      const number = readText(account, 'accountNumber', 'account_number')
      const label = [bank, number].filter((part) => part.length > 0).join(' — ') || value.slice(0, 8)
      return { value, label: account.isDefault === true ? `${label} ★` : label }
    })
    .filter((option) => option.value.length > 0)
}

export type PartyDetail = {
  id: string
  name: string
  /** Address composed for the printed head; the master stores it in parts. */
  address: string
  contact: string
  bankAccounts: Array<{
    id: string
    beneficiaryBank: string
    accountNumber: string
    swiftCode: string
    bankAddress: string
    isDefault: boolean
  }>
}

/**
 * One party's head plus its bank accounts, as `GET /api/parties/{id}` projects them. The picker
 * fills the contract/PI's printed "our party" block from this, so the paper and the master agree;
 * the free-text fields stay editable afterwards for documents that predate the master data.
 */
export async function loadPartyDetail(errorMessage: string, partyId: string): Promise<PartyDetail | null> {
  const scopedPartyId = partyId.trim()
  if (!scopedPartyId) return null
  const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
    `/api/parties/${encodeURIComponent(scopedPartyId)}`,
    undefined,
    { errorMessage },
  )
  const item = payload.item
  if (!item) return null
  const address = [
    readText(item, 'addressLine1', 'address_line1'),
    readText(item, 'addressLine2', 'address_line2'),
    readText(item, 'city'),
    readText(item, 'countryCode', 'country_code'),
  ].filter((part) => part.length > 0).join(', ')
  const rawAccounts = Array.isArray(item.bankAccounts) ? (item.bankAccounts as Array<Record<string, unknown>>) : []
  return {
    id: scopedPartyId,
    name: readText(item, 'name'),
    address,
    contact: readText(item, 'contactName', 'contact_name') || readText(item, 'email'),
    bankAccounts: rawAccounts.map((account) => ({
      id: String(account.id ?? ''),
      beneficiaryBank: readText(account, 'beneficiaryBank', 'beneficiary_bank'),
      accountNumber: readText(account, 'accountNumber', 'account_number'),
      swiftCode: readText(account, 'swiftCode', 'swift_code'),
      bankAddress: readText(account, 'bankAddress', 'bank_address'),
      isDefault: account.isDefault === true,
    })),
  }
}

/**
 * The `parties` roles of a contract's counterparty — `branch` (our own subsidiary) or `buyer` (a
 * local customer) — used to align the contract's copyable sales sources with its trade type.
 *
 * A contract counterparty may also be a `purchasing` supplier, whose id is not a party: that read
 * answers 404, and the caller then treats the counterparty as having **no** master link (offering
 * both trade types labeled) rather than as an error. The same happens when the read is simply
 * unreadable — never a reason to block the lines editor.
 */
export async function loadPartyRoles(errorMessage: string, partyId: string): Promise<string[] | null> {
  const scopedPartyId = partyId.trim()
  if (!scopedPartyId) return null
  try {
    const payload = await readApiResultOrThrow<{ item?: { roles?: unknown } }>(
      `/api/parties/${encodeURIComponent(scopedPartyId)}`,
      undefined,
      { errorMessage },
    )
    const roles = payload.item?.roles
    return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : []
  } catch {
    return null
  }
}
