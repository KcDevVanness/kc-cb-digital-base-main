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
 * Supplier code issuance (`src/modules/purchasing`).
 *
 * `.ai/specs/2026-09-24-supplier-code-issuance.md` (TEST-001…003): the operator never types a
 * supplier number — `purchasing.suppliers.create` issues the next `SUP-####` for the organization,
 * a soft-deleted supplier keeps its number (it is never reused), each organization numbers
 * independently, and an explicitly supplied code still behaves exactly as it did before.
 */

const SUPPLIERS_URL = '/api/purchasing/suppliers'
const ISSUED_SUPPLIER_CODE = /^SUP-(\d+)$/

const STAFF_PASSWORD = 'SupplierCodes!2026'
const STAFF_FEATURES = ['purchasing.suppliers.view', 'purchasing.suppliers.manage']

type SupplierRow = { id: string; name: string; code: string }
type CreatedSupplier = { id: string; code: string }

/** The serial inside an issued code — what the monotonicity assertions compare. */
const serialOf = (code: string): number => {
  const match = ISSUED_SUPPLIER_CODE.exec(code)
  expect(match, `code ${code} must carry the SUP-#### shape`).toBeTruthy()
  return Number.parseInt((match as RegExpExecArray)[1], 10)
}

test.describe.serial('purchasing — supplier code issuance', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  const createdSuppliers: Array<{ id: string; orgId: string }> = []

  const stamp = Date.now().toString(36)

  const staffRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: staffToken, selectedOrgId: hqOrgId, data })

  const readSupplier = async (id: string, token = staffToken, orgId = hqOrgId): Promise<SupplierRow> => {
    const response = await apiRequestWithSelectedOrg(api, 'GET', `${SUPPLIERS_URL}?ids=${encodeURIComponent(id)}&pageSize=1`, {
      token,
      selectedOrgId: orgId,
    })
    expect(response.status()).toBe(200)
    const item = (await readJsonSafe<{ items?: SupplierRow[] }>(response))?.items?.[0]
    expect(item, 'the supplier must be readable back').toBeTruthy()
    return item as SupplierRow
  }

  /** Creates a supplier in one organization; `data` lets a test supply its own code. */
  const createSupplier = async (
    name: string,
    data: Record<string, unknown> = {},
    token = staffToken,
    orgId = hqOrgId,
  ): Promise<CreatedSupplier> => {
    const response = await apiRequestWithSelectedOrg(api, 'POST', SUPPLIERS_URL, {
      token,
      selectedOrgId: orgId,
      data: { name, defaultCurrencyCode: 'CNY', ...data },
    })
    expect(response.status(), `creating ${name} must succeed`).toBe(201)
    const id = String((await readJsonSafe<{ id?: string }>(response))?.id ?? '')
    expect(id, 'the create response carries the id').toBeTruthy()
    createdSuppliers.push({ id, orgId })
    const row = await readSupplier(id, token, orgId)
    return { id, code: row.code }
  }

  /**
   * A freshly created organization carries no dictionaries, and the supplier command checks the
   * currency against the **organization's own** dictionary (`lib/currencyDictionary.ts`), so the
   * branch fixture needs the one entry a supplier requires.
   */
  const seedCurrencyDictionary = async (orgId: string): Promise<void> => {
    const dictionary = await apiRequestWithSelectedOrg(api, 'POST', '/api/dictionaries', {
      token: rootToken,
      selectedOrgId: orgId,
      data: { key: 'currency', name: 'Currency' },
    })
    expect(dictionary.status(), 'the branch organization gets a currency dictionary').toBe(201)
    const dictionaryId = String((await readJsonSafe<{ id?: string }>(dictionary))?.id ?? '')
    expect(dictionaryId, 'the dictionary response carries the id').toBeTruthy()

    const entry = await apiRequestWithSelectedOrg(api, 'POST', `/api/dictionaries/${dictionaryId}/entries`, {
      token: rootToken,
      selectedOrgId: orgId,
      data: { value: 'CNY', label: 'CNY' },
    })
    expect(entry.status(), 'CNY is available in the branch organization').toBe(201)
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // Bootstrapping a role needs `superadmin`: the installed grant check refuses a feature the
    // actor does not itself hold (see the sibling supplier-products spec).
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Supplier codes E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    roleId = await createRoleFixture(api, rootToken, { name: `Supplier codes E2E staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: STAFF_FEATURES })
    const staffEmail = `supplier-codes-staff-${stamp}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [roleId],
      name: 'Supplier codes E2E staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    for (const { id, orgId } of createdSuppliers) {
      await apiRequestWithSelectedOrg(api, 'DELETE', `${SUPPLIERS_URL}?id=${encodeURIComponent(id)}`, {
        token: rootToken,
        selectedOrgId: orgId,
      }).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('issues the next SUP-#### when the create carries no code (TEST-001)', async () => {
    const first = await createSupplier(`E2E auto A ${stamp}`)
    const second = await createSupplier(`E2E auto B ${stamp}`)

    expect(first.code).toMatch(ISSUED_SUPPLIER_CODE)
    expect(serialOf(second.code), 'the second create takes the next number').toBe(serialOf(first.code) + 1)
  })

  test('never reuses the number of a soft-deleted supplier (TEST-002)', async () => {
    const deleted = await createSupplier(`E2E auto deleted ${stamp}`)
    const remove = await staffRequest('DELETE', `${SUPPLIERS_URL}?id=${encodeURIComponent(deleted.id)}`)
    expect(remove.ok(), 'the supplier is soft-deleted').toBe(true)

    const next = await createSupplier(`E2E auto after delete ${stamp}`)
    expect(serialOf(next.code), 'the deleted number stays spent').toBe(serialOf(deleted.code) + 1)
  })

  test('numbers each organization independently (TEST-002)', async () => {
    const branchOrg = branchOrgId
    expect(branchOrg, 'the branch organization fixture exists').toBeTruthy()
    if (!branchOrg) return

    await seedCurrencyDictionary(branchOrg)
    const hq = await createSupplier(`E2E auto HQ ${stamp}`)
    const branch = await createSupplier(`E2E auto branch ${stamp}`, {}, rootToken, branchOrg)

    expect(serialOf(branch.code), 'a fresh organization starts at SUP-0001').toBe(1)
    expect(serialOf(hq.code), 'the HQ sequence is unaffected by the branch').toBeGreaterThan(1)
  })

  test('keeps an explicitly supplied code and refuses a duplicate (TEST-003)', async () => {
    const before = await createSupplier(`E2E issued before explicit ${stamp}`)
    const explicit = `PETKIT-${stamp.toUpperCase()}`
    const created = await createSupplier(`E2E explicit ${stamp}`, { code: explicit })

    expect(created.code, 'an explicit code is stored as typed').toBe(explicit)
    expect(ISSUED_SUPPLIER_CODE.test(created.code), 'and it is not an issued number').toBe(false)

    const duplicate = await apiRequestWithSelectedOrg(api, 'POST', SUPPLIERS_URL, {
      token: staffToken,
      selectedOrgId: hqOrgId,
      data: { name: `E2E explicit duplicate ${stamp}`, code: explicit, defaultCurrencyCode: 'CNY' },
    })
    expect(duplicate.status(), 'a duplicate code is a readable conflict').toBe(409)

    const after = await createSupplier(`E2E issued after explicit ${stamp}`)
    expect(serialOf(after.code), 'a hand-typed code does not consume an issued number').toBe(serialOf(before.code) + 1)
  })
})
