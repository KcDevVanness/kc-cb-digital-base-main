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
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The supplier library's side of product codes (`src/modules/purchasing`).
 *
 * `.ai/specs/2026-09-24-supplier-product-code-rules.md` (TEST-PC-006, TEST-PC-008):
 *
 * 1. a row inherits the supplier's default brand, a generated code saves onto it, and 建商品档案 makes
 *    that code the master product's SKU;
 * 2. a retired code stays findable — both in the library list and in the product list — through the
 *    alias the re-code records.
 */

const LIBRARY_URL = '/api/purchasing/supplier-products'
const SUPPLIERS_URL = '/api/purchasing/suppliers'
const ITEMS_URL = '/api/products/items'
const GENERATE_URL = '/api/product_codes/generate'
const ALIAS_URL = '/api/product_codes/aliases'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const STAFF_PASSWORD = 'SupplierCodes!2026'
const STAFF_FEATURES = [
  'purchasing.suppliers.view',
  'purchasing.suppliers.manage',
  'purchasing.supplier-products.view',
  'purchasing.supplier-products.manage',
  'purchasing.supplier-products.promote',
  'product_codes.rules.view',
  'product_codes.rules.manage',
  'product_codes.codes.generate',
  'products.items.view',
  'products.items.manage',
  'products.prices.manage',
]

type LibraryRow = { id: string; supplierSku: string; brandValue: string | null; productId: string | null; updatedAt: string | null }

test.describe.serial('purchasing — generated codes on the supplier library', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let roleId: string | null = null
  let userId: string | null = null
  let supplierId = ''
  let rowId = ''
  let retiredRowId = ''
  let promotedProductId = ''
  let retiredCode = ''

  const stamp = Date.now().toString(36).toUpperCase()

  const staffRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: staffToken, selectedOrgId: hqOrgId, data })

  const lockedRequest = (method: string, path: string, data: unknown, updatedAt: string) =>
    apiRequest(api, method, path, {
      token: staffToken,
      headers: { [LOCK_HEADER]: updatedAt, cookie: `om_selected_org=${hqOrgId}` },
      data,
    })

  const readRow = async (id: string): Promise<LibraryRow> => {
    const response = await staffRequest('GET', `${LIBRARY_URL}?ids=${encodeURIComponent(id)}&pageSize=1`)
    expect(response.status()).toBe(200)
    const item = (await readJsonSafe<{ items?: LibraryRow[] }>(response))?.items?.[0]
    expect(item, 'the row must be readable').toBeTruthy()
    return item as LibraryRow
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    roleId = await createRoleFixture(api, rootToken, { name: `Supplier codes E2E ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: STAFF_FEATURES })
    const email = `supplier-codes-${stamp.toLowerCase()}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [roleId],
      name: 'Supplier codes E2E',
    })
    staffToken = await getAuthToken(api, email, STAFF_PASSWORD)

    // The supplier carries the brand its codes are generated under; `PK` is PetKit in the seeded list.
    const supplier = await staffRequest('POST', SUPPLIERS_URL, {
      name: `PetKit E2E ${stamp}`,
      code: `PETKIT-${stamp}`,
      defaultCurrencyCode: 'CNY',
      brandValue: 'PK',
    })
    expect(supplier.status()).toBe(201)
    supplierId = String((await readJsonSafe<{ id?: string }>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()
  })

  test.afterAll(async () => {
    for (const id of [rowId, retiredRowId]) {
      if (id) await staffRequest('DELETE', `${LIBRARY_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (promotedProductId) {
      await staffRequest('DELETE', `${ITEMS_URL}?id=${encodeURIComponent(promotedProductId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await api.dispose()
  })

  test('inherits the supplier brand, takes a generated code, and promotes it into the master SKU', async () => {
    const created = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: `LEGACY-${stamp}`,
      name: 'Eversweet 3 Pro',
      unit: 'PCS',
    })
    expect(created.status()).toBe(201)
    rowId = String((await readJsonSafe<{ id?: string }>(created))?.id ?? '')
    expect(rowId).toBeTruthy()

    const inherited = await readRow(rowId)
    expect(inherited.brandValue, 'the row inherits the supplier’s default brand').toBe('PK')

    const generated = await staffRequest('POST', GENERATE_URL, {
      brandValue: inherited.brandValue,
      categoryValue: 'CL',
      dryRun: false,
    })
    expect(generated.status()).toBe(200)
    const issued = await readJsonSafe<{ code?: string; parts?: Array<{ label: string | null }> }>(generated)
    expect(String(issued?.code)).toMatch(/^PK-CL\d{3}$/)
    // Prefix, not equality: the code-list label is shared state, and another spec in the same
    // database renames it to prove a rename stays allowed.
    expect(String(issued?.parts?.[0]?.label)).toContain('PetKit')

    const updated = await lockedRequest(
      'PUT',
      LIBRARY_URL,
      {
        id: rowId,
        supplierSku: issued?.code,
        name: 'Eversweet 3 Pro',
        unit: 'PCS',
        brandValue: 'PK',
        status: 'active',
      },
      inherited.updatedAt ?? '',
    )
    expect(updated.status(), 'the generated code saves onto the row').toBe(200)
    expect((await readRow(rowId)).supplierSku).toBe(issued?.code)

    const promoted = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowId })
    expect(promoted.status()).toBe(200)
    const promotion = await readJsonSafe<{ productId?: string; action?: string }>(promoted)
    promotedProductId = String(promotion?.productId ?? '')
    expect(promotion?.action).toBe('created')

    const product = await staffRequest('GET', `${ITEMS_URL}/${promotedProductId}`)
    expect(product.status()).toBe(200)
    const item = (await readJsonSafe<{ item?: { sku?: string } }>(product))?.item
    expect(item?.sku, 'the master SKU is the generated code').toBe(issued?.code)
  })

  test('keeps a retired code findable in both lists', async () => {
    retiredCode = `P4108-${stamp}`
    const created = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: retiredCode,
      name: 'Legacy scoop',
      unit: 'PCS',
    })
    expect(created.status()).toBe(201)
    retiredRowId = String((await readJsonSafe<{ id?: string }>(created))?.id ?? '')
    expect(retiredRowId).toBeTruthy()

    const reCoded = await staffRequest('POST', GENERATE_URL, { brandValue: 'PK', categoryValue: 'LS', dryRun: false })
    const newCode = String((await readJsonSafe<{ code?: string }>(reCoded))?.code ?? '')
    expect(newCode).toMatch(/^PK-LS\d{3}$/)

    const aliased = await staffRequest('POST', ALIAS_URL, {
      aliasCode: retiredCode,
      targetKind: 'supplier_product',
      targetId: retiredRowId,
    })
    expect(aliased.status(), 'the retired code is recorded').toBe(201)

    const current = await readRow(retiredRowId)
    const renamed = await lockedRequest(
      'PUT',
      LIBRARY_URL,
      { id: retiredRowId, supplierSku: newCode, name: 'Legacy scoop', unit: 'PCS', status: 'active' },
      current.updatedAt ?? '',
    )
    expect(renamed.status()).toBe(200)
    expect((await readRow(retiredRowId)).supplierSku).toBe(newCode)

    // The library list finds the row by the code that is still on the paperwork.
    const librarySearch = await staffRequest('GET', `${LIBRARY_URL}?search=${encodeURIComponent(retiredCode)}`)
    expect(librarySearch.status()).toBe(200)
    const found = (await readJsonSafe<{ items?: Array<{ id: string }> }>(librarySearch))?.items ?? []
    expect(found.map((row) => row.id)).toContain(retiredRowId)

    // …and so does the product list, for the product this row is linked to.
    if (promotedProductId) {
      const productAlias = await staffRequest('POST', ALIAS_URL, {
        aliasCode: `OLD-${stamp}`,
        targetKind: 'product',
        targetId: promotedProductId,
      })
      expect(productAlias.status()).toBe(201)
      const productSearch = await staffRequest('GET', `${ITEMS_URL}?search=${encodeURIComponent(`OLD-${stamp}`)}&pageSize=10`)
      expect(productSearch.status()).toBe(200)
      const products = (await readJsonSafe<{ items?: Array<{ id: string }> }>(productSearch))?.items ?? []
      expect(products.map((product) => product.id)).toContain(promotedProductId)
    }
  })

  test('refuses a supplier brand the dictionary does not list, and still allows clearing it', async () => {
    // The form only offers `product_brand` values; the command has to hold the same line, or an API
    // caller can store a brand whose codes can never be generated.
    const unlisted = await staffRequest('POST', SUPPLIERS_URL, {
      name: `Unlisted brand E2E ${stamp}`,
      code: `UNLISTED-${stamp}`,
      defaultCurrencyCode: 'CNY',
      brandValue: 'ZZ',
    })
    expect(unlisted.status(), 'a brand outside the dictionary is refused on create').toBe(400)
    expect(String((await readJsonSafe<{ error?: string }>(unlisted))?.error)).toContain('product_brand')

    const readSupplier = async () => {
      const response = await staffRequest('GET', `${SUPPLIERS_URL}?ids=${encodeURIComponent(supplierId)}&pageSize=1`)
      expect(response.status()).toBe(200)
      const item = (await readJsonSafe<{ items?: Array<{ brandValue?: string | null; updatedAt?: string | null }> }>(response))?.items?.[0]
      expect(item, 'the supplier must be readable').toBeTruthy()
      return item as { brandValue?: string | null; updatedAt?: string | null }
    }

    const before = await readSupplier()
    const beforeBrand = before.brandValue ?? null

    const unlistedUpdate = await lockedRequest(
      'PUT',
      SUPPLIERS_URL,
      { id: supplierId, brandValue: 'ZZ' },
      before.updatedAt ?? '',
    )
    expect(unlistedUpdate.status(), 'changing to an unlisted brand is refused on update').toBe(400)
    expect((await readSupplier()).brandValue ?? null, 'the refused update writes nothing').toBe(beforeBrand)

    const cleared = await lockedRequest('PUT', SUPPLIERS_URL, { id: supplierId, brandValue: null }, before.updatedAt ?? '')
    expect(cleared.status(), 'clearing the optional brand stays allowed').toBe(200)
    const afterClear = await readSupplier()
    expect(afterClear.brandValue ?? null).toBeNull()

    // `PK` is the brand `beforeAll` gave this supplier, so the row ends where it started.
    const restored = await lockedRequest('PUT', SUPPLIERS_URL, { id: supplierId, brandValue: 'PK' }, afterClear.updatedAt ?? '')
    expect(restored.status(), 'a listed brand can be set again').toBe(200)
    expect((await readSupplier()).brandValue).toBe('PK')
  })
})
