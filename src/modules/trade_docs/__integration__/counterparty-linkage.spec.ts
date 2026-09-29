import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The counterparty of a trade document follows its direction.
 *
 * Four contracts are pinned here: a create cannot store a pair that contradicts itself, an omitted
 * kind is derived from the direction, a `counterpartyId` must exist in the namespace of that kind,
 * and a partial update neither rewrites the stored pair nor wipes the lines (the zod `.partial()`
 * default re-injection this suite exists for). The commercial-invoice guard is checked on update as
 * well as on create.
 */
type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type ContractItem = {
  id?: string
  direction?: string
  counterpartyKind?: string
  counterpartyId?: string | null
  currencyCode?: string
  contractTotal?: string
}
type DocumentItem = {
  id?: string
  direction?: string
  counterpartyKind?: string
  status?: string
}
type LineItem = { id?: string; name?: string }

test.describe.serial('trade documents — direction decides the counterparty', () => {
  let api: APIRequestContext
  let token = ''
  let orgId = ''
  let supplierId = ''
  let partyId = ''
  const contractIds: string[] = []
  const documentIds: string[] = []
  const invoiceIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const create = async (path: string, payload: Record<string, unknown>) => {
    const response = await scoped('POST', path, payload)
    const body = await response.text()
    const id = (JSON.parse(body || '{}') as IdPayload).id
    return { status: response.status(), id: id ?? '', body }
  }

  const readContract = async (id: string): Promise<ContractItem | undefined> => {
    const response = await scoped('GET', `/api/trade_docs/contracts?ids=${encodeURIComponent(id)}&pageSize=1`)
    expect(response.status()).toBe(200)
    return (await readJsonSafe<ListPayload<ContractItem>>(response))?.items?.[0]
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    token = await getAuthToken(api, 'superadmin')
    orgId = getTokenContext(token).organizationId
    const stamp = `${Date.now()}`
    const supplier = await create('/api/purchasing/suppliers', {
      name: `Counterparty E2E supplier ${stamp}`,
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status, supplier.body).toBe(201)
    supplierId = supplier.id
    const party = await create('/api/parties', {
      code: `CP-E2E-${stamp}`,
      name: `Counterparty E2E customer ${stamp}`,
      roles: ['buyer'],
    })
    expect(party.status, party.body).toBe(201)
    partyId = party.id
  })

  test.afterAll(async () => {
    for (const id of contractIds) {
      await scoped('DELETE', `/api/trade_docs/contracts?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of documentIds) {
      await scoped('POST', '/api/trade_docs/documents/transitions', { id, action: 'void', reason: 'e2e cleanup' }).catch(() => undefined)
      await scoped('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of invoiceIds) {
      await scoped('POST', '/api/trade_docs/invoices/transitions', { id, action: 'void', reason: 'e2e cleanup' }).catch(() => undefined)
      await scoped('DELETE', `/api/trade_docs/invoices?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (supplierId) {
      await scoped('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    }
    if (partyId) {
      await scoped('DELETE', `/api/parties?id=${encodeURIComponent(partyId)}`).catch(() => undefined)
    }
    await api.dispose()
  })

  test('accepts only the counterparty kind its direction allows (create)', async () => {
    const purchase = await create('/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'supplier',
      currencyCode: 'CNY',
    })
    expect(purchase.status, purchase.body).toBe(201)
    contractIds.push(purchase.id)

    const purchaseWithCustomer = await create('/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'customer',
      currencyCode: 'CNY',
    })
    expect(purchaseWithCustomer.status, 'purchase + customer must be rejected').toBe(400)

    const sales = await create('/api/trade_docs/contracts', {
      direction: 'sales',
      counterpartyKind: 'customer',
      currencyCode: 'CNY',
    })
    expect(sales.status, sales.body).toBe(201)
    contractIds.push(sales.id)

    const salesWithSupplier = await create('/api/trade_docs/contracts', {
      direction: 'sales',
      counterpartyKind: 'supplier',
      currencyCode: 'CNY',
    })
    expect(salesWithSupplier.status, 'sales + supplier must be rejected').toBe(400)
  })

  test('derives an omitted kind from the direction', async () => {
    const derived = await create('/api/trade_docs/contracts', { direction: 'sales', currencyCode: 'CNY' })
    expect(derived.status, derived.body).toBe(201)
    contractIds.push(derived.id)
    const stored = await readContract(derived.id)
    expect(stored?.counterpartyKind).toBe('customer')
  })

  test('rejects a counterparty id from the other namespace', async () => {
    const purchaseWithParty = await create('/api/trade_docs/contracts', {
      direction: 'purchase',
      counterpartyKind: 'supplier',
      counterpartyId: partyId,
      counterpartySnapshot: { name: 'not a supplier' },
      currencyCode: 'CNY',
    })
    expect(purchaseWithParty.status, purchaseWithParty.body).toBe(400)
    expect(purchaseWithParty.body).toContain('counterparty_not_found')

    const salesWithSupplier = await create('/api/trade_docs/contracts', {
      direction: 'sales',
      counterpartyKind: 'customer',
      counterpartyId: supplierId,
      counterpartySnapshot: { name: 'not a customer' },
      currencyCode: 'CNY',
    })
    expect(salesWithSupplier.status, salesWithSupplier.body).toBe(400)
    expect(salesWithSupplier.body).toContain('counterparty_not_found')

    const salesWithParty = await create('/api/trade_docs/contracts', {
      direction: 'sales',
      counterpartyId: partyId,
      counterpartySnapshot: { name: 'E2E customer' },
      currencyCode: 'CNY',
    })
    expect(salesWithParty.status, salesWithParty.body).toBe(201)
    contractIds.push(salesWithParty.id)
  })

  test('a notes-only update keeps the direction pair, the currency and every line', async () => {
    const created = await create('/api/trade_docs/contracts', {
      direction: 'sales',
      currencyCode: 'USD',
      counterpartySnapshot: { name: 'Partial update buyer' },
      lines: [
        { name: 'Line A', quantity: '2', unitPrice: '5' },
        { name: 'Line B', quantity: '1', unitPrice: '7' },
      ],
    })
    expect(created.status, created.body).toBe(201)
    contractIds.push(created.id)

    const updated = await scoped('PUT', '/api/trade_docs/contracts', { id: created.id, notes: 'edited' })
    expect(updated.status(), await updated.text()).toBe(200)

    const after = await readContract(created.id)
    expect(after?.direction, 'a partial update must not re-inject the create default').toBe('sales')
    expect(after?.counterpartyKind).toBe('customer')
    expect(after?.currencyCode).toBe('USD')
    expect(after?.contractTotal, 'the two lines survive a notes-only update').toBe('17.00')

    const linesResponse = await scoped('GET', `/api/trade_docs/contracts/lines?contractId=${encodeURIComponent(created.id)}&pageSize=50`)
    const lines = (await readJsonSafe<ListPayload<LineItem>>(linesResponse))?.items ?? []
    expect(lines.map((line) => line.name)).toEqual(['Line A', 'Line B'])
  })

  test('keeps a legacy snapshot shape untouched on a partial update', async () => {
    // Documents written before the picker shipped carry only these four keys; a partial update must
    // neither rewrite them nor invent the new `bankAccountId`.
    const created = await create('/api/trade_docs/contracts', {
      direction: 'sales',
      currencyCode: 'CNY',
      counterpartySnapshot: { name: 'Legacy buyer', address: 'Old address', contact: 'Old contact', bank: 'Old bank' },
      lines: [{ name: 'Legacy line', quantity: '1', unitPrice: '4' }],
    })
    expect(created.status, created.body).toBe(201)
    contractIds.push(created.id)

    const updated = await scoped('PUT', '/api/trade_docs/contracts', { id: created.id, notes: 'touched' })
    expect(updated.status(), await updated.text()).toBe(200)

    const response = await scoped(
      'GET',
      `/api/trade_docs/contracts?ids=${encodeURIComponent(created.id)}&pageSize=1`,
    )
    const item = (await readJsonSafe<ListPayload<ContractItem & { counterpartySnapshot?: Record<string, unknown> }>>(response))
      ?.items?.[0]
    expect(item?.counterpartySnapshot).toEqual({
      name: 'Legacy buyer',
      address: 'Old address',
      contact: 'Old contact',
      bank: 'Old bank',
    })
  })

  test('a commercial invoice cannot be flipped to the purchase side on update', async () => {
    const created = await create('/api/trade_docs/documents', {
      kind: 'commercial',
      direction: 'sales',
      currencyCode: 'USD',
      counterpartySnapshot: { name: 'CI guard buyer' },
      lines: [{ name: 'CI line', quantity: '1', unitPrice: '3' }],
    })
    expect(created.status, created.body).toBe(201)
    documentIds.push(created.id)

    const flipped = await scoped('PUT', '/api/trade_docs/documents', {
      id: created.id,
      direction: 'purchase',
      counterpartyKind: 'supplier',
    })
    expect(flipped.status(), await flipped.text()).toBe(400)

    const readBack = await scoped('GET', `/api/trade_docs/documents?ids=${encodeURIComponent(created.id)}&pageSize=1`)
    const item = (await readJsonSafe<ListPayload<DocumentItem>>(readBack))?.items?.[0]
    expect(item?.direction).toBe('sales')
  })

  test('invoices map inbound to suppliers and outbound to customers', async () => {
    const inbound = await create('/api/trade_docs/invoices', {
      direction: 'inbound',
      counterpartyKind: 'supplier',
      currencyCode: 'CNY',
      lines: [{ description: 'Inbound line', quantity: '1', unitPrice: '10', amount: '10' }],
    })
    expect(inbound.status, inbound.body).toBe(201)
    invoiceIds.push(inbound.id)

    const inboundWithCustomer = await create('/api/trade_docs/invoices', {
      direction: 'inbound',
      counterpartyKind: 'customer',
      currencyCode: 'CNY',
    })
    expect(inboundWithCustomer.status).toBe(400)

    const outbound = await create('/api/trade_docs/invoices', {
      direction: 'outbound',
      counterpartyKind: 'customer',
      currencyCode: 'CNY',
      lines: [{ description: 'Outbound line', quantity: '1', unitPrice: '10', amount: '10' }],
    })
    expect(outbound.status, outbound.body).toBe(201)
    invoiceIds.push(outbound.id)

    const outboundWithSupplier = await create('/api/trade_docs/invoices', {
      direction: 'outbound',
      counterpartyKind: 'supplier',
      currencyCode: 'CNY',
    })
    expect(outboundWithSupplier.status).toBe(400)
  })
})
