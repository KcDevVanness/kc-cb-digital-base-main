import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Supplier product promotion — one master SKU, one supplier row.
 *
 * `.ai/specs/2026-09-24-supplier-product-code-rules.md` (REQ-PC-010, TEST-PC-007): when a row's code
 * matches a master product that **another live supplier row already owns**, promotion must refuse
 * instead of writing this row's name/spec/packaging over that supplier's data. The intent behind a
 * second row for the same item is 关联已有商品, and the test proves that path still works.
 *
 * It also pins the behaviour the guard must not break: a master created by hand (no supplier row owns
 * it) is still synced by SKU.
 */

const LIBRARY_URL = '/api/purchasing/supplier-products'
const ITEMS_URL = '/api/products/items'
const STAFF_PASSWORD = 'PromotionGuard!2026'
const STAFF_FEATURES = [
  'purchasing.suppliers.view',
  'purchasing.suppliers.manage',
  'purchasing.supplier-products.view',
  'purchasing.supplier-products.manage',
  'purchasing.supplier-products.promote',
  'products.items.view',
  'products.items.manage',
  'products.prices.manage',
]

type Promoted = { productId?: string; action?: string }
type ProductDetail = { item?: { id?: string; sku?: string; name?: string } }

test.describe.serial('purchasing — supplier product promotion guard', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let staffRoleId: string | null = null
  let staffUserId: string | null = null
  let supplierAId = ''
  let supplierBId = ''
  let handMadeProductId = ''
  let createdProductId = ''
  let rowBId = ''
  let rowCId = ''
  let rowAId = ''

  const stamp = Date.now().toString(36)
  const sharedCode = `GUARD-${stamp.toUpperCase()}`
  const handMadeCode = `HAND-${stamp.toUpperCase()}`

  const staffRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: staffToken, selectedOrgId: hqOrgId, data })

  const createRow = async (supplierId: string, supplierSku: string, name: string): Promise<string> => {
    const response = await staffRequest('POST', LIBRARY_URL, { supplierId, supplierSku, name })
    expect(response.status(), `library row ${supplierSku} is created`).toBe(201)
    const id = String((await readJsonSafe<{ id?: string }>(response))?.id ?? '')
    expect(id).toBeTruthy()
    return id
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    staffRoleId = await createRoleFixture(api, rootToken, { name: `Promotion guard E2E ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })
    const staffEmail = `promotion-guard-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'Promotion guard E2E',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    for (const [index, label] of ['A', 'B'].entries()) {
      const supplier = await staffRequest('POST', '/api/purchasing/suppliers', {
        name: `Guard supplier ${label} ${stamp}`,
        code: `GUARD${index}-${stamp}`.toUpperCase(),
        defaultCurrencyCode: 'CNY',
      })
      expect(supplier.status()).toBe(201)
      const id = String((await readJsonSafe<{ id?: string }>(supplier))?.id ?? '')
      expect(id).toBeTruthy()
      if (index === 0) supplierAId = id
      else supplierBId = id
    }
  })

  test.afterAll(async () => {
    for (const id of [rowAId, rowBId, rowCId]) {
      if (!id) continue
      await staffRequest('DELETE', `${LIBRARY_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of [handMadeProductId, createdProductId]) {
      if (!id) continue
      await staffRequest('DELETE', `${ITEMS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await api.dispose()
  })

  test('refuses to overwrite a master another supplier row owns, and links instead', async () => {
    // A master created by hand: no supplier row owns it, so promotion must still sync by SKU.
    const handMade = await staffRequest('POST', ITEMS_URL, { sku: handMadeCode, name: 'Hand-made master' })
    expect(handMade.status()).toBe(201)
    handMadeProductId = String((await readJsonSafe<{ id?: string }>(handMade))?.id ?? '')
    expect(handMadeProductId).toBeTruthy()

    rowAId = await createRow(supplierAId, handMadeCode, 'Row A name')
    const synced = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowAId })
    expect(synced.status(), 'an unowned master is still synced by SKU').toBe(200)
    const syncedBody = await readJsonSafe<Promoted>(synced)
    expect(syncedBody?.productId).toBe(handMadeProductId)
    expect(['created', 'updated']).toContain(String(syncedBody?.action))

    // Row B creates its own master from the shared code.
    rowBId = await createRow(supplierBId, sharedCode, 'Row B name')
    const created = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowBId })
    expect(created.status()).toBe(200)
    const createdBody = await readJsonSafe<Promoted>(created)
    expect(createdBody?.action).toBe('created')
    createdProductId = String(createdBody?.productId ?? '')
    expect(createdProductId).toBeTruthy()

    // Row C carries the same code for the *other* supplier: promotion must refuse, not overwrite.
    rowCId = await createRow(supplierAId, sharedCode, 'Row C name')
    const refused = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowCId })
    expect(refused.status(), 'a second row for an owned SKU is refused').toBe(422)
    const refusedBody = await readJsonSafe<{ code?: string }>(refused)
    expect(refusedBody?.code).toBe('sku_owned_by_another_supplier_product')

    // Nothing was written: the master still carries the owning row's name.
    const master = await staffRequest('GET', `${ITEMS_URL}/${createdProductId}`)
    expect(master.status()).toBe(200)
    const masterItem = (await readJsonSafe<ProductDetail>(master))?.item
    expect(masterItem?.name, 'the owning supplier row still owns the master data').toBe('Row B name')
    expect(masterItem?.sku).toBe(sharedCode)

    // The intended action works: link the second row to the same master, then promote is a no-op.
    const linked = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowCId, productId: createdProductId })
    expect(linked.status(), '关联已有商品 is the supported path').toBe(200)
    const afterLink = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowCId })
    expect(afterLink.status()).toBe(200)
    expect((await readJsonSafe<Promoted>(afterLink))?.action).toBe('skipped')
  })
})
