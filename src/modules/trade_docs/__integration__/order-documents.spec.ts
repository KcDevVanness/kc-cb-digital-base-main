import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The sales order's own documents dimension (`trade_docs_order_documents`, module `trade_docs`).
 *
 * Covers the five rules the link set depends on:
 * 1. a replace-all POST writes the whole set and the read returns each row with the number frozen
 *    at link time;
 * 2. a second POST with a smaller set drops what is not in it (replace, not merge);
 * 3. both sides of a link are resolved inside the caller's scope — an order or a document of
 *    another organization answers 422 instead of being linked;
 * 4. a document created with `?orderKind=&orderId=` records its link in the same transaction, so
 *    the hub sees it without a second write;
 * 5. deleting the document drops the link (there is no foreign key — the link is polymorphic).
 *
 * A stale `orderUpdatedAt` is pinned too: the set is edited as one aggregate, so a dialog built on
 * an order someone else changed must 409 rather than overwrite.
 */
const DOCUMENT_FEATURES = [
  'trade_docs.documents.view',
  'trade_docs.documents.manage',
  'trade_docs.contracts.view',
  'trade_docs.contracts.manage',
]
const ORDER_LINK_KIND = 'internal_sales_order'

type IdPayload = { id?: string; item?: { id?: string }; orderId?: string; number?: string | null }
type ListPayload<T> = { items?: T[]; total?: number }

type OrderDocumentItem = {
  id: string
  orderKind: string
  orderId: string
  orderNumber?: string | null
  documentKind: string
  documentId: string
  documentNumber?: string | null
}

test.describe.serial('trade_docs — order document links', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let salesOrderId = ''
  let branchSalesOrderId = ''
  let proformaId = ''
  let proformaNumber: string | null = null
  let invoiceId = ''
  let branchDocumentId = ''
  const createdDocumentIds: string[] = []
  const stamp = Date.now().toString(36)

  const apiCall = (method: string, path: string, data?: unknown, orgId: string = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: orgId, data })

  const createDocument = async (
    payload: Record<string, unknown>,
    orgId: string = hqOrgId,
  ): Promise<string> => {
    const response = await apiCall(
      'POST',
      '/api/trade_docs/documents',
      {
        kind: 'proforma',
        direction: 'sales',
        counterpartySnapshot: { name: `Order docs buyer ${stamp}` },
        currencyCode: 'CNY',
        lines: [],
        ...payload,
      },
      orgId,
    )
    expect(response.status(), `POST /api/trade_docs/documents answered ${response.status()}`).toBe(201)
    const id = String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    expect(id).toBeTruthy()
    createdDocumentIds.push(id)
    return id
  }

  const createSalesOrder = async (orgId: string = hqOrgId): Promise<string> => {
    const response = await apiRequestWithSelectedOrg(api, 'POST', '/api/sales/orders', {
      token: rootToken,
      selectedOrgId: orgId,
      data: {
        currencyCode: 'CNY',
        lines: [
          { currencyCode: 'CNY', quantity: 1, name: `Order docs line ${stamp}`, unitPriceNet: 5, unitPriceGross: 5 },
        ],
      },
    })
    expect(response.ok(), `POST /api/sales/orders answered ${response.status()}`).toBeTruthy()
    const body = await readJsonSafe<IdPayload>(response)
    const id = String(body?.id ?? body?.orderId ?? body?.item?.id ?? '')
    expect(id, 'the created sales order id is reachable').toBeTruthy()
    return id
  }

  const replaceDocuments = (
    rows: Array<{ documentKind: string; documentId: string }>,
    options: { orderId?: string; orderUpdatedAt?: string; orgId?: string } = {},
  ) =>
    apiCall(
      'POST',
      '/api/trade_docs/orders/documents',
      {
        orderKind: ORDER_LINK_KIND,
        orderId: options.orderId ?? salesOrderId,
        rows,
        ...(options.orderUpdatedAt ? { orderUpdatedAt: options.orderUpdatedAt } : {}),
      },
      options.orgId ?? hqOrgId,
    )

  const loadLinks = async (orderId: string = salesOrderId, orgId: string = hqOrgId) => {
    const response = await apiCall(
      'GET',
      `/api/trade_docs/orders/documents?orderKind=${ORDER_LINK_KIND}&orderId=${encodeURIComponent(orderId)}&pageSize=50`,
      undefined,
      orgId,
    )
    expect(response.status(), `GET /api/trade_docs/orders/documents answered ${response.status()}`).toBe(200)
    return (await readJsonSafe<ListPayload<OrderDocumentItem>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `TD order docs branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    salesOrderId = await createSalesOrder()
    branchSalesOrderId = await createSalesOrder(branchOrgId)

    // Issued so the link freezes a real number: a draft PI carries none.
    proformaId = await createDocument({})
    const issued = await apiCall('POST', '/api/trade_docs/documents/transitions', {
      id: proformaId,
      action: 'issue',
    })
    expect([200, 201], `issuing the proforma answered ${issued.status()}`).toContain(issued.status())
    const issuedBody = await readJsonSafe<IdPayload>(issued)
    const loaded = await apiCall('GET', `/api/trade_docs/documents?ids=${encodeURIComponent(proformaId)}&pageSize=1`)
    const proformaRow = (await readJsonSafe<ListPayload<Record<string, unknown>>>(loaded))?.items?.[0] ?? {}
    proformaNumber = (issuedBody?.number ?? proformaRow.number ?? null) as string | null
    expect(proformaNumber, 'an issued proforma carries its number').toBeTruthy()

    const invoice = await apiCall('POST', '/api/trade_docs/invoices', {
      number: `TI-E2E-${stamp}`.toUpperCase(),
      direction: 'inbound',
      counterpartySnapshot: { name: `Order docs supplier ${stamp}` },
      currencyCode: 'CNY',
      lines: [],
    })
    expect(invoice.status(), `POST /api/trade_docs/invoices answered ${invoice.status()}`).toBe(201)
    invoiceId = String((await readJsonSafe<IdPayload>(invoice))?.id ?? '')
    expect(invoiceId).toBeTruthy()

    branchDocumentId = await createDocument(
      { counterpartySnapshot: { name: `Order docs branch buyer ${stamp}` } },
      branchOrgId,
    )
  })

  test.afterAll(async () => {
    for (const id of createdDocumentIds) {
      await apiCall('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (branchDocumentId) {
      await apiCall(
        'DELETE',
        `/api/trade_docs/documents?id=${encodeURIComponent(branchDocumentId)}`,
        undefined,
        branchOrgId ?? hqOrgId,
      ).catch(() => undefined)
    }
    if (invoiceId) {
      await apiCall('DELETE', `/api/trade_docs/invoices?id=${encodeURIComponent(invoiceId)}`).catch(() => undefined)
    }
    if (salesOrderId) {
      await apiCall('DELETE', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`).catch(() => undefined)
    }
    if (branchSalesOrderId) {
      await apiCall(
        'DELETE',
        `/api/sales/orders?id=${encodeURIComponent(branchSalesOrderId)}`,
        undefined,
        branchOrgId ?? hqOrgId,
      ).catch(() => undefined)
    }
    if (branchOrgId) await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('a replace-all writes the set and freezes each document number', async () => {
    const written = await replaceDocuments([
      { documentKind: 'proforma', documentId: proformaId },
      { documentKind: 'tax_invoice', documentId: invoiceId },
    ])
    expect([200, 201], `POST /api/trade_docs/orders/documents answered ${written.status()}`).toContain(written.status())

    const links = await loadLinks()
    expect(links.length).toBe(2)
    const proforma = links.find((row) => row.documentId === proformaId)
    const invoice = links.find((row) => row.documentId === invoiceId)
    expect(proforma?.documentKind).toBe('proforma')
    expect(proforma?.documentNumber).toBe(proformaNumber)
    expect(proforma?.orderId).toBe(salesOrderId)
    expect(proforma?.orderNumber, 'the link freezes the order number it was written against').toBeTruthy()
    expect(invoice?.documentKind).toBe('tax_invoice')
    expect(invoice?.documentNumber).toBe(`TI-E2E-${stamp}`.toUpperCase())
  })

  test('a second replace drops the rows it does not name', async () => {
    const written = await replaceDocuments([{ documentKind: 'tax_invoice', documentId: invoiceId }])
    expect([200, 201]).toContain(written.status())

    const links = await loadLinks()
    expect(links.map((row) => row.documentId)).toEqual([invoiceId])
  })

  test('a stale order version is refused instead of overwriting the set', async () => {
    const stale = await replaceDocuments(
      [{ documentKind: 'tax_invoice', documentId: invoiceId }],
      { orderUpdatedAt: '2000-01-01T00:00:00.000Z' },
    )
    expect(stale.status(), 'a version the order does not have must answer 409').toBe(409)
  })

  test('refuses an order and a document of another organization', async () => {
    const otherOrder = await replaceDocuments([{ documentKind: 'tax_invoice', documentId: invoiceId }], {
      orderId: branchSalesOrderId,
    })
    expect(otherOrder.status()).toBe(422)
    expect((await readJsonSafe<{ error?: string }>(otherOrder))?.error).toBe('order_document_link_order_not_found')

    const otherDocument = await replaceDocuments([{ documentKind: 'proforma', documentId: branchDocumentId }])
    expect(otherDocument.status()).toBe(422)
    expect((await readJsonSafe<{ error?: string }>(otherDocument))?.error).toBe('order_document_link_document_not_found')

    // The refused writes left the stored set alone.
    const links = await loadLinks()
    expect(links.map((row) => row.documentId)).toEqual([invoiceId])
  })

  test('a document created for the order records its own link, and deleting it drops the link', async () => {
    const linked = await createDocument({ orderKind: ORDER_LINK_KIND, orderId: salesOrderId })

    const afterCreate = await loadLinks()
    const created = afterCreate.find((row) => row.documentId === linked)
    expect(created, 'the create wrote the order link in the same transaction').toBeTruthy()
    expect(created?.documentKind).toBe('proforma')

    const removed = await apiCall('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(linked)}`)
    expect([200, 204], `DELETE answered ${removed.status()}`).toContain(removed.status())

    const afterDelete = await loadLinks()
    expect(afterDelete.some((row) => row.documentId === linked)).toBe(false)
    expect(afterDelete.map((row) => row.documentId)).toEqual([invoiceId])
  })
})
