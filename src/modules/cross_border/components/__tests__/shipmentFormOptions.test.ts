import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ fetchCrudList: jest.fn() }))
jest.mock('../../../internal_sales/lib/tradeTypeChannels', () => ({ loadTradeTypeChannelIds: jest.fn() }))

import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { loadTradeTypeChannelIds } from '../../../internal_sales/lib/tradeTypeChannels'
import { buildSalesOrderListParams, loadSalesOrderOptions } from '../shipmentFormOptions'

/**
 * The shipment sales-allocation picker offers **internal** trade-type orders only
 * (`.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md`): the order list is scoped by the
 * organization's `INTERNAL_SALES` channel id, and a missing channel must leave the picker empty
 * with the caller's own message rather than widen to every order.
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

  it('builds nothing when the internal channel is unavailable', () => {
    expect(buildSalesOrderListParams(null, 'SO-2026')).toBeNull()
    expect(buildSalesOrderListParams('', '')).toBeNull()
  })
})

describe('loadSalesOrderOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('asks the orders list for the internal channel only', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: 'channel-internal', external: 'channel-external' })
    jest.mocked(fetchCrudList).mockResolvedValue({
      items: [{ id: 'order-1', orderNumber: 'SO-1', customerName: 'ACME' }],
      total: 1,
      page: 1,
      pageSize: 50,
    } as never)

    const options = await loadSalesOrderOptions(ERROR_MESSAGE, ' SO-1 ')

    expect(fetchCrudList).toHaveBeenCalledWith('sales/orders', {
      channelId: 'channel-internal',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'SO-1',
    })
    expect(options).toEqual([{ value: 'order-1', label: 'SO-1 — ACME' }])
  })

  it('offers an empty list with the caller message when the internal channel is missing', async () => {
    jest.mocked(loadTradeTypeChannelIds).mockResolvedValue({ internal: null, external: 'channel-external' })

    const options = await loadSalesOrderOptions(ERROR_MESSAGE).catch(() => [])

    expect(options).toEqual([])
    await expect(loadSalesOrderOptions(ERROR_MESSAGE)).rejects.toThrow(ERROR_MESSAGE)
    expect(fetchCrudList).not.toHaveBeenCalled()
  })
})
