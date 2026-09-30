import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  SALES_TRADE_TYPES,
  channelIdForTradeType,
  resolveRowTradeType,
  type SalesTradeType,
} from '../../internal_sales/lib/tradeType'
import { readBuyerSnapshot } from '../../internal_sales/lib/buyer'
import { loadTradeTypeChannelIds, type TradeTypeChannelMap } from '../../internal_sales/lib/tradeTypeChannels'

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
 * `channelIds` are the organization's trade-type channels — **both** of them, because a shipment
 * allocates to internal (总部 → 分公司) and external (分公司 → 当地客户) orders alike since
 * 2026-09-30. The ids travel as the list route's comma-separated plural filter; an empty list
 * (no channel seeded yet) omits the filter rather than narrowing to nothing, and the caller pairs
 * that with the unmarked bucket below. Pure so the param contract is testable without a network.
 */
export function buildSalesOrderListParams(
  channelIds: readonly string[],
  term: string,
): Record<string, string | number> {
  const scopedIds = channelIds.map((id) => id.trim()).filter((id) => id.length > 0)
  return {
    ...(scopedIds.length ? { channelIds: scopedIds.join(',') } : {}),
    pageSize: SALES_OPTION_PAGE_SIZE,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  }
}

/** The 对内/对外 word an option's direction is labelled with, keyed by the trade type it resolves to. */
function salesTradeTypeLabel(t: TranslateFn, type: SalesTradeType): string {
  return t(`cross_border.shipments.salesAllocations.tradeType.${type}`)
}

/**
 * Sales orders a shipment's sales allocation may draw from — both trade types.
 *
 * Read from the installed `sales` list — the module that owns the order resolves it, and the label
 * carries the order number so an operator can pick without memorizing ids. The route's own scope
 * rules apply, so an order outside the caller's organization is never offered.
 *
 * Both directions are offered because a container's goods are sold on both: the internal order is
 * the head-office → branch sale the allocation used to be limited to, the external one is the
 * branch → local-customer sale the same goods end up in. Each option carries its own direction in
 * front of the label, so the two families cannot be confused in one search box.
 *
 * Two buckets make the list complete: the orders marked with either trade-type channel, plus every
 * order carrying no channel at all (documents written before the marker existed — the backfill
 * classifies them, and until it runs they must stay allocatable).
 */
export async function loadSalesOrderOptions(
  t: TranslateFn,
  errorMessage: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  const term = query?.trim() ?? ''
  const channelIds = await loadTradeTypeChannelIds('order', errorMessage)
  const tradeTypeChannelIds = SALES_TRADE_TYPES
    .map((type) => channelIdForTradeType(type, channelIds))
    .filter((id): id is string => id !== null)
  try {
    const [marked, unmarked] = await Promise.all([
      fetchCrudList<Record<string, unknown>>(
        SALES_ORDERS_API_PATH,
        buildSalesOrderListParams(tradeTypeChannelIds, term),
      ),
      fetchCrudList<Record<string, unknown>>(SALES_ORDERS_API_PATH, {
        ...buildSalesOrderListParams([], term),
        channelIdsEmpty: 'true',
      }),
    ])
    return toSalesOrderOptions(t, [...(marked.items ?? []), ...(unmarked.items ?? [])], channelIds)
  } catch {
    // A caller-localized message beats the transport error for an operator staring at a search box.
    throw new Error(errorMessage)
  }
}

/**
 * Option shape shared by the two buckets, deduplicated by id (a row carries a channel or does not).
 * The direction is read off the channel marker first and the frozen buyer snapshot second, and it
 * goes **in front of** the label: it is what the eye compares when two orders name the same branch,
 * and a row whose direction cannot be resolved at all (a hand-typed buyer, written before the
 * marker) keeps the plain label rather than a guess.
 *
 * The buyer is read off the row when the list projects one and off the frozen snapshot otherwise
 * (`sales/orders` carries it only inside `customerSnapshot`), because an order number alone does not
 * tell two orders of the same week apart in a search box.
 */
function toSalesOrderOptions(
  t: TranslateFn,
  items: Array<Record<string, unknown>>,
  channelIds: TradeTypeChannelMap,
): CrudFieldOption[] {
  const seen = new Set<string>()
  const options: CrudFieldOption[] = []
  for (const item of items) {
    const value = String(item.id ?? '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    const number = readOptionText(item, 'orderNumber', 'order_number') || value.slice(0, 8)
    const customer = readOptionText(item, 'customerName', 'customer_name')
      || readBuyerSnapshot(item.customerSnapshot ?? item.customer_snapshot).name
    const label = customer ? `${number} — ${customer}` : number
    const tradeType = resolveRowTradeType(item, channelIds)
    options.push({ value, label: tradeType ? `${salesTradeTypeLabel(t, tradeType)} · ${label}` : label })
  }
  return options
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
