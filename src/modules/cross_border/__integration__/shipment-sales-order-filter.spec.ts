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
 * The shipments of one sales order (`src/modules/cross_border`).
 *
 * `.ai/specs/2026-10-08-order-centric-entry.md` (TEST-204, REQ-007): the order hub's 发运单 section and
 * the shipment list's `?salesOrderId=` filter both read the sales allocations, so the filter must
 * return exactly the shipments carrying goods from that order, answer an unknown order with an empty
 * page, and never leak another organization's shipment.
 *
 * A shipment needs at least one purchase allocation, so the fixture builds a committed purchase order
 * line as well as the sales order line the allocation points at — and that sales line has to be
 * bridged to the installed catalog, which is what the product master row is for.
 */

const SHIPMENTS_URL = '/api/cross_border/shipments'
const VIEWER_FEATURES = ['cross_border.shipments.view']
const VIEWER_PASSWORD = 'ShipOrder!2026'

type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[]; total?: number }
type ShipmentRow = { id: string; number: string | null; salesOrderNumber?: string | null }
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }

test.describe.serial('cross_border — shipments of one sales order', () => {
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
  let purchaseOrderId = ''
  let purchaseOrderLineId = ''
  let salesOrderId = ''
  let salesOrderLineId = ''
  let withAllocationId = ''
  let withoutAllocationId = ''
  const shipmentIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const listShipments = async (query: Record<string, string>, token = rootToken, orgId = hqOrgId) => {
    const params = new URLSearchParams({ pageSize: '50', ...query })
    const response = await scoped('GET', `${SHIPMENTS_URL}?${params.toString()}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<ShipmentRow>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    expect(channels.status()).toBe(200)
    const internalChannelId = String((await readJsonSafe<ChannelPayload>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded').toBeTruthy()

    // One action creates the catalog product and its default variant; the returned id is the
    // catalog product id every downstream document reference uses.
    const productSku = `SHIP-ORDER-${stamp}`.toUpperCase()
    const product = await scoped('POST', '/api/products/items', {
      sku: productSku,
      name: `Ship order product ${stamp}`,
      unit: 'PCS',
    })
    expect(product.status(), await product.text()).toBe(201)
    const created = await readJsonSafe<IdPayload>(product)
    productId = String(created?.id ?? '')
    catalogProductId = productId
    expect(productId).toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Ship order supplier ${stamp}`,
      code: `SHIP-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), await supplier.text()).toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')

    const purchaseOrder = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 20, unitPrice: 100, taxRate: 0, priceIncludesTax: true }],
    })
    expect(purchaseOrder.status(), await purchaseOrder.text()).toBe(201)
    purchaseOrderId = String((await readJsonSafe<IdPayload>(purchaseOrder))?.id ?? '')
    const placed = await scoped('POST', '/api/purchasing/purchase-orders/transitions', {
      id: purchaseOrderId,
      action: 'place',
    })
    expect(placed.status(), await placed.text()).toBeLessThan(300)
    const lines = await scoped('GET', `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}`)
    purchaseOrderLineId = String((await readJsonSafe<ListPayload<{ id: string }>>(lines))?.items?.[0]?.id ?? '')
    expect(purchaseOrderLineId).toBeTruthy()

    const salesOrder = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId: internalChannelId,
      customerSnapshot: { name: `Ship order buyer ${stamp}`, internalSales: { organizationId: hqOrgId } },
      lines: [
        {
          kind: 'product',
          productId,
          name: `Ship order line ${stamp}`,
          currencyCode: 'CNY',
          quantity: 6,
          unitPriceNet: 200,
        },
      ],
    })
    expect(salesOrder.status(), await salesOrder.text()).toBe(201)
    salesOrderId = String((await readJsonSafe<IdPayload>(salesOrder))?.id ?? '')
    const salesLines = await scoped('GET', `/api/sales/order-lines?orderId=${encodeURIComponent(salesOrderId)}&pageSize=10`)
    salesOrderLineId = String((await readJsonSafe<ListPayload<{ id: string }>>(salesLines))?.items?.[0]?.id ?? '')
    expect(salesOrderLineId, 'the sales order line fixture resolved an id').toBeTruthy()

    // One shipment carrying goods from the order, one carrying only purchase goods.
    const withAllocation = await scoped('POST', SHIPMENTS_URL, {
      containerNumber: `SHIP-ORD-${stamp}`.toUpperCase(),
      allocations: [{ purchaseOrderLineId, quantity: 5 }],
      salesAllocations: [
        {
          salesOrderId,
          salesOrderLineId,
          catalogProductId,
          quantity: 5,
          unitPrice: 200,
          currencyCode: 'CNY',
        },
      ],
    })
    expect(withAllocation.status(), await withAllocation.text()).toBe(201)
    withAllocationId = String((await readJsonSafe<IdPayload>(withAllocation))?.id ?? '')
    shipmentIds.push(withAllocationId)

    const withoutAllocation = await scoped('POST', SHIPMENTS_URL, {
      containerNumber: `SHIP-ORD-NONE-${stamp}`.toUpperCase(),
      allocations: [{ purchaseOrderLineId, quantity: 4 }],
    })
    expect(withoutAllocation.status(), await withoutAllocation.text()).toBe(201)
    withoutAllocationId = String((await readJsonSafe<IdPayload>(withoutAllocation))?.id ?? '')
    shipmentIds.push(withoutAllocationId)

    // A second organization, to prove the filter never crosses organizations.
    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Ship order branch ${stamp}`,
      tenantId,
    })
    roleId = await createRoleFixture(api, rootToken, { name: `Ship order viewer ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: VIEWER_FEATURES })
    const viewerEmail = `ship-order-viewer-${stamp}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: branchOrgId,
      roles: [roleId],
      name: 'Ship order viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of shipmentIds) {
      await scoped('DELETE', `${SHIPMENTS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (purchaseOrderId) {
      await scoped('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(purchaseOrderId)}`).catch(() => undefined)
    }
    if (salesOrderId) {
      await scoped('DELETE', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`).catch(() => undefined)
    }
    if (supplierId) {
      await scoped('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    }
    if (productId) {
      await scoped('DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    }
    if (catalogProductId) {
      await scoped('DELETE', `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('the filter returns exactly the shipments carrying goods from that order', async () => {
    const rows = await listShipments({ salesOrderId })
    const ids = rows.map((row) => row.id)
    expect(ids).toContain(withAllocationId)
    expect(ids).not.toContain(withoutAllocationId)
  })

  test('an unknown order answers with an empty page', async () => {
    const rows = await listShipments({ salesOrderId: '11111111-1111-4111-8111-111111111111' })
    expect(rows).toEqual([])
  })

  test('an unknown contract answers with an empty page too', async () => {
    // The same link filter serves `?contractId=`: an empty id set used to reach Postgres as `in ()`,
    // which is a syntax error — a 500 where the hub and the list expect an empty page.
    const rows = await listShipments({ contractId: '11111111-1111-4111-8111-111111111111' })
    expect(rows).toEqual([])
  })

  test('another organization sees nothing for the same order id', async () => {
    const rows = await listShipments({ salesOrderId }, viewerToken, branchOrgId as string)
    expect(rows).toEqual([])
  })
})
