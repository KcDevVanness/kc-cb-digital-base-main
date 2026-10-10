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
 * The shipments of one purchase order (`src/modules/cross_border`).
 *
 * `.ai/specs/2026-10-08-order-centric-entry.md` (third round): the purchase order page's 关联发运单
 * block and the shipment list's `?purchaseOrderId=` filter both read the purchase allocations, so the
 * filter must return exactly the shipments carrying goods from that order, answer an unknown order
 * with an empty page, and never leak another organization's shipment.
 *
 * A shipment needs at least one purchase allocation, so the fixture builds two committed purchase
 * orders (each shipment carries exactly one of them) and the product they order is bridged to the
 * installed catalog — the shipment command refuses an allocation whose line has no catalog link.
 */

const SHIPMENTS_URL = '/api/cross_border/shipments'
const VIEWER_FEATURES = ['cross_border.shipments.view']
const VIEWER_PASSWORD = 'ShipPoOrder!2026'

type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[]; total?: number }
type ShipmentRow = { id: string; number: string | null }

test.describe.serial('cross_border — shipments of one purchase order', () => {
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
  let otherPurchaseOrderId = ''
  let otherPurchaseOrderLineId = ''
  let withAllocationId = ''
  let otherOrderShipmentId = ''
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

  const createPlacedPurchaseOrder = async (quantity: number) => {
    const order = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ catalogProductId, quantity, unitPrice: 100, taxRate: 0, priceIncludesTax: true }],
    })
    expect(order.status(), await order.text()).toBe(201)
    const orderId = String((await readJsonSafe<IdPayload>(order))?.id ?? '')
    expect(orderId).toBeTruthy()
    const placed = await scoped('POST', '/api/purchasing/purchase-orders/transitions', {
      id: orderId,
      action: 'place',
    })
    expect(placed.status(), await placed.text()).toBeLessThan(300)
    const lines = await scoped('GET', `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(orderId)}`)
    const lineId = String((await readJsonSafe<ListPayload<{ id: string }>>(lines))?.items?.[0]?.id ?? '')
    expect(lineId, 'the purchase order line fixture resolved an id').toBeTruthy()
    return { orderId, lineId }
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    // One action creates the catalog product and its default variant; the returned id is the
    // catalog product id every downstream document reference uses.
    const productSku = `SHIP-PO-${stamp}`.toUpperCase()
    const product = await scoped('POST', '/api/products/items', {
      sku: productSku,
      name: `Ship purchase order product ${stamp}`,
      unit: 'PCS',
    })
    expect(product.status(), await product.text()).toBe(201)
    const created = await readJsonSafe<IdPayload>(product)
    productId = String(created?.id ?? '')
    catalogProductId = productId
    expect(productId).toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Ship purchase order supplier ${stamp}`,
      code: `SHIP-PO-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), await supplier.text()).toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')

    const placedOrder = await createPlacedPurchaseOrder(20)
    purchaseOrderId = placedOrder.orderId
    purchaseOrderLineId = placedOrder.lineId
    const otherPlacedOrder = await createPlacedPurchaseOrder(10)
    otherPurchaseOrderId = otherPlacedOrder.orderId
    otherPurchaseOrderLineId = otherPlacedOrder.lineId

    // One shipment carrying goods from the filtered order, one carrying only the other order's goods.
    const withAllocation = await scoped('POST', SHIPMENTS_URL, {
      containerNumber: `SHIP-PO-${stamp}`.toUpperCase(),
      allocations: [{ purchaseOrderLineId, quantity: 5 }],
    })
    expect(withAllocation.status(), await withAllocation.text()).toBe(201)
    withAllocationId = String((await readJsonSafe<IdPayload>(withAllocation))?.id ?? '')
    shipmentIds.push(withAllocationId)

    const otherOrderShipment = await scoped('POST', SHIPMENTS_URL, {
      containerNumber: `SHIP-PO-OTHER-${stamp}`.toUpperCase(),
      allocations: [{ purchaseOrderLineId: otherPurchaseOrderLineId, quantity: 4 }],
    })
    expect(otherOrderShipment.status(), await otherOrderShipment.text()).toBe(201)
    otherOrderShipmentId = String((await readJsonSafe<IdPayload>(otherOrderShipment))?.id ?? '')
    shipmentIds.push(otherOrderShipmentId)

    // A second organization, to prove the filter never crosses organizations.
    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Ship purchase order branch ${stamp}`,
      tenantId,
    })
    roleId = await createRoleFixture(api, rootToken, { name: `Ship purchase order viewer ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: VIEWER_FEATURES })
    const viewerEmail = `ship-po-order-viewer-${stamp}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: branchOrgId,
      roles: [roleId],
      name: 'Ship purchase order viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of shipmentIds) {
      await scoped('DELETE', `${SHIPMENTS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of [purchaseOrderId, otherPurchaseOrderId]) {
      if (id) {
        await scoped('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(id)}`).catch(() => undefined)
      }
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
    const rows = await listShipments({ purchaseOrderId })
    const ids = rows.map((row) => row.id)
    expect(ids).toContain(withAllocationId)
    expect(ids).not.toContain(otherOrderShipmentId)
  })

  test('an unknown purchase order answers with an empty page', async () => {
    const rows = await listShipments({ purchaseOrderId: '11111111-1111-4111-8111-111111111111' })
    expect(rows).toEqual([])
  })

  test('another organization sees nothing for the same order id', async () => {
    const rows = await listShipments({ purchaseOrderId }, viewerToken, branchOrgId as string)
    expect(rows).toEqual([])
  })
})
