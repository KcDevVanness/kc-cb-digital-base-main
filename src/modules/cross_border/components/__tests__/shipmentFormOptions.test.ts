import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ fetchCrudList: jest.fn() }))
jest.mock('../../../internal_sales/lib/tradeTypeChannels', () => ({ loadTradeTypeChannelIds: jest.fn() }))

import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadTradeTypeChannelIds } from '../../../internal_sales/lib/tradeTypeChannels'
import { buildSalesOrderListParams, loadSalesOrderOptions } from '../shipmentFormOptions'

/**
 * The shipment sales-allocation picker offers sales orders of **both** trade types — internal
 * (总部 → 分公司) and external (分公司 → 当地客户), the owner's 2026-09-30 revision of
 * `.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md` REQ-004. The list is scoped by the
 * organization's two trade-type channels (plus every order carrying no channel at all — a document
 * written before the marker existed has to stay allocatable until the backfill runs), and each
 * option leads with the direction it resolved to so the two families cannot be confused. A failed
 * read surfaces the caller's own message.
 */

const ERROR_MESSAGE = 'cross_border.shipments.salesAllocations.loadLinesFailed'

/** Stand-in for `useT`, so the assertions read as keys rather than as translated words. */
const t = ((key: string) => key) as unknown as Parameters<typeof loadSalesOrderOptions>[0]

describe('sales-order picker list params', () => {
  it('scopes the request to both trade-type channels and keeps the page cap', () => {
    expect(buildSalesOrderListParams(['channel-internal', 'channel-external'], '')).toEqual({
      channelIds: 'channel-internal,channel-external',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
    })
  })

  it('adds the trimmed search term without touching the cap', () => {
    expect(buildSalesOrderListParams(['channel-internal'], 'SO-2026')).toEqual({
      channelIds: 'channel-internal',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO-2026',
    })
  })

  it('drops blank ids — and omits the filter entirely when no channel is seeded', () => {
    expect(buildSalesOrderListParams([], 'SO-2026')).toEqual({
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO-2026',
    })
    expect(buildSalesOrderListParams(['', '   '], '')).toEqual({
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
    })
  })
})

describe('loadSalesOrderOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('asks both buckets and labels every option with its own direction', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: 'channel-internal', external: 'channel-external' })
    jest.mocked(fetchCrudList).mockImplementation(async (_path: unknown, params?: unknown) => {
      const query = (params ?? {}) as Record<string, unknown>
      if (query.channelIdsEmpty === 'true') {
        return {
          items: [
            { id: 'legacy-internal', orderNumber: 'SO-LEGACY', customerName: 'Branch', customerSnapshot: { internalSales: { organizationId: 'org-1' } } },
            { id: 'legacy-external', orderNumber: 'SO-EXT', customerName: 'Local customer', customerSnapshot: { internalSales: { partyId: 'party-1' } } },
            { id: 'legacy-unlinked', orderNumber: 'SO-PLAIN', customerName: 'Hand typed' },
          ],
          total: 3,
          page: 1,
          pageSize: 50,
        } as never
      }
      return {
        items: [
          { id: 'order-1', orderNumber: 'SO-1', customerName: 'ACME', channelId: 'channel-internal' },
          // The list route carries the buyer only inside the frozen snapshot — the loader falls back to it.
          { id: 'order-2', orderNumber: 'SO-2', customerSnapshot: { name: 'Local customer' }, channelId: 'channel-external' },
        ],
        total: 2,
        page: 1,
        pageSize: 50,
      } as never
    })

    const options = await loadSalesOrderOptions(t, ERROR_MESSAGE, ' SO ')

    expect(fetchCrudList).toHaveBeenCalledWith('sales/orders', {
      channelIds: 'channel-internal,channel-external',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO',
    })
    expect(fetchCrudList).toHaveBeenCalledWith('sales/orders', {
      channelIdsEmpty: 'true',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO',
    })
    // Every row is offered — the external order and the unlinked legacy one included — and the
    // direction leads the label wherever it could be resolved.
    expect(options).toEqual([
      { value: 'order-1', label: 'cross_border.shipments.salesAllocations.tradeType.internal · SO-1 — ACME' },
      { value: 'order-2', label: 'cross_border.shipments.salesAllocations.tradeType.external · SO-2 — Local customer' },
      { value: 'legacy-internal', label: 'cross_border.shipments.salesAllocations.tradeType.internal · SO-LEGACY — Branch' },
      { value: 'legacy-external', label: 'cross_border.shipments.salesAllocations.tradeType.external · SO-EXT — Local customer' },
      { value: 'legacy-unlinked', label: 'SO-PLAIN — Hand typed' },
    ])
  })

  it('keeps the label plain when neither channel could be read', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: null, external: null })
    jest.mocked(fetchCrudList).mockResolvedValue({
      items: [{ id: 'order-1', orderNumber: 'SO-1', customerName: 'ACME' }],
      total: 1,
      page: 1,
      pageSize: 50,
    } as never)

    const options = await loadSalesOrderOptions(t, ERROR_MESSAGE)

    // No channel filter at all: an organization that has not seeded its channels yet must still see
    // every order it may allocate.
    expect(fetchCrudList).toHaveBeenCalledWith('sales/orders', {
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
    })
    expect(options).toEqual([{ value: 'order-1', label: 'SO-1 — ACME' }])
  })

  it('offers only confirmed orders and says so on the ones without a status', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: 'channel-internal', external: null })
    jest.mocked(fetchCrudList).mockImplementation(async (_path: unknown, params?: unknown) => {
      const query = (params ?? {}) as Record<string, unknown>
      if (query.channelIdsEmpty === 'true') {
        return {
          items: [{
            id: 'legacy',
            orderNumber: 'SO-LEGACY',
            customerName: 'Branch',
            customerSnapshot: { internalSales: { organizationId: 'org-1' } },
          }],
          total: 1,
          page: 1,
          pageSize: 50,
        } as never
      }
      return {
        items: [
          { id: 'draft-order', orderNumber: 'SO-DRAFT', customerName: 'A', status: 'draft' },
          { id: 'confirmed-order', orderNumber: 'SO-CONF', customerName: 'B', status: 'confirmed' },
          { id: 'canceled-order', orderNumber: 'SO-CANCEL', customerName: 'C', status: 'canceled' },
        ],
        total: 3,
        page: 1,
        pageSize: 50,
      } as never
    })

    const options = await loadSalesOrderOptions(ERROR_MESSAGE, '', { unmarkedStatusLabel: 'status not marked' })

    // An unconfirmed or canceled order must never reach a shipment; a legacy order is offered, but says so.
    expect(options.map((option) => option.value)).toEqual(['confirmed-order', 'legacy'])
    expect(options.map((option) => option.label)).toEqual([
      'SO-CONF — B',
      'SO-LEGACY — Branch (status not marked)',
    ])
  })

  it('surfaces the caller message when the read fails', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: 'channel-internal', external: null })
    jest.mocked(fetchCrudList).mockRejectedValue(new Error('transport') as never)

    await expect(loadSalesOrderOptions(t, ERROR_MESSAGE)).rejects.toThrow(ERROR_MESSAGE)
  })
})
