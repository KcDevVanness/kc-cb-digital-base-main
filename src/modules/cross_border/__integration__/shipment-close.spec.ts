import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The shipment archival stage (`closed`) — Phase 2 of
 * `.ai/specs/2026-09-30-document-status-lifecycle.md`.
 *
 * Covers the archival transition end to end, through the real APIs:
 *
 * - TEST-201: a `received` shipment closes and the list surface reports `closed`;
 * - TEST-202: the command guard refuses the transition from `draft` and from `in_transit`;
 * - TEST-203: `closed` is terminal — cancellation is refused and the status does not move.
 *
 * The fixture chain is the minimum that lets a shipment reach `received`: a catalog product with
 * an active default variant (stock is booked at variant level), its product-master bridge, a
 * supplier, a placed purchase order with one line, and a wms warehouse plus location to receive
 * into.
 */

type IdPayload = { id?: string; item?: { id?: string } }
type ListPayload<T> = { items?: T[]; total?: number }
type ShipmentItem = { id: string; status: string; number?: string | null }

const STAFF_PASSWORD = 'ShipmentClose!2026'

async function post(api: APIRequestContext, path: string, token: string, orgId: string, data: Record<string, unknown>) {
  return apiRequestWithSelectedOrg(api, 'POST', path, { token, selectedOrgId: orgId, data })
}

async function get(api: APIRequestContext, path: string, token: string, orgId: string) {
  return apiRequestWithSelectedOrg(api, 'GET', path, { token, selectedOrgId: orgId })
}

/** A body the test then reads: `readJsonSafe` answers `T | null`, and a null here is a failed call. */
async function readBody<T>(response: APIResponse): Promise<T> {
  const body = await readJsonSafe<T>(response)
  expect(body, 'response body should be JSON').not.toBeNull()
  return body as T
}

/**
 * For the command routes: the framework answers 200 or 201 depending on whether the route pins a
 * status, and what the test cares about is that the command ran — not which of the two came back.
 */
async function expectOk<T extends Record<string, unknown>>(response: APIResponse): Promise<T> {
  const body = await readBody<T>(response)
  expect([200, 201], JSON.stringify(body)).toContain(response.status())
  return body
}

/** The shipment list surface, narrowed to one id: `status` is what the archival assertions read. */
async function loadShipmentStatus(
  api: APIRequestContext,
  token: string,
  orgId: string,
  shipmentId: string,
): Promise<string | null> {
  const response = await get(
    api,
    `/api/cross_border/shipments?id=${encodeURIComponent(shipmentId)}&pageSize=1`,
    token,
    orgId,
  )
  expect(response.status(), 'GET /api/cross_border/shipments should return 200').toBe(200)
  const body = await readBody<ListPayload<ShipmentItem>>(response)
  return body.items?.[0]?.status ?? null
}

test.describe.serial('cross_border — shipment archival closure', () => {
  const stamp = Date.now().toString(36)
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let organizationId = ''
  let staffRoleId: string | null = null
  let staffUserId: string | null = null
  let catalogProductId = ''
  let productId = ''
  let supplierId = ''
  let purchaseOrderId = ''
  let purchaseOrderLineId = ''
  let warehouseId = ''
  let locationId = ''
  // Shipments this spec created that the API cannot delete (a `received`/`closed` one) are kept
  // for reporting; the rest belong to the shared phase-2 list.
  let closedShipmentId = ''

  const shipmentIds: string[] = []

  const createShipment = async (quantity: number) => {
    const response = await post(api, '/api/cross_border/shipments', staffToken, organizationId, {
      containerNumber: `CBLC-${stamp.toUpperCase()}`,
      allocations: [{ purchaseOrderLineId, quantity }],
    })
    expect(response.status(), 'POST /api/cross_border/shipments should return 201').toBe(201)
    const created = await readJsonSafe<IdPayload>(response)
    const id = String(created?.id ?? '')
    shipmentIds.push(id)
    return id
  }

  const depart = async (shipmentId: string) => {
    const response = await post(api, '/api/cross_border/shipments/depart', staffToken, organizationId, {
      id: shipmentId,
    })
    await expectOk<{ status?: string }>(response)
  }

  const receive = async (shipmentId: string) => {
    const response = await post(api, '/api/cross_border/shipments/receive', staffToken, organizationId, {
      id: shipmentId,
      warehouseId,
      locationId,
    })
    await expectOk<{ status?: string }>(response)
  }

  const close = async (shipmentId: string) => {
    const response = await post(api, '/api/cross_border/shipments/close', staffToken, organizationId, {
      id: shipmentId,
    })
    await expectOk<{ status?: string }>(response)
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    organizationId = scope.organizationId

    // Role and user fixtures are created through the platform's own auth APIs, and torn down in
    // `afterAll` — the spec's writes go through a user the phase-2 feature set actually covers.
    staffRoleId = await createRoleFixture(api, rootToken, { name: `shipment-close ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, {
      roleId: staffRoleId,
      features: [
        'cross_border.shipments.view',
        'cross_border.shipments.manage',
        'cross_border.shipments.depart',
        'cross_border.shipments.receive',
        'purchasing.suppliers.view',
        'purchasing.suppliers.manage',
        'purchasing.orders.view',
        'purchasing.orders.manage',
        'products.items.manage',
        'catalog.products.manage',
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
      ],
    })
    const staffEmail = `shipment-close-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId,
      roles: [staffRoleId],
      name: 'Shipment close staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    // The allocation guard refuses a purchase line that is not bridged to the installed catalog,
    // and the receipt books stock at variant level, so catalog product, active default variant and
    // the product-master bridge all have to exist before a shipment can be received.
    const catalogSku = `CBLC-${stamp.toUpperCase()}`
    const catalogProduct = await post(api, '/api/catalog/products', rootToken, organizationId, {
      title: `Shipment close product ${stamp}`,
      sku: catalogSku,
    })
    expect(catalogProduct.status(), 'POST /api/catalog/products should return 201').toBe(201)
    catalogProductId = String((await readJsonSafe<IdPayload>(catalogProduct))?.id ?? '')
    expect(catalogProductId, 'the catalog product fixture resolved an id').toBeTruthy()

    const variant = await post(api, '/api/catalog/variants', rootToken, organizationId, {
      productId: catalogProductId,
      sku: `${catalogSku}-V`,
      isDefault: true,
      isActive: true,
    })
    expect(variant.status(), 'POST /api/catalog/variants should return 201').toBe(201)

    const product = await post(api, '/api/products/items', staffToken, organizationId, {
      sku: catalogSku,
      name: `Shipment close product ${stamp}`,
      catalogProductId,
      unit: 'PCS',
    })
    expect(product.status(), 'POST /api/products/items should return 201').toBe(201)
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    expect(productId).toBeTruthy()

    const supplier = await post(api, '/api/purchasing/suppliers', staffToken, organizationId, {
      name: `Shipment close supplier ${stamp}`,
      code: `CBLC-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), 'POST /api/purchasing/suppliers should return 201').toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const order = await post(api, '/api/purchasing/purchase-orders', staffToken, organizationId, {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 20, unitPrice: 100, taxRate: 0, priceIncludesTax: true }],
    })
    expect(order.status(), 'POST /api/purchasing/purchase-orders should return 201').toBe(201)
    purchaseOrderId = String((await readJsonSafe<IdPayload>(order))?.id ?? '')
    expect(purchaseOrderId).toBeTruthy()

    const placed = await post(api, '/api/purchasing/purchase-orders/transitions', staffToken, organizationId, {
      id: purchaseOrderId,
      action: 'place',
    })
    expect(placed.status(), 'placing the purchase order should succeed').toBeLessThan(300)

    const lines = await get(
      api,
      `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}&pageSize=1`,
      staffToken,
      organizationId,
    )
    expect(lines.status()).toBe(200)
    purchaseOrderLineId = String((await readJsonSafe<ListPayload<{ id: string }>>(lines))?.items?.[0]?.id ?? '')
    expect(purchaseOrderLineId).toBeTruthy()

    const warehouse = await post(api, '/api/wms/warehouses', staffToken, organizationId, {
      name: `Shipment close warehouse ${stamp}`,
      code: `CBLC-${stamp}`.toUpperCase(),
    })
    expect(warehouse.status(), 'POST /api/wms/warehouses should return 201').toBe(201)
    warehouseId = String((await readJsonSafe<IdPayload>(warehouse))?.id ?? '')
    expect(warehouseId).toBeTruthy()

    const location = await post(api, '/api/wms/locations', staffToken, organizationId, {
      warehouseId,
      code: 'A-01',
      type: 'bin',
    })
    expect(location.status(), 'POST /api/wms/locations should return 201').toBe(201)
    locationId = String((await readJsonSafe<IdPayload>(location))?.id ?? '')
    expect(locationId).toBeTruthy()
  })

  test.afterAll(async () => {
    // A `received`/`closed` shipment cannot be deleted through the API — the delete command only
    // accepts a `draft` or `cancelled` one, so this attempt answers 409 and is expected to fail
    // harmlessly; the row is left behind for the ephemeral database to discard.
    for (const id of shipmentIds) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/cross_border/shipments?id=${encodeURIComponent(id)}`, {
        token: staffToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (purchaseOrderId) {
      await apiRequestWithSelectedOrg(
        api,
        'DELETE',
        `/api/purchasing/purchase-orders?id=${encodeURIComponent(purchaseOrderId)}`,
        { token: staffToken, selectedOrgId: organizationId },
      ).catch(() => undefined)
    }
    if (supplierId) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`, {
        token: staffToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (productId) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`, {
        token: staffToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (catalogProductId) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`, {
        token: rootToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (locationId) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/wms/locations?id=${encodeURIComponent(locationId)}`, {
        token: staffToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (warehouseId) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(warehouseId)}`, {
        token: staffToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await api.dispose()
  })

  test('TEST-201: a received shipment closes and the list surface reports the archival status', async () => {
    const shipmentId = await createShipment(10)
    expect(await loadShipmentStatus(api, staffToken, organizationId, shipmentId)).toBe('draft')

    await depart(shipmentId)
    await receive(shipmentId)
    expect(await loadShipmentStatus(api, staffToken, organizationId, shipmentId)).toBe('received')

    const closed = await post(api, '/api/cross_border/shipments/close', staffToken, organizationId, {
      id: shipmentId,
    })
    const body = await expectOk<{ status?: string }>(closed)
    expect(body.status, 'the close command reports the archival status').toBe('closed')

    expect(await loadShipmentStatus(api, staffToken, organizationId, shipmentId)).toBe('closed')
    closedShipmentId = shipmentId
  })

  test('TEST-202: closing is refused from draft and from in-transit', async () => {
    // A second allocation of the same line: 10 of the ordered 20 are already consumed by the
    // received shipment, so the remainder is exactly one more shipment.
    const shipmentId = await createShipment(5)

    const refusedDraft = await post(api, '/api/cross_border/shipments/close', staffToken, organizationId, {
      id: shipmentId,
    })
    expect(refusedDraft.status(), 'a draft shipment cannot be closed').toBe(422)

    await depart(shipmentId)
    expect(await loadShipmentStatus(api, staffToken, organizationId, shipmentId)).toBe('in_transit')

    const refusedInTransit = await post(api, '/api/cross_border/shipments/close', staffToken, organizationId, {
      id: shipmentId,
    })
    expect(refusedInTransit.status(), 'an in-transit shipment cannot be closed').toBe(422)
    expect(await loadShipmentStatus(api, staffToken, organizationId, shipmentId)).toBe('in_transit')

    // The refused close left the shipment alone, so it can still take the cancellation escape —
    // which also makes the fixture deletable in `afterAll`.
    const cancelled = await post(api, '/api/cross_border/shipments/cancel', staffToken, organizationId, {
      id: shipmentId,
      reason: 'refused-close fixture cleanup',
    })
    await expectOk<{ status?: string }>(cancelled)
    expect(await loadShipmentStatus(api, staffToken, organizationId, shipmentId)).toBe('cancelled')
  })

  test('TEST-203: a closed shipment is terminal — cancellation is refused', async () => {
    expect(closedShipmentId, 'TEST-201 closed the archival fixture first').toBeTruthy()

    const refused = await post(api, '/api/cross_border/shipments/cancel', staffToken, organizationId, {
      id: closedShipmentId,
      reason: 'the cabinet is already filed',
    })
    expect(refused.status(), 'a closed shipment cannot be cancelled').toBe(422)

    expect(
      await loadShipmentStatus(api, staffToken, organizationId, closedShipmentId),
      'the refused cancellation left the archival status untouched',
    ).toBe('closed')
  })
})
