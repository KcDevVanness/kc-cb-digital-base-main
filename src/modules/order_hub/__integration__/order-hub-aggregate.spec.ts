import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The workbench's aggregate read (`src/modules/order_hub/api/orders/route.ts`).
 *
 * One request answers a page of company orders across three sources (internal sales, external sales,
 * purchase), paged on real data: the slice the caller asked for, the total, and — with a filter — the
 * scan-window floor that `totalIsCapped` qualifies. The fixture builds two orders of each kind so a
 * two-row page is never ambiguous about which source a row came from.
 */

const AGG_URL = '/api/order_hub/orders'
const VIEWER_FEATURES = ['order_hub.view']
const VIEWER_PASSWORD = 'Aggregate!2026'

type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }
type PeerListPayload = { total?: number }
type OrderStage = {
  procurementCount: number
  shipmentCount: number
  documentCount: number
  collected: boolean
  refunded: boolean
}
type OrderRow = {
  id: string
  source: 'internal_sales' | 'external_sales' | 'purchase_order'
  number: string | null
  status: string | null
  createdAt: string | null
  stages: OrderStage | null
}
type OrdersPayload = {
  items?: OrderRow[]
  total?: number
  page?: number
  pageSize?: number
  totalIsCapped?: boolean
  unavailableSources?: string[]
}

test.describe.serial('order_hub — aggregate list and paging', () => {
  let api: APIRequestContext
  let rootToken = ''
  let viewerToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  let catalogProductId = ''
  let productId = ''
  let supplierId = ''
  let internalChannelId = ''
  let externalChannelId = ''
  const internalSalesIds: string[] = []
  const externalSalesIds: string[] = []
  const purchaseOrderIds: string[] = []
  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const readOrders = async (query: string, token = rootToken, orgId = hqOrgId): Promise<OrdersPayload> => {
    const response = await scoped('GET', `${AGG_URL}?${query}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<OrdersPayload>(response)) ?? {}
  }

  const createSalesOrder = async (channelId: string, name: string): Promise<string> => {
    const response = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId,
      customerSnapshot: { name, internalSales: { organizationId: hqOrgId } },
      lines: [{ kind: 'product', productId, name: `Aggregate line ${stamp}`, currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
    })
    expect(response.status(), await response.text()).toBe(201)
    return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
  }

  const createPurchaseOrder = async (): Promise<string> => {
    const response = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 1, unitPrice: 50, taxRate: 0, priceIncludesTax: true }],
    })
    expect(response.status(), await response.text()).toBe(201)
    return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    const channelBody = await readJsonSafe<ChannelPayload>(channels)
    internalChannelId = String(channelBody?.channels?.internal ?? '')
    externalChannelId = String(channelBody?.channels?.external ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded').toBeTruthy()
    expect(externalChannelId, 'the external trade-type channel is seeded').toBeTruthy()

    const catalogSku = `AGG-${stamp}`.toUpperCase()
    const catalog = await scoped('POST', '/api/catalog/products', {
      title: `Aggregate product ${stamp}`,
      sku: catalogSku,
      description: 'Long enough description for the catalog create validation in QA automation flows.',
    })
    const catalogBody = await readJsonSafe<Record<string, unknown>>(catalog)
    catalogProductId = String(
      [catalogBody?.id, (catalogBody?.item as Record<string, unknown>)?.id].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ) ?? '',
    )
    const product = await scoped('POST', '/api/products/items', {
      sku: catalogSku,
      name: `Aggregate product ${stamp}`,
      catalogProductId,
      unit: 'PCS',
    })
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    expect(productId).toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Aggregate supplier ${stamp}`,
      code: `AGG-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')

    for (let index = 1; index <= 2; index += 1) {
      internalSalesIds.push(await createSalesOrder(internalChannelId, `Aggregate internal buyer ${stamp}-${index}`))
      externalSalesIds.push(await createSalesOrder(externalChannelId, `Aggregate external buyer ${stamp}-${index}`))
      purchaseOrderIds.push(await createPurchaseOrder())
    }

    branchOrgId = await createOrganizationFixture(api, rootToken, { name: `Aggregate branch ${stamp}`, tenantId })
    roleId = await createRoleFixture(api, rootToken, { name: `Aggregate viewer ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: VIEWER_FEATURES })
    const viewerEmail = `aggregate-viewer-${stamp}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: branchOrgId,
      roles: [roleId],
      name: 'Aggregate viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)
  })

  test.afterAll(async () => {
    const cleanups: Array<[string, string]> = [
      ...internalSalesIds.map((id): [string, string] => [`/api/sales/orders?id=${encodeURIComponent(id)}`, 'DELETE']),
      ...externalSalesIds.map((id): [string, string] => [`/api/sales/orders?id=${encodeURIComponent(id)}`, 'DELETE']),
      ...purchaseOrderIds.map((id): [string, string] => [`/api/purchasing/purchase-orders?id=${encodeURIComponent(id)}`, 'DELETE']),
      [`/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`, 'DELETE'],
      [`/api/products/items?id=${encodeURIComponent(productId)}`, 'DELETE'],
      [`/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`, 'DELETE'],
    ]
    for (const [path, method] of cleanups) {
      if (path.includes('=undefined') || path.includes('id=&')) continue
      await scoped(method, path).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('pages the merged rows newest-first without overlap', async () => {
    const first = await readOrders('page=1&pageSize=2')
    const second = await readOrders('page=2&pageSize=2')

    const firstItems = first.items ?? []
    const secondItems = second.items ?? []
    expect(firstItems).toHaveLength(2)
    expect(secondItems).toHaveLength(2)
    expect(first.page).toBe(1)
    expect(first.pageSize).toBe(2)

    const firstIds = new Set(firstItems.map((item) => item.id))
    for (const item of secondItems) {
      expect(firstIds.has(item.id), `${item.id} must not appear on both pages`).toBe(false)
    }

    const times = [...firstItems, ...secondItems].map((item) => (item.createdAt ? Date.parse(item.createdAt) : Number.NaN))
    expect(times.every((value) => Number.isFinite(value))).toBe(true)
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index - 1]).toBeGreaterThanOrEqual(times[index] as number)
    }
  })

  test('reports the exact sum of the three peer totals when unfiltered', async () => {
    const internal = await scoped('GET', `/api/sales/orders?channelIds=${encodeURIComponent(internalChannelId)}&pageSize=1`)
    const external = await scoped('GET', `/api/sales/orders?channelIds=${encodeURIComponent(externalChannelId)}&pageSize=1`)
    const purchase = await scoped('GET', '/api/purchasing/purchase-orders?pageSize=1')
    const expected =
      Number((await readJsonSafe<PeerListPayload>(internal))?.total ?? 0) +
      Number((await readJsonSafe<PeerListPayload>(external))?.total ?? 0) +
      Number((await readJsonSafe<PeerListPayload>(purchase))?.total ?? 0)

    const payload = await readOrders('pageSize=1')
    expect(payload.total).toBe(expected)
  })

  test('type=purchase returns only purchase orders', async () => {
    const payload = await readOrders('type=purchase&pageSize=100')
    const items = payload.items ?? []
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.source).toBe('purchase_order')
    }
  })

  test('another organization sees none of the fixture orders', async () => {
    const payload = await readOrders('pageSize=100', viewerToken, branchOrgId as string)
    const fixtureIds = new Set([...internalSalesIds, ...externalSalesIds, ...purchaseOrderIds])
    for (const item of payload.items ?? []) {
      expect(fixtureIds.has(item.id), `${item.id} must not be visible to another organization`).toBe(false)
    }
  })

  test('refuses a pageSize above the peer contract', async () => {
    const response = await scoped('GET', `${AGG_URL}?pageSize=101`)
    expect(response.status()).toBe(400)
  })
})
