import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Cross-organization write hardening (src/modules/scope_guards).
 *
 * Covers the three commands that reach the guards and the transport mapping that
 * turns an interceptor rejection into a 403 instead of a 500:
 * - `auth.users.create`      → destination organization must be in actor scope
 * - `auth.role-acl.update`   → target role ACL's existing organization scope must be grantable
 * - `auth.user-acl.update`   → same rule for per-user ACL overrides
 *
 * See `.ai/specs/2026-09-21-auth-scope-guard-hardening.md` (TEST-001..TEST-006).
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const BRANCH_ROLE_FEATURES = ['auth.users.list', 'auth.users.create', 'auth.roles.list', 'auth.acl.manage']
const BRANCH_PASSWORD = 'ScopeGuards!2026'

test.describe.serial('scope_guards — cross-organization write hardening', () => {
  let api: APIRequestContext
  let adminToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let branchRoleId: string | null = null
  let groupRoleId: string | null = null
  let branchUserId: string | null = null
  let aclTargetUserId: string | null = null
  let branchToken = ''
  let branchEmail = ''
  const createdUserIds: string[] = []
  const stamp = Date.now()

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: BASE_URL })
    adminToken = await getAuthToken(api, 'admin')
    const context = getTokenContext(adminToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    branchOrgId = await createOrganizationFixture(api, adminToken, {
      name: `Scope Guards Branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    // Unrestricted role (organizations = null): the "someone else's role" target.
    groupRoleId = await createRoleFixture(api, adminToken, { name: `scope-guards-group-${stamp}`, tenantId })
    await setRoleAclFeatures(api, adminToken, {
      roleId: groupRoleId,
      features: ['auth.users.list'],
      organizations: null,
    })

    // Restricted role scoped to the branch organization.
    branchRoleId = await createRoleFixture(api, adminToken, { name: `scope-guards-branch-${stamp}`, tenantId })
    await setRoleAclFeatures(api, adminToken, {
      roleId: branchRoleId,
      features: BRANCH_ROLE_FEATURES,
      organizations: [branchOrgId],
    })

    branchEmail = `scope-guards-branch-${stamp}@example.com`
    branchUserId = await createUserFixture(api, adminToken, {
      email: branchEmail,
      password: BRANCH_PASSWORD,
      organizationId: branchOrgId,
      roles: [`scope-guards-branch-${stamp}`],
      name: 'Scope Guards Branch Admin',
    })
    branchToken = await getAuthToken(api, branchEmail, BRANCH_PASSWORD)

    // A second member of the branch organization: the target of the user-ACL scenarios.
    // It must NOT be the actor — a per-user ACL is an absolute override, so writing one
    // onto the actor would silently drop the features the scenarios need.
    aclTargetUserId = await createUserFixture(api, adminToken, {
      email: `scope-guards-target-${stamp}@example.com`,
      password: BRANCH_PASSWORD,
      organizationId: branchOrgId,
      roles: [`scope-guards-branch-${stamp}`],
      name: 'Scope Guards ACL Target',
    })
  })

  test.afterAll(async () => {
    for (const userId of createdUserIds) {
      await deleteUserIfExists(api, adminToken, userId)
    }
    await deleteUserIfExists(api, adminToken, branchUserId)
    await deleteUserIfExists(api, adminToken, aclTargetUserId)
    await deleteRoleIfExists(api, adminToken, branchRoleId)
    await deleteRoleIfExists(api, adminToken, groupRoleId)
    await deleteOrganizationIfExists(api, adminToken, branchOrgId)
    await api.dispose()
  })

  test('rejects creating a user in an organization outside the actor scope (TEST-001, AC-001)', async () => {
    const attemptedEmail = `scope-guards-blocked-${stamp}@example.com`
    const response = await apiRequest(api, 'POST', '/api/auth/users', {
      token: branchToken,
      data: {
        email: attemptedEmail,
        name: 'Blocked',
        password: BRANCH_PASSWORD,
        organizationId: hqOrgId,
        roles: [`scope-guards-branch-${stamp}`],
      },
    })
    const body = await readJsonSafe<{ code?: string; id?: string }>(response)
    expect(response.status(), 'cross-organization create must be rejected').toBe(403)
    expect(body?.code).toBe('scope_guards.user_destination_outside_scope')
    if (body?.id) createdUserIds.push(body.id)

    const listed = await apiRequest(
      api,
      'GET',
      `/api/auth/users?organizationId=${hqOrgId}&search=${encodeURIComponent(attemptedEmail)}`,
      { token: adminToken },
    )
    const listedBody = await readJsonSafe<{ items?: unknown[] }>(listed)
    expect(listedBody?.items?.length ?? 0, 'no user row may be created by the rejected request').toBe(0)
  })

  test('allows creating a user inside the actor own organization (TEST-005, AC-002)', async () => {
    const response = await apiRequest(api, 'POST', '/api/auth/users', {
      token: branchToken,
      data: {
        email: `scope-guards-inside-${stamp}@example.com`,
        name: 'Inside',
        password: BRANCH_PASSWORD,
        organizationId: branchOrgId,
        roles: [`scope-guards-branch-${stamp}`],
      },
    })
    const body = await readJsonSafe<{ id?: string }>(response)
    expect(response.status(), 'in-scope create must succeed').toBe(201)
    if (body?.id) createdUserIds.push(body.id)
  })

  test('allows an unrestricted actor to create a user in any organization (TEST-004, AC-002)', async () => {
    const response = await apiRequest(api, 'POST', '/api/auth/users', {
      token: adminToken,
      data: {
        email: `scope-guards-admin-${stamp}@example.com`,
        name: 'Admin created',
        password: BRANCH_PASSWORD,
        organizationId: branchOrgId,
        roles: [`scope-guards-branch-${stamp}`],
      },
    })
    const body = await readJsonSafe<{ id?: string }>(response)
    expect(response.status(), 'unrestricted actor keeps cross-organization access').toBe(201)
    if (body?.id) createdUserIds.push(body.id)
  })

  test('rejects rewriting a role ACL that is scoped outside the actor scope (TEST-002, AC-003)', async () => {
    const before = await apiRequest(api, 'GET', `/api/auth/roles/acl?roleId=${groupRoleId}`, { token: adminToken })
    const beforeBody = await readJsonSafe<{ organizations?: string[] | null; updatedAt?: string | null }>(before)

    const response = await apiRequest(api, 'PUT', '/api/auth/roles/acl', {
      token: branchToken,
      data: {
        roleId: groupRoleId,
        features: ['auth.users.list'],
        organizations: [branchOrgId],
      },
    })
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(response.status(), 'out-of-scope role ACL write must be rejected with 403, not 500').toBe(403)
    expect(body?.code).toBe('scope_guards.acl_target_outside_scope')

    const after = await apiRequest(api, 'GET', `/api/auth/roles/acl?roleId=${groupRoleId}`, { token: adminToken })
    const afterBody = await readJsonSafe<{ organizations?: string[] | null; updatedAt?: string | null }>(after)
    expect(afterBody?.organizations, 'target ACL must stay unrestricted').toBeNull()
    expect(afterBody?.updatedAt ?? null).toBe(beforeBody?.updatedAt ?? null)
  })

  test('keeps in-scope role ACL maintenance working, including narrowing (TEST-002, AC-005)', async () => {
    // Narrowing drops `auth.users.create` / `auth.roles.list` but keeps `auth.acl.manage`,
    // which the remaining scenarios still need to reach the command at all.
    const response = await apiRequest(api, 'PUT', '/api/auth/roles/acl', {
      token: branchToken,
      data: {
        roleId: branchRoleId,
        features: ['auth.users.list', 'auth.acl.manage'],
        organizations: [branchOrgId],
      },
    })
    const body = await readJsonSafe<{ ok?: boolean }>(response)
    expect(response.status(), 'in-scope role ACL write must succeed').toBe(200)
    expect(body?.ok).toBe(true)
  })

  test('rejects rewriting a user ACL override that is scoped outside the actor scope (TEST-003, AC-004)', async () => {
    await setUserAclVisibility(api, adminToken, {
      userId: aclTargetUserId as string,
      organizations: null,
      features: ['auth.users.list'],
    })
    const response = await apiRequest(api, 'PUT', '/api/auth/users/acl', {
      token: branchToken,
      data: {
        userId: aclTargetUserId,
        features: ['auth.users.list'],
        organizations: [branchOrgId],
      },
    })
    const body = await readJsonSafe<{ code?: string; error?: string }>(response)
    expect(response.status(), `out-of-scope user ACL write must be rejected with 403, not 500: ${JSON.stringify(body)}`).toBe(403)
    expect(body?.code, `unexpected rejection body: ${JSON.stringify(body)}`).toBe('scope_guards.acl_target_outside_scope')

    const inScopeOrgId = branchOrgId
    if (!inScopeOrgId) throw new Error('branchOrgId fixture was not created')
    await setUserAclVisibility(api, adminToken, {
      userId: aclTargetUserId as string,
      organizations: [inScopeOrgId],
      features: ['auth.users.list'],
    })
    const allowed = await apiRequest(api, 'PUT', '/api/auth/users/acl', {
      token: branchToken,
      data: {
        userId: aclTargetUserId,
        features: ['auth.users.list'],
        organizations: [branchOrgId],
      },
    })
    const allowedBody = await readJsonSafe<{ ok?: boolean }>(allowed)
    expect(allowed.status(), 'in-scope user ACL write must succeed').toBe(200)
    expect(allowedBody?.ok).toBe(true)
  })
})
