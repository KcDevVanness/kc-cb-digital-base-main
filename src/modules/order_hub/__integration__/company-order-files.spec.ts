import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Company-order files — Phase 4.C of `.ai/specs/2026-10-09-company-order-root.md` (REQ-015).
 *
 * The files block is a thin client over the installed `attachments` module: upload via multipart
 * (`entityId`/`recordId`/`file`), list by entity+record, delete by id. This spec proves the root's
 * entity id and record id are the contract the UI uses, without asserting anything about the
 * installed module's own scoping.
 */

const ORDERS_URL = '/api/order_hub/orders'
const ATTACHMENTS_URL = '/api/attachments'
const ENTITY_ID = 'order_hub:company_order'
const BASE_URL = process.env.BASE_URL ?? ''

type IdPayload = { id?: string; number?: string | null }
type AttachmentItem = { id: string; fileName?: string | null }

test.describe.serial('order_hub — company order files', () => {
  let api: APIRequestContext
  let rootToken = ''
  let hqOrgId = ''
  let companyOrderId = ''
  const companyOrderIds: string[] = []

  const scoped = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: hqOrgId, data })

  const listFiles = async (): Promise<AttachmentItem[]> => {
    const response = await scoped(
      'GET',
      `${ATTACHMENTS_URL}?entityId=${encodeURIComponent(ENTITY_ID)}&recordId=${encodeURIComponent(companyOrderId)}`,
    )
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<{ items?: AttachmentItem[] }>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    hqOrgId = context.organizationId

    const created = await scoped('POST', ORDERS_URL, { title: `Files root ${Date.now().toString(36)}` })
    expect(created.status(), await created.text()).toBe(201)
    companyOrderId = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    expect(companyOrderId).toBeTruthy()
    companyOrderIds.push(companyOrderId)
  })

  test.afterAll(async () => {
    for (const id of companyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await api.dispose()
  })

  test('uploads, lists and deletes one file against the company order', async () => {
    expect(await listFiles(), 'a fresh root has no files').toHaveLength(0)

    const upload = await api.post(`${BASE_URL}${ATTACHMENTS_URL}`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
        Cookie: `om_selected_org=${hqOrgId}`,
      },
      multipart: {
        entityId: ENTITY_ID,
        recordId: companyOrderId,
        file: { name: 'company-order-note.txt', mimeType: 'text/plain', buffer: Buffer.from('company order file smoke') },
      },
    })
    expect(upload.status(), `POST /api/attachments answered ${await upload.text()}`).toBe(200)
    const attachmentId = String((await readJsonSafe<{ item?: AttachmentItem }>(upload))?.item?.id ?? '')
    expect(attachmentId, 'the upload answers with the attachment id').toBeTruthy()

    const listed = await listFiles()
    expect(listed.map((row) => row.id)).toContain(attachmentId)

    const deleted = await scoped('DELETE', `${ATTACHMENTS_URL}?id=${encodeURIComponent(attachmentId)}`)
    expect(deleted.status(), await deleted.text()).toBe(200)
    expect((await listFiles()).map((row) => row.id)).not.toContain(attachmentId)
  })
})
