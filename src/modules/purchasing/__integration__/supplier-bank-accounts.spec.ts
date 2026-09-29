import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * A supplier's bank block: the account our payments go to.
 *
 * Pins the risky parts: exactly one default row (payload rejection plus the two-phase replace that
 * keeps the partial unique index satisfiable), the encrypted-at-rest columns (ciphertext on disk,
 * plaintext through the API), the detail route that carries the block while list/option reads stay
 * free of it, and the organization narrowing the pickers rely on.
 */
type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type BankRow = {
  id?: string
  beneficiaryBank?: string
  accountNumber?: string
  swiftCode?: string | null
  isDefault?: boolean
}
type SupplierDetail = {
  item?: {
    id?: string
    code?: string
    bankAccounts?: BankRow[]
  }
}
type SupplierListItem = { id?: string; bankAccounts?: unknown }

test.describe.serial('supplier bank accounts — encrypted, one default, detail-only', () => {
  let api: APIRequestContext
  let token = ''
  let orgId = ''
  let tenantId = ''
  let siblingOrgId: string | null = null
  const supplierIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown, organization = orgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: organization, data })

  const createSupplier = async (payload: Record<string, unknown>) => {
    const response = await scoped('POST', '/api/purchasing/suppliers', payload)
    const body = await response.text()
    const id = (JSON.parse(body || '{}') as IdPayload).id
    if (id) supplierIds.push(id)
    return { status: response.status(), id: id ?? '', body }
  }

  const readDetail = async (id: string, organization = orgId) => {
    const response = await scoped('GET', `/api/purchasing/suppliers/${encodeURIComponent(id)}`, undefined, organization)
    return { status: response.status(), payload: await readJsonSafe<SupplierDetail>(response) }
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    token = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(token)
    orgId = context.organizationId
    tenantId = context.tenantId ?? ''
    siblingOrgId = await createOrganizationFixture(api, token, {
      name: `Supplier bank E2E sibling ${Date.now()}`,
      tenantId,
    })
  })

  test.afterAll(async () => {
    for (const id of supplierIds) {
      await scoped('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteOrganizationIfExists(api, token, siblingOrgId)
    await api.dispose()
  })

  test('stores the bank block encrypted, returns it decrypted, and keeps it out of lists', async () => {
    const created = await createSupplier({
      name: `Bank E2E supplier ${Date.now()}`,
      defaultCurrencyCode: 'CNY',
      bankAccounts: [
        {
          beneficiaryBank: 'Сбербанк',
          accountNumber: '40817810099910004312',
          swiftCode: 'SABRRUMM',
          bankAddress: 'Москва',
          isDefault: true,
        },
        {
          beneficiaryBank: 'ВТБ',
          accountNumber: '40817810700000000001',
        },
      ],
    })
    expect(created.status, created.body).toBe(201)

    const detail = await readDetail(created.id)
    expect(detail.status).toBe(200)
    const rows = detail.payload?.item?.bankAccounts ?? []
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      beneficiaryBank: 'Сбербанк',
      accountNumber: '40817810099910004312',
      swiftCode: 'SABRRUMM',
      bankAddress: 'Москва',
      isDefault: true,
    })

    const raw = await withClient(async (client) => {
      const result = await client.query<{ beneficiary_bank: string; account_number: string }>(
        'select beneficiary_bank, account_number from purchasing_supplier_bank_accounts where supplier_id = $1 order by created_at asc',
        [created.id],
      )
      return result.rows
    })
    expect(raw).toHaveLength(2)
    expect(raw[0]?.beneficiary_bank, 'the bank name is ciphertext at rest').not.toBe('Сбербанк')
    expect(raw[0]?.account_number, 'the account number is ciphertext at rest').not.toBe('40817810099910004312')

    const list = await scoped('GET', `/api/purchasing/suppliers?ids=${encodeURIComponent(created.id)}&pageSize=10`)
    const item = (await readJsonSafe<ListPayload<SupplierListItem>>(list))?.items?.[0]
    expect(item?.id).toBe(created.id)
    expect(item, 'a list projection never carries the bank block').not.toHaveProperty('bankAccounts')
  })

  test('rejects two default rows before any write', async () => {
    const created = await createSupplier({
      name: `Bank E2E two defaults ${Date.now()}`,
      defaultCurrencyCode: 'CNY',
      bankAccounts: [
        { beneficiaryBank: 'A', accountNumber: '1', isDefault: true },
        { beneficiaryBank: 'B', accountNumber: '2', isDefault: true },
      ],
    })
    expect(created.status).toBe(400)
    expect(created.id).toBe('')
  })

  test('replaces the block in place and keeps one default after a flip', async () => {
    const created = await createSupplier({
      name: `Bank E2E replace ${Date.now()}`,
      defaultCurrencyCode: 'CNY',
      bankAccounts: [
        { beneficiaryBank: 'First', accountNumber: '100', isDefault: true },
        { beneficiaryBank: 'Second', accountNumber: '200' },
      ],
    })
    expect(created.status, created.body).toBe(201)
    const before = (await readDetail(created.id)).payload?.item?.bankAccounts ?? []
    const keptId = before.find((row) => row.beneficiaryBank === 'First')?.id as string
    const droppedId = before.find((row) => row.beneficiaryBank === 'Second')?.id as string

    // Flip the default onto the *other* row in the same payload: the two-phase replace must clear
    // the old default before it writes the new one, otherwise the partial unique index fires.
    const updated = await scoped('PUT', '/api/purchasing/suppliers', {
      id: created.id,
      bankAccounts: [
        { id: keptId, beneficiaryBank: 'First renamed', accountNumber: '101' },
        { id: droppedId, beneficiaryBank: 'Second', accountNumber: '200', isDefault: true },
        { beneficiaryBank: 'Third', accountNumber: '300' },
      ],
    })
    expect(updated.status(), await updated.text()).toBe(200)

    const after = (await readDetail(created.id)).payload?.item?.bankAccounts ?? []
    expect(after).toHaveLength(3)
    expect(after.find((row) => row.id === keptId)).toMatchObject({ beneficiaryBank: 'First renamed', accountNumber: '101', isDefault: false })
    expect(after.find((row) => row.id === droppedId)?.isDefault).toBe(true)
    expect(after.filter((row) => row.isDefault)).toHaveLength(1)
  })

  test('rejects a bank row id that belongs to no supplier', async () => {
    const created = await createSupplier({ name: `Bank E2E unknown row ${Date.now()}`, defaultCurrencyCode: 'CNY' })
    expect(created.status, created.body).toBe(201)
    const updated = await scoped('PUT', '/api/purchasing/suppliers', {
      id: created.id,
      bankAccounts: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          beneficiaryBank: 'Ghost',
          accountNumber: '1',
        },
      ],
    })
    expect(updated.status()).toBe(400)
  })

  test('an empty block clears every account and is not returned for another organization', async () => {
    const created = await createSupplier({
      name: `Bank E2E clear ${Date.now()}`,
      defaultCurrencyCode: 'CNY',
      bankAccounts: [{ beneficiaryBank: 'ToBeCleared', accountNumber: '9', isDefault: true }],
    })
    expect(created.status, created.body).toBe(201)

    const cleared = await scoped('PUT', '/api/purchasing/suppliers', { id: created.id, bankAccounts: [] })
    expect(cleared.status(), await cleared.text()).toBe(200)
    expect((await readDetail(created.id)).payload?.item?.bankAccounts ?? []).toHaveLength(0)

    // A sibling organization is outside the selected organization's readable set, so the same record
    // is invisible there — the narrowing the pickers apply and the reason the write check stays
    // inside the command scope.
    expect(siblingOrgId).toBeTruthy()
    const foreign = await readDetail(created.id, siblingOrgId as string)
    expect(foreign.status, 'another organization cannot read this supplier').toBe(404)
    const narrowed = await scoped(
      'GET',
      `/api/purchasing/suppliers?organizationId=${encodeURIComponent(siblingOrgId as string)}&pageSize=50`,
      undefined,
      orgId,
    )
    const rows = (await readJsonSafe<ListPayload<SupplierListItem>>(narrowed))?.items ?? []
    expect(rows.some((row) => row.id === created.id)).toBe(false)
  })
})
