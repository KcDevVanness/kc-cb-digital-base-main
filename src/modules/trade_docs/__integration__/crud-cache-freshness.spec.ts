import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The CRUD list cache must be invalidated by every write that changes a collection — including the
 * writes a *different* resource's command performs.
 *
 * The integration harness runs the app with `ENABLE_CRUD_API_CACHE=true`, so this suite is the
 * oracle for that contract: the platform only invalidates the resource a route itself owns, and an
 * invoice confirmation rewrites the contract's money columns, a shipment write rewrites its
 * allocation lists, and this module's `[id]/…` action routes (generate, aggregate, copy) bypass the
 * factory entirely. Before the commands named those collections, every read below answered the
 * pre-write payload until the TTL — the exact "edit the record, the list does not move" report.
 *
 * Every read here uses the **plain** URL it used before the write: a cache-busting parameter would
 * pass against a broken invalidation and hide the regression.
 */
type ListPayload<T> = { items?: T[]; total?: number }

test.describe.serial('crud cache — collections refresh after a write', () => {
  let api: APIRequestContext
  let token = ''
  let orgId = ''
  const documentIds: string[] = []
  const invoiceIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const createDocument = async (payload: Record<string, unknown>) => {
    const response = await scoped('POST', '/api/trade_docs/documents', payload)
    const body = await response.text()
    expect(response.status(), `POST /api/trade_docs/documents answered ${response.status()}: ${body.slice(0, 300)}`).toBe(201)
    const id = (JSON.parse(body) as { id?: string }).id as string
    documentIds.push(id)
    return id
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    token = await getAuthToken(api, 'superadmin')
    orgId = getTokenContext(token).organizationId
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
    await api.dispose()
  })

  test('the documents list shows an issue and a generated file on the same URL', async () => {
    const documentId = await createDocument({
      kind: 'proforma',
      direction: 'sales',
      currencyCode: 'CNY',
      counterpartySnapshot: { name: 'Cache oracle buyer' },
      lines: [{ name: 'Cache oracle line', quantity: '2', unitPrice: '5' }],
    })

    const listUrl = '/api/trade_docs/documents?kind=proforma&pageSize=50'
    const readItem = async () => {
      const response = await scoped('GET', listUrl)
      expect(response.status()).toBe(200)
      const payload = await readJsonSafe<ListPayload<{ id: string; status: string; generatedAttachmentId?: string | null }>>(response)
      return payload?.items?.find((item) => item.id === documentId) ?? null
    }

    // Warm the cache with the pre-write payload…
    const before = await readItem()
    expect(before?.status).toBe('draft')
    expect(before?.generatedAttachmentId ?? null).toBeNull()

    // …then issue and generate through the custom action routes, which never touch the factory.
    const issued = await scoped('POST', '/api/trade_docs/documents/transitions', { id: documentId, action: 'issue' })
    expect(issued.status()).toBeLessThan(300)
    const generated = await scoped('POST', `/api/trade_docs/documents/${documentId}/generate`, {})
    expect(generated.status(), `generate answered ${generated.status()}`).toBe(200)

    const after = await readItem()
    expect(after?.status, 'the list reflects the issued status on the same URL').toBe('issued')
    expect(Boolean(after?.generatedAttachmentId), 'the list reflects the generated attachment').toBe(true)
  })

  test('the contract list shows money rewritten by an invoice confirmation on the same URL', async () => {
    const contractResponse = await scoped('POST', '/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'supplier',
      counterpartySnapshot: { name: 'Cache oracle supplier' },
      currencyCode: 'CNY',
      lines: [{ name: 'Cache oracle contract line', quantity: '10', unitPrice: '100' }],
    })
    expect(contractResponse.status()).toBe(201)
    const contractId = String((await readJsonSafe<{ id?: string }>(contractResponse))?.id ?? '')

    const lineResponse = await scoped('GET', `/api/trade_docs/contracts/lines?contractId=${encodeURIComponent(contractId)}&pageSize=5`)
    const contractLineId = String(
      (await readJsonSafe<ListPayload<{ id: string }>>(lineResponse))?.items?.[0]?.id ?? '',
    )
    expect(contractLineId).toBeTruthy()

    const listUrl = `/api/trade_docs/contracts?id=${encodeURIComponent(contractId)}&pageSize=1`
    const readContract = async () => {
      const response = await scoped('GET', listUrl)
      expect(response.status()).toBe(200)
      const payload = await readJsonSafe<ListPayload<{ id: string; financeTotal: string }>>(response)
      return payload?.items?.find((item) => item.id === contractId) ?? null
    }

    // Warm the cache with the computed (pre-invoice) financial amount.
    const before = await readContract()
    const beforeFinance = before?.financeTotal

    const invoiceResponse = await scoped('POST', '/api/trade_docs/invoices', {
      direction: 'inbound',
      invoiceKind: 'vat_special',
      currencyCode: 'CNY',
      contractId,
      lines: [
        {
          description: 'Cache oracle invoice line',
          quantity: '1',
          unitPrice: '100',
          amount: '100',
          taxRate: '13',
          priceIncludesTax: false,
          contractLineId,
        },
      ],
    })
    expect(invoiceResponse.status()).toBe(201)
    const invoiceId = String((await readJsonSafe<{ id?: string }>(invoiceResponse))?.id ?? '')
    invoiceIds.push(invoiceId)

    const confirmed = await scoped('POST', '/api/trade_docs/invoices/transitions', { id: invoiceId, action: 'confirm' })
    expect(confirmed.status()).toBeLessThan(300)

    const after = await readContract()
    expect(
      after?.financeTotal,
      `the contract list reflects the confirmed invoice on the same URL (before=${String(beforeFinance)}, after=${String(after?.financeTotal)})`,
    ).not.toBe(beforeFinance)
    expect(after?.financeTotal).toBe('100.00')

    await scoped('DELETE', `/api/trade_docs/contracts?id=${encodeURIComponent(contractId)}`).catch(() => undefined)
  })

  test('a document action route refreshes the line collection it rewrote', async () => {
    const ciId = await createDocument({ kind: 'commercial', direction: 'sales', currencyCode: 'CNY' })
    const linesUrl = `/api/trade_docs/documents/lines?documentId=${encodeURIComponent(ciId)}&pageSize=50`

    const before = await scoped('GET', linesUrl)
    expect(((await readJsonSafe<ListPayload<{ id: string }>>(before))?.items ?? []).length).toBe(0)

    // The copy command replaces the line set through a custom route.
    const piId = await createDocument({
      kind: 'proforma',
      direction: 'sales',
      counterpartySnapshot: { name: 'Cache oracle source' },
      currencyCode: 'CNY',
      lines: [{ name: 'Cache oracle copied line', quantity: '1', unitPrice: '7' }],
    })
    const copy = await scoped('POST', `/api/trade_docs/documents/${ciId}/copy-from`, { sourceDocumentId: piId })
    expect(copy.status()).toBe(200)

    const after = await scoped('GET', linesUrl)
    const items = (await readJsonSafe<ListPayload<{ id: string }>>(after))?.items ?? []
    expect(items.length, 'the line list reflects the copy on the same URL').toBe(1)
  })
})
