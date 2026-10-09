import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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
 * Company-order document slots — Phase 7.A of `.ai/specs/2026-10-09-company-order-root.md`
 * (REQ-020…REQ-022, REQ-025, TEST-015).
 *
 * A document slot binds a 35-column document field to a stored file. The file is uploaded through the
 * **installed** `POST /api/attachments` with `entityId=order_hub:company_order_document` and
 * `recordId=<the slot row id the caller pre-generated>`; this module only records the mapping
 * (`POST /api/order_hub/orders/documents`). Reads follow the root's visibility (owner or
 * collaborator) and stream the bytes through the round-5 proxy route, which now also serves
 * document-slot files. Registration and detachment are owner-only.
 *
 * This spec proves: two slots register and list name/size/time; the duplicate registration 409s; the
 * proxy serves byte-identical content; delete removes the row; a collaborator lists and downloads
 * but is refused (403 `company_order_owner_required`) on register/delete; an unrelated organization
 * reads an empty list and a 404 for the bytes.
 */

const ORDERS_URL = '/api/order_hub/orders'
const COLLABORATORS_URL = '/api/order_hub/orders/collaborators'
const DOCUMENTS_URL = '/api/order_hub/orders/documents'
const BYTES_URL = '/api/order_hub/orders/attachments'
const INSTALLED_ATTACHMENTS_URL = '/api/attachments'
const DOCUMENT_ENTITY_ID = 'order_hub:company_order_document'
const BASE_URL = process.env.BASE_URL ?? ''
const STAFF_PASSWORD = 'CompanySlots!2026'
const STAFF_FEATURES = ['order_hub.view', 'order_hub.manage']

/** A real 1×1 PNG, so the byte proxy serves it inline and as an attachment identically. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const TEXT_BYTES = Buffer.from('KC INVOICE stamp placeholder — byte identical check', 'utf8')

type IdPayload = { id?: string; number?: string | null }
type ListPayload<T> = { items?: T[] }
type DocumentItem = {
  id: string
  companyOrderId: string
  slot: string
  attachmentId: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  createdAt: string | null
  missing: boolean
}

test.describe.serial('order_hub — company order document slots', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let companyOrderId = ''
  let branchOrgId: string | null = null
  let siblingOrgId: string | null = null
  let staffRoleId: string | null = null
  let branchUserId: string | null = null
  let siblingUserId: string | null = null
  let branchToken = ''
  let siblingToken = ''

  const invoiceSlotRowId = randomUUID()
  const stampSlotRowId = randomUUID()
  let invoiceAttachmentId = ''
  let stampAttachmentId = ''

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const listDocuments = async (token: string, orgId: string): Promise<DocumentItem[]> => {
    const response = await scoped('GET', `${DOCUMENTS_URL}?companyOrderId=${encodeURIComponent(companyOrderId)}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<DocumentItem>>(response))?.items ?? []
  }

  const upload = async (token: string, orgId: string, recordId: string, name: string, mimeType: string, buffer: Buffer): Promise<string> => {
    const response = await api.post(`${BASE_URL}${INSTALLED_ATTACHMENTS_URL}`, {
      headers: { Authorization: `Bearer ${token}`, Cookie: `om_selected_org=${orgId}` },
      multipart: { entityId: DOCUMENT_ENTITY_ID, recordId, file: { name, mimeType, buffer } },
    })
    expect(response.status(), `upload ${name} answered ${await response.text()}`).toBe(200)
    const id = String((await readJsonSafe<{ item?: { id?: string } }>(response))?.item?.id ?? '')
    expect(id, 'the upload answers with the attachment id').toBeTruthy()
    return id
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const created = await scoped('POST', ORDERS_URL, { title: `Document slots root ${stamp}` })
    expect(created.status(), await created.text()).toBe(201)
    companyOrderId = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    expect(companyOrderId).toBeTruthy()

    // The two files are uploaded through the *installed* route, filed under the document entity and
    // the pre-generated slot row ids — exactly the contract the hub's upload control uses.
    invoiceAttachmentId = await upload(rootToken, hqOrgId, invoiceSlotRowId, 'commercial-invoice.png', 'image/png', PNG_BYTES)
    stampAttachmentId = await upload(rootToken, hqOrgId, stampSlotRowId, 'kc-invoice-stamp.txt', 'text/plain', TEXT_BYTES)

    branchOrgId = await createOrganizationFixture(api, rootToken, { name: `Slots branch ${stamp}`, tenantId, parentId: hqOrgId })
    siblingOrgId = await createOrganizationFixture(api, rootToken, { name: `Slots sibling ${stamp}`, tenantId, parentId: hqOrgId })
    staffRoleId = await createRoleFixture(api, rootToken, { name: `Slots staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })

    const branchEmail = `slots-branch-${stamp}@example.com`
    branchUserId = await createUserFixture(api, rootToken, {
      email: branchEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [staffRoleId],
      name: 'Slots branch staff',
    })
    branchToken = await getAuthToken(api, branchEmail, STAFF_PASSWORD)

    const siblingEmail = `slots-sibling-${stamp}@example.com`
    siblingUserId = await createUserFixture(api, rootToken, {
      email: siblingEmail,
      password: STAFF_PASSWORD,
      organizationId: siblingOrgId,
      roles: [staffRoleId],
      name: 'Slots sibling staff',
    })
    siblingToken = await getAuthToken(api, siblingEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(companyOrderId)}`).catch(() => undefined)
    for (const attachmentId of [invoiceAttachmentId, stampAttachmentId]) {
      if (attachmentId) await scoped('DELETE', `${INSTALLED_ATTACHMENTS_URL}?id=${encodeURIComponent(attachmentId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, branchUserId)
    await deleteUserIfExists(api, rootToken, siblingUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await deleteOrganizationIfExists(api, rootToken, siblingOrgId)
    await api.dispose()
  })

  test('registers two slots, lists their metadata, and refuses a duplicate registration', async () => {
    expect(await listDocuments(rootToken, hqOrgId), 'a fresh root has no slot rows').toHaveLength(0)

    const invoice = await scoped('POST', DOCUMENTS_URL, {
      id: invoiceSlotRowId,
      companyOrderId,
      slot: 'commercial_invoice',
      attachmentId: invoiceAttachmentId,
    })
    expect(invoice.status(), await invoice.text()).toBe(201)
    const invoiceItem = (await readJsonSafe<{ ok?: boolean; item?: DocumentItem }>(invoice))?.item
    expect(invoiceItem?.fileName).toBe('commercial-invoice.png')
    expect(invoiceItem?.slot).toBe('commercial_invoice')

    const stampRegister = await scoped('POST', DOCUMENTS_URL, {
      id: stampSlotRowId,
      companyOrderId,
      slot: 'kc_invoice_stamp',
      attachmentId: stampAttachmentId,
    })
    expect(stampRegister.status(), await stampRegister.text()).toBe(201)

    const items = await listDocuments(rootToken, hqOrgId)
    expect(items).toHaveLength(2)
    const invoiceRow = items.find((row) => row.id === invoiceSlotRowId)
    expect(invoiceRow, 'the invoice slot is listed').toBeTruthy()
    expect(invoiceRow?.fileName).toBe('commercial-invoice.png')
    expect(invoiceRow?.fileSize).toBe(PNG_BYTES.length)
    expect(invoiceRow?.mimeType).toBe('image/png')
    expect(invoiceRow?.createdAt, 'the list carries the registration time').toBeTruthy()
    expect(invoiceRow?.missing).toBe(false)

    const duplicate = await scoped('POST', DOCUMENTS_URL, {
      id: invoiceSlotRowId,
      companyOrderId,
      slot: 'commercial_invoice',
      attachmentId: invoiceAttachmentId,
    })
    expect(duplicate.status(), 'a duplicate registration 409s').toBe(409)
  })

  test('an attachment that is not a document file of the root is refused', async () => {
    const mismatch = await scoped('POST', DOCUMENTS_URL, {
      id: randomUUID(),
      companyOrderId,
      slot: 'packing_list',
      // The invoice attachment belongs to another record id (a different slot row).
      attachmentId: invoiceAttachmentId,
    })
    expect(mismatch.status(), await mismatch.text()).toBe(422)
    expect((await readJsonSafe<{ code?: string }>(mismatch))?.code).toBe('company_order_document_attachment_invalid')
  })

  test('the byte proxy streams both slot files byte-identically', async () => {
    const invoiceBytes = await scoped('GET', `${BYTES_URL}/${encodeURIComponent(invoiceAttachmentId)}?download=1`)
    expect(invoiceBytes.status(), await invoiceBytes.text()).toBe(200)
    expect(invoiceBytes.headers()['content-disposition']).toContain('attachment;')
    expect((await invoiceBytes.body()).equals(PNG_BYTES), 'the proxy serves the invoice bytes').toBe(true)

    const invoiceInline = await scoped('GET', `${BYTES_URL}/${encodeURIComponent(invoiceAttachmentId)}`)
    expect(invoiceInline.status(), await invoiceInline.text()).toBe(200)
    expect(invoiceInline.headers()['content-type']).toBe('image/png')
    expect((await invoiceInline.body()).equals(PNG_BYTES)).toBe(true)

    const stampBytes = await scoped('GET', `${BYTES_URL}/${encodeURIComponent(stampAttachmentId)}?download=1`)
    expect(stampBytes.status(), await stampBytes.text()).toBe(200)
    expect((await stampBytes.body()).equals(TEXT_BYTES), 'the proxy serves the stamp bytes').toBe(true)
  })

  test('detaching a slot removes its row; the stored file is still the caller’s to delete', async () => {
    const detached = await scoped('DELETE', `${DOCUMENTS_URL}?id=${encodeURIComponent(invoiceSlotRowId)}`)
    expect(detached.status(), await detached.text()).toBe(200)
    expect((await readJsonSafe<{ ok?: boolean }>(detached))?.ok).toBe(true)

    const items = await listDocuments(rootToken, hqOrgId)
    expect(items.map((row) => row.id)).toEqual([stampSlotRowId])
  })

  test('a collaborator lists and downloads but is refused on register and delete', async () => {
    expect(await listDocuments(branchToken, branchOrgId ?? hqOrgId), 'the branch sees nothing before it collaborates').toHaveLength(0)

    const added = await scoped('POST', COLLABORATORS_URL, { companyOrderId, organizationIds: [branchOrgId] })
    expect(added.status(), await added.text()).toBe(200)

    const listed = await listDocuments(branchToken, branchOrgId ?? hqOrgId)
    expect(listed.map((row) => row.id), 'the collaborator lists the owner’s slot row').toEqual([stampSlotRowId])

    const bytes = await scoped('GET', `${BYTES_URL}/${encodeURIComponent(stampAttachmentId)}?download=1`, undefined, branchToken, branchOrgId ?? hqOrgId)
    expect(bytes.status(), await bytes.text()).toBe(200)
    expect((await bytes.body()).equals(TEXT_BYTES), 'the collaborator downloads byte-identical content').toBe(true)

    const register = await scoped(
      'POST',
      DOCUMENTS_URL,
      { id: randomUUID(), companyOrderId, slot: 'packing_list', attachmentId: stampAttachmentId },
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(register.status(), 'registering stays owner-only').toBe(403)
    expect((await readJsonSafe<{ code?: string }>(register))?.code).toBe('company_order_owner_required')

    const detach = await scoped(
      'DELETE',
      `${DOCUMENTS_URL}?id=${encodeURIComponent(stampSlotRowId)}`,
      undefined,
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(detach.status(), 'detaching stays owner-only').toBe(403)
    expect((await readJsonSafe<{ code?: string }>(detach))?.code).toBe('company_order_owner_required')
  })

  test('an unrelated organization reads an empty list, a 404 for the bytes, and a 404 on register', async () => {
    expect(await listDocuments(siblingToken, siblingOrgId ?? hqOrgId), 'an unrelated organization lists nothing').toHaveLength(0)

    const denied = await scoped(
      'GET',
      `${BYTES_URL}/${encodeURIComponent(stampAttachmentId)}`,
      undefined,
      siblingToken,
      siblingOrgId ?? hqOrgId,
    )
    expect(denied.status(), 'an unrelated organization cannot read the bytes').toBe(404)

    const register = await scoped(
      'POST',
      DOCUMENTS_URL,
      { id: randomUUID(), companyOrderId, slot: 'packing_list', attachmentId: stampAttachmentId },
      siblingToken,
      siblingOrgId ?? hqOrgId,
    )
    expect(register.status(), 'an invisible root is a 404, not a 403').toBe(404)
  })
})
