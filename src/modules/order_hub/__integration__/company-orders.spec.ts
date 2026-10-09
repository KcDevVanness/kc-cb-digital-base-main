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
 * The company-order root record — Phase 1 of `.ai/specs/2026-10-09-company-order-root.md`.
 *
 * REQ-001/REQ-002: `POST /api/order_hub/orders` issues a server-assigned `CO-<year>-<seq>` number;
 * the list narrows by `search` (the root's own number/title and a child's frozen number) and
 * `status`; an update that echoes the version the client rendered with succeeds while an older one
 * is refused with 409 `optimistic_lock_conflict`; a delete is soft, so the row leaves every list
 * read; and another organization never sees the row through the `id` lookup.
 */

const ORDERS_URL = '/api/order_hub/orders'
const STAFF_FEATURES = ['order_hub.view', 'order_hub.manage']
const STAFF_PASSWORD = 'CompanyOrder!2026'
const NUMBER_PATTERN = /^CO-\d{4}-\d{4}$/

type IdPayload = { id?: string; number?: string }
type ListPayload<T> = { items?: T[]; total?: number }
type CompanyOrderRow = {
  id: string
  number: string
  title?: string | null
  status?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

test.describe.serial('order_hub — company orders', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let branchRoleId: string | null = null
  let branchUserId: string | null = null
  let branchToken = ''
  const orderIds: string[] = []
  const branchOrderIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const createOrder = async (data: Record<string, unknown> = {}) => {
    const response = await scoped('POST', ORDERS_URL, data)
    const body = await response.text()
    const parsed = JSON.parse(body || '{}') as IdPayload
    if (parsed.id) orderIds.push(parsed.id)
    return { status: response.status(), id: parsed.id ?? '', number: parsed.number ?? '', body }
  }

  const readOrder = async (
    id: string,
    token = rootToken,
    orgId = hqOrgId,
  ): Promise<CompanyOrderRow | null> => {
    const response = await scoped('GET', `${ORDERS_URL}?id=${encodeURIComponent(id)}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<CompanyOrderRow>>(response))?.items?.[0] ?? null
  }

  const listOrderIds = async (query: string, token = rootToken, orgId = hqOrgId): Promise<string[]> => {
    const response = await scoped('GET', `${ORDERS_URL}?${query}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return ((await readJsonSafe<ListPayload<CompanyOrderRow>>(response))?.items ?? []).map((row) => row.id)
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // Granting module features needs an actor that already holds them: the installed check refuses
    // to hand out a feature the actor itself lacks.
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Company order branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    branchRoleId = await createRoleFixture(api, rootToken, { name: `Company order staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: branchRoleId, features: STAFF_FEATURES })
    const branchEmail = `company-order-staff-${stamp}@example.com`
    branchUserId = await createUserFixture(api, rootToken, {
      email: branchEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [branchRoleId],
      name: 'Company order staff',
    })
    branchToken = await getAuthToken(api, branchEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    const branch = branchOrgId ?? hqOrgId
    for (const id of branchOrderIds) {
      // A branch row is only visible to a command acting in the branch org (writes use the selected
      // org, not the expanded set), so the cleanup selects it.
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`, undefined, rootToken, branch)
        .catch(() => undefined)
    }
    for (const id of orderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, branchUserId)
    await deleteRoleIfExists(api, rootToken, branchRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('creates a draft with a server-assigned CO-<year>-<seq> number', async () => {
    const created = await createOrder({ title: `Company order number ${stamp}` })
    expect(created.status, created.body).toBe(201)
    expect(created.id, 'the create response carries the new id').toBeTruthy()
    expect(created.number, 'the number is issued by the server in CO-<year>-<seq> form').toMatch(NUMBER_PATTERN)

    const row = await readOrder(created.id)
    expect(row, 'the created order is readable back').toBeTruthy()
    expect(row?.number).toBe(created.number)
    expect(row?.status, 'a fresh order defaults to draft').toBe('draft')
    expect(row?.updatedAt, 'the list row carries the optimistic-lock version').toBeTruthy()
  })

  test('lists by search and narrows further by status', async () => {
    const draft = await createOrder({ title: `Company order draft ${stamp}`, status: 'draft' })
    const done = await createOrder({ title: `Company order done ${stamp}`, status: 'completed' })
    expect(draft.status, draft.body).toBe(201)
    expect(done.status, done.body).toBe(201)

    const bySearch = await listOrderIds(`search=${encodeURIComponent(stamp)}&pageSize=100`)
    expect(bySearch).toContain(draft.id)
    expect(bySearch).toContain(done.id)

    // The root's own number is a searchable column too.
    const byNumber = await listOrderIds(`search=${encodeURIComponent(draft.number)}&pageSize=100`)
    expect(byNumber).toContain(draft.id)

    const drafts = await listOrderIds(`search=${encodeURIComponent(stamp)}&status=draft&pageSize=100`)
    expect(drafts).toContain(draft.id)
    expect(drafts, 'the completed fixture is filtered out by status').not.toContain(done.id)

    const completed = await listOrderIds(`search=${encodeURIComponent(stamp)}&status=completed&pageSize=100`)
    expect(completed).toContain(done.id)
    expect(completed).not.toContain(draft.id)
  })

  test('updates with the rendered version and refuses a stale one', async () => {
    const created = await createOrder({ title: `Company order lock ${stamp}` })
    expect(created.status, created.body).toBe(201)
    const before = await readOrder(created.id)
    const version = String(before?.updatedAt ?? before?.updated_at ?? '')
    expect(version, 'the detail read must carry the optimistic-lock version').toBeTruthy()

    const fresh = await scoped('PUT', ORDERS_URL, {
      id: created.id,
      updatedAt: version,
      title: `Company order lock updated ${stamp}`,
      status: 'in_progress',
    })
    expect(fresh.status(), await fresh.text()).toBe(200)
    expect((await readJsonSafe<{ ok?: boolean }>(fresh))?.ok).toBe(true)

    const stale = await scoped('PUT', ORDERS_URL, {
      id: created.id,
      updatedAt: '2000-01-01T00:00:00.000Z',
      notes: 'stale write',
    })
    expect(stale.status(), 'a dialog rendered from an older version 409s').toBe(409)
    expect((await readJsonSafe<{ code?: string }>(stale))?.code).toBe('optimistic_lock_conflict')

    const after = await readOrder(created.id)
    expect(after?.title, 'the fresh write landed').toBe(`Company order lock updated ${stamp}`)
    expect(after?.status).toBe('in_progress')
  })

  test('soft-deletes so the row leaves the list', async () => {
    const created = await createOrder({ title: `Company order delete ${stamp}` })
    expect(created.status, created.body).toBe(201)
    expect(await readOrder(created.id), 'the fixture is visible before the delete').toBeTruthy()

    const removed = await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(created.id)}`)
    expect(removed.status(), await removed.text()).toBe(200)
    expect((await readJsonSafe<{ ok?: boolean }>(removed))?.ok).toBe(true)

    expect(await readOrder(created.id), 'the soft-deleted order leaves the id lookup').toBeNull()
    const listed = await listOrderIds(`search=${encodeURIComponent(`Company order delete ${stamp}`)}&pageSize=100`)
    expect(listed).not.toContain(created.id)
  })

  test('another organization never sees the row through the id lookup', async () => {
    expect(branchOrgId).toBeTruthy()
    const branch = branchOrgId ?? hqOrgId

    const created = await createOrder({ title: `Company order scope ${stamp}` })
    expect(created.status, created.body).toBe(201)
    expect(await readOrder(created.id), 'the head office reads its own order').toBeTruthy()

    // The row exists, but not in the branch caller's scope, so the scoped lookup answers empty.
    expect(
      await readOrder(created.id, branchToken, branch),
      'another organization must not read the row',
    ).toBeNull()
    const branchList = await listOrderIds(`search=${encodeURIComponent(`Company order scope ${stamp}`)}&pageSize=100`, branchToken, branch)
    expect(branchList).toEqual([])
  })

  test('an expanded head-office context finds descendant-organization rows by search and kind', async () => {
    const branch = branchOrgId ?? hqOrgId
    const descendantTitle = `Company order descendant ${stamp}`

    const created = await scoped('POST', ORDERS_URL, { title: descendantTitle }, rootToken, branch)
    expect(created.status(), await created.text()).toBe(201)
    const orderId = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    expect(orderId).toBeTruthy()
    branchOrderIds.push(orderId)

    // A child document in the branch, attached to that branch company order, so the `kind` filter
    // (which reads the link table) has a row to match.
    const salesRes = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      lines: [
        { currencyCode: 'CNY', quantity: 1, name: `descendant line ${stamp}`, unitPriceNet: 5, unitPriceGross: 5 },
      ],
    }, rootToken, branch)
    expect(salesRes.ok(), `POST /api/sales/orders answered ${salesRes.status()}`).toBeTruthy()
    const salesBody = await readJsonSafe<{ id?: string; orderId?: string; item?: { id?: string } }>(salesRes)
    const salesId = String(salesBody?.id ?? salesBody?.orderId ?? salesBody?.item?.id ?? '')
    expect(salesId, 'the branch sales fixture resolved an id').toBeTruthy()

    const linked = await scoped('POST', '/api/order_hub/orders/link-child', {
      kind: 'internal_sales_order',
      refId: salesId,
      companyOrderId: orderId,
    }, rootToken, branch)
    expect([200, 201], await linked.text()).toContain(linked.status())

    // The head office's visible set is the parent plus its descendants: both the search sub-read and
    // the kind sub-read must include the branch row (the bug this guards).
    const bySearch = await listOrderIds(`search=${encodeURIComponent(descendantTitle)}&pageSize=100`)
    expect(bySearch, 'HQ search includes the descendant-organization row').toContain(orderId)

    const byKind = await listOrderIds('kind=internal_sales_order&pageSize=100')
    expect(byKind, 'HQ kind filter includes the descendant-organization row').toContain(orderId)

    // The reverse isolation still holds: a branch-scoped caller does not see head-office rows.
    const branchViewOfHq = await listOrderIds('kind=internal_sales_order&pageSize=100', branchToken, branch)
    for (const id of orderIds) expect(branchViewOfHq).not.toContain(id)
  })
})
