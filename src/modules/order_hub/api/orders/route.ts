import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import { GET as salesOrdersGet } from '@open-mercato/core/modules/sales/api/orders/route'
import { GET as purchaseOrdersGet } from '../../../purchasing/api/purchase-orders/route'
import { TRADE_TYPE_CHANNEL_CODES } from '../../../internal_sales/lib/tradeType'
import { loadOrderStages, type OrderStageItem } from '../../lib/orderStages'
import { resolveOrderHubRequestScope } from '../../lib/requestScope'
import {
  mergeOrderRows,
  slicePage,
  sumTotals,
  toPurchaseOrderRow,
  toSalesOrderRow,
  type OrderRow,
  type OrderRowSource,
} from '../../lib/mergeOrders'

/**
 * The workbench's list: three company-order sources read through their own module routes, merged and
 * paged server-side.
 *
 * The route never touches the peers' tables or decryption: it forwards the caller's credentials to
 * `GET /api/sales/orders` (once per trade-type channel) and `GET /api/purchasing/purchase-orders`,
 * and each of those decides scope and features for itself. That is what keeps the buyer name
 * encrypted at rest and decrypted only inside the module that owns it — the reason the earlier
 * version merged in the browser.
 *
 * A source the caller may not read degrades to no rows (`unavailableSources`) instead of blanking the
 * screen; only a 401 from a peer is returned as-is.
 */

const logger = createLogger('order_hub').child({ component: 'orders-route' })

/** One peer page is always asked at the peer's own maximum, so the scan needs as few round trips as possible. */
const PEER_PAGE_SIZE = 100
/** The window one source is scanned to at most; past this the caller must narrow the filters. */
const MAX_SCAN_PER_SOURCE = 500

/** The source order is the merge/dedupe tiebreak — keep it stable. */
const ALL_SOURCES: OrderRowSource[] = ['internal_sales', 'external_sales', 'purchase_order']

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
}

const ordersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['all', 'internal', 'external', 'purchase']).default('all'),
  status: z.string().min(1).optional(),
  search: z.string().optional(),
})

const stageItemSchema = z.object({
  id: z.string(),
  source: z.enum(['sales_order', 'purchase_order']),
  procurementCount: z.number().int().nonnegative(),
  shipmentCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  collected: z.boolean(),
  refunded: z.boolean(),
})

const orderRowSchema = z.object({
  id: z.string(),
  source: z.enum(['internal_sales', 'external_sales', 'purchase_order']),
  number: z.string().nullable(),
  counterparty: z.string().nullable(),
  currencyCode: z.string(),
  total: z.string(),
  status: z.string().nullable(),
  createdAt: z.string().nullable(),
  lineCount: z.number(),
  stages: stageItemSchema.nullable(),
})

const ordersResponseSchema = z.object({
  items: z.array(orderRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalIsCapped: z.boolean().optional(),
  unavailableSources: z.array(z.enum(['internal_sales', 'external_sales', 'purchase_order'])).optional(),
})

type TradeTypeChannels = { internal: string | null; external: string | null }

/** The two trade-type channel ids of the caller's organization set, as a scoped Kysely projection. */
async function readTradeTypeChannelIds(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] },
): Promise<TradeTypeChannels> {
  const codes = [TRADE_TYPE_CHANNEL_CODES.internal, TRADE_TYPE_CHANNEL_CODES.external]
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('sales_channels')
    .select(['id', 'code'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .where('code', 'in', codes)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string; code: string | null }>
  const byCode = new Map(rows.map((row) => [row.code ?? '', String(row.id)]))
  return {
    internal: byCode.get(TRADE_TYPE_CHANNEL_CODES.internal) ?? null,
    external: byCode.get(TRADE_TYPE_CHANNEL_CODES.external) ?? null,
  }
}

type SourceScan = {
  source: OrderRowSource
  rows: OrderRow[]
  total: number
  /** The scan stopped (window filled or the cap hit) before the source was exhausted. */
  windowTruncated: boolean
  /** The peer itself reported a capped count (`OM_LIST_COUNT_CAP`). */
  peerTotalCapped: boolean
}

type SourceScanResult = { ok: true; scan: SourceScan } | { ok: false; source: OrderRowSource; unauthorized: Response | null }

function peerPathFor(source: OrderRowSource): string {
  return source === 'purchase_order' ? '/api/purchasing/purchase-orders' : '/api/sales/orders'
}

function toRow(source: OrderRowSource, item: Record<string, unknown>): OrderRow {
  return source === 'purchase_order'
    ? toPurchaseOrderRow(item)
    : toSalesOrderRow(item, source)
}

/**
 * Scan one source newest-first until the requested page can be filled, the source is exhausted or the
 * per-source cap is hit. The peers' own scope and feature gates remain the verdict.
 */
async function scanSource(
  request: Request,
  source: OrderRowSource,
  channelId: string | null,
  page: number,
  pageSize: number,
  search: string | undefined,
): Promise<SourceScanResult> {
  if ((source === 'internal_sales' || source === 'external_sales') && !channelId) {
    // The trade-type channel is not seeded for this organization: the source is empty, not broken.
    return { ok: true, scan: { source, rows: [], total: 0, windowTruncated: false, peerTotalCapped: false } }
  }
  const needed = page * pageSize
  const get = source === 'purchase_order' ? purchaseOrdersGet : salesOrdersGet
  const rows: OrderRow[] = []
  let total = 0
  let peerTotalCapped = false
  let windowTruncated = false
  let scanPage = 1
  for (;;) {
    const peerUrl = new URL(peerPathFor(source), request.url)
    peerUrl.searchParams.set('page', String(scanPage))
    peerUrl.searchParams.set('pageSize', String(PEER_PAGE_SIZE))
    peerUrl.searchParams.set('sortField', 'created_at')
    peerUrl.searchParams.set('sortDir', 'desc')
    const term = search?.trim()
    if (term) peerUrl.searchParams.set('search', term)
    if (source !== 'purchase_order' && channelId) peerUrl.searchParams.set('channelIds', channelId)

    let response: Response
    try {
      response = await get(new Request(peerUrl, { headers: request.headers, method: 'GET' }))
    } catch (error) {
      logger.warn('A peer list route threw', { err: error, source })
      return { ok: false, source, unauthorized: null }
    }
    if (response.status === 401) return { ok: false, source, unauthorized: response }
    if (!response.ok) {
      logger.warn('A peer list route refused the read', { source, status: response.status })
      return { ok: false, source, unauthorized: null }
    }

    let payload: { items?: Array<Record<string, unknown>>; total?: unknown; totalIsCapped?: unknown }
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      logger.warn('A peer list route returned a non-JSON body', { source })
      return { ok: false, source, unauthorized: null }
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    for (const item of items) rows.push(toRow(source, item))
    total = typeof payload.total === 'number' && Number.isFinite(payload.total) ? payload.total : rows.length
    if (payload.totalIsCapped === true) peerTotalCapped = true

    // Drained: the peer returned a short page or we have every row it counts.
    if (items.length < PEER_PAGE_SIZE || rows.length >= total) break
    if (rows.length >= needed || rows.length >= MAX_SCAN_PER_SOURCE) {
      windowTruncated = rows.length < total
      break
    }
    scanPage += 1
  }
  return { ok: true, scan: { source, rows, total, windowTruncated, peerTotalCapped } }
}

export async function GET(request: Request) {
  const scope = await resolveOrderHubRequestScope(request)
  if (!scope.ok) return scope.response

  const url = new URL(request.url)
  const parsed = ordersQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const { page, pageSize, type, status, search } = parsed.data

  try {
    const channels = await readTradeTypeChannelIds(scope.em, scope)
    const requested = ALL_SOURCES.filter((source) => {
      if (type === 'all') return true
      if (type === 'internal') return source === 'internal_sales'
      if (type === 'external') return source === 'external_sales'
      return source === 'purchase_order'
    })

    const results = await Promise.all(
      requested.map((source) =>
        scanSource(
          request,
          source,
          source === 'internal_sales' ? channels.internal : source === 'external_sales' ? channels.external : null,
          page,
          pageSize,
          search,
        ),
      ),
    )

    for (const result of results) {
      if (!result.ok && result.unauthorized) return result.unauthorized
    }

    const scans = results.flatMap((result) => (result.ok ? [result.scan] : []))
    const unavailableSources = results.flatMap((result) => (result.ok ? [] : [result.source]))

    const merged = mergeOrderRows(
      scans.map((scan) => ({
        source: scan.source,
        rows: scan.rows,
        total: scan.total,
        totalIsCapped: scan.windowTruncated || scan.peerTotalCapped,
      })),
      page * pageSize,
    )

    const ids = merged.map((row) => row.id)
    const stageItems: OrderStageItem[] = ids.length > 0
      ? await loadOrderStages(scope.em, { tenantId: scope.tenantId, organizationIds: scope.organizationIds }, ids)
      : []
    const stageById = new Map(stageItems.map((item) => [item.id, item]))
    let rows: OrderRow[] = merged.map((row) => ({ ...row, stages: stageById.get(row.id) ?? null }))

    // The installed sales list has no status filter, so the status filter runs on the merged window.
    if (status) rows = rows.filter((row) => row.status === status)

    const filtered = Boolean(status)
    const total = filtered ? rows.length : sumTotals(scans)
    const totalIsCapped = filtered
      ? scans.some((scan) => scan.windowTruncated || scan.peerTotalCapped)
      : scans.some((scan) => scan.peerTotalCapped)

    const body: Record<string, unknown> = {
      items: slicePage(rows, page, pageSize),
      total,
      page,
      pageSize,
    }
    if (totalIsCapped) body.totalIsCapped = true
    if (unavailableSources.length > 0) body.unavailableSources = unavailableSources
    return NextResponse.json(body)
  } catch (error) {
    logger.error('Failed to aggregate the order workbench', { err: error })
    return NextResponse.json({ error: 'Failed to aggregate the order workbench' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Order workbench',
  summary: 'Aggregated company-order list',
  methods: {
    GET: {
      summary: 'List the three company-order sources, merged and paged',
      description: [
        'Reads the internal-sales, external-sales and purchase-order lists through their own module routes and merges them newest-first by `createdAt` (ties keep the source order: internal, external, purchase), deduped by id.',
        'Each source is scanned newest-first until the requested page can be filled (`page * pageSize` rows), the source is exhausted, or MAX_SCAN_PER_SOURCE (500) rows were read.',
        '`total`: without `status` this is the exact sum of the queried sources’ own totals. With a filter it counts only the rows inside the scanned window, so treat it as a floor and check `totalIsCapped` (true when a source stopped before its own total, or when a peer capped its own count).',
        '`type` selects which sources are read (default `all`). `status` filters on the exact row status in the window (the installed sales list has no status filter).',
        'A source the caller may not read, or whose read failed, contributes no rows and is named in `unavailableSources` instead of failing the whole response; a 401 from a peer is returned unchanged.',
      ].join(' '),
      query: ordersQuerySchema,
      responses: [
        { status: 200, description: 'The merged page of orders', schema: ordersResponseSchema },
        { status: 400, description: 'Invalid `page`, `pageSize`, `type` or `status`' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.view' },
      ],
    },
  },
}
