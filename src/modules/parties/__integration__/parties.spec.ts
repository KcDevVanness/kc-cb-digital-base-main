import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
 * Trading-party master (`src/modules/parties`).
 *
 * Covers the contracts that carry business risk: the aggregate round trip (party + roles + bank
 * block), replace semantics that must not duplicate rows, clearing a nullable field, the optimistic
 * lock, the duplicate-code and two-default rejections, organization isolation, feature denial, and
 * the option sources Phase 3 re-pointed.
 *
 * Every party request selects an organization explicitly (`om_selected_org`), which is what the
 * backend UI does — a write with no resolvable organization fails closed with
 * `organization_scope_required` before it can reach the duplicate check.
 *
 * See `.ai/specs/2026-09-22-app-owned-party-master.md` (TEST-001..TEST-005).
 */

const PARTY_FEATURES = ['parties.view', 'parties.manage']
const STAFF_PASSWORD = 'Parties!2026'
const VIEWER_PASSWORD = 'PartiesViewer!2026'

type PartyAggregate = {
  item?: {
    id?: string
    code?: string
    name?: string
    city?: string | null
    countryCode?: string | null
    roles?: string[]
    bankAccounts?: Array<{ id?: string; beneficiaryBank?: string; accountNumber?: string; isDefault?: boolean }>
    updatedAt?: string | null
  }
}

test.describe.serial('parties — counterparty master', () => {
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
  let partyId: string | null = null
  let branchPartyId: string | null = null

  const stamp = Date.now().toString(36)
  const uniqueCode = `E2E-${stamp.toUpperCase()}`

  /** Every party call goes through the selected organization, like the backend UI does. */
  const partyRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: hqOrgId, data })

  test.beforeAll(async () => {
    api = await request.newContext()
    // Fixtures that create roles and grant features need `superadmin`: the installed grant check
    // (`auth/lib/grantChecks.ts`) refuses a feature the actor does not itself hold, so a plain
    // `admin` token cannot bootstrap a role holding `parties.*` on a tenant whose admin role
    // predates this module.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Parties E2E Branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `Parties E2E staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: PARTY_FEATURES })
    const staffEmail = `parties-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'Parties E2E staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    // A second role with no parties features at all, to prove the gate fails closed.
    viewerRoleId = await createRoleFixture(api, rootToken, { name: `Parties E2E viewer ${stamp}`, tenantId })
    const viewerEmail = `parties-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'Parties E2E viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of [partyId, branchPartyId]) {
      if (!id) continue
      await apiRequestWithSelectedOrg(api, 'DELETE', `/api/parties?id=${encodeURIComponent(id)}`, {
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

  test('creates a party with roles and a default bank account, and reads the aggregate back', async () => {
    const response = await partyRequest('POST', '/api/parties', {
      code: uniqueCode,
      name: 'E2E Trading Buyer',
      countryCode: 'ru',
      contactName: 'Ivan Petrov',
      contactPhone: '+7 999 000 11 22',
      email: 'buyer@example.com',
      addressLine1: 'Lenina 1',
      city: 'Moscow',
      roles: ['buyer', 'branch'],
      bankAccounts: [
        { beneficiaryBank: 'VTB', accountNumber: '40702810000000000001', swiftCode: 'VTBRRUMM', isDefault: true },
      ],
    })
    expect(response.status(), 'POST /api/parties should return 201').toBe(201)
    partyId = (await readJsonSafe<{ id?: string }>(response))?.id ?? null
    expect(partyId, 'the create response carries the party id').toBeTruthy()

    const read = await partyRequest('GET', `/api/parties/${partyId}`)
    expect(read.status()).toBe(200)
    const aggregate = await readJsonSafe<PartyAggregate>(read)
    expect(aggregate?.item?.code).toBe(uniqueCode)
    expect(aggregate?.item?.countryCode).toBe('RU')
    expect(aggregate?.item?.name).toBe('E2E Trading Buyer')
    expect(aggregate?.item?.roles?.slice().sort()).toEqual(['branch', 'buyer'])
    expect(aggregate?.item?.bankAccounts).toHaveLength(1)
    expect(aggregate?.item?.bankAccounts?.[0]?.isDefault).toBe(true)
    expect(typeof aggregate?.item?.updatedAt).toBe('string')
  })

  test('rejects a duplicate code and an unknown role', async () => {
    const duplicate = await partyRequest('POST', '/api/parties', { code: uniqueCode, name: 'Duplicate' })
    expect(duplicate.status(), 'a code already in use is a 409').toBe(409)

    const badRole = await partyRequest('POST', '/api/parties', {
      code: `${uniqueCode}-C`,
      name: 'Bad role',
      roles: ['supplier'],
    })
    expect(badRole.status(), 'an unknown role is a 400').toBe(400)
  })

  test('rejects two default bank accounts', async () => {
    const response = await partyRequest('POST', '/api/parties', {
      code: `${uniqueCode}-B`,
      name: 'Two defaults',
      bankAccounts: [
        { beneficiaryBank: 'A', accountNumber: '1', isDefault: true },
        { beneficiaryBank: 'B', accountNumber: '2', isDefault: true },
      ],
    })
    expect(response.status()).toBe(400)
  })

  test('replaces roles and bank rows, and clears a nullable field', async () => {
    expect(partyId).toBeTruthy()
    const current = await partyRequest('GET', `/api/parties/${partyId}`)
    const before = await readJsonSafe<PartyAggregate>(current)
    const bankId = before?.item?.bankAccounts?.[0]?.id

    const update = await apiRequestWithSelectedOrg(api, 'PUT', '/api/parties', {
      token: rootToken,
      selectedOrgId: hqOrgId,
      data: {
        id: partyId,
        roles: ['buyer'],
        city: null,
        bankAccounts: [
          { id: bankId, beneficiaryBank: 'VTB', accountNumber: '40702810000000000001', swiftCode: 'VTBRRUMM', isDefault: true },
          { beneficiaryBank: 'ICBC', accountNumber: '0987654321', isDefault: false },
        ],
      },
    })
    expect(update.status(), 'PUT /api/parties should return 200').toBe(200)

    const after = await partyRequest('GET', `/api/parties/${partyId}`)
    const aggregate = await readJsonSafe<PartyAggregate>(after)
    expect(aggregate?.item?.roles).toEqual(['buyer'])
    expect(aggregate?.item?.city).toBeNull()
    expect(aggregate?.item?.bankAccounts).toHaveLength(2)
    expect(aggregate?.item?.bankAccounts?.filter((row) => row.isDefault)).toHaveLength(1)
  })

  test('rejects a stale update with a 409', async () => {
    // The expected version travels in the header (`CrudForm` derives it from `initialValues.updatedAt`),
    // never in the body — `enforceCommandOptimisticLock` reads the request header. `apiRequest` is used
    // here because the selected-organization helper does not take extra headers.
    const stale = await apiRequest(api, 'PUT', '/api/parties', {
      token: rootToken,
      headers: {
        'x-om-ext-optimistic-lock-expected-updated-at': '2020-01-01T00:00:00.000Z',
        cookie: `om_selected_org=${hqOrgId}`,
      },
      data: { id: partyId, name: 'Stale write' },
    })
    expect(stale.status(), 'a write carrying an outdated version is refused').toBe(409)
  })

  test('serves the option source by code and isolates organizations', async () => {
    const options = await partyRequest('GET', `/api/parties/options?search=${encodeURIComponent(uniqueCode)}`)
    expect(options.status()).toBe(200)
    const payload = await readJsonSafe<{ items?: Array<{ value?: string; label?: string }> }>(options)
    const match = payload?.items?.find((item) => item.value === partyId)
    expect(match, 'the created party is offered as an option').toBeTruthy()
    expect(match?.label).toContain(uniqueCode)

    expect(branchOrgId).toBeTruthy()
    const inBranch = await apiRequestWithSelectedOrg(api, 'POST', '/api/parties', {
      token: rootToken,
      selectedOrgId: branchOrgId as string,
      data: { code: `${uniqueCode}-BR`, name: 'Branch-only buyer' },
    })
    expect(inBranch.status()).toBe(201)
    branchPartyId = (await readJsonSafe<{ id?: string }>(inBranch))?.id ?? null

    // Selecting the branch must not expose the HQ party.
    const crossScope = await apiRequestWithSelectedOrg(api, 'GET', `/api/parties/${partyId}`, {
      token: rootToken,
      selectedOrgId: branchOrgId as string,
    })
    expect(crossScope.status()).toBe(404)
  })

  test('denies a caller without the feature and allows one with it', async () => {
    const denied = await apiRequestWithSelectedOrg(api, 'GET', '/api/parties', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
    })
    expect(denied.status(), 'a caller without parties.view is denied').toBe(403)
    const deniedOptions = await apiRequestWithSelectedOrg(api, 'GET', '/api/parties/options', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
    })
    expect(deniedOptions.status()).toBe(403)

    const allowed = await apiRequestWithSelectedOrg(api, 'GET', '/api/parties', {
      token: staffToken,
      selectedOrgId: hqOrgId,
    })
    expect(allowed.status(), 'a caller with parties.view is allowed').toBe(200)
  })

  test('serves currency options to a caller with currencies.view and denies one without', async () => {
    const allowed = await apiRequestWithSelectedOrg(api, 'GET', '/api/currency_policy/currencies', {
      token: rootToken,
      selectedOrgId: hqOrgId,
    })
    expect(allowed.status(), 'the app-owned currency option source answers').toBe(200)
    const payload = await readJsonSafe<{ entries?: Array<{ value?: string }> }>(allowed)
    expect(Array.isArray(payload?.entries)).toBe(true)

    const denied = await apiRequestWithSelectedOrg(api, 'GET', '/api/currency_policy/currencies', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
    })
    expect(denied.status(), 'a caller without currencies.view is denied').toBe(403)
  })

  test('soft-deletes the party and hides it', async () => {
    expect(partyId).toBeTruthy()
    const current = await partyRequest('GET', `/api/parties/${partyId}`)
    const aggregate = await readJsonSafe<PartyAggregate>(current)
    const remove = await apiRequestWithSelectedOrg(api, 'DELETE', `/api/parties?id=${encodeURIComponent(partyId as string)}`, {
      token: rootToken,
      selectedOrgId: hqOrgId,
    })
    expect(remove.status()).toBe(200)

    const gone = await partyRequest('GET', `/api/parties/${partyId}`)
    expect(gone.status()).toBe(404)
    partyId = null
  })
})
