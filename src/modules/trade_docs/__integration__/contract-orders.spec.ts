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
 * Contract ↔ order links and the document's contract reference (`src/modules/trade_docs`) —
 * Phase 2 of `.ai/specs/2026-09-29-contract-linked-export-documents.md`.
 *
 * Covers TEST-201/TEST-202 (API half): a contract covers zero-or-more orders as a replace-all set
 * whose snapshot freezes the order's number, counterparty and date; a PI/CI carries its own
 * contract reference (independent of `source_kind/source_id`) and filters by it; and the two safety
 * invariants hold — another organization never sees a link, and a caller without `trade_docs.*`
 * is refused. The contract's own lifecycle still governs the write: a cancelled contract refuses
 * new links, and a stale dialog 409s instead of silently dropping someone else's link.
 */
const TRADE_DOCS_FEATURES = [
  'trade_docs.contracts.view',
  'trade_docs.contracts.manage',
  'trade_docs.documents.view',
  'trade_docs.documents.manage',
]
const STAFF_PASSWORD = 'TdOrders!2026'
const VIEWER_PASSWORD = 'TdOrdersViewer!2026'

type IdPayload = { id?: string; item?: { id?: string }; orderId?: string }
type ListPayload<T> = { items?: T[]; total?: number }

type ContractOrderItem = {
  id: string
  contractId: string
  orderKind: string
  orderId: string
  orderNumber?: string | null
  counterpartyName?: string | null
  orderedAt?: string | null
  status?: string | null
}

test.describe.serial('trade_docs — contract order links', () => {
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
  let supplierId = ''
  let catalogProductId = ''
  let productId = ''
  let purchaseOrderId = ''
  let purchaseOrderNumber: string | null = null
  let salesOrderId = ''
  let contractId = ''
  let cancelledContractId = ''
  let documentId = ''
  const contractIds: string[] = []
  const branchContractIds: string[] = []

  const stamp = Date.now().toString(36)

  const apiCall = (method: string, path: string, data?: unknown, orgId: string = hqOrgId, token: string = rootToken) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const createContract = async (label: string) => {
    const response = await apiCall('POST', '/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'supplier',
      counterpartySnapshot: { name: `${label} ${stamp}` },
      currencyCode: 'CNY',
      lines: [{ name: `${label} line ${stamp}`, quantity: '5', unitPrice: '2.5' }],
    })
    expect(response.status(), 'POST /api/trade_docs/contracts should return 201').toBe(201)
    const id = String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    expect(id).toBeTruthy()
    contractIds.push(id)
    return id
  }

  const replaceOrders = (
    id: string,
    orders: Array<{ orderKind: string; orderId: string }>,
    options: { updatedAt?: string; orgId?: string; token?: string } = {},
  ) =>
    apiCall(
      'POST',
      '/api/trade_docs/contracts/orders',
      { contractId: id, orders, ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}) },
      options.orgId ?? hqOrgId,
      options.token ?? rootToken,
    )

  const loadOrders = async (id: string, orgId: string = hqOrgId) => {
    const response = await apiCall(
      'GET',
      `/api/trade_docs/contracts/orders?contractId=${encodeURIComponent(id)}&pageSize=50`,
      undefined,
      orgId,
    )
    expect(response.status(), 'GET /api/trade_docs/contracts/orders should return 200').toBe(200)
    return (await readJsonSafe<ListPayload<ContractOrderItem>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // Granting module features needs an actor that already holds them: the installed check refuses
    // to hand out a feature the actor itself lacks.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `TD orders E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `TD orders staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: TRADE_DOCS_FEATURES })
    const staffEmail = `td-orders-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'TD orders staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    viewerRoleId = await createRoleFixture(api, rootToken, { name: `TD orders viewer ${stamp}`, tenantId })
    const viewerEmail = `td-orders-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'TD orders viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)

    const supplier = await apiCall('POST', '/api/purchasing/suppliers', {
      name: `TD orders supplier ${stamp}`,
      code: `TD-ORD-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), 'a supplier fixture is required for the purchase order').toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    // A purchase-order line names a catalog product; one action creates that product and its
    // default variant, and the returned id is what the line and every downstream document use.
    const productSku = `TD-ORD-${stamp}`.toUpperCase()
    const product = await apiCall('POST', '/api/products/items', {
      sku: productSku,
      name: `TD orders product ${stamp}`,
      unit: 'PCS',
    })
    expect(product.status(), 'POST /api/products/items should return 201').toBe(201)
    const productBody = await readJsonSafe<IdPayload>(product)
    productId = String(productBody?.id ?? productBody?.item?.id ?? '')
    catalogProductId = productId
    expect(productId, 'the product fixture resolved an id').toBeTruthy()

    const purchaseOrder = await apiCall('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ catalogProductId, quantity: 3, unitPrice: 12 }],
    })
    expect(purchaseOrder.status(), 'POST /api/purchasing/purchase-orders should return 201').toBe(201)
    const purchaseBody = await readJsonSafe<IdPayload & { number?: string | null }>(purchaseOrder)
    purchaseOrderId = String(purchaseBody?.id ?? purchaseBody?.item?.id ?? '')
    purchaseOrderNumber = purchaseBody?.number ?? null
    expect(purchaseOrderId).toBeTruthy()

    const salesOrder = await apiRequestWithSelectedOrg(api, 'POST', '/api/sales/orders', {
      token: rootToken,
      selectedOrgId: hqOrgId,
      data: {
        currencyCode: 'CNY',
        lines: [
          { currencyCode: 'CNY', quantity: 1, name: `TD orders sales line ${stamp}`, unitPriceNet: 5, unitPriceGross: 5 },
        ],
      },
    })
    expect(salesOrder.ok(), `POST /api/sales/orders answered ${salesOrder.status()}`).toBeTruthy()
    const salesBody = await readJsonSafe<IdPayload>(salesOrder)
    salesOrderId = String(salesBody?.id ?? salesBody?.orderId ?? salesBody?.item?.id ?? '')
    expect(salesOrderId, 'the created sales order id is reachable').toBeTruthy()

    contractId = await createContract('TD orders contract')
    // Issued (not draft) so the fixture also pins the "links stay editable after issue" rule and
    // the document's contract-number snapshot has something to freeze.
    const issued = await apiCall('POST', '/api/trade_docs/contracts/transitions', {
      id: contractId,
      action: 'issue',
    })
    expect([200, 201], 'a contract with lines can be issued').toContain(issued.status())

    cancelledContractId = await createContract('TD orders cancelled contract')
    const cancelled = await apiCall('POST', '/api/trade_docs/contracts/transitions', {
      id: cancelledContractId,
      action: 'cancel',
      reason: 'TEST-201 fixture',
    })
    expect([200, 201], 'a draft contract can be cancelled').toContain(cancelled.status())
  })

  test.afterAll(async () => {
    if (documentId) {
      await apiCall('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(documentId)}`).catch(() => undefined)
    }
    for (const id of contractIds) {
      await apiCall('DELETE', `/api/trade_docs/contracts?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of branchContractIds) {
      await apiCall(
        'DELETE',
        `/api/trade_docs/contracts?id=${encodeURIComponent(id)}`,
        undefined,
        branchOrgId ?? hqOrgId,
      ).catch(() => undefined)
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
    if (salesOrderId) {
      await apiCall('DELETE', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteUserIfExists(api, rootToken, viewerUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteRoleIfExists(api, rootToken, viewerRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('TEST-201: a contract covers several orders as a replace-all set', async () => {
    expect(await loadOrders(contractId), 'a fresh contract covers no order').toHaveLength(0)

    const added = await replaceOrders(contractId, [{ orderKind: 'purchase_order', orderId: purchaseOrderId }])
    expect(added.status(), 'linking the purchase order should succeed').toBe(201)
    expect((await readJsonSafe<{ count?: number }>(added))?.count).toBe(1)

    const single = await loadOrders(contractId)
    expect(single).toHaveLength(1)
    expect(single[0]?.orderKind).toBe('purchase_order')
    expect(single[0]?.orderId).toBe(purchaseOrderId)
    expect(single[0]?.orderNumber ?? null, 'the snapshot freezes the order number the order had').toBe(purchaseOrderNumber)
    expect(single[0]?.counterpartyName, 'the snapshot freezes the order counterparty').toContain(`TD orders supplier ${stamp}`)
    expect(typeof single[0]?.orderedAt === 'string' && single[0].orderedAt.length > 0, 'the snapshot freezes the order date').toBe(true)

    // The audit trail names the contract (not the link row) as the affected record, so the hub can
    // answer "who re-arranged this contract's orders" from the standard audit surface.
    const audit = await apiCall(
      'GET',
      `/api/audit_logs/audit-logs/actions?resourceKind=${encodeURIComponent('trade_docs.contract.order')}&resourceId=${encodeURIComponent(contractId)}&pageSize=20`,
    )
    expect(audit.status(), 'the audit surface answers for the link resource').toBe(200)
    const auditBody = await readJsonSafe<{ items?: unknown[]; total?: number }>(audit)
    expect((auditBody?.items ?? []).length, 'each replace writes an audit entry').toBeGreaterThan(0)

    // A swap keeps exactly what the dialog shows: the replaced set, not an accumulated one.
    const swapped = await replaceOrders(contractId, [
      { orderKind: 'purchase_order', orderId: purchaseOrderId },
      { orderKind: 'internal_sales_order', orderId: salesOrderId },
    ])
    expect(swapped.status()).toBe(201)
    const both = await loadOrders(contractId)
    expect(both).toHaveLength(2)
    expect(both.map((item) => item.orderKind).sort()).toEqual(['internal_sales_order', 'purchase_order'])
    expect(both.find((item) => item.orderKind === 'internal_sales_order')?.orderId).toBe(salesOrderId)

    const cleared = await replaceOrders(contractId, [])
    expect(cleared.status()).toBe(201)
    expect(await loadOrders(contractId), 'clearing the set removes every link').toHaveLength(0)
  })

  test('TEST-201: duplicates, unknown orders, a cancelled contract and a stale version are refused', async () => {
    const duplicate = await replaceOrders(contractId, [
      { orderKind: 'purchase_order', orderId: purchaseOrderId },
      { orderKind: 'purchase_order', orderId: purchaseOrderId },
    ])
    expect(duplicate.status(), 'the same order twice is refused before the unique key sees it').toBe(422)

    const unknownOrder = await replaceOrders(contractId, [
      { orderKind: 'purchase_order', orderId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    ])
    expect(unknownOrder.status(), 'an order this organization cannot see cannot be linked').toBe(422)

    const unknownContract = await replaceOrders('0f8fad5b-d9cb-469f-a165-70867728950e', [])
    expect(unknownContract.status()).toBe(404)

    const cancelled = await replaceOrders(cancelledContractId, [
      { orderKind: 'purchase_order', orderId: purchaseOrderId },
    ])
    expect(cancelled.status(), 'a cancelled contract refuses new links').toBe(422)

    const stale = await replaceOrders(
      contractId,
      [{ orderKind: 'purchase_order', orderId: purchaseOrderId }],
      { updatedAt: '2000-01-01T00:00:00.000Z' },
    )
    expect(stale.status(), 'a dialog rendered from an older contract version 409s').toBe(409)
    expect((await readJsonSafe<{ code?: string }>(stale))?.code).toBe('optimistic_lock_conflict')

    // The version the client actually rendered with is accepted, which proves the 409 above came
    // from the version check rather than from a broken payload.
    const contract = await apiCall('GET', `/api/trade_docs/contracts?id=${encodeURIComponent(contractId)}`)
    const current = (await readJsonSafe<ListPayload<{ updatedAt?: string }>>(contract))?.items?.[0]?.updatedAt ?? ''
    expect(current).toBeTruthy()
    const fresh = await replaceOrders(
      contractId,
      [{ orderKind: 'purchase_order', orderId: purchaseOrderId }],
      { updatedAt: current },
    )
    expect(fresh.status()).toBe(201)
  })

  test('TEST-201: an order from another organization cannot be linked, and its links stay invisible', async () => {
    expect(branchOrgId).toBeTruthy()
    const branch = branchOrgId ?? hqOrgId

    // A contract of the branch organization: the command resolves the contract first, so this
    // keeps the next assertion about the *order* rather than about a missing contract.
    const branchContract = await apiCall('POST', '/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'supplier',
      counterpartySnapshot: { name: `TD orders branch contract ${stamp}` },
      currencyCode: 'CNY',
      lines: [{ name: `TD orders branch line ${stamp}`, quantity: '1', unitPrice: '1' }],
    }, branch)
    expect(branchContract.status(), 'the branch contract fixture is created').toBe(201)
    const branchContractId = String((await readJsonSafe<IdPayload>(branchContract))?.id ?? '')
    branchContractIds.push(branchContractId)

    const foreign = await replaceOrders(
      branchContractId,
      [{ orderKind: 'purchase_order', orderId: purchaseOrderId }],
      { orgId: branch },
    )
    expect(foreign.status(), 'a purchase order of the head office is not visible in the branch').toBe(422)

    // The head-office contract is not visible from the branch either, so neither are its links.
    const branchView = await loadOrders(contractId, branch)
    expect(branchView, 'another organization never sees the contract links').toHaveLength(0)
  })

  test('TEST-202: a PI carries its own contract reference and filters by it', async () => {
    const created = await apiCall('POST', '/api/trade_docs/documents', {
      kind: 'proforma',
      direction: 'purchase',
      counterpartyKind: 'supplier',
      currencyCode: 'CNY',
      contractId,
      lines: [{ name: `TD orders PI line ${stamp}`, quantity: '2', unitPrice: '7' }],
    })
    expect(created.status(), 'a PI bound to a contract is created').toBe(201)
    documentId = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    expect(documentId).toBeTruthy()

    const listed = await apiCall(
      'GET',
      `/api/trade_docs/documents?contractId=${encodeURIComponent(contractId)}&pageSize=50`,
    )
    const items = (await readJsonSafe<ListPayload<{ id: string; contractId?: string; contractName?: string | null }>>(listed))?.items ?? []
    const match = items.find((item) => item.id === documentId)
    expect(match, 'the document is reachable through the contract filter').toBeTruthy()
    expect(match?.contractId).toBe(contractId)
    expect(match?.contractName, 'the number snapshot travels with the list row').toBeTruthy()

    const unbound = await apiCall('PUT', '/api/trade_docs/documents', { id: documentId, contractId: null })
    expect(unbound.status(), 'the contract reference is cleared on demand').toBe(200)
    const after = await apiCall(
      'GET',
      `/api/trade_docs/documents?contractId=${encodeURIComponent(contractId)}&pageSize=50`,
    )
    const remaining = (await readJsonSafe<ListPayload<{ id: string }>>(after))?.items ?? []
    expect(remaining.some((item) => item.id === documentId), 'an unbound document leaves the filter').toBe(false)
  })

  test('TEST-201: a caller without trade_docs features is refused', async () => {
    const write = await replaceOrders(contractId, [], {
      orgId: hqOrgId,
      token: viewerToken,
    })
    expect([401, 403]).toContain(write.status())

    const read = await apiRequestWithSelectedOrg(
      api,
      'GET',
      `/api/trade_docs/contracts/orders?contractId=${encodeURIComponent(contractId)}&pageSize=10`,
      { token: viewerToken, selectedOrgId: hqOrgId },
    )
    expect([401, 403]).toContain(read.status())

    // The staff role holds the same features and reaches both verbs, which proves the refusal
    // above comes from the feature gate rather than from a broken fixture.
    const staffRead = await apiRequestWithSelectedOrg(
      api,
      'GET',
      `/api/trade_docs/contracts/orders?contractId=${encodeURIComponent(contractId)}&pageSize=10`,
      { token: staffToken, selectedOrgId: hqOrgId },
    )
    expect(staffRead.status()).toBe(200)
  })
})
