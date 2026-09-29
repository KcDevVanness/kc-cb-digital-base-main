import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { channelIdForTradeType } from '../../internal_sales/lib/tradeType'
import { loadTradeTypeChannelIds } from '../../internal_sales/lib/tradeTypeChannels'

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

const SALES_ORDERS_API_PATH = 'sales/orders'
const SALES_ORDER_LINES_API_PATH = 'sales/order-lines'
const SALES_OPTION_PAGE_SIZE = 50
const SALES_LINE_PAGE_SIZE = 100

function readOptionText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * The list query a shipment's sales-order picker sends.
 *
 * `channelId` is the whole point: a shipment's sales allocation is an **internal** (总部 → 分公司)
 * sale, so the marker is mandatory. `null` means the organization has no `INTERNAL_SALES` channel
 * yet — the caller must offer nothing rather than fall back to every order, or an external sale
 * could be allocated onto a shipment. Pure so the param contract is testable without a network.
 */
export function buildSalesOrderListParams(
  channelId: string | null,
  term: string,
): Record<string, string | number> | null {
  if (!channelId) return null
  return {
    channelId,
    pageSize: SALES_OPTION_PAGE_SIZE,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  }
}

/**
 * Internal sales orders a shipment's sales allocation may draw from.
 *
 * Read from the installed `sales` list — the module that owns the order resolves it, and the label
 * carries the order number so an operator can pick without memorizing ids. The route's own scope
 * rules apply, so an order outside the caller's organization is never offered.
 *
 * Only the organization's **internal** trade-type channel is offered (`channelId`): an external
 * order has no 总部 → 分公司 pricing link behind it. When that channel is missing the picker stays
 * empty and the caller's localized message is surfaced, never a widened list.
 */
export async function loadSalesOrderOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  const term = query?.trim() ?? ''
  const channelIds = await loadTradeTypeChannelIds('order', errorMessage)
  const params = buildSalesOrderListParams(channelIdForTradeType('internal', channelIds), term)
  // No `INTERNAL_SALES` channel: no request, no options, and the caller's own message (the channel
  // loader already localized it the same way) instead of a picker that quietly lists everything.
  if (!params) throw new Error(errorMessage)
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(SALES_ORDERS_API_PATH, params)
    return (payload.items ?? [])
      .map((item) => {
        const value = String(item.id ?? '')
        const number = readOptionText(item, 'orderNumber', 'order_number') || value.slice(0, 8)
        const customer = readOptionText(item, 'customerName', 'customer_name')
        return { value, label: customer ? `${number} — ${customer}` : number }
      })
      .filter((option) => option.value.length > 0)
  } catch {
    // A caller-localized message beats the transport error for an operator staring at a search box.
    throw new Error(errorMessage)
  }
}

/** One internal sales-order line as `/api/sales/order-lines` projects it. */
export type SalesOrderLineOption = {
  id: string
  lineNumber: number
  productId: string
  productTitle: string
  productSku: string
  quantity: string
  unitPrice: string
  currencyCode: string
}

/**
 * The lines of one internal sales order — the candidates a sales allocation can be built from.
 * The product master id is kept so the editor can resolve the product's catalog link; the unit
 * price and currency are the line's own values, offered as the row's editable default.
 */
export async function loadSalesOrderLineOptions(
  errorMessage: string,
  orderId: string,
): Promise<SalesOrderLineOption[]> {
  const scopedOrderId = orderId.trim()
  if (!scopedOrderId) return []
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(SALES_ORDER_LINES_API_PATH, {
      orderId: scopedOrderId,
      pageSize: SALES_LINE_PAGE_SIZE,
    })
    return (payload.items ?? [])
      .map((item) => ({
        id: readOptionText(item, 'id'),
        lineNumber: Number(item.lineNumber ?? item.line_number ?? 0),
        productId: readOptionText(item, 'productId', 'product_id'),
        productTitle: readOptionText(item, 'name'),
        productSku: readOptionText(item, 'sku'),
        quantity: readOptionText(item, 'quantity') || '0',
        unitPrice: readOptionText(item, 'unitPriceNet', 'unit_price_net') || '0',
        currencyCode: readOptionText(item, 'currencyCode', 'currency_code'),
      }))
      .filter((line) => line.id.length > 0)
  } catch {
    throw new Error(errorMessage)
  }
}

const CONTRACTS_API_PATH = 'trade_docs/contracts'
const CONTRACT_LINES_API_PATH = 'trade_docs/contracts/lines'
const CONTRACT_OPTION_PAGE_SIZE = 50
const CONTRACT_LINE_PAGE_SIZE = 200

/** One contract line as `/api/trade_docs/contracts/lines` projects it. */
export type ContractLineOption = {
  id: string
  productId: string
  name: string
  sku: string
  unit: string
  quantity: string
}

/**
 * The line items of one contract — what the packing-list reference copies and what the shipment
 * allocation reference matches against the shipment's own order lines. Read-only, scoped by the
 * owning module's route.
 */
export async function loadContractLines(errorMessage: string, contractId: string): Promise<ContractLineOption[]> {
  const scopedContractId = contractId.trim()
  if (!scopedContractId) return []
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(CONTRACT_LINES_API_PATH, {
      contractId: scopedContractId,
      pageSize: CONTRACT_LINE_PAGE_SIZE,
    })
    return (payload.items ?? []).map((item) => ({
      id: readOptionText(item, 'id'),
      productId: readOptionText(item, 'productId', 'product_id'),
      name: readOptionText(item, 'name'),
      sku: readOptionText(item, 'sku'),
      unit: readOptionText(item, 'unit'),
      quantity: readOptionText(item, 'quantity'),
    })).filter((line) => line.id.length > 0)
  } catch {
    throw new Error(errorMessage)
  }
}

/**
 * Purchase/sales contracts a shipment can be linked to.
 *
 * Read from the `trade_docs` contract list, so the owning module resolves the record; the label
 * carries the contract number and its counterparty, which is what an operator picks by (the id
 * never appears in the UI). Cancelled contracts are filtered out here for the same reason the
 * command refuses them — a cancelled contract cannot cover a shipment.
 */
export async function loadContractOptions(query?: string): Promise<CrudFieldOption[]> {
  const payload = await fetchCrudList<Record<string, unknown>>(CONTRACTS_API_PATH, {
    search: query?.trim() || undefined,
    pageSize: CONTRACT_OPTION_PAGE_SIZE,
  })
  return (payload.items ?? [])
    .filter((item) => readOptionText(item, 'status') !== 'cancelled')
    .map((item) => {
      const id = readOptionText(item, 'id')
      const number = readOptionText(item, 'number') || id.slice(0, 8)
      const counterparty = readOptionText(item, 'counterpartyName')
      return {
        value: id,
        label: counterparty ? `${number} — ${counterparty}` : number,
      }
    })
    .filter((option) => option.value.length > 0)
}
