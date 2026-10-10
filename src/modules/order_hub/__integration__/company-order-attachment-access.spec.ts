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
 * Company-order attachment collaboration — Phase 5.B of `.ai/specs/2026-10-09-company-order-root.md`
 * (REQ-018, TEST-012).
 *
 * The installed `/api/attachments` list and file routes scope by the caller's own organization, which
 * hides an owner's files from a collaborating organization. The hub's two new read-only routes
 * authorize on the **root** instead (owner organization or a listed collaborator) and stream the
 * bytes through the same platform storage pieces as the installed route.
 *
 * This spec proves: the owner reads and downloads through the order_hub routes; after the owner adds
 * a collaborator, the collaborator lists and downloads byte-identical content; an unrelated
 * organization gets an empty list and a 404 on the byte route; and the collaborator's own upload
 * through the installed route is refused (it keeps the installed feature gate — the hub hides the
 * upload control for a collaborator, and the server refuses regardless).
 */

const ORDERS_URL = '/api/order_hub/orders'
const COLLABORATORS_URL = '/api/order_hub/orders/collaborators'
const ORDER_HUB_FILES_URL = '/api/order_hub/orders/attachments'
const INSTALLED_ATTACHMENTS_URL = '/api/attachments'
const INSTALLED_FILE_URL = '/api/attachments/file'
const ENTITY_ID = 'order_hub:company_order'
const BASE_URL = process.env.BASE_URL ?? ''
const STAFF_PASSWORD = 'CompanyFiles!2026'
const STAFF_FEATURES = ['order_hub.view']

/** A real 1×1 PNG: the byte route must serve it inline by default and as an attachment on `?download=1`. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

type IdPayload = { id?: string; number?: string | null }
type ListPayload<T> = { items?: T[] }
type FileItem = { id: string; fileName?: string | null; fileSize?: number }

test.describe.serial('order_hub — company order attachment access', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let companyOrderId = ''
  let attachmentId = ''
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

  const listViaOrderHub = async (token: string, orgId: string): Promise<FileItem[]> => {
    const response = await scoped(
      'GET',
      `${ORDER_HUB_FILES_URL}?companyOrderId=${encodeURIComponent(companyOrderId)}`,
      undefined,
      token,
      orgId,
    )
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<FileItem>>(response))?.items ?? []
  }

  const downloadBytes = async (base: string, token: string, orgId: string, query = ''): Promise<Buffer> => {
    const response = await scoped('GET', `${base}/${encodeURIComponent(attachmentId)}${query}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return response.body()
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const created = await scoped('POST', ORDERS_URL, { title: `Files access root ${stamp}` })
    expect(created.status(), await created.text()).toBe(201)
    companyOrderId = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    expect(companyOrderId).toBeTruthy()
    companyOrderIds.push(companyOrderId)

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Files branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    siblingOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Files sibling ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    staffRoleId = await createRoleFixture(api, rootToken, { name: `Files staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })

    const branchEmail = `files-branch-${stamp}@example.com`
    branchUserId = await createUserFixture(api, rootToken, {
      email: branchEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [staffRoleId],
      name: 'Files branch staff',
    })
    branchToken = await getAuthToken(api, branchEmail, STAFF_PASSWORD)

    const siblingEmail = `files-sibling-${stamp}@example.com`
    siblingUserId = await createUserFixture(api, rootToken, {
      email: siblingEmail,
      password: STAFF_PASSWORD,
      organizationId: siblingOrgId,
      roles: [staffRoleId],
      name: 'Files sibling staff',
    })
    siblingToken = await getAuthToken(api, siblingEmail, STAFF_PASSWORD)

    // The owner uploads through the installed route: the hub keeps that as its only upload path.
    const upload = await api.post(`${BASE_URL}${INSTALLED_ATTACHMENTS_URL}`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
        Cookie: `om_selected_org=${hqOrgId}`,
      },
      multipart: {
        entityId: ENTITY_ID,
        recordId: companyOrderId,
        file: { name: 'company-order-scan.png', mimeType: 'image/png', buffer: PNG_BYTES },
      },
    })
    expect(upload.status(), `POST /api/attachments answered ${await upload.text()}`).toBe(200)
    attachmentId = String((await readJsonSafe<{ item?: FileItem }>(upload))?.item?.id ?? '')
    expect(attachmentId, 'the owner upload answers with the attachment id').toBeTruthy()
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

  test('the owner lists and downloads the file through the order_hub routes', async () => {
    const listed = await listViaOrderHub(rootToken, hqOrgId)
    expect(listed.map((row) => row.id)).toContain(attachmentId)
    expect(listed.find((row) => row.id === attachmentId)?.fileName).toBe('company-order-scan.png')

    // Inline by default (an image), with the same content-type the installed route serves it as.
    const inline = await scoped('GET', `${ORDER_HUB_FILES_URL}/${encodeURIComponent(attachmentId)}`)
    expect(inline.status(), await inline.text()).toBe(200)
    expect(inline.headers()['content-type']).toBe('image/png')
    expect(inline.headers()['content-disposition']).toContain('inline;')
    expect((await inline.body()).equals(PNG_BYTES), 'the proxy serves the stored bytes').toBe(true)

    const forced = await scoped('GET', `${ORDER_HUB_FILES_URL}/${encodeURIComponent(attachmentId)}?download=1`)
    expect(forced.status(), await forced.text()).toBe(200)
    expect(forced.headers()['content-type']).toBe('application/octet-stream')
    expect(forced.headers()['content-disposition']).toContain('attachment;')
    expect((await forced.body()).equals(PNG_BYTES), '?download=1 still serves the same bytes').toBe(true)

    // Cross-check: the installed route (owner-only) answers the exact same bytes.
    const installed = await scoped('GET', `${INSTALLED_FILE_URL}/${encodeURIComponent(attachmentId)}?download=1`)
    expect(installed.status(), await installed.text()).toBe(200)
    expect((await installed.body()).equals(PNG_BYTES), 'both routes serve the stored bytes').toBe(true)
  })

  test('a collaborating organization lists and downloads byte-identical content', async () => {
    expect(await listViaOrderHub(branchToken, branchOrgId ?? hqOrgId), 'the branch sees nothing before it collaborates').toHaveLength(0)

    const added = await scoped('POST', COLLABORATORS_URL, {
      companyOrderId,
      organizationIds: [branchOrgId],
    })
    expect(added.status(), await added.text()).toBe(200)

    const listed = await listViaOrderHub(branchToken, branchOrgId ?? hqOrgId)
    expect(listed.map((row) => row.id), 'the collaborator now lists the owner’s file').toContain(attachmentId)

    const bytes = await downloadBytes(ORDER_HUB_FILES_URL, branchToken, branchOrgId ?? hqOrgId)
    expect(bytes.equals(PNG_BYTES), 'the collaborator downloads byte-identical content').toBe(true)
    const forced = await downloadBytes(ORDER_HUB_FILES_URL, branchToken, branchOrgId ?? hqOrgId, '?download=1')
    expect(forced.equals(PNG_BYTES)).toBe(true)
  })

  test('an unrelated organization reads an empty list and a 404 for the bytes', async () => {
    expect(await listViaOrderHub(siblingToken, siblingOrgId ?? hqOrgId), 'an unrelated organization lists nothing').toHaveLength(0)

    const denied = await scoped(
      'GET',
      `${ORDER_HUB_FILES_URL}/${encodeURIComponent(attachmentId)}`,
      undefined,
      siblingToken,
      siblingOrgId ?? hqOrgId,
    )
    expect(denied.status(), 'an unrelated organization cannot read the bytes').toBe(404)

    const unknown = await scoped('GET', `${ORDER_HUB_FILES_URL}/00000000-0000-4000-8000-000000000000`)
    expect(unknown.status(), 'an unknown id is indistinguishable from an invisible one').toBe(404)
  })

  test('the collaborator cannot upload through the installed attachments route', async () => {
    const upload = await api.post(`${BASE_URL}${INSTALLED_ATTACHMENTS_URL}`, {
      headers: {
        Authorization: `Bearer ${branchToken}`,
        Cookie: `om_selected_org=${branchOrgId}`,
      },
      multipart: {
        entityId: ENTITY_ID,
        recordId: companyOrderId,
        file: { name: 'collaborator-upload.png', mimeType: 'image/png', buffer: PNG_BYTES },
      },
    })
    // The installed route keeps its `attachments.manage` gate: a collaborator role granted only
    // `order_hub.view` is refused (403), exactly as TEST-012 states. Upload stays owner-only.
    expect(upload.status(), await upload.text()).toBe(403)
    expect(await listViaOrderHub(branchToken, branchOrgId ?? hqOrgId), 'the refused upload left the list unchanged').toHaveLength(1)
  })
})
