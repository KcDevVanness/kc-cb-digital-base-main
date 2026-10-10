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
 * Contract links and packing-list lines (`src/modules/cross_border`) — Phase 1 of
 * `.ai/specs/2026-09-29-contract-linked-export-documents.md`.
 *
 * Covers TEST-101/TEST-102: a shipment carries zero-or-more contracts as a replace-all set with a
 * frozen number/direction snapshot and a `?contractId=` filter; a packing list carries structured
 * lines (numbered, fixed-scale, all nullable) that only exist on `packing_list` documents and are
 * replaced wholesale. Also pins the two safety invariants: another organization never sees a link,
 * and a caller without `cross_border.*` is refused.
 */
const CROSS_BORDER_FEATURES = [
  'cross_border.shipments.view',
  'cross_border.shipments.manage',
  'cross_border.documents.manage',
]
const STAFF_PASSWORD = 'CbLinks!2026'
const VIEWER_PASSWORD = 'CbLinksViewer!2026'

type IdPayload = { id?: string; item?: { id?: string } }
type ListPayload<T> = { items?: T[]; total?: number }

type ShipmentContractItem = {
  id: string
  shipmentId: string
  contractId: string
  contractNumber?: string | null
  contractDirection?: string | null
}

type DocumentLineItem = {
  id: string
  documentId: string
  lineNumber: number
  name?: string | null
  sku?: string | null
  quantity?: string | null
  cartons?: string | null
  grossWeight?: string | null
  netWeight?: string | null
  volume?: string | null
}

test.describe.serial('cross_border — shipment contracts and packing-list lines', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let viewerToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let staffRoleId: string | null = null
  let viewerRoleId: string | null = null
  let staffUserId: string | null = null
  let viewerUserId: string | null = null
  let catalogProductId = ''
  let productId = ''
  let supplierId = ''
  let purchaseOrderId = ''
  let purchaseOrderLineId = ''
  const contractIds: string[] = []
  const shipmentIds: string[] = []
  const documentIds: string[] = []

  const stamp = Date.now().toString(36)

  const apiCall = (method: string, path: string, data?: unknown, orgId: string = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: orgId, data })

  const createContract = async (direction: 'purchase' | 'sales', label: string) => {
    const response = await apiCall('POST', '/api/trade_docs/contracts', {
      direction,
      counterpartyKind: direction === 'purchase' ? 'supplier' : 'customer',
      counterpartySnapshot: { name: `${label} ${stamp}` },
      currencyCode: 'CNY',
      lines: [{ name: `${label} line ${stamp}`, quantity: '9', unitPrice: '3.5' }],
    })
    expect(response.status(), 'POST /api/trade_docs/contracts should return 201').toBe(201)
    const created = await readJsonSafe<IdPayload>(response)
    contractIds.push(String(created?.id ?? ''))
    return String(created?.id ?? '')
  }

  const createShipment = async (payload: Record<string, unknown>) => {
    const response = await apiCall('POST', '/api/cross_border/shipments', payload)
    expect(response.status(), 'POST /api/cross_border/shipments should return 201').toBe(201)
    const created = await readJsonSafe<IdPayload>(response)
    const id = String(created?.id ?? '')
    shipmentIds.push(id)
    return id
  }

  const loadContracts = async (shipmentId: string, orgId: string = hqOrgId) => {
    const response = await apiCall(
      'GET',
      `/api/cross_border/shipments/contracts?shipmentId=${encodeURIComponent(shipmentId)}&pageSize=50`,
      undefined,
      orgId,
    )
    expect(response.status(), 'GET /api/cross_border/shipments/contracts should return 200').toBe(200)
    return (await readJsonSafe<ListPayload<ShipmentContractItem>>(response))?.items ?? []
  }

  const createPackingList = async (payload: Record<string, unknown>) => {
    const response = await apiCall('POST', '/api/cross_border/shipments/documents', payload)
    expect(response.status(), 'POST /api/cross_border/shipments/documents should return 201').toBe(201)
    const created = await readJsonSafe<IdPayload>(response)
    const id = String(created?.id ?? '')
    documentIds.push(id)
    return id
  }

  const loadDocumentLines = async (documentId: string) => {
    const response = await apiCall(
      'GET',
      `/api/cross_border/shipments/documents/lines?documentId=${encodeURIComponent(documentId)}&pageSize=100`,
    )
    expect(response.status(), 'GET /api/cross_border/shipments/documents/lines should return 200').toBe(200)
    return (await readJsonSafe<ListPayload<DocumentLineItem>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // A role that grants module features needs a `superadmin` actor: the installed grant check
    // refuses a feature the actor does not itself hold.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `CB links E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `CB links staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: CROSS_BORDER_FEATURES })
    const staffEmail = `cb-links-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'CB links staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    viewerRoleId = await createRoleFixture(api, rootToken, { name: `CB links viewer ${stamp}`, tenantId })
    const viewerEmail = `cb-links-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'CB links viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)

    // One action creates the catalog product and its default variant; the returned id is the
    // catalog product id every downstream document reference uses.
    const product = await apiCall('POST', '/api/products/items', {
      sku: `CB-LINKS-${stamp}`.toUpperCase(),
      name: `CB links product ${stamp}`,
      unit: 'PCS',
    })
    expect(product.status(), 'POST /api/products/items should return 201').toBe(201)
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    catalogProductId = productId
    expect(productId).toBeTruthy()

    const supplier = await apiCall('POST', '/api/purchasing/suppliers', {
      name: `CB links supplier ${stamp}`,
      code: `CB-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), 'POST /api/purchasing/suppliers should return 201').toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const order = await apiCall('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ catalogProductId, quantity: 20, unitPrice: 100, taxRate: 0, priceIncludesTax: true }],
    })
    expect(order.status(), 'POST /api/purchasing/purchase-orders should return 201').toBe(201)
    purchaseOrderId = String((await readJsonSafe<IdPayload>(order))?.id ?? '')
    expect(purchaseOrderId).toBeTruthy()

    const placed = await apiCall('POST', '/api/purchasing/purchase-orders/transitions', {
      id: purchaseOrderId,
      action: 'place',
    })
    expect(placed.status(), 'placing the purchase order should succeed').toBeLessThan(300)

    const lines = await apiCall(
      'GET',
      `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}`,
    )
    expect(lines.status()).toBe(200)
    purchaseOrderLineId = String((await readJsonSafe<ListPayload<{ id: string }>>(lines))?.items?.[0]?.id ?? '')
    expect(purchaseOrderLineId).toBeTruthy()
  })

  test.afterAll(async () => {
    for (const id of documentIds) {
      await apiCall('DELETE', `/api/cross_border/shipments/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of shipmentIds) {
      await apiCall('DELETE', `/api/cross_border/shipments?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of contractIds) {
      await apiCall('DELETE', `/api/trade_docs/contracts?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (purchaseOrderId) {
      await apiCall('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(purchaseOrderId)}`).catch(() => undefined)
    }
    if (supplierId) {
      await apiCall('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    }
    if (productId) {
      await apiCall('DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    }
    if (catalogProductId) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`, {
        token: rootToken,
        selectedOrgId: hqOrgId,
      }).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteUserIfExists(api, rootToken, viewerUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteRoleIfExists(api, rootToken, viewerRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('TEST-101: shipment links several contracts, freezes the snapshot and filters by contract', async () => {
    const purchaseContractId = await createContract('purchase', 'CB purchase')
    const salesContractId = await createContract('sales', 'CB sales')
    const shipmentId = await createShipment({
      containerNumber: `CBL-${stamp.toUpperCase()}`,
      allocations: [{ purchaseOrderLineId, quantity: 2 }],
      contracts: [{ contractId: purchaseContractId }, { contractId: salesContractId }],
    })

    const links = await loadContracts(shipmentId)
    expect(links).toHaveLength(2)
    const directions = links.map((link) => link.contractDirection).sort()
    expect(directions, 'both directions are stored as the operator picked them').toEqual(['purchase', 'sales'])
    expect(links.every((link) => link.shipmentId === shipmentId)).toBe(true)

    const byContract = await apiCall(
      'GET',
      `/api/cross_border/shipments?contractId=${encodeURIComponent(salesContractId)}&pageSize=50`,
    )
    expect(byContract.status()).toBe(200)
    const filtered = await readJsonSafe<ListPayload<{ id: string }>>(byContract)
    expect((filtered?.items ?? []).some((item) => item.id === shipmentId), 'the filter finds the linked shipment').toBe(true)

    const duplicate = await apiCall('POST', '/api/cross_border/shipments', {
      allocations: [{ purchaseOrderLineId, quantity: 1 }],
      contracts: [{ contractId: purchaseContractId }, { contractId: purchaseContractId }],
    })
    expect(duplicate.status(), 'the same contract twice is refused').toBe(422)

    const unknown = await apiCall('POST', '/api/cross_border/shipments', {
      allocations: [{ purchaseOrderLineId, quantity: 1 }],
      contracts: [{ contractId: '00000000-0000-4000-8000-000000000000' }],
    })
    expect(unknown.status(), 'an unknown contract is refused').toBe(422)

    const cleared = await apiCall('PUT', '/api/cross_border/shipments', { id: shipmentId, contracts: [] })
    expect(cleared.status(), 'an explicit empty set clears the links').toBe(200)
    expect(await loadContracts(shipmentId)).toHaveLength(0)

    const branchView = await loadContracts(shipmentId, branchOrgId as string)
    expect(branchView, 'another organization never sees the links').toHaveLength(0)
  })

  test('TEST-102: packing-list lines are numbered, normalized, replace-all and packing-only', async () => {
    const contractId = await createContract('sales', 'CB packing')
    const shipmentId = await createShipment({
      containerNumber: `CBP-${stamp.toUpperCase()}`,
      allocations: [{ purchaseOrderLineId, quantity: 2 }],
      contracts: [{ contractId }],
    })

    const documentId = await createPackingList({
      shipmentId,
      docType: 'packing_list',
      documentNumber: `PL-${stamp.toUpperCase()}`,
      issuedAt: '2026-09-29',
      lines: [
        { name: 'Packed feeder', sku: 'P1', quantity: '12', cartons: 3, grossWeight: '1.5', netWeight: '1.25', volume: 88642 },
        { name: 'Packed fountain', sku: 'P2', quantity: '4', cartons: 1, grossWeight: null, netWeight: null, volume: null },
      ],
    })

    const lines = await loadDocumentLines(documentId)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.lineNumber).toBe(1)
    expect(lines[0]?.quantity).toBe('12.0000')
    expect(lines[0]?.cartons).toBe('3')
    expect(lines[0]?.grossWeight).toBe('1.5000')
    expect(lines[0]?.volume).toBe('88642')
    expect(lines[1]?.lineNumber).toBe(2)
    expect(lines[1]?.netWeight, 'a blank measurement stays null rather than "0"').toBeNull()

    const refused = await apiCall('POST', '/api/cross_border/shipments/documents', {
      shipmentId,
      docType: 'customs_declaration',
      lines: [{ name: 'not a packing list' }],
    })
    expect(refused.status(), 'lines are refused on a non-packing document').toBe(422)

    const replaced = await apiCall('PUT', '/api/cross_border/shipments/documents', {
      id: documentId,
      lines: [{ name: 'Only line', sku: 'P3', quantity: '7' }],
    })
    expect(replaced.status()).toBe(200)
    const afterReplace = await loadDocumentLines(documentId)
    expect(afterReplace).toHaveLength(1)
    expect(afterReplace[0]?.name).toBe('Only line')

    const cleared = await apiCall('PUT', '/api/cross_border/shipments/documents', { id: documentId, lines: [] })
    expect(cleared.status()).toBe(200)
    expect(await loadDocumentLines(documentId)).toHaveLength(0)

    const byContract = await apiCall(
      'GET',
      `/api/cross_border/shipments/documents?docType=packing_list&contractId=${encodeURIComponent(contractId)}&pageSize=50`,
    )
    expect(byContract.status()).toBe(200)
    const documents = await readJsonSafe<ListPayload<{ id: string }>>(byContract)
    expect(
      (documents?.items ?? []).some((item) => item.id === documentId),
      'a packing list is reachable through its shipment-linked contract',
    ).toBe(true)

    const removed = await apiCall('DELETE', `/api/cross_border/shipments/documents?id=${encodeURIComponent(documentId)}`)
    expect(removed.status()).toBe(200)
    expect(await loadDocumentLines(documentId), 'a deleted document stops serving its lines').toHaveLength(0)
  })

  test('TEST-103: a caller without cross_border features is refused', async () => {
    const response = await apiRequestWithSelectedOrg(api, 'POST', '/api/cross_border/shipments', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
      data: { allocations: [{ purchaseOrderLineId, quantity: 1 }] },
    })
    expect([401, 403]).toContain(response.status())

    const read = await apiRequestWithSelectedOrg(
      api,
      'GET',
      `/api/cross_border/shipments/contracts?shipmentId=${encodeURIComponent(shipmentIds[0] ?? '')}&pageSize=10`,
      { token: viewerToken, selectedOrgId: hqOrgId },
    )
    expect([401, 403]).toContain(read.status())

    // The staff role can read and write the same surface, which proves the refusal above comes
    // from the feature gate rather than from a broken fixture.
    const staffRead = await apiRequestWithSelectedOrg(
      api,
      'GET',
      `/api/cross_border/shipments/contracts?shipmentId=${encodeURIComponent(shipmentIds[0] ?? '')}&pageSize=10`,
      { token: staffToken, selectedOrgId: hqOrgId },
    )
    expect(staffRead.status()).toBe(200)
  })
})
