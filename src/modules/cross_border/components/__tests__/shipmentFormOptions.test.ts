import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ fetchCrudList: jest.fn() }))
jest.mock('../../../internal_sales/lib/tradeTypeChannels', () => ({ loadTradeTypeChannelIds: jest.fn() }))

import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadTradeTypeChannelIds } from '../../../internal_sales/lib/tradeTypeChannels'
import { buildSalesOrderListParams, loadSalesOrderOptions } from '../shipmentFormOptions'

/**
 * The shipment sales-allocation picker offers **internal** trade-type orders only
 * (`.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md`): the list is scoped by the
 * organization's `INTERNAL_SALES` channel id, plus the unmarked orders whose frozen buyer is a
 * related organization (the backfill classifies exactly those, and until it runs a pre-marker order
 * must stay allocatable). A row without a channel and without such a buyer link — an external sale,
 * or a hand-typed buyer — is never offered, and a failed read surfaces the caller's own message.
 */

const ERROR_MESSAGE = 'cross_border.shipments.salesAllocations.loadLinesFailed'

describe('sales-order picker list params', () => {
  it('scopes the request to the internal channel and keeps the page cap', () => {
    expect(buildSalesOrderListParams('channel-internal', '')).toEqual({
      channelId: 'channel-internal',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
    })
  })

  it('adds the trimmed search term without touching the cap', () => {
    expect(buildSalesOrderListParams('channel-internal', 'SO-2026')).toEqual({
      channelId: 'channel-internal',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO-2026',
    })
  })

  it('omits the channel filter when the internal channel is unavailable', () => {
    expect(buildSalesOrderListParams(null, 'SO-2026')).toEqual({
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO-2026',
    })
    expect(buildSalesOrderListParams('', '')).toEqual({
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

  it('asks both buckets — the marked channel and the unmarked legacy orders', async () => {
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
        items: [{ id: 'order-1', orderNumber: 'SO-1', customerName: 'ACME' }],
        total: 1,
        page: 1,
        pageSize: 50,
      } as never
    })

    const options = await loadSalesOrderOptions(ERROR_MESSAGE, ' SO ')

    expect(fetchCrudList).toHaveBeenCalledWith('sales/orders', {
      channelId: 'channel-internal',
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
    // Marked orders plus the unmarked internal ones; the external and the unlinked legacy rows stay out.
    expect(options.map((option) => option.value)).toEqual(['order-1', 'legacy-internal'])
  })

  it('surfaces the caller message when the read fails', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: 'channel-internal', external: null })
    jest.mocked(fetchCrudList).mockRejectedValue(new Error('transport') as never)

    await expect(loadSalesOrderOptions(ERROR_MESSAGE)).rejects.toThrow(ERROR_MESSAGE)
  })
})
