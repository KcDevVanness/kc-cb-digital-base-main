import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The tax-invoice ledger's Phase 3 behaviour (`.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`):
 * invoice kinds with server-computed tax calibers, our own `TI-` number on an outbound confirmation,
 * and — the piece that actually moves money — the rule that a **confirmed export invoice never
 * touches a contract's three money columns** while every other kind still does.
 */
type InvoiceRecord = {
  id: string
  status: string
  direction: string
  invoiceKind?: string | null
  ourNumber?: string | null
  subtotal?: string
  total?: string
  taxTotal?: string
  grossTotal?: string
  updatedAt?: string | null
}

type ContractRecord = { id: string; contractTotal: string; financeTotal: string; differenceTotal: string }

test.describe.serial('trade_docs — tax invoice ledger', () => {
  let api: APIRequestContext
  let token = ''
  let orgId = ''
  let contractId: string | null = null
  let contractLineId: string | null = null
  const invoiceIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const readInvoice = async (id: string): Promise<InvoiceRecord | null> => {
    const response = await scoped('GET', `/api/trade_docs/invoices?id=${encodeURIComponent(id)}&pageSize=1`)
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<{ items?: InvoiceRecord[] }>(response)
    return payload?.items?.find((item) => item.id === id) ?? null
  }

  const readContract = async (): Promise<ContractRecord> => {
    const response = await scoped(
      'GET',
      `/api/trade_docs/contracts?id=${encodeURIComponent(contractId as string)}&pageSize=1`,
    )
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<{ items?: ContractRecord[] }>(response)
    const contract = payload?.items?.find((item) => item.id === contractId)
    expect(contract, 'the contract row is readable').toBeTruthy()
    return contract as ContractRecord
  }

  const createInvoice = async (payload: Record<string, unknown>): Promise<string> => {
    const response = await scoped('POST', '/api/trade_docs/invoices', payload)
    const bodyText = await response.text()
    expect(
      response.status(),
      `POST /api/trade_docs/invoices answered ${response.status()}: ${bodyText.slice(0, 400)}`,
    ).toBe(201)
    const created = JSON.parse(bodyText) as { id?: string }
    expect(created?.id).toBeTruthy()
    invoiceIds.push(created?.id as string)
    return created?.id as string
  }

  const confirmInvoice = async (id: string) => {
    const response = await scoped('POST', '/api/trade_docs/invoices/transitions', { id, action: 'confirm' })
    expect(response.status(), `confirming ${id} should succeed`).toBeLessThan(300)
    return readInvoice(id)
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    token = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(token)
    orgId = scope.organizationId

    // A purchase contract with one line is the anchor the financial column is measured against.
    const contract = await scoped('POST', '/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'supplier',
      counterpartySnapshot: { name: 'Tax invoice E2E supplier' },
      currencyCode: 'CNY',
      lines: [{ name: 'Tax invoice E2E line', quantity: '10', unitPrice: '100' }],
    })
    expect(contract.status(), `POST /api/trade_docs/contracts answered ${contract.status()}`).toBe(201)
    contractId = String((await readJsonSafe<{ id?: string }>(contract))?.id ?? '')
    expect(contractId).toBeTruthy()

    const lines = await scoped(
      'GET',
      `/api/trade_docs/contracts/lines?contractId=${encodeURIComponent(contractId as string)}&pageSize=10`,
    )
    expect(lines.status()).toBe(200)
    contractLineId = String(
      (await readJsonSafe<{ items?: Array<{ id?: string }> }>(lines))?.items?.[0]?.id ?? '',
    )
    expect(contractLineId, 'the contract line the invoices bind to').toBeTruthy()
  })

  test.afterAll(async () => {
    for (const id of invoiceIds) {
      await scoped('POST', '/api/trade_docs/invoices/transitions', { id, action: 'void', reason: 'e2e cleanup' }).catch(
        () => undefined,
      )
      await scoped('DELETE', `/api/trade_docs/invoices?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (contractId) {
      await scoped('DELETE', `/api/trade_docs/contracts?id=${encodeURIComponent(contractId)}`).catch(() => undefined)
    }
    await api.dispose()
  })

  test('computes both tax calibers from the line data, for both price conventions', async () => {
    const inclusiveId = await createInvoice({
      direction: 'inbound',
      invoiceKind: 'vat_special',
      currencyCode: 'CNY',
      contractId,
      lines: [
        {
          description: 'Inclusive line',
          quantity: '1',
          unitPrice: '113',
          amount: '113',
          taxRate: '13',
          priceIncludesTax: true,
          contractLineId,
        },
      ],
    })
    const inclusive = await readInvoice(inclusiveId)
    expect(inclusive?.invoiceKind).toBe('vat_special')
    expect(inclusive?.taxTotal).toBe('13.00')
    expect(inclusive?.grossTotal).toBe('113.00')
    expect(inclusive?.total, 'the printed face amount keeps its meaning').toBe('113.00')

    const exclusiveId = await createInvoice({
      direction: 'inbound',
      invoiceKind: 'vat_general',
      currencyCode: 'CNY',
      lines: [
        { description: 'Exclusive line', quantity: '1', unitPrice: '100', amount: '100', taxRate: '13', priceIncludesTax: false },
      ],
    })
    const exclusive = await readInvoice(exclusiveId)
    expect(exclusive?.taxTotal).toBe('13.00')
    expect(exclusive?.grossTotal).toBe('113.00')
  })

  test('numbers an outbound confirmation with our own TI number, and leaves drafts and inbound rows alone', async () => {
    const outboundId = await createInvoice({
      direction: 'outbound',
      invoiceKind: 'vat_special',
      currencyCode: 'CNY',
      lines: [{ description: 'Sales line', quantity: '1', unitPrice: '200', amount: '200', taxRate: '13', priceIncludesTax: false }],
    })
    const draft = await readInvoice(outboundId)
    expect(draft?.ourNumber, 'a draft carries no number').toBeNull()

    const confirmed = await confirmInvoice(outboundId)
    expect(confirmed?.status).toBe('confirmed')
    expect(confirmed?.ourNumber).toMatch(new RegExp(`^TI-${new Date().getFullYear()}-\\d{4}$`))

    const inboundId = await createInvoice({
      direction: 'inbound',
      invoiceKind: 'vat_special',
      currencyCode: 'CNY',
      lines: [{ description: 'Purchase line', quantity: '1', unitPrice: '50', amount: '50', taxRate: '13', priceIncludesTax: false }],
    })
    const inboundConfirmed = await confirmInvoice(inboundId)
    expect(inboundConfirmed?.ourNumber, 'an inbound invoice is the counterparty’s document').toBeNull()
  })

  test('keeps a historical row (no kind) working exactly as before', async () => {
    const legacyId = await createInvoice({
      direction: 'inbound',
      currencyCode: 'CNY',
      number: `LEGACY-${Date.now()}`,
      lines: [{ description: 'Legacy line', quantity: '1', unitPrice: '10', amount: '10' }],
    })
    const legacy = await readInvoice(legacyId)
    expect(legacy?.invoiceKind ?? null).toBeNull()
    expect(legacy?.taxTotal).toBe('0.00')
    expect(legacy?.grossTotal).toBe('10.00')
    const confirmed = await confirmInvoice(legacyId)
    expect(confirmed?.ourNumber, 'a kind-less row is never numbered').toBeNull()
  })

  test('an export invoice is a refund voucher: confirming it never moves the contract columns', async () => {
    const before = await readContract()

    // A non-export invoice bound to the same contract line DOES move the financial column.
    const vatId = await createInvoice({
      direction: 'inbound',
      invoiceKind: 'vat_special',
      currencyCode: 'CNY',
      contractId,
      lines: [
        {
          description: 'Settled line',
          quantity: '1',
          unitPrice: '100',
          amount: '100',
          taxRate: '13',
          priceIncludesTax: false,
          contractLineId,
        },
      ],
    })

    // Pin the binding before measuring: the contract only moves if the invoice line really points at
    // the contract line this test watched.
    const vatLines = await scoped(
      'GET',
      `/api/trade_docs/invoices/lines?invoiceId=${encodeURIComponent(vatId)}&pageSize=10`,
    )
    const boundLine = (await readJsonSafe<{ items?: Array<{ contractLineId?: string | null }> }>(vatLines))?.items?.[0]
    expect(
      boundLine?.contractLineId,
      `the invoice line is bound to the measured contract line (expected=${String(contractLineId)}, got=${String(boundLine?.contractLineId)})`,
    ).toBe(contractLineId)

    await confirmInvoice(vatId)
    const afterVat = await readContract()
    expect(
      afterVat.financeTotal,
      `a confirmed VAT invoice still drives the financial column (before=${before.financeTotal}, after=${afterVat.financeTotal}, contract=${JSON.stringify(afterVat)})`,
    ).not.toBe(before.financeTotal)
    // …while the export invoice on the same contract line leaves all three columns untouched.
    const exportId = await createInvoice({
      direction: 'outbound',
      invoiceKind: 'export',
      currencyCode: 'CNY',
      contractId,
      lines: [
        {
          description: 'Export line',
          quantity: '1',
          unitPrice: '500',
          amount: '500',
          taxRate: '0',
          priceIncludesTax: false,
          contractLineId,
        },
      ],
    })
    const exportInvoice = await confirmInvoice(exportId)
    expect(exportInvoice?.ourNumber, 'the export invoice is numbered like any outbound confirmation').toMatch(
      new RegExp(`^TI-${new Date().getFullYear()}-\\d{4}$`),
    )
    expect(exportInvoice?.taxTotal, 'an export invoice is a 0% caliber').toBe('0.00')
    expect(exportInvoice?.grossTotal).toBe('500.00')

    const afterExport = await readContract()
    expect(afterExport.financeTotal, 'the export invoice did not touch the financial column').toBe(afterVat.financeTotal)
    expect(afterExport.contractTotal).toBe(afterVat.contractTotal)
    expect(afterExport.differenceTotal).toBe(afterVat.differenceTotal)
  })

  test('refuses a malformed kind and a negative rate', async () => {
    const badKind = await scoped('POST', '/api/trade_docs/invoices', {
      direction: 'inbound',
      invoiceKind: 'not-a-kind',
      currencyCode: 'CNY',
      lines: [{ description: 'x', quantity: '1', unitPrice: '1', amount: '1' }],
    })
    expect(badKind.status()).toBe(400)

    const badRate = await scoped('POST', '/api/trade_docs/invoices', {
      direction: 'inbound',
      invoiceKind: 'vat_general',
      currencyCode: 'CNY',
      lines: [{ description: 'x', quantity: '1', unitPrice: '1', amount: '1', taxRate: '-5' }],
    })
    expect(badRate.status()).toBe(400)

    const anonymous = await apiRequest(api, 'GET', '/api/trade_docs/invoices?pageSize=1', { token: 'not-a-real-token' })
    expect(anonymous.status()).toBe(401)
  })
})
