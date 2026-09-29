import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The trade-type marker of a sales document.
 *
 * Pins what the module promises the rest of the app: both system channels exist for the
 * organization (seeded by the module setup), a document written with one of them is returned by the
 * engine's own `channelId` filter and by nothing else, and a document without a marker (the shape
 * older writers produced, and the demo seed still does) stays visible in the unfiltered list only —
 * which is exactly why the backfill CLI exists.
 */
type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type ChannelResponse = { channels?: { internal?: string | null; external?: string | null }; missing?: string[] }
type OrderRow = { id?: string; orderNumber?: string | null; channelId?: string | null }

test.describe.serial('sales trade types — channel marker and filtered lists', () => {
  let api: APIRequestContext
  let token = ''
  let orgId = ''
  let internalChannelId = ''
  let externalChannelId = ''
  const orderIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const createOrder = async (payload: Record<string, unknown>) => {
    const response = await scoped('POST', '/api/sales/orders', payload)
    const body = await response.text()
    const id = (JSON.parse(body || '{}') as IdPayload).id
    if (id) orderIds.push(id)
    return { status: response.status(), id: id ?? '', body }
  }

  const listOrders = async (query: Record<string, string> = {}) => {
    const params = new URLSearchParams({ pageSize: '50', sortField: 'created_at', sortDir: 'desc', ...query })
    const response = await scoped('GET', `/api/sales/orders?${params.toString()}`)
    expect(response.status()).toBe(200)
    return (await readJsonSafe<ListPayload<OrderRow>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    token = await getAuthToken(api, 'superadmin')
    orgId = getTokenContext(token).organizationId
    const channelsResponse = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    expect(channelsResponse.status()).toBe(200)
    const payload = await readJsonSafe<ChannelResponse>(channelsResponse)
    internalChannelId = String(payload?.channels?.internal ?? '')
    externalChannelId = String(payload?.channels?.external ?? '')
  })

  test.afterAll(async () => {
    for (const id of orderIds) {
      await scoped('DELETE', `/api/sales/orders?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await api.dispose()
  })

  test('the organization owns both trade-type channels', () => {
    expect(internalChannelId, 'the internal channel is seeded for this organization').toBeTruthy()
    expect(externalChannelId, 'the external channel is seeded for this organization').toBeTruthy()
  })

  test('a document is returned by its own channel filter and by no other', async () => {
    const stamp = `${Date.now()}`
    const internal = await createOrder({
      currencyCode: 'CNY',
      channelId: internalChannelId,
      customerSnapshot: { name: `Trade type internal ${stamp}`, internalSales: { organizationId: orgId } },
      lines: [{ kind: 'product', name: 'Trade type line', currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
    })
    expect(internal.status, internal.body).toBe(201)

    const external = await createOrder({
      currencyCode: 'CNY',
      channelId: externalChannelId,
      customerSnapshot: {
        name: `Trade type external ${stamp}`,
        internalSales: { partyId: '11111111-1111-4111-8111-111111111111' },
      },
      lines: [{ kind: 'product', name: 'Trade type line', currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
    })
    expect(external.status, external.body).toBe(201)

    const legacy = await createOrder({
      currencyCode: 'CNY',
      customerSnapshot: { name: `Trade type unmarked ${stamp}` },
      lines: [{ kind: 'product', name: 'Trade type line', currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
    })
    expect(legacy.status, legacy.body).toBe(201)

    const internalRows = await listOrders({ channelId: internalChannelId })
    const internalIds = internalRows.map((row) => row.id)
    expect(internalIds).toContain(internal.id)
    expect(internalIds).not.toContain(external.id)
    expect(internalIds).not.toContain(legacy.id)

    const externalRows = await listOrders({ channelId: externalChannelId })
    const externalIds = externalRows.map((row) => row.id)
    expect(externalIds).toContain(external.id)
    expect(externalIds).not.toContain(internal.id)
    expect(externalIds).not.toContain(legacy.id)

    // The unmarked document is exactly what the backfill CLI reports — visible without a filter,
    // invisible to both trade-type lists until it is classified.
    const unmarkedRows = await listOrders({ channelIdsEmpty: 'true' })
    const unmarkedIds = unmarkedRows.map((row) => row.id)
    expect(unmarkedIds).toContain(legacy.id)
    expect(unmarkedIds).not.toContain(internal.id)
  })
})
