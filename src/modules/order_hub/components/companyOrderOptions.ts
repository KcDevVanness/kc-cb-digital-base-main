/**
 * Option sources for the company-order create/edit form: the default customer/supplier pickers and
 * the two "link an existing document" search multi-selects.
 *
 * Every source is the owning module's own scoped route, so a picker can only offer a record the
 * caller may use:
 *   - customer  → `GET /api/parties/options?roles=buyer` (buyer-role parties only);
 *   - supplier  → `GET /api/purchasing/suppliers` (active suppliers);
 *   - sales orders → `GET /api/sales/orders?channelIds=<trade-type channels>` (both internal and
 *     external channels, so the picker spans the two kinds and derives each option's kind from its
 *     channel);
 *   - purchase orders → `GET /api/purchasing/purchase-orders`.
 *
 * Loaders degrade to an empty list on failure (an optional picker must not block the form). Labels
 * mirror what the child modules print (`CODE — name`, `number — counterparty`).
 */

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'

const SUPPLIERS_API_PATH = '/api/purchasing/suppliers'
const PARTIES_OPTIONS_PATH = '/api/parties/options'
const SALES_ORDERS_API_PATH = '/api/sales/orders'
const PURCHASE_ORDERS_API_PATH = '/api/purchasing/purchase-orders'
const TRADE_TYPE_CHANNELS_API_PATH = '/api/internal_sales/trade-type-channels/orders'
const OPTION_PAGE_SIZE = 50

/** A raw sales-order candidate; the caller labels it and derives its link kind. */
export type SalesOrderCandidate = {
  refId: string
  kind: 'internal_sales_order' | 'external_sales_order'
  number: string | null
  status: string | null
}

/** A raw purchase-order candidate. */
export type PurchaseOrderCandidate = {
  refId: string
  number: string | null
  supplierName: string | null
  status: string | null
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function snapshotName(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ''
  const name = (snapshot as Record<string, unknown>).name
  return typeof name === 'string' ? name : ''
}

function labelFromParts(code: string, name: string, fallback: string): string {
  if (code && name) return `${code} — ${name}`
  return code || name || fallback
}

/** Active suppliers, `CODE — name`; typed input narrows by `search`. */
export async function loadSupplierOptions(search?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({ isActive: 'true', page: '1', pageSize: String(OPTION_PAGE_SIZE) })
  const term = search?.trim()
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${SUPPLIERS_API_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage: '' },
    )
    return (payload.items ?? []).flatMap<CrudFieldOption>((item) => {
      const value = readText(item, 'id')
      if (!value) return []
      return [{ value, label: labelFromParts(readText(item, 'code'), readText(item, 'name'), value) }]
    })
  } catch {
    return []
  }
}

/** Buyer-role parties, `CODE — name`; typed input narrows by `search` (the code, server-side). */
export async function loadCustomerPartyOptions(search?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({ roles: 'buyer' })
  const term = search?.trim()
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${PARTIES_OPTIONS_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage: '' },
    )
    return (payload.items ?? []).flatMap<CrudFieldOption>((item) => {
      const value = readText(item, 'value')
      if (!value) return []
      return [{ value, label: readText(item, 'label') || value }]
    })
  } catch {
    return []
  }
}

/** The label of an already-selected customer, for the edit form's preselected value. */
export async function resolveCustomerPartyLabel(partyId: string): Promise<string> {
  try {
    const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
      `/api/parties/${encodeURIComponent(partyId)}`,
      undefined,
      { fallback: {}, errorMessage: '' },
    )
    const item = payload.item ?? {}
    return labelFromParts(readText(item, 'code'), readText(item, 'name'), partyId)
  } catch {
    return ''
  }
}

/** The label of an already-selected supplier, for the edit form's preselected value. */
export async function resolveSupplierLabel(supplierId: string): Promise<string> {
  try {
    const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
      `${SUPPLIERS_API_PATH}/${encodeURIComponent(supplierId)}`,
      undefined,
      { fallback: {}, errorMessage: '' },
    )
    const item = payload.item ?? {}
    return labelFromParts(readText(item, 'code'), readText(item, 'name'), supplierId)
  } catch {
    return ''
  }
}

/** Resolved once per session: the organization's internal/external trade-type channel ids. */
let tradeTypeChannelsCache: Promise<{ internal: string | null; external: string | null }> | null = null

function loadTradeTypeChannels(): Promise<{ internal: string | null; external: string | null }> {
  if (!tradeTypeChannelsCache) {
    tradeTypeChannelsCache = readApiResultOrThrow<{ channels?: { internal?: string | null; external?: string | null } }>(
      TRADE_TYPE_CHANNELS_API_PATH,
      undefined,
      { fallback: {}, errorMessage: '' },
    )
      .then((payload) => ({
        internal: payload.channels?.internal ?? null,
        external: payload.channels?.external ?? null,
      }))
      .catch(() => {
        tradeTypeChannelsCache = null
        return { internal: null, external: null }
      })
  }
  return tradeTypeChannelsCache
}

/**
 * Sales-order candidates across both trade types. Each option's link `kind` is derived from the
 * order's own channel — a document cannot be linked as a kind its channel contradicts.
 */
export async function loadSalesOrderCandidates(search?: string): Promise<SalesOrderCandidate[]> {
  const channels = await loadTradeTypeChannels()
  const channelIds = [channels.internal, channels.external].filter((id): id is string => !!id)
  if (channelIds.length === 0) return []
  const params = new URLSearchParams({
    channelIds: channelIds.join(','),
    page: '1',
    pageSize: String(OPTION_PAGE_SIZE),
  })
  const term = search?.trim()
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${SALES_ORDERS_API_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage: '' },
    )
    return (payload.items ?? []).flatMap<SalesOrderCandidate>((item) => {
      const refId = readText(item, 'id')
      const channelId = readText(item, 'channelId', 'channel_id')
      if (!refId || !channelId) return []
      const kind = channels.external && channelId === channels.external ? 'external_sales_order' : 'internal_sales_order'
      return [{ refId, kind, number: readText(item, 'orderNumber', 'order_number') || null, status: readText(item, 'status') || null }]
    })
  } catch {
    return []
  }
}

/** Purchase-order candidates, labelled by their frozen supplier name. */
export async function loadPurchaseOrderCandidates(search?: string): Promise<PurchaseOrderCandidate[]> {
  const params = new URLSearchParams({ page: '1', pageSize: String(OPTION_PAGE_SIZE) })
  const term = search?.trim()
  if (term) params.set('search', term)
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${PURCHASE_ORDERS_API_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage: '' },
    )
    return (payload.items ?? []).flatMap<PurchaseOrderCandidate>((item) => {
      const refId = readText(item, 'id')
      if (!refId) return []
      const supplierName = readText(item, 'supplierName') || snapshotName(item.supplierSnapshot)
      return [{ refId, number: readText(item, 'number') || null, supplierName: supplierName || null, status: readText(item, 'status') || null }]
    })
  } catch {
    return []
  }
}
