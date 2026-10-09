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
 * Company-order collaboration — Phase 4.B of `.ai/specs/2026-10-09-company-order-root.md`.
 *
 * REQ-014/REQ-016: an owner organization adds collaborating organizations to a root; a collaborator
 * **sees** the root (workbench + hub, `viewerIsCollaborator` flagged) and may write ONLY
 * `status`/`notes` — anything else is refused server-side (`collaborator_field_not_allowed`), and
 * the owner-only surfaces (delete, links replace, collaborators replace) answer
 * `company_order_owner_required`. An unrelated organization sees nothing at all.
 */

const ORDERS_URL = '/api/order_hub/orders'
const LINKS_URL = '/api/order_hub/orders/links'
const COLLABORATORS_URL = '/api/order_hub/orders/collaborators'
const STAFF_FEATURES = ['order_hub.view', 'order_hub.manage']
const STAFF_PASSWORD = 'CompanyCollab!2026'

type IdPayload = { id?: string; number?: string | null }
type ListPayload<T> = { items?: T[]; total?: number }
type OrderRow = { id: string; number: string; status: string; title: string | null; updatedAt?: string | null; viewerIsCollaborator?: boolean }
type CollaboratorRow = { id: string; companyOrderId: string; organizationId: string }

test.describe.serial('order_hub — company order collaborators', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let companyOrderId = ''
  let companyOrderNumber = ''
  let branchOrgId: string | null = null
  let siblingOrgId: string | null = null
  let staffRoleId: string | null = null
  let branchUserId: string | null = null
  let siblingUserId: string | null = null
  let branchToken = ''
  let siblingToken = ''
  const companyOrderIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const findRoot = async (token: string, orgId: string): Promise<OrderRow[]> => {
    const response = await scoped('GET', `${ORDERS_URL}?search=${encodeURIComponent(companyOrderNumber)}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<OrderRow>>(response))?.items ?? []
  }

  const readRoot = async (token: string, orgId: string): Promise<OrderRow | null> => {
    const response = await scoped('GET', `${ORDERS_URL}?id=${encodeURIComponent(companyOrderId)}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<OrderRow>>(response))?.items?.[0] ?? null
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const created = await scoped('POST', ORDERS_URL, { title: `Collaboration root ${stamp}` })
    expect(created.status(), await created.text()).toBe(201)
    const body = await readJsonSafe<IdPayload>(created)
    companyOrderId = String(body?.id ?? '')
    companyOrderNumber = String(body?.number ?? '')
    expect(companyOrderId).toBeTruthy()
    expect(companyOrderNumber).toBeTruthy()
    companyOrderIds.push(companyOrderId)

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Collab branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    siblingOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Collab sibling ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    staffRoleId = await createRoleFixture(api, rootToken, { name: `Collab staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })

    const branchEmail = `collab-branch-${stamp}@example.com`
    branchUserId = await createUserFixture(api, rootToken, {
      email: branchEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [staffRoleId],
      name: 'Collab branch staff',
    })
    branchToken = await getAuthToken(api, branchEmail, STAFF_PASSWORD)

    const siblingEmail = `collab-sibling-${stamp}@example.com`
    siblingUserId = await createUserFixture(api, rootToken, {
      email: siblingEmail,
      password: STAFF_PASSWORD,
      organizationId: siblingOrgId,
      roles: [staffRoleId],
      name: 'Collab sibling staff',
    })
    siblingToken = await getAuthToken(api, siblingEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of companyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, branchUserId)
    await deleteUserIfExists(api, rootToken, siblingUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await deleteOrganizationIfExists(api, rootToken, siblingOrgId)
    await api.dispose()
  })

  test('the owner adds a collaborator, who then sees the root flagged as collaboration', async () => {
    expect(await findRoot(branchToken, branchOrgId ?? hqOrgId), 'a child organization cannot see an HQ root before it collaborates').toHaveLength(0)

    const added = await scoped('POST', COLLABORATORS_URL, {
      companyOrderId,
      organizationIds: [branchOrgId],
    })
    expect(added.status(), await added.text()).toBe(200)
    const addedBody = await readJsonSafe<{ ok?: boolean; count?: number }>(added)
    expect(addedBody?.ok).toBe(true)
    expect(addedBody?.count).toBe(1)

    const listed = await scoped('GET', `${COLLABORATORS_URL}?companyOrderId=${encodeURIComponent(companyOrderId)}`)
    expect(listed.status(), await listed.text()).toBe(200)
    const stored = (await readJsonSafe<ListPayload<CollaboratorRow>>(listed))?.items ?? []
    expect(stored).toHaveLength(1)
    expect(stored[0]?.organizationId).toBe(branchOrgId)

    const branchRows = await findRoot(branchToken, branchOrgId ?? hqOrgId)
    expect(branchRows, 'the collaborator now sees the root').toHaveLength(1)
    expect(branchRows[0]?.id).toBe(companyOrderId)
    expect(branchRows[0]?.viewerIsCollaborator, 'and the row says why').toBe(true)

    expect(await findRoot(siblingToken, siblingOrgId ?? hqOrgId), 'an unrelated organization still sees nothing').toHaveLength(0)
  })

  test('a collaborator writes status/notes only; owner-only actions are refused', async () => {
    const before = await readRoot(branchToken, branchOrgId ?? hqOrgId)
    expect(before, 'the collaborator can read the root').toBeTruthy()
    const version = String(before?.updatedAt ?? '')
    expect(version).toBeTruthy()

    const statusWrite = await scoped(
      'PUT',
      ORDERS_URL,
      { id: companyOrderId, status: 'in_progress', updatedAt: version },
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(statusWrite.status(), await statusWrite.text()).toBe(200)
    const afterStatus = await readRoot(branchToken, branchOrgId ?? hqOrgId)
    expect(afterStatus?.status).toBe('in_progress')

    const freshVersion = String(afterStatus?.updatedAt ?? '')
    const titleWrite = await scoped(
      'PUT',
      ORDERS_URL,
      { id: companyOrderId, title: 'not allowed', updatedAt: freshVersion },
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(titleWrite.status(), 'a collaborator cannot write any field but status/notes').toBe(422)
    const titleBody = await readJsonSafe<{ code?: string }>(titleWrite)
    expect(titleBody?.code).toBe('collaborator_field_not_allowed')

    const removeAttempt = await scoped(
      'DELETE',
      `${ORDERS_URL}?id=${encodeURIComponent(companyOrderId)}`,
      undefined,
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(removeAttempt.status(), 'deleting stays owner-only').toBe(403)
    expect((await readJsonSafe<{ code?: string }>(removeAttempt))?.code).toBe('company_order_owner_required')

    const linkAttempt = await scoped(
      'POST',
      LINKS_URL,
      { companyOrderId, kind: 'purchase_order', refs: [] },
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(linkAttempt.status(), 'editing the child set stays owner-only').toBe(403)

    const ownerWrite = await scoped('PUT', ORDERS_URL, {
      id: companyOrderId,
      title: `Owner title ${stamp}`,
      updatedAt: freshVersion,
    })
    expect(ownerWrite.status(), await ownerWrite.text()).toBe(200)
  })

  test('replace is a whole set with an optimistic lock', async () => {
    const stale = await scoped('POST', COLLABORATORS_URL, {
      companyOrderId,
      organizationIds: [siblingOrgId],
      updatedAt: '2000-01-01T00:00:00.000Z',
    })
    expect(stale.status(), 'a dialog rendered from an older version 409s').toBe(409)

    const root = await readRoot(rootToken, hqOrgId)
    const version = String(root?.updatedAt ?? '')
    expect(version).toBeTruthy()
    const replaced = await scoped('POST', COLLABORATORS_URL, {
      companyOrderId,
      organizationIds: [siblingOrgId],
      updatedAt: version,
    })
    expect(replaced.status(), await replaced.text()).toBe(200)

    expect(await findRoot(branchToken, branchOrgId ?? hqOrgId), 'the removed branch loses visibility').toHaveLength(0)
    const siblingRows = await findRoot(siblingToken, siblingOrgId ?? hqOrgId)
    expect(siblingRows, 'the newly added sibling gains it').toHaveLength(1)
    expect(siblingRows[0]?.viewerIsCollaborator).toBe(true)
  })

  test('an unknown collaborating organization is refused', async () => {
    const root = await readRoot(rootToken, hqOrgId)
    const version = String(root?.updatedAt ?? '')
    const unknown = await scoped('POST', COLLABORATORS_URL, {
      companyOrderId,
      organizationIds: ['0f8fad5b-d9cb-469f-a165-70867728950e'],
      updatedAt: version,
    })
    expect(unknown.status()).toBe(422)
    expect((await readJsonSafe<{ code?: string }>(unknown))?.code).toBe('collaborator_organization_not_found')
  })
})
