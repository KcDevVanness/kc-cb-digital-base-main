import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The one-shot copy flow (`.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`, J-004 / REQ-011 /
 * TEST-011): a PI is copied into a CI, a CI into a tax invoice — once, with the source kept as a
 * link, and never as a live sync.
 *
 * The reads use the plain list URLs on purpose: with `ENABLE_CRUD_API_CACHE` on, a command that
 * rewrote a collection has to invalidate it, and a cache-busting parameter would hide a regression
 * in exactly that behaviour.
 */
type DocumentItem = {
  id: string
  status: string
  number: string | null
  currencyCode: string
  total: string
  sourceKind?: string | null
  sourceId?: string | null
  incoterms?: string | null
  paymentTerms?: string | null
  counterpartySnapshot?: Record<string, unknown> | null
}

type LineItem = {
  id: string
  name?: string | null
  description?: string | null
  quantity: string
  unitPrice: string
  amount: string
  taxRate?: string
  sourceSnapshot?: Record<string, unknown> | null
}

test.describe.serial('trade_docs — one-shot copy flow', () => {
  let api: APIRequestContext
  let token = ''
  let orgId = ''
  let branchOrgId: string | null = null
  let piId: string | null = null
  let branchDocumentId: string | null = null
  const documentIds: string[] = []
  const invoiceIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown, org: string = orgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: org, data })

  const readDocument = async (id: string, org: string = orgId): Promise<DocumentItem | null> => {
    const response = await scoped('GET', `/api/trade_docs/documents?id=${encodeURIComponent(id)}&pageSize=1`, undefined, org)
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<{ items?: DocumentItem[] }>(response)
    return payload?.items?.find((item) => item.id === id) ?? null
  }

  const readDocumentLines = async (id: string): Promise<LineItem[]> => {
    const response = await scoped('GET', `/api/trade_docs/documents/lines?documentId=${encodeURIComponent(id)}&pageSize=50`)
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<{ items?: LineItem[] }>(response)
    return payload?.items ?? []
  }

  const readInvoiceLines = async (id: string): Promise<LineItem[]> => {
    const response = await scoped('GET', `/api/trade_docs/invoices/lines?invoiceId=${encodeURIComponent(id)}&pageSize=50`)
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<{ items?: LineItem[] }>(response)
    return payload?.items ?? []
  }

  const createDocument = async (payload: Record<string, unknown>, org: string = orgId) => {
    const response = await scoped('POST', '/api/trade_docs/documents', payload, org)
    const body = await response.text()
    expect(response.status(), `POST /api/trade_docs/documents answered ${response.status()}: ${body.slice(0, 300)}`).toBe(201)
    const id = (JSON.parse(body) as { id?: string }).id as string
    documentIds.push(id)
    return id
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    token = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(token)
    orgId = scope.organizationId
    branchOrgId = await createOrganizationFixture(api, token, {
      name: `Copy flow E2E branch ${Date.now().toString(36)}`,
      tenantId: scope.tenantId,
      parentId: orgId,
    }).catch(() => null)

    // An issued PI is the realistic source: the flow copies a *sent* document into the next one.
    piId = await createDocument({
      kind: 'proforma',
      direction: 'sales',
      counterpartySnapshot: { name: 'Copy flow buyer' },
      ourPartySnapshot: { name: 'KC HQ', accountNumber: '40702810000000000001' },
      currencyCode: 'USD',
      paymentTerms: '30% deposit',
      incoterms: 'FOB',
      lines: [
        { name: 'Copied line A', quantity: '2', unitPrice: '10', amount: '20' },
        { name: 'Copied line B', quantity: '3', unitPrice: '30', amount: '90' },
      ],
    })
    const issued = await scoped('POST', '/api/trade_docs/documents/transitions', { id: piId, action: 'issue' })
    expect(issued.status(), 'the source PI is issued').toBeLessThan(300)
  })

  test.afterAll(async () => {
    for (const id of documentIds) {
      await scoped('POST', '/api/trade_docs/documents/transitions', { id, action: 'void', reason: 'e2e cleanup' }).catch(() => undefined)
      await scoped('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of invoiceIds) {
      await scoped('POST', '/api/trade_docs/invoices/transitions', { id, action: 'void', reason: 'e2e cleanup' }).catch(() => undefined)
      await scoped('DELETE', `/api/trade_docs/invoices?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteOrganizationIfExists(api, token, branchOrgId)
    await api.dispose()
  })

  test('copies an issued PI into a draft CI: head, lines, link — and copies nothing twice', async () => {
    const ciId = await createDocument({ kind: 'commercial', direction: 'sales', currencyCode: 'EUR' })

    const copy = await scoped('POST', `/api/trade_docs/documents/${ciId}/copy-from`, { sourceDocumentId: piId })
    expect(copy.status(), `copy-from answered ${copy.status()}`).toBe(200)

    const ci = await readDocument(ciId)
    const source = await readDocument(piId as string)
    expect(ci?.currencyCode, 'the head currency travels with the copy').toBe('USD')
    expect(ci?.paymentTerms).toBe('30% deposit')
    expect(ci?.incoterms).toBe('FOB')
    expect(ci?.counterpartySnapshot).toEqual({ name: 'Copy flow buyer' })
    expect(ci?.sourceKind, 'the target keeps a link to the document it came from').toBe('trade_document')
    expect(ci?.sourceId).toBe(piId)
    expect(ci?.total, 'the head total is recomputed from the copied lines').toBe(source?.total)

    const lines = await readDocumentLines(ciId)
    expect(lines, 'both source lines were copied').toHaveLength(2)
    expect(lines.map((line) => Number(line.quantity)).sort()).toEqual([2, 3])
    expect(lines.every((line) => (line.sourceSnapshot as { kind?: string } | null)?.kind === 'trade_document')).toBe(true)

    // The copy is a snapshot: editing the copy must not touch the source, and re-running must not
    // duplicate rows.
    const rerun = await scoped('POST', `/api/trade_docs/documents/${ciId}/copy-from`, { sourceDocumentId: piId })
    expect(rerun.status()).toBe(200)
    expect(await readDocumentLines(ciId), 're-running replaces, never appends').toHaveLength(2)

    const sourceAfter = await readDocumentLines(piId as string)
    expect(sourceAfter, 'the source document keeps its own lines').toHaveLength(2)
  })

  test('refuses to overwrite an issued CI and a foreign document', async () => {
    const issuedCi = await createDocument({
      kind: 'commercial',
      direction: 'sales',
      counterpartySnapshot: { name: 'Already issued' },
      lines: [{ name: 'x', quantity: '1', unitPrice: '1' }],
    })
    await scoped('POST', '/api/trade_docs/documents/transitions', { id: issuedCi, action: 'issue' })
    const denied = await scoped('POST', `/api/trade_docs/documents/${issuedCi}/copy-from`, { sourceDocumentId: piId })
    expect(denied.status(), 'an issued document is frozen').toBeGreaterThanOrEqual(400)
    expect(denied.status()).toBeLessThan(500)

    if (branchOrgId) {
      branchDocumentId = await createDocument(
        {
          kind: 'proforma',
          direction: 'sales',
          counterpartySnapshot: { name: 'Other org document' },
          lines: [{ name: 'y', quantity: '1', unitPrice: '1' }],
        },
        branchOrgId,
      )
      const foreign = await scoped('POST', `/api/trade_docs/documents/${issuedCi}/copy-from`, {
        sourceDocumentId: branchDocumentId,
      })
      expect(foreign.status(), 'a document of another organization is not a copy source').toBeGreaterThanOrEqual(400)
    }
  })

  test('copies a CI into a draft tax invoice with the invoice defaults intact', async () => {
    const ciId = await createDocument({
      kind: 'commercial',
      direction: 'sales',
      counterpartySnapshot: { name: 'Invoice copy buyer' },
      currencyCode: 'USD',
      lines: [
        { name: 'Invoice line A', quantity: '4', unitPrice: '12.5', amount: '50' },
        { name: 'Invoice line B', quantity: '1', unitPrice: '30', amount: '30' },
      ],
    })

    const invoiceResponse = await scoped('POST', '/api/trade_docs/invoices', {
      direction: 'outbound',
      invoiceKind: 'vat_general',
      currencyCode: 'CNY',
      lines: [{ description: 'placeholder', quantity: '1', unitPrice: '0', amount: '0' }],
    })
    expect(invoiceResponse.status(), 'the target invoice is created first').toBe(201)
    const invoiceId = String((await readJsonSafe<{ id?: string }>(invoiceResponse))?.id ?? '')
    invoiceIds.push(invoiceId)

    const copy = await scoped('POST', `/api/trade_docs/invoices/${invoiceId}/copy-from`, { sourceDocumentId: ciId })
    expect(copy.status(), `invoice copy-from answered ${copy.status()}`).toBe(200)

    const lines = await readInvoiceLines(invoiceId)
    expect(lines, 'the invoice lines replace the placeholder').toHaveLength(2)
    expect(lines.map((line) => line.description).sort()).toEqual(['Invoice line A', 'Invoice line B'])
    expect(lines.every((line) => Number(line.taxRate ?? 0) === 0), 'a CI carries no VAT rate').toBe(true)

    const read = await scoped(
      'GET',
      `/api/trade_docs/invoices?id=${encodeURIComponent(invoiceId)}&pageSize=1`,
    )
    const invoice = (await readJsonSafe<{ items?: Array<{ total?: string; taxTotal?: string; sourceKind?: string | null; sourceId?: string | null }> }>(read))?.items?.[0]
    expect(invoice?.sourceKind, 'the invoice links back to the commercial invoice').toBe('trade_document')
    expect(invoice?.sourceId).toBe(ciId)
    expect(invoice?.total, 'the invoice head is recomputed from the copied lines').toBe('80.00')
    expect(invoice?.taxTotal).toBe('0.00')
  })

  test('rejects an unauthenticated copy and a malformed payload', async () => {
    const anonymous = await apiRequest(api, 'POST', '/api/trade_docs/documents/00000000-0000-4000-8000-000000000000/copy-from', {
      token: 'not-a-real-token',
      data: { sourceDocumentId: piId },
    })
    expect(anonymous.status()).toBe(401)

    const malformed = await scoped('POST', `/api/trade_docs/documents/${documentIds[0]}/copy-from`, { sourceDocumentId: 'not-a-uuid' })
    expect(malformed.status()).toBeGreaterThanOrEqual(400)
  })
})
