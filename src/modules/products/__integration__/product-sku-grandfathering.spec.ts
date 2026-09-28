import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Product SKU grandfathering (`src/modules/products`).
 *
 * `.ai/specs/2026-09-24-supplier-product-code-rules.md` (REQ-PC-009, TEST-PC-007): a product whose
 * SKU predates the charset rule must stay editable — name, spec, prices — while every **changed** SKU
 * still has to pass `SKU_PATTERN`. The update schema therefore no longer carries the rule; the update
 * command applies it to a changed value only.
 *
 * The legacy value is written with SQL on purpose: no API can produce it (`products.items.create`
 * validates the pattern), and that is exactly the state a database migrated from the spreadsheet era
 * is in. Without the grandfathering fix, step 3 below returns 400 and the row is uneditable forever.
 */

const ITEMS_URL = '/api/products/items'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const STAFF_PASSWORD = 'ProductSku!2026'
const STAFF_FEATURES = ['products.items.view', 'products.items.manage']

/** Breaks `SKU_PATTERN` twice over: a space and a `#`. */
const LEGACY_SKU = '测试 001#'

type ProductDetail = { item?: { id?: string; sku?: string; name?: string; updatedAt?: string | null } }

test.describe.serial('products — legacy SKU grandfathering', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let staffRoleId: string | null = null
  let staffUserId: string | null = null
  let productId = ''

  const stamp = Date.now().toString(36)
  const legalSku = `GRAND-${stamp.toUpperCase()}`

  const staffRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: staffToken, selectedOrgId: hqOrgId, data })

  /** A write carrying the version the read returned, the way `CrudForm` does it. */
  const staffWrite = (method: string, path: string, data: unknown, updatedAt: string) =>
    apiRequest(api, method, path, {
      token: staffToken,
      headers: { [LOCK_HEADER]: updatedAt, cookie: `om_selected_org=${hqOrgId}` },
      data,
    })

  const readProduct = async (): Promise<Required<NonNullable<ProductDetail['item']>>> => {
    const response = await staffRequest('GET', `${ITEMS_URL}/${productId}`)
    expect(response.status(), 'the detail read must succeed').toBe(200)
    const body = await readJsonSafe<ProductDetail>(response)
    const item = body?.item
    expect(item?.updatedAt, 'the detail read must carry the lock version').toBeTruthy()
    return item as Required<NonNullable<ProductDetail['item']>>
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // Granting features needs `superadmin`: the installed check refuses a feature the actor does not
    // itself hold, and the tenant's admin role predates this module.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    staffRoleId = await createRoleFixture(api, rootToken, { name: `Product SKU E2E staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })
    const staffEmail = `product-sku-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'Product SKU E2E staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    if (productId) {
      await staffRequest('DELETE', `${ITEMS_URL}?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await api.dispose()
  })

  test('keeps a legacy SKU editable and still refuses a new illegal one', async () => {
    const created = await staffRequest('POST', ITEMS_URL, { sku: legalSku, name: 'Legacy holder' })
    expect(created.status(), 'the fixture product is created through the real API').toBe(201)
    productId = String((await readJsonSafe<{ id?: string }>(created))?.id ?? '')
    expect(productId).toBeTruthy()

    // Reproduce the migrated state: an SKU the pattern rejects, written where only a migration can.
    await withClient(async (client) => {
      await client.query('update products_products set sku = $1 where id = $2', [LEGACY_SKU, productId])
    })
    const legacy = await readProduct()
    expect(legacy.sku, 'the legacy value is in the row').toBe(LEGACY_SKU)

    // 1. Unchanged illegal SKU + a new name: the update must go through.
    const renamed = await staffWrite('PUT', ITEMS_URL, { id: productId, sku: LEGACY_SKU, name: 'Renamed row' }, legacy.updatedAt ?? '')
    expect(renamed.status(), 'an unchanged legacy SKU must not block the edit').toBe(200)
    const afterRename = await readProduct()
    expect(afterRename.name).toBe('Renamed row')
    expect(afterRename.sku, 'the legacy code is untouched').toBe(LEGACY_SKU)

    // 2. A *changed* illegal SKU is still refused.
    const illegalChange = await staffWrite(
      'PUT',
      ITEMS_URL,
      { id: productId, sku: 'Illegal #2', name: 'Renamed row' },
      afterRename.updatedAt ?? '',
    )
    expect(illegalChange.status(), 'a new illegal SKU is still rejected').toBe(400)

    // 3. A changed legal SKU is accepted and persisted.
    const legalChange = await staffWrite(
      'PUT',
      ITEMS_URL,
      { id: productId, sku: `${legalSku}-2`, name: 'Renamed row' },
      afterRename.updatedAt ?? '',
    )
    expect(legalChange.status()).toBe(200)
    const afterLegalChange = await readProduct()
    expect(afterLegalChange.sku).toBe(`${legalSku}-2`)
  })
})
