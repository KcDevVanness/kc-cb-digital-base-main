import { type SalesTradeType } from '../../internal_sales/lib/tradeType'
import { type TradeTypeChannelMap } from '../../internal_sales/lib/tradeTypeChannels'

/**
 * Where a contract's copied lines may come from, and how the source is aligned with the contract's
 * trade type.
 *
 * A contract's direction decides the family: a purchase contract draws from purchase orders, a
 * sales contract from sales documents (orders and quotes). For sales the counterparty decides the
 * trade type — a branch (`parties` role `branch`) is an internal 总部 → 分公司 sale, an external
 * customer (`buyer`) is a 分公司 → 当地客户 sale — and the type becomes a `channelId` filter on the
 * installed sales list. Nothing here hits the network: the selection rules are pure so the filter
 * contract is testable without a session.
 */

/** The document families a contract line can be copied from. */
export const CONTRACT_LINE_SOURCE_KINDS = ['purchase_order', 'sales_order', 'sales_quote'] as const
export type ContractLineSourceKind = (typeof CONTRACT_LINE_SOURCE_KINDS)[number]

/**
 * Everything the picker and the line reader need for one source family. The sales order/quote pair
 * differs only in these strings, so they stay in one table instead of branching at each call site.
 */
export const CONTRACT_LINE_SOURCE_ROUTES: Record<
  ContractLineSourceKind,
  {
    family: 'purchase_order' | 'sales'
    /** Head anchor the contract writes: a quote anchors as `sales_order` (no quote entry exists). */
    headSourceKind: 'purchase_order' | 'sales_order'
    headApiPath: string
    lineApiPath: string
    /** Query param the line surfaces accept for their parent document. */
    lineParentParam: 'orderId' | 'quoteId'
    /** Field carrying the head's own number in the list projection. */
    headNumberKey: 'number' | 'orderNumber' | 'quoteNumber'
  }
> = {
  purchase_order: {
    family: 'purchase_order',
    headSourceKind: 'purchase_order',
    headApiPath: 'purchasing/purchase-orders',
    lineApiPath: 'purchasing/purchase-orders/lines',
    lineParentParam: 'orderId',
    headNumberKey: 'number',
  },
  sales_order: {
    family: 'sales',
    headSourceKind: 'sales_order',
    headApiPath: 'sales/orders',
    lineApiPath: 'sales/order-lines',
    lineParentParam: 'orderId',
    headNumberKey: 'orderNumber',
  },
  sales_quote: {
    family: 'sales',
    headSourceKind: 'sales_order',
    headApiPath: 'sales/quotes',
    lineApiPath: 'sales/quote-lines',
    lineParentParam: 'quoteId',
    headNumberKey: 'quoteNumber',
  },
}

export function isSalesSourceKind(kind: ContractLineSourceKind): boolean {
  return CONTRACT_LINE_SOURCE_ROUTES[kind].family === 'sales'
}

/** The sources a contract direction is allowed to draw from — never the other family's. */
export function sourceKindsForDirection(direction: string): ContractLineSourceKind[] {
  return direction === 'sales' ? ['sales_order', 'sales_quote'] : ['purchase_order']
}

/**
 * The trade type a `parties` record's roles imply.
 *
 * `branch` (our own subsidiary) is the internal link, `buyer` (a local customer) the external one.
 * A party holding both — a subsidiary that also buys from us — resolves to `internal`: the branch
 * relationship is the more specific one, and the spec's 分公司 ⇒ 内部单据 rule wins. No role at all
 * means the record is not a trade-type master link, so the caller offers both kinds instead of
 * guessing.
 */
export function tradeTypeFromPartyRoles(roles: readonly string[] | null | undefined): SalesTradeType | null {
  if (!Array.isArray(roles)) return null
  if (roles.includes('branch')) return 'internal'
  if (roles.includes('buyer')) return 'external'
  return null
}

const SALES_HEAD_PAGE_SIZE = 100

/**
 * The list query a sales-source picker sends.
 *
 * A resolved trade type becomes a hard `channelId` filter: a missing channel id yields `null` — no
 * request, no sources — rather than a widened list that would offer the other type's documents. An
 * unresolved counterparty lists both channels and lets the caller label each option with its own
 * trade type, so the operator can tell the two apart without a filter standing behind the list.
 */
export function buildSalesSourceListParams(
  type: SalesTradeType | null,
  channelIds: TradeTypeChannelMap,
  term: string,
): Record<string, string | number> | null {
  const search = term.trim()
  const base = {
    pageSize: SALES_HEAD_PAGE_SIZE,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(search ? { search } : {}),
  } satisfies Record<string, string | number>
  if (type) {
    const channelId = channelIds[type]
    return channelId ? { channelId, ...base } : null
  }
  const both = [channelIds.internal, channelIds.external].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  // No trade-type channel exists at all: every option would be unlabelable, so offer nothing.
  if (both.length === 0) return null
  return { channelIds: both.join(','), ...base }
}

/** One source line mapped onto the contract line's own field names. */
export type ContractLineDraft = {
  productId: string
  name: string
  sku: string
  model: string
  spec: string
  unit: string
  quantity: string
  unitPrice: string
  note: string
  /** Frozen provenance of a copied line; `null` on a row the operator typed. */
  sourceSnapshot: Record<string, unknown> | null
}

function readSourceText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function snapshotSourceText(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function orderLineSnapshot(
  item: Record<string, unknown>,
  orderKind: ContractLineSourceKind,
  copiedAt: string,
): Record<string, unknown> {
  return {
    kind: 'order_line',
    id: readSourceText(item, 'id'),
    orderKind,
    copiedAt,
  }
}

/**
 * One source line as a contract line. A purchase line's printing copies come from its own snapshot
 * columns (the supplier library knows the title/SKU/unit without a product-master row), while a
 * sales line keeps them in `catalogSnapshot` when it was never bound to a live product — the same
 * shapes the PI/CI dialog copies.
 */
export function sourceLineToContractLine(
  item: Record<string, unknown>,
  kind: ContractLineSourceKind,
  copiedAt: string,
): ContractLineDraft {
  if (kind === 'purchase_order') {
    return {
      productId: readSourceText(item, 'productId', 'product_id'),
      name: readSourceText(item, 'productTitle', 'product_title'),
      sku:
        readSourceText(item, 'productSku', 'product_sku') ||
        readSourceText(item, 'supplierSku', 'supplier_sku'),
      model: '',
      spec: '',
      unit: readSourceText(item, 'productUnit', 'product_unit'),
      quantity: readSourceText(item, 'quantity') || '0',
      unitPrice: readSourceText(item, 'unitPrice', 'unit_price') || '0',
      note: readSourceText(item, 'note'),
      sourceSnapshot: orderLineSnapshot(item, kind, copiedAt),
    }
  }
  const snapshot = item.catalogSnapshot ?? item.catalog_snapshot
  return {
    productId: readSourceText(item, 'productId', 'product_id'),
    name: readSourceText(item, 'name'),
    sku: readSourceText(item, 'sku') || snapshotSourceText(snapshot, 'sku'),
    model: '',
    spec: '',
    unit: readSourceText(item, 'quantityUnit', 'quantity_unit') || snapshotSourceText(snapshot, 'unit'),
    quantity: readSourceText(item, 'quantity') || '0',
    unitPrice: readSourceText(item, 'unitPriceNet', 'unit_price_net') || '0',
    note: readSourceText(item, 'comment'),
    sourceSnapshot: orderLineSnapshot(item, kind, copiedAt),
  }
}

/** True when a row carries content the operator meant to keep (a blank placeholder does not). */
export function hasContractLineContent(line: Pick<ContractLineDraft, 'productId' | 'name'>): boolean {
  return line.productId.trim().length > 0 || line.name.trim().length > 0
}

/**
 * Appends copied rows after the rows the operator already entered, dropping the blank placeholder
 * row a fresh editor starts with — the same one-shot append the PI/CI dialog performs. Existing
 * rows are never replaced by the copy.
 */
export function appendContractLines(
  existing: ContractLineDraft[],
  appended: ContractLineDraft[],
): ContractLineDraft[] {
  const kept = existing.filter(hasContractLineContent)
  return kept.length > 0 ? [...kept, ...appended] : appended
}

/** The head anchor part of the form's own values. */
export type ContractSourceAnchorFields = {
  sourceKind: string
  sourceId: string
  sourceNumber: string
  sourceCounterparty: string
}

export type ContractSourceAnchorPayload = {
  sourceKind: 'purchase_order' | 'sales_order' | null
  sourceId: string | null
  sourceSnapshot: Record<string, unknown> | null
}

/**
 * The head anchor the contract payload carries.
 *
 * Nothing picked stays exactly as before this feature: the three keys are sent as `null`, which is
 * what the schema/table held for a hand-written contract (not the UI's `manual` placeholder), so an
 * un-anchored contract saves the same shape it always did. A picked source keeps its id and freezes
 * the display fields (`number`, `counterparty`) it was chosen from.
 */
export function buildContractSourceAnchorPayload(
  anchor: ContractSourceAnchorFields,
): ContractSourceAnchorPayload {
  const id = anchor.sourceId.trim()
  if (!id) return { sourceKind: null, sourceId: null, sourceSnapshot: null }
  const snapshot: Record<string, unknown> = {}
  const number = anchor.sourceNumber.trim()
  const counterparty = anchor.sourceCounterparty.trim()
  if (number) snapshot.number = number
  if (counterparty) snapshot.counterparty = counterparty
  return {
    sourceKind: anchor.sourceKind === 'purchase_order' ? 'purchase_order' : 'sales_order',
    sourceId: id,
    sourceSnapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
  }
}
