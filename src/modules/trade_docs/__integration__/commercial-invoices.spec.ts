import { expect, request, test, type APIRequestContext } from '@playwright/test'
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
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * CI（商业发票）documents (`src/modules/trade_docs`, kind=`commercial`) — Phase 2 of
 * `.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`.
 *
 * Covers what the spec's Integration Coverage table records for TEST-008, TEST-004 and TEST-005,
 * plus the scope/permission invariants that make the surface safe:
 *
 * - TEST-008 — a shipment carries sales allocations for two different internal sales orders (with
 *   the frozen quantity/price/currency snapshot), and an update replaces the set wholesale.
 * - TEST-004 — a draft CI aggregates one line per allocation, sales first and purchase as the
 *   fallback, rerunning replaces rather than duplicates, and each line keeps its source snapshot.
 * - TEST-005 — a CI with no shipment at all still runs the whole lifecycle (manual lines → issue
 *   with our own `CI-<year>-<4 digits>` number → generate → download), and the legacy
 *   `commercial_invoice` slot of the shipment's export documents keeps working for historical rows.
 * - Scope and permissions — an HQ document is invisible with the branch organization selected, and
 *   a caller without `trade_docs.documents.*` is refused while a granted caller succeeds.
 *
 * Every fixture is built through the real HTTP API: supplier → product master → purchase order
 * (placed) → its lines, and internal sales order → its product line, which is what the shipment
 * command resolves the sales allocation against. Assertions read observable state back through the
 * read seams (`…/shipments/sales-allocations`, `…/documents/lines`), never a DOM or a file.
 */
const DOCUMENT_FEATURES = ['trade_docs.documents.view', 'trade_docs.documents.manage']
const STAFF_PASSWORD = 'CiDocs!2026'
const VIEWER_PASSWORD = 'CiDocsViewer!2026'
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type ListPayload<T> = { items?: T[]; total?: number }

type DocumentItem = {
  id: string
  kind: string
  direction: string
  number: string | null
  status: string
  currencyCode: string
  subtotal: string
  total: string
  sourceKind?: string | null
  sourceId?: string | null
  generatedAttachmentId?: string | null
  issuedAt?: string | null
}

type DocumentLineItem = {
  id: string
  documentId: string
  lineNumber: number
  productId: string | null
  name: string | null
  quantity: string
  unitPrice: string
  amount: string
  sourceSnapshot: Record<string, unknown> | null
}

type ShipmentSalesAllocationItem = {
  id: string
  salesOrderId: string
  salesOrderNumber: string | null
  salesOrderLineId: string
  catalogProductId: string
  productTitle?: string | null
  productSku?: string | null
  quantity: string
  unitPrice: string | null
  currencyCode: string | null
  shipmentId: string | null
}

type IdPayload = { id?: string }

test.describe.serial('trade_docs — commercial invoices', () => {
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

  let catalogProductId: string | null = null
  let productId: string | null = null
  let supplierId: string | null = null
  let purchaseOrderId: string | null = null
  let purchaseOrderLineId: string | null = null
  let salesOrderAId: string | null = null
  let salesOrderBId: string | null = null
  let salesOrderLineAId: string | null = null
  let salesOrderLineBId: string | null = null

  let shipmentWithSalesId: string | null = null
  let shipmentPurchaseOnlyId: string | null = null
  let legacyExportDocumentId: string | null = null

  const createdDocumentIds: string[] = []

  const stamp = Date.now().toString(36)

  /** Every fixture/assertion call acts in the organization it selects, exactly like the backend UI. */
  const apiCall = (method: string, path: string, data?: unknown, orgId: string = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: orgId, data })

  // The installed `sales` routes refuse a write that carries no organization context, so the order
  // and its line are created through the same org-scoped helper as everything else.
  const createSaleOrder = async (currencyCode: string) => {
    const response = await apiRequestWithSelectedOrg(api, 'POST', '/api/sales/orders', {
      token: rootToken,
      selectedOrgId: hqOrgId,
      data: {
        currencyCode,
        lines: [
          { currencyCode, quantity: 1, name: `QA seed line ${Date.now()}`, unitPriceNet: 0, unitPriceGross: 0 },
        ],
      },
    })
    expect(response.ok(), `POST /api/sales/orders answered ${response.status()}`).toBeTruthy()
    const body = await readJsonSafe<IdPayload & { orderId?: string; item?: { id?: string } }>(response)
    const id = body?.id ?? body?.orderId ?? body?.item?.id ?? null
    expect(id, 'the created sales order id is reachable').toBeTruthy()
    return id as string
  }

  // `productId` is the app-owned product master id — the id space `cross_border` bridges into a
  // catalog product through `products_products.catalog_product_id`.
  const createSaleOrderLine = async (
    orderId: string,
    productId: string,
    currencyCode: string,
    quantity: string,
    unitPriceNet: string,
    catalogSnapshot: Record<string, unknown>,
  ) => {
    const response = await apiRequestWithSelectedOrg(api, 'POST', '/api/sales/order-lines', {
      token: rootToken,
      selectedOrgId: hqOrgId,
      data: {
        orderId,
        kind: 'product',
        productId,
        currencyCode,
        quantity,
        unitPriceNet,
        unitPriceGross: unitPriceNet,
        catalogSnapshot,
      },
    })
    expect(response.ok(), `POST /api/sales/order-lines answered ${response.status()}`).toBeTruthy()
    const body = await readJsonSafe<IdPayload & { item?: { id?: string } }>(response)
    const id = body?.id ?? body?.item?.id ?? null
    expect(id, 'the created sales order line id is reachable').toBeTruthy()
    return id as string
  }

  const createDocument = async (payload: Record<string, unknown>, orgId: string = hqOrgId) => {
    const response = await apiCall('POST', '/api/trade_docs/documents', payload, orgId)
    expect(response.status(), 'POST /api/trade_docs/documents should return 201').toBe(201)
    const created = await readJsonSafe<IdPayload>(response)
    expect(created?.id, 'the create response carries the document id').toBeTruthy()
    createdDocumentIds.push(created?.id as string)
    return created?.id as string
  }

  const loadDocument = async (id: string, orgId: string = hqOrgId) => {
    const response = await apiCall(
      'GET',
      `/api/trade_docs/documents?id=${encodeURIComponent(id)}&pageSize=1`,
      undefined,
      orgId,
    )
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<ListPayload<DocumentItem>>(response)
    return payload?.items?.find((item) => item.id === id) ?? null
  }

  const loadDocumentLines = async (documentId: string) => {
    const response = await apiCall(
      'GET',
      `/api/trade_docs/documents/lines?documentId=${encodeURIComponent(documentId)}&pageSize=100`,
    )
    expect(response.status(), 'GET /api/trade_docs/documents/lines should return 200').toBe(200)
    const payload = await readJsonSafe<ListPayload<DocumentLineItem>>(response)
    return payload?.items ?? []
  }

  const aggregateDocument = async (documentId: string) => {
    const response = await apiCall('POST', `/api/trade_docs/documents/${documentId}/aggregate-lines`, {})
    expect(response.status(), 'POST aggregate-lines should succeed').toBe(200)
    return readJsonSafe<{ ok?: boolean; lineCount?: number }>(response)
  }

  const loadSalesAllocations = async (shipmentId: string) => {
    const response = await apiCall(
      'GET',
      `/api/cross_border/shipments/sales-allocations?shipmentId=${encodeURIComponent(shipmentId)}&pageSize=100`,
    )
    expect(response.status(), 'GET /api/cross_border/shipments/sales-allocations should return 200').toBe(200)
    const payload = await readJsonSafe<ListPayload<ShipmentSalesAllocationItem>>(response)
    return payload?.items ?? []
  }

  /**
   * The allocation list is a plain CRUD collection: the shipment command invalidates it, so the
   * first read after a write is already fresh. The retry loop is a safety margin for the eventual
   * consistency of other projections, not a substitute for that invalidation.
   */
  const waitForSalesAllocations = async (
    shipmentId: string,
    expectedCount: number,
    timeoutMs = 8000,
  ): Promise<ShipmentSalesAllocationItem[]> => {
    const deadline = Date.now() + timeoutMs
    let rows = await loadSalesAllocations(shipmentId)
    while (rows.length !== expectedCount && Date.now() < deadline) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 250)
      await promise
      rows = await loadSalesAllocations(shipmentId)
    }
    return rows
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
      name: `CI docs E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `CI docs staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: DOCUMENT_FEATURES })
    const staffEmail = `ci-docs-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'CI docs staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    viewerRoleId = await createRoleFixture(api, rootToken, { name: `CI docs viewer ${stamp}`, tenantId })
    const viewerEmail = `ci-docs-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'CI docs viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)

    // One action creates the catalog product and its default variant; the returned id is the
    // catalog product id that sales/purchase lines, allocations and the CI all reference.
    const productSku = `CI-E2E-${stamp}`.toUpperCase()
    const product = await apiCall('POST', '/api/products/items', {
      sku: productSku,
      name: `CI E2E product ${stamp}`,
      unit: 'PCS',
    })
    expect(product.status(), 'POST /api/products/items should return 201').toBe(201)
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    catalogProductId = productId
    expect(productId).toBeTruthy()

    const supplier = await apiCall('POST', '/api/purchasing/suppliers', {
      name: `CI E2E supplier ${stamp}`,
      code: `CI-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), 'POST /api/purchasing/suppliers should return 201').toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const order = await apiCall('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 20, unitPrice: 100, taxRate: 0, priceIncludesTax: true }],
    })
    expect(order.status(), 'POST /api/purchasing/purchase-orders should return 201').toBe(201)
    purchaseOrderId = String((await readJsonSafe<IdPayload>(order))?.id ?? '')
    expect(purchaseOrderId).toBeTruthy()

    // Only a committed order may be shipped: the allocation guard refuses a draft.
    const placed = await apiCall('POST', '/api/purchasing/purchase-orders/transitions', {
      id: purchaseOrderId,
      action: 'place',
    })
    expect(placed.status(), 'placing the purchase order should succeed').toBeGreaterThanOrEqual(200)
    expect(placed.status()).toBeLessThan(300)

    const lines = await apiCall(
      'GET',
      `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}`,
    )
    expect(lines.status()).toBe(200)
    purchaseOrderLineId = String(
      (await readJsonSafe<ListPayload<{ id: string }>>(lines))?.items?.[0]?.id ?? '',
    )
    expect(purchaseOrderLineId).toBeTruthy()

    // Two internal sales orders, each with one line for the bridged product: one shipment may carry
    // goods ordered on several of them.
    salesOrderAId = await createSaleOrder('USD')
    salesOrderLineAId = await createSaleOrderLine(salesOrderAId, productId as string, 'USD', '10', '12.5', {
      title: `CI E2E product A ${stamp}`,
      sku: productSku,
    })
    salesOrderBId = await createSaleOrder('USD')
    salesOrderLineBId = await createSaleOrderLine(salesOrderBId, productId as string, 'USD', '10', '30', {
      title: `CI E2E product B ${stamp}`,
      sku: productSku,
    })
  })

  test.afterAll(async () => {
    for (const id of createdDocumentIds) {
      await apiCall('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (legacyExportDocumentId) {
      await apiCall(
        'DELETE',
        `/api/cross_border/shipments/documents?id=${encodeURIComponent(legacyExportDocumentId)}`,
      ).catch(() => undefined)
    }
    for (const id of [shipmentWithSalesId, shipmentPurchaseOnlyId]) {
      if (!id) continue
      await apiCall('DELETE', `/api/cross_border/shipments?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (purchaseOrderId) {
      await apiCall(
        'DELETE',
        `/api/purchasing/purchase-orders?id=${encodeURIComponent(purchaseOrderId)}`,
      ).catch(() => undefined)
    }
    if (supplierId) {
      await apiCall('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    }
    for (const id of [salesOrderAId, salesOrderBId]) {
      if (!id) continue
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/sales/orders?id=${encodeURIComponent(id)}`, {
        token: rootToken,
        selectedOrgId: hqOrgId,
      }).catch(() => undefined)
    }
    if (productId) {
      await apiCall('DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    }
    if (catalogProductId) {
      await apiRequestWithSelectedOrg(
        api,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`,
        { token: rootToken, selectedOrgId: hqOrgId },
      ).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteUserIfExists(api, rootToken, viewerUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteRoleIfExists(api, rootToken, viewerRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  // ---------------------------------------------------------------------------------------------
  // TEST-008 — shipment ↔ internal sales order allocations
  // ---------------------------------------------------------------------------------------------

  test('TEST-008: carries sales allocations for two sales orders and replaces the set on update', async () => {
    expect(catalogProductId).toBeTruthy()
    const response = await apiCall('POST', '/api/cross_border/shipments', {
      containerNumber: `E2E-${stamp.toUpperCase()}`,
      allocations: [{ purchaseOrderLineId, quantity: 5 }],
      salesAllocations: [
        {
          salesOrderId: salesOrderAId,
          salesOrderLineId: salesOrderLineAId,
          catalogProductId,
          quantity: 4,
          unitPrice: '12.5',
          currencyCode: 'USD',
        },
        {
          salesOrderId: salesOrderBId,
          salesOrderLineId: salesOrderLineBId,
          catalogProductId,
          quantity: 6,
          unitPrice: '31.25',
          currencyCode: 'USD',
        },
      ],
    })
    const shipmentBody = await response.text()
    expect(
      response.status(),
      `POST /api/cross_border/shipments answered ${response.status()}: ${shipmentBody.slice(0, 400)}`,
    ).toBe(201)
    shipmentWithSalesId = String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    expect(shipmentWithSalesId).toBeTruthy()

    const rows = await waitForSalesAllocations(shipmentWithSalesId as string, 2)
    expect(rows, 'one row per sales allocation written').toHaveLength(2)

    const rowA = rows.find((row) => row.salesOrderLineId === salesOrderLineAId)
    const rowB = rows.find((row) => row.salesOrderLineId === salesOrderLineBId)
    expect(rowA, 'the first sales order line is allocated').toBeTruthy()
    expect(rowB, 'the second sales order line is allocated').toBeTruthy()
    expect(rowA?.shipmentId).toBe(shipmentWithSalesId)
    expect(rowB?.shipmentId).toBe(shipmentWithSalesId)
    expect(rowA?.salesOrderId).toBe(salesOrderAId)
    expect(rowB?.salesOrderId).toBe(salesOrderBId)
    expect(rowA?.catalogProductId).toBe(catalogProductId)
    expect(rowB?.catalogProductId).toBe(catalogProductId)
    // The display copy the line was raised with travels with the allocation.
    expect(rowA?.productTitle).toBeTruthy()
    expect(rowB?.productTitle).toBeTruthy()

    // Quantities and the frozen price/currency snapshots survive the round trip — one container may
    // carry goods ordered on several sales orders, each at its own internal price.
    expect(Number(rowA?.quantity)).toBe(4)
    expect(Number(rowA?.unitPrice)).toBe(12.5)
    expect(rowA?.currencyCode).toBe('USD')
    expect(Number(rowB?.quantity)).toBe(6)
    expect(Number(rowB?.unitPrice)).toBe(31.25)
    expect(rowB?.currencyCode).toBe('USD')

    // The sales order number is resolved from the line's own order, and the two rows belong to
    // different orders.
    expect(rowA?.salesOrderNumber, 'the sales order number is snapshotted').toBeTruthy()
    expect(rowB?.salesOrderNumber, 'the sales order number is snapshotted').toBeTruthy()
    expect(rowA?.salesOrderNumber).not.toBe(rowB?.salesOrderNumber)

    // An update replaces the whole set rather than appending to it.
    const replaced = await apiCall('PUT', '/api/cross_border/shipments', {
      id: shipmentWithSalesId,
      salesAllocations: [
        {
          salesOrderId: salesOrderAId,
          salesOrderLineId: salesOrderLineAId,
          catalogProductId,
          quantity: 4,
          unitPrice: '12.5',
          currencyCode: 'USD',
        },
      ],
    })
    expect(replaced.status(), 'PUT /api/cross_border/shipments should return 200').toBe(200)

    const afterReplace = await waitForSalesAllocations(shipmentWithSalesId as string, 1)
    expect(
      afterReplace,
      `the stored set now holds exactly the one row that was sent: ${JSON.stringify(afterReplace)}`,
    ).toHaveLength(1)
    expect(afterReplace[0]?.salesOrderLineId).toBe(salesOrderLineAId)
    expect(Number(afterReplace[0]?.quantity)).toBe(4)
  })

  // ---------------------------------------------------------------------------------------------
  // TEST-004 — aggregation: sales allocations first, purchase allocations as the fallback
  // ---------------------------------------------------------------------------------------------

  test('TEST-004: aggregates one line per sales allocation and re-running replaces the set', async () => {
    // TEST-008 left the shipment holding one allocation; put the two-order set back so the roll-up
    // is exercised with one line per allocation across two different sales orders.
    const restored = await apiCall('PUT', '/api/cross_border/shipments', {
      id: shipmentWithSalesId,
      salesAllocations: [
        {
          salesOrderId: salesOrderAId,
          salesOrderLineId: salesOrderLineAId,
          catalogProductId,
          quantity: 4,
          unitPrice: '12.5',
          currencyCode: 'USD',
        },
        {
          salesOrderId: salesOrderBId,
          salesOrderLineId: salesOrderLineBId,
          catalogProductId,
          quantity: 6,
          unitPrice: '31.25',
          currencyCode: 'USD',
        },
      ],
    })
    expect(restored.status(), 'restoring both allocations should succeed').toBe(200)
    expect(await loadSalesAllocations(shipmentWithSalesId as string)).toHaveLength(2)

    const documentId = await createDocument({
      kind: 'commercial',
      direction: 'sales',
      sourceKind: 'shipment',
      sourceId: shipmentWithSalesId,
      counterpartySnapshot: { name: `CI buyer ${stamp}` },
      consigneeSnapshot: { name: `CI consignee ${stamp}`, countryCode: 'US' },
      notifyPartySnapshot: { name: `CI notify party ${stamp}` },
      currencyCode: 'USD',
      incoterms: 'FOB',
    })

    const draft = await loadDocument(documentId)
    expect(draft?.kind).toBe('commercial')
    expect(draft?.status).toBe('draft')
    expect(draft?.sourceKind).toBe('shipment')
    expect(draft?.sourceId).toBe(shipmentWithSalesId)

    const aggregated = await aggregateDocument(documentId)
    expect(aggregated?.ok).toBe(true)
    expect(aggregated?.lineCount, 'one line per sales allocation of the shipment').toBe(2)

    const lines = await loadDocumentLines(documentId)
    expect(lines, 'one line for each allocation the shipment carries').toHaveLength(2)
    expect(lines.map((line) => Number(line.quantity)).sort((a, b) => a - b)).toEqual([4, 6])
    expect(lines.every((line) => line.sourceSnapshot?.kind === 'sales_allocation')).toBe(true)
    // The price and quantity default to the frozen allocation snapshot the line also records.
    const lineForFour = lines.find((line) => Number(line.sourceSnapshot?.quantity) === 4)
    const lineForSix = lines.find((line) => Number(line.sourceSnapshot?.quantity) === 6)
    expect(lineForFour?.id).toBeTruthy()
    expect(lineForSix?.id).toBeTruthy()
    expect(Number(lineForFour?.unitPrice)).toBe(12.5)
    expect(Number(lineForSix?.unitPrice)).toBe(31.25)

    // Rerunning copies the set again: same count, no duplicate rows.
    const rerun = await aggregateDocument(documentId)
    expect(rerun?.lineCount).toBe(2)
    const rerunLines = await loadDocumentLines(documentId)
    expect(rerunLines, 'a rerun replaces the lines instead of appending them').toHaveLength(2)
    expect(rerunLines.map((line) => Number(line.quantity)).sort((a, b) => a - b)).toEqual([4, 6])
    expect(new Set(rerunLines.map((line) => line.lineNumber)).size).toBe(2)
    expect(rerunLines.every((line) => line.sourceSnapshot?.kind === 'sales_allocation')).toBe(true)
  })

  test('TEST-004: a shipment with no sales allocation aggregates from the purchase side', async () => {
    const response = await apiCall('POST', '/api/cross_border/shipments', {
      containerNumber: `E2E-PO-${stamp.toUpperCase()}`,
      allocations: [{ purchaseOrderLineId, quantity: 5 }],
    })
    const shipmentBody = await response.text()
    expect(
      response.status(),
      `POST /api/cross_border/shipments answered ${response.status()}: ${shipmentBody.slice(0, 400)}`,
    ).toBe(201)
    shipmentPurchaseOnlyId = String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    expect(shipmentPurchaseOnlyId).toBeTruthy()
    expect(await loadSalesAllocations(shipmentPurchaseOnlyId as string), 'no sales allocation was written').toHaveLength(0)

    const documentId = await createDocument({
      kind: 'commercial',
      direction: 'sales',
      sourceKind: 'shipment',
      sourceId: shipmentPurchaseOnlyId,
      counterpartySnapshot: { name: `CI pre-customs buyer ${stamp}` },
      consigneeSnapshot: { name: `CI pre-customs consignee ${stamp}` },
      currencyCode: 'CNY',
    })

    const aggregated = await aggregateDocument(documentId)
    expect(aggregated?.lineCount, 'the only purchase allocation becomes one line').toBe(1)

    const lines = await loadDocumentLines(documentId)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.sourceSnapshot?.kind).toBe('purchase_allocation')
    expect(lines[0]?.sourceSnapshot?.purchaseOrderLineId).toBe(purchaseOrderLineId)
    expect(Number(lines[0]?.quantity)).toBe(5)
  })

  // ---------------------------------------------------------------------------------------------
  // TEST-005 — a CI with no shipment at all, and the legacy `commercial_invoice` slot
  // ---------------------------------------------------------------------------------------------

  test('TEST-005: a CI without a shipment runs the full lifecycle and downloads its XLSX', async () => {
    const documentId = await createDocument({
      kind: 'commercial',
      direction: 'sales',
      counterpartySnapshot: { name: `Manual CI buyer ${stamp}` },
      consigneeSnapshot: { name: `Manual CI consignee ${stamp}` },
      notifyPartySnapshot: { name: `Manual CI notify party ${stamp}` },
      currencyCode: 'USD',
      incoterms: 'CIF',
      lines: [
        { name: 'Manual line A', quantity: '2', unitPrice: '9.5' },
        { name: 'Manual line B', quantity: '1', unitPrice: '40' },
      ],
    })

    const draft = await loadDocument(documentId)
    expect(draft?.status).toBe('draft')
    expect(draft?.sourceKind ?? null, 'a pre-customs CI needs no shipment').toBeNull()
    expect(draft?.total).toBe('59.00')

    const issued = await apiCall('POST', '/api/trade_docs/documents/transitions', { id: documentId, action: 'issue' })
    expect(issued.status(), 'issuing the CI should succeed').toBeGreaterThanOrEqual(200)
    expect(issued.status()).toBeLessThan(300)
    const issuedBody = await readJsonSafe<{ status?: string; number?: string | null }>(issued)
    expect(issuedBody?.status).toBe('issued')
    expect(issuedBody?.number).toMatch(new RegExp(`^CI-${new Date().getFullYear()}-\\d{4}$`))

    const generate = await apiCall('POST', `/api/trade_docs/documents/${documentId}/generate`, {})
    expect(generate.status(), 'POST generate should return 200').toBe(200)
    const generated = await readJsonSafe<{ attachmentId?: string; fileName?: string }>(generate)
    expect(generated?.attachmentId, 'the generated file is persisted on the document').toBeTruthy()
    expect(generated?.fileName).toContain('.xlsx')

    const download = await apiCall('GET', `/api/trade_docs/documents/${documentId}/document`)
    expect(download.status(), 'GET document should stream the generated file').toBe(200)
    expect(download.headers()['content-type']).toContain(XLSX_CONTENT_TYPE)
    expect((await download.body()).byteLength).toBeGreaterThan(1000)
  })

  test('TEST-005: the legacy commercial_invoice slot still accepts and lists a row', async () => {
    expect(shipmentPurchaseOnlyId).toBeTruthy()
    const created = await apiCall('POST', '/api/cross_border/shipments/documents', {
      shipmentId: shipmentPurchaseOnlyId,
      docType: 'commercial_invoice',
      documentNumber: `CI-LEGACY-${stamp.toUpperCase()}`,
    })
    expect(created.status(), 'POST /api/cross_border/shipments/documents should return 201').toBe(201)
    legacyExportDocumentId = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    expect(legacyExportDocumentId).toBeTruthy()

    const list = await apiCall(
      'GET',
      `/api/cross_border/shipments/documents?shipmentId=${encodeURIComponent(
        shipmentPurchaseOnlyId as string,
      )}&docType=commercial_invoice&pageSize=100`,
    )
    expect(list.status()).toBe(200)
    const items = (await readJsonSafe<ListPayload<{ id: string; docType: string }>>(list))?.items ?? []
    const row = items.find((item) => item.id === legacyExportDocumentId)
    expect(row, 'the legacy export document type is still listed for the shipment').toBeTruthy()
    expect(row?.docType).toBe('commercial_invoice')
  })

  // ---------------------------------------------------------------------------------------------
  // Scope and permissions
  // ---------------------------------------------------------------------------------------------

  test('keeps a CI inside its organization', async () => {
    const inBranch = await apiCall(
      'GET',
      '/api/trade_docs/documents?kind=commercial&pageSize=100',
      undefined,
      branchOrgId as string,
    )
    expect(inBranch.status()).toBe(200)
    const ids = ((await readJsonSafe<ListPayload<DocumentItem>>(inBranch))?.items ?? []).map((item) => item.id)
    expect(ids, 'the branch list never contains an HQ commercial invoice').not.toContain(createdDocumentIds[0])

    const crossScope = await loadDocument(createdDocumentIds[0], branchOrgId as string)
    expect(crossScope, "reading another organization's CI by id yields nothing").toBeNull()
  })

  test('denies a caller without the feature and allows one holding it', async () => {
    const deniedList = await apiRequestWithSelectedOrg(api, 'GET', '/api/trade_docs/documents?kind=commercial', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
    })
    expect(deniedList.status(), 'a caller without trade_docs.documents.view is denied').toBe(403)

    const deniedAggregate = await apiRequestWithSelectedOrg(
      api,
      'POST',
      `/api/trade_docs/documents/${createdDocumentIds[0]}/aggregate-lines`,
      { token: viewerToken, selectedOrgId: hqOrgId, data: {} },
    )
    expect(deniedAggregate.status(), 'a caller without trade_docs.documents.manage is denied').toBe(403)

    const allowed = await apiRequestWithSelectedOrg(api, 'GET', '/api/trade_docs/documents?kind=commercial', {
      token: staffToken,
      selectedOrgId: hqOrgId,
    })
    expect(allowed.status(), 'a caller holding the feature is allowed').toBe(200)
    const ids = ((await readJsonSafe<ListPayload<DocumentItem>>(allowed))?.items ?? []).map((item) => item.id)
    expect(ids).toContain(createdDocumentIds[0])
  })
})
