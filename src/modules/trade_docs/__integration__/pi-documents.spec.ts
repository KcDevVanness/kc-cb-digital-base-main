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
 * PI（形式发票）documents (`src/modules/trade_docs`, kind=`proforma`) — Phase 1 of
 * `.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`.
 *
 * Covers the acceptance path the spec records for TEST-001…TEST-003: create → issue (our own
 * number, per organization) → generate the XLSX → download it, plus the invariants that make the
 * feature safe — an issued document is frozen, another organization never sees it, and a caller
 * without `trade_docs.documents.*` is refused.
 */
const DOCUMENT_FEATURES = ['trade_docs.documents.view', 'trade_docs.documents.manage']
const STAFF_PASSWORD = 'PiDocs!2026'
const VIEWER_PASSWORD = 'PiDocsViewer!2026'
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type DocumentItem = {
  id: string
  kind: string
  direction: string
  number: string | null
  status: string
  currencyCode: string
  subtotal: string
  total: string
  counterpartyName?: string | null
  issuedAt?: string | null
  updatedAt?: string | null
}

type ListPayload = { items?: DocumentItem[]; total?: number }

function currentYear(): number {
  return new Date().getFullYear()
}

test.describe.serial('trade_docs — PI documents', () => {
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
  let firstDocumentId: string | null = null
  let secondDocumentId: string | null = null
  let branchDocumentId: string | null = null

  const stamp = Date.now().toString(36)

  const documentRequest = (method: string, path: string, data?: unknown, orgId: string = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: orgId, data })

  const createDraft = async (payload: Record<string, unknown>, orgId: string = hqOrgId) => {
    const response = await documentRequest('POST', '/api/trade_docs/documents', payload, orgId)
    expect(response.status(), 'POST /api/trade_docs/documents should return 201').toBe(201)
    const created = await readJsonSafe<{ id?: string }>(response)
    expect(created?.id, 'the create response carries the document id').toBeTruthy()
    return created?.id as string
  }

  const issueDocument = async (id: string, orgId: string = hqOrgId) => {
    const response = await documentRequest(
      'POST',
      '/api/trade_docs/documents/transitions',
      { id, action: 'issue' },
      orgId,
    )
    return { response, payload: await readJsonSafe<{ status?: string; number?: string | null }>(response) }
  }

  const loadDocument = async (id: string, orgId: string = hqOrgId) => {
    const response = await documentRequest('GET', `/api/trade_docs/documents?id=${encodeURIComponent(id)}&pageSize=1`, undefined, orgId)
    expect(response.status()).toBe(200)
    const payload = await readJsonSafe<ListPayload>(response)
    return payload?.items?.find((item) => item.id === id) ?? null
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // Roles that grant a module's features need a `superadmin` actor: the installed grant check
    // refuses a feature the actor does not itself hold, so a plain admin cannot bootstrap
    // `trade_docs.documents.*` on a tenant whose admin role predates this slice.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `PI docs E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `PI docs staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: DOCUMENT_FEATURES })
    const staffEmail = `pi-docs-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'PI docs staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    viewerRoleId = await createRoleFixture(api, rootToken, { name: `PI docs viewer ${stamp}`, tenantId })
    const viewerEmail = `pi-docs-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'PI docs viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of [firstDocumentId, secondDocumentId, branchDocumentId]) {
      if (!id) continue
      await documentRequest('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteUserIfExists(api, rootToken, viewerUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteRoleIfExists(api, rootToken, viewerRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('creates a draft PI with lines and computes the head from them', async () => {
    firstDocumentId = await createDraft({
      kind: 'proforma',
      direction: 'sales',
      counterpartyKind: 'customer',
      counterpartySnapshot: { name: 'E2E branch buyer' },
      ourPartySnapshot: { name: 'KC HQ', bankAccountId: null, accountNumber: '40702810000000000001' },
      currencyCode: 'CNY',
      paymentTerms: '30% deposit',
      incoterms: 'FOB',
      lines: [
        { name: 'Free-text line', quantity: '2', unitPrice: '10' },
        { name: 'Overridden line', quantity: '3', unitPrice: '10', amount: '25.5' },
      ],
    })

    const document = await loadDocument(firstDocumentId as string)
    expect(document?.kind).toBe('proforma')
    expect(document?.status).toBe('draft')
    expect(document?.number, 'a draft consumes no sequence slot').toBeNull()
    // 2 × 10 = 20 computed, plus the explicit 25.5 override.
    expect(document?.subtotal).toBe('45.50')
    expect(document?.total).toBe('45.50')
    expect(document?.counterpartyName).toBe('E2E branch buyer')
    expect(typeof document?.updatedAt).toBe('string')
  })

  test('replaces the line set of a draft and recomputes the total', async () => {
    const response = await documentRequest('PUT', '/api/trade_docs/documents/lines', {
      documentId: firstDocumentId,
      lines: [{ name: 'Replacement line', quantity: '4', unitPrice: '12.25' }],
    })
    expect(response.status(), 'PUT /api/trade_docs/documents/lines should return 200').toBe(200)
    const document = await loadDocument(firstDocumentId as string)
    expect(document?.total).toBe('49.00')
  })

  test('refuses to issue a document without lines', async () => {
    const emptyId = await createDraft({
      kind: 'proforma',
      direction: 'sales',
      counterpartySnapshot: { name: 'No lines' },
      lines: [],
    })
    const { response } = await issueDocument(emptyId)
    expect(response.status(), 'an empty document is not issuable').toBe(400)
    await documentRequest('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(emptyId)}`)
  })

  test('issues the document and assigns our own PI number, per organization', async () => {
    const first = await issueDocument(firstDocumentId as string)
    // The transition route is a CRUD-factory create action, so success is 201.
    expect(first.response.status(), 'POST transitions issue should succeed').toBeGreaterThanOrEqual(200)
    expect(first.response.status()).toBeLessThan(300)
    expect(first.payload?.status).toBe('issued')
    expect(first.payload?.number).toMatch(new RegExp(`^PI-${currentYear()}-\\d{4}$`))

    secondDocumentId = await createDraft({
      kind: 'proforma',
      direction: 'purchase',
      counterpartyKind: 'supplier',
      counterpartySnapshot: { name: 'E2E supplier' },
      lines: [{ name: 'Supplier line', quantity: '1', unitPrice: '5' }],
    })
    const second = await issueDocument(secondDocumentId)
    expect(second.payload?.number, 'the sequence advances inside the same organization').toMatch(
      new RegExp(`^PI-${currentYear()}-\\d{4}$`),
    )
    expect(second.payload?.number).not.toBe(first.payload?.number)

    expect(branchOrgId).toBeTruthy()
    branchDocumentId = await createDraft(
      {
        kind: 'proforma',
        direction: 'sales',
        counterpartySnapshot: { name: 'Branch document' },
        lines: [{ name: 'Branch line', quantity: '1', unitPrice: '3' }],
      },
      branchOrgId as string,
    )
    const branchIssued = await issueDocument(branchDocumentId as string, branchOrgId as string)
    expect(branchIssued.payload?.number, 'each organization owns its own sequence').toMatch(
      new RegExp(`^PI-${currentYear()}-\\d{4}$`),
    )
  })

  test('freezes an issued document against edits and deletes', async () => {
    const update = await documentRequest('PUT', '/api/trade_docs/documents', {
      id: firstDocumentId,
      paymentTerms: 'changed after issue',
    })
    expect(update.status(), 'an issued document is not editable').toBeGreaterThanOrEqual(400)
    expect(update.status()).toBeLessThan(500)

    const remove = await documentRequest('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(firstDocumentId as string)}`)
    expect(remove.status(), 'an issued document is not deletable').toBeGreaterThanOrEqual(400)
    expect(remove.status()).toBeLessThan(500)
  })

  test('generates the XLSX once, downloads it, and keeps the pointer on regeneration', async () => {
    const generate = await documentRequest('POST', `/api/trade_docs/documents/${firstDocumentId}/generate`, {})
    expect(generate.status(), 'POST generate should return 200').toBe(200)
    const generated = await readJsonSafe<{ attachmentId?: string; fileName?: string }>(generate)
    expect(generated?.attachmentId).toBeTruthy()
    expect(generated?.fileName).toContain('.xlsx')

    const download = await documentRequest('GET', `/api/trade_docs/documents/${firstDocumentId}/document`)
    expect(download.status(), 'GET document should stream the generated file').toBe(200)
    expect(download.headers()['content-type']).toContain(XLSX_CONTENT_TYPE)
    expect((await download.body()).byteLength).toBeGreaterThan(1000)

    const regenerate = await documentRequest('POST', `/api/trade_docs/documents/${firstDocumentId}/generate`, {})
    expect(regenerate.status()).toBe(200)
    const second = await readJsonSafe<{ attachmentId?: string }>(regenerate)
    expect(second?.attachmentId, 'regeneration writes a new file and moves the pointer').toBeTruthy()
    expect(second?.attachmentId).not.toBe(generated?.attachmentId)
  })

  test('keeps documents inside their organization', async () => {
    const inBranch = await documentRequest(
      'GET',
      `/api/trade_docs/documents?kind=proforma&pageSize=100`,
      undefined,
      branchOrgId as string,
    )
    expect(inBranch.status()).toBe(200)
    const payload = await readJsonSafe<ListPayload>(inBranch)
    const ids = (payload?.items ?? []).map((item) => item.id)
    expect(ids, 'the branch list never contains the HQ document').not.toContain(firstDocumentId)

    const crossScope = await loadDocument(firstDocumentId as string, branchOrgId as string)
    expect(crossScope, 'reading another organization\'s document by id yields nothing').toBeNull()
  })

  test('denies a caller without the feature and allows one with it', async () => {
    const deniedList = await apiRequestWithSelectedOrg(api, 'GET', '/api/trade_docs/documents?kind=proforma', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
    })
    expect(deniedList.status(), 'a caller without trade_docs.documents.view is denied').toBe(403)

    const deniedCreate = await apiRequestWithSelectedOrg(api, 'POST', '/api/trade_docs/documents', {
      token: viewerToken,
      selectedOrgId: hqOrgId,
      data: { kind: 'proforma', counterpartySnapshot: { name: 'Denied' } },
    })
    expect(deniedCreate.status(), 'a caller without trade_docs.documents.manage is denied').toBe(403)

    const allowed = await apiRequestWithSelectedOrg(api, 'GET', '/api/trade_docs/documents?kind=proforma', {
      token: staffToken,
      selectedOrgId: hqOrgId,
    })
    expect(allowed.status(), 'a caller holding the feature is allowed').toBe(200)
  })

  test('allows one order to carry several PI documents', async () => {
    const sourceId = '00000000-0000-4000-8000-0000000000aa'
    const anchor = {
      kind: 'proforma',
      direction: 'sales',
      sourceKind: 'sales_order',
      sourceId,
      sourceSnapshot: { number: 'ORDER-E2E-1', kind: 'sales_order' },
      counterpartySnapshot: { name: 'Anchored buyer' },
      lines: [{ name: 'Anchored line', quantity: '1', unitPrice: '7' }],
    }
    const first = await createDraft(anchor)
    const second = await createDraft(anchor)

    for (const id of [first, second]) {
      const document = await loadDocument(id)
      expect(document?.status).toBe('draft')
      await documentRequest('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`)
    }
  })

  test('rejects a malformed write instead of widening the query', async () => {
    const malformed = await documentRequest('POST', '/api/trade_docs/documents', {
      kind: 'proforma',
      sourceKind: 'not-a-kind',
      lines: [{ name: 'x', quantity: '1', unitPrice: '1' }],
    })
    expect(malformed.status(), 'an unknown source kind is refused').toBe(400)

    const badId = await documentRequest('GET', '/api/trade_docs/documents?id=not-a-uuid')
    expect(badId.status(), 'a malformed id never reaches the query').toBeGreaterThanOrEqual(400)

    const unauthenticated = await apiRequest(api, 'GET', '/api/trade_docs/documents?kind=proforma', {
      token: 'not-a-real-token',
    })
    expect(unauthenticated.status(), 'a request without a valid session is refused').toBe(401)
  })
})
