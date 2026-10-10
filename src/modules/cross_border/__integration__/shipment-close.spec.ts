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
type DocumentItem = { id: string; shipmentId: string; docType: string }

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

/** The document section of one shipment, as the detail page reads it. */
async function loadDocuments(
  api: APIRequestContext,
  token: string,
  orgId: string,
  shipmentId: string,
): Promise<DocumentItem[]> {
  const response = await get(
    api,
    `/api/cross_border/shipments/documents?shipmentId=${encodeURIComponent(shipmentId)}&pageSize=50`,
    token,
    orgId,
  )
  expect(response.status(), 'GET /api/cross_border/shipments/documents should return 200').toBe(200)
  const body = await readBody<ListPayload<DocumentItem>>(response)
  return body.items ?? []
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
  // A document registered while the archival shipment was still `received`, so the sealing
  // assertions in TEST-204 have an existing paper to try to edit and delete.
  let closedShipmentDocumentId = ''

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

  const close = async (shipmentId: string): Promise<string | null> => {
    const response = await post(api, '/api/cross_border/shipments/close', staffToken, organizationId, {
      id: shipmentId,
    })
    const body = await expectOk<{ status?: string }>(response)
    return body.status ?? null
  }

  /** One export paper on a shipment, through the documents surface the detail page uses. */
  const createDocument = async (shipmentId: string, docType: string) => {
    const response = await post(api, '/api/cross_border/shipments/documents', staffToken, organizationId, {
      shipmentId,
      docType,
    })
    expect(response.status(), 'POST /api/cross_border/shipments/documents should return 201').toBe(201)
    return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
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
        'cross_border.documents.manage',
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

    // The product store creates the catalog product **and** its default variant in one action; the
    // returned id is the catalog product id, which is what purchase lines, allocations and the
    // variant-level receipt all reference.
    const productSku = `CBLC-${stamp.toUpperCase()}`
    const product = await post(api, '/api/products/items', staffToken, organizationId, {
      sku: productSku,
      name: `Shipment close product ${stamp}`,
      unit: 'PCS',
    })
    expect(product.status(), 'POST /api/products/items should return 201').toBe(201)
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    catalogProductId = productId
    expect(productId, 'the product fixture resolved an id').toBeTruthy()

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
    // The closed shipment's own paper is refused the same way (the sealing answers 422), so this
    // delete is expected to fail harmlessly alongside the shipment row.
    if (closedShipmentDocumentId) {
      await apiRequestWithSelectedOrg(
        api,
        'DELETE',
        `/api/cross_border/shipments/documents?id=${encodeURIComponent(closedShipmentDocumentId)}`,
        { token: staffToken, selectedOrgId: organizationId },
      ).catch(() => undefined)
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

    // The paperwork is registered while the shipment is still open, so TEST-204 can prove that
    // closing sealed an existing document rather than only refusing new ones.
    closedShipmentDocumentId = await createDocument(shipmentId, 'packing_list')
    expect(closedShipmentDocumentId).toBeTruthy()
    expect(await loadDocuments(api, staffToken, organizationId, shipmentId)).toHaveLength(1)

    expect(await close(shipmentId), 'the close command reports the archival status').toBe('closed')

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

  test('TEST-204: a closed shipment is sealed for its paperwork too', async () => {
    expect(closedShipmentId, 'TEST-201 closed the archival fixture first').toBeTruthy()
    expect(closedShipmentDocumentId, 'TEST-201 registered a paper before closing').toBeTruthy()

    const refusedCreate = await post(
      api,
      '/api/cross_border/shipments/documents',
      staffToken,
      organizationId,
      { shipmentId: closedShipmentId, docType: 'packing_list' },
    )
    expect(refusedCreate.status(), 'a document cannot be added to a closed shipment').toBe(422)
    expect(await loadDocuments(api, staffToken, organizationId, closedShipmentId)).toHaveLength(1)

    const refusedUpdate = await apiRequestWithSelectedOrg(
      api,
      'PUT',
      '/api/cross_border/shipments/documents',
      {
        token: staffToken,
        selectedOrgId: organizationId,
        data: { id: closedShipmentDocumentId, note: 'edited after the cabinet was filed' },
      },
    )
    expect(refusedUpdate.status(), 'an existing document cannot be edited on a closed shipment').toBe(422)

    const refusedDelete = await apiRequestWithSelectedOrg(
      api,
      'DELETE',
      `/api/cross_border/shipments/documents?id=${encodeURIComponent(closedShipmentDocumentId)}`,
      { token: staffToken, selectedOrgId: organizationId },
    )
    expect(refusedDelete.status(), 'an existing document cannot be deleted from a closed shipment').toBe(422)

    // Each refusal left the paper in place, and the refusals never moved the shipment out of the
    // archival status the sealing is derived from.
    const documents = await loadDocuments(api, staffToken, organizationId, closedShipmentId)
    expect(documents.map((document) => document.id)).toEqual([closedShipmentDocumentId])
    expect(
      await loadShipmentStatus(api, staffToken, organizationId, closedShipmentId),
      'the refused document writes left the archival status untouched',
    ).toBe('closed')
  })
})
