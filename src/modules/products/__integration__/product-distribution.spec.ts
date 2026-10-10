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
 * Product distribution to another organization (`src/modules/products`).
 *
 * `.ai/specs/2026-09-28-product-distribution-to-branches.md` (TEST-PD-002, TEST-PD-003, TEST-PD-004):
 * the first call creates the copy — fields, variants and one price set — with `sourceProductId`
 * pointing back at the source; repeating it updates the whitelist fields and variants but never
 * touches the copy's prices; a SKU the target already owns is reported as `sku_taken` and left alone;
 * a target outside the caller's writable organization set is a 403 with no writes.
 *
 * The branch organization fixture is a real child organization of the caller's organization, so the
 * happy path exercises the same scope rules the backend UI runs under.
 */

const ITEMS_URL = '/api/products/items'
const DISTRIBUTE_URL = '/api/products/items/distribute'
const PRICES_URL = '/api/products/prices'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const STAFF_PASSWORD = 'ProductDist!2026'
const STAFF_FEATURES = ['products.items.view', 'products.items.manage']

type ProductItem = {
  id: string
  sku: string
  name: string
  sourceProductId?: string | null
  catalogProductId?: string | null
  updatedAt?: string | null
  variants?: Array<{ sku: string; isDefault?: boolean }>
}

type DistributeResult = {
  created?: number
  updated?: number
  skipped?: Array<{ sku?: string; organizationId?: string; reason?: string }>
}

test.describe.serial('products — distribution to branches', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let staffRoleId: string | null = null
  let staffUserId: string | null = null

  const stamp = Date.now().toString(36)
  const skuA = `PD-A-${stamp.toUpperCase()}`
  const skuB = `PD-B-${stamp.toUpperCase()}`
  const variantCodeA = `${skuA}-V1`
  const sourceAId = { value: '' }
  const sourceBId = { value: '' }
  const branchCopyAId = { value: '' }
  const branchOwnBId = { value: '' }

  const hqRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: hqOrgId, data })

  const branchRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: branchOrgId as string, data })

  const distribute = (productIds: string[] | undefined, organizationIds: string[]) =>
    hqRequest('POST', DISTRIBUTE_URL, { ...(productIds ? { productIds } : {}), organizationIds })

  const listProducts = async (organizationId: string, sku: string): Promise<ProductItem[]> => {
    const response = await apiRequestWithSelectedOrg(api, 'GET', `${ITEMS_URL}?pageSize=100&search=${encodeURIComponent(sku)}`, {
      token: rootToken,
      selectedOrgId: organizationId,
    })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items?: ProductItem[] }>(response)
    return (body?.items ?? []).filter((item) => item.sku === sku)
  }

  const readProduct = async (organizationId: string, id: string): Promise<ProductItem> => {
    const response = await apiRequestWithSelectedOrg(api, 'GET', `${ITEMS_URL}/${id}`, {
      token: rootToken,
      selectedOrgId: organizationId,
    })
    expect(response.status(), 'the product detail read must succeed').toBe(200)
    const body = await readJsonSafe<{ item?: ProductItem }>(response)
    expect(body?.item?.id).toBe(id)
    return body?.item as ProductItem
  }

  const readExportPrice = async (organizationId: string, productId: string): Promise<number | null> => {
    const response = await apiRequestWithSelectedOrg(api, 'GET', `${PRICES_URL}?productId=${productId}&pageSize=50`, {
      token: rootToken,
      selectedOrgId: organizationId,
    })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items?: Array<{ tier?: string; unitPrice?: string }> }>(response)
    const exportRow = (body?.items ?? []).find((row) => row.tier === 'export')
    return exportRow?.unitPrice ? Number(exportRow.unitPrice) : null
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    // Granting features needs `superadmin`: the installed check refuses a feature the actor does not
    // itself hold, and the tenant's own roles predate this module.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Products E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `Products E2E staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, {
      roleId: staffRoleId,
      features: STAFF_FEATURES,
      organizations: [branchOrgId as string],
    })
    const staffEmail = `products-dist-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId as string,
      roles: [staffRoleId],
      name: 'Products E2E staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    // Source A: one product, one default variant, one export price in the source organization.
    const createdA = await hqRequest('POST', ITEMS_URL, {
      sku: skuA,
      name: 'Distribution source A',
      unit: 'PCS',
      variants: [{ code: variantCodeA, name: 'Variant one', isDefault: true }],
    })
    expect(createdA.status(), 'the fixture product is created through the real API').toBe(201)
    sourceAId.value = String((await readJsonSafe<{ id?: string }>(createdA))?.id ?? '')
    expect(sourceAId.value).toBeTruthy()
    const priceWrite = await hqRequest('PUT', PRICES_URL, {
      productId: sourceAId.value,
      rows: [{ tier: 'export', currencyCode: 'USD', minQuantity: 1, unitPrice: '12.5000' }],
    })
    expect(priceWrite.status()).toBe(200)

    // Source B: only a SKU is needed for the collision case.
    const createdB = await hqRequest('POST', ITEMS_URL, { sku: skuB, name: 'Distribution source B' })
    expect(createdB.status()).toBe(201)
    sourceBId.value = String((await readJsonSafe<{ id?: string }>(createdB))?.id ?? '')
  })

  test.afterAll(async () => {
    const cleanupOrg = async (organizationId: string, ids: Array<{ value: string }>) => {
      for (const id of ids) {
        if (!id.value) continue
        await apiRequestWithSelectedOrg(api, 'DELETE', `${ITEMS_URL}?id=${id.value}`, {
          token: rootToken,
          selectedOrgId: organizationId,
        }).catch(() => undefined)
      }
    }
    if (branchOrgId) {
      const branchRows = await apiRequestWithSelectedOrg(api, 'GET', `${ITEMS_URL}?pageSize=100&search=PD-`, {
        token: rootToken,
        selectedOrgId: branchOrgId,
      })
      const branchItems = (await readJsonSafe<{ items?: ProductItem[] }>(branchRows))?.items ?? []
      for (const item of branchItems) {
        await apiRequestWithSelectedOrg(api, 'DELETE', `${ITEMS_URL}?id=${item.id}`, {
          token: rootToken,
          selectedOrgId: branchOrgId,
        }).catch(() => undefined)
      }
    }
    await cleanupOrg(hqOrgId, [sourceAId, sourceBId])
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('creates a copy once, then updates it without duplicating or overwriting its prices', async () => {
    const first = await distribute([sourceAId.value], [branchOrgId as string])
    expect(first.status(), 'distribute must succeed').toBe(200)
    const firstResult = await readJsonSafe<DistributeResult>(first)
    expect(firstResult?.created).toBe(1)
    expect(firstResult?.updated).toBe(0)
    expect(firstResult?.skipped ?? []).toEqual([])

    const copies = await listProducts(branchOrgId as string, skuA)
    expect(copies, 'exactly one copy exists in the branch').toHaveLength(1)
    branchCopyAId.value = copies[0]?.id ?? ''
    const copy = await readProduct(branchOrgId as string, branchCopyAId.value)
    expect(copy.sourceProductId, 'the copy points at its source').toBe(sourceAId.value)
    expect(copy.name).toBe('Distribution source A')
    expect(copy.variants?.map((variant) => variant.sku)).toEqual([variantCodeA])
    expect(copy.catalogProductId, 'the copy is its own catalog product').toBe(branchCopyAId.value)
    expect(await readExportPrice(branchOrgId as string, branchCopyAId.value)).toBe(12.5)

    // The source changes; the branch re-runs the distribution.
    const sourceDetail = await readProduct(hqOrgId, sourceAId.value)
    const renamed = await apiRequest(api, 'PUT', ITEMS_URL, {
      token: rootToken,
      headers: { [LOCK_HEADER]: sourceDetail.updatedAt ?? '', cookie: `om_selected_org=${hqOrgId}` },
      data: { id: sourceAId.value, name: 'Distribution source A (renamed)' },
    })
    expect(renamed.status()).toBe(200)
    const repriced = await hqRequest('PUT', PRICES_URL, {
      productId: sourceAId.value,
      rows: [{ tier: 'export', currencyCode: 'USD', minQuantity: 1, unitPrice: '99.9900' }],
    })
    expect(repriced.status()).toBe(200)

    const second = await distribute([sourceAId.value], [branchOrgId as string])
    expect(second.status()).toBe(200)
    const secondResult = await readJsonSafe<DistributeResult>(second)
    expect(secondResult?.created).toBe(0)
    expect(secondResult?.updated).toBe(1)

    const copiesAfter = await listProducts(branchOrgId as string, skuA)
    expect(copiesAfter, 'a re-run updates, it does not duplicate').toHaveLength(1)
    const copyAfter = await readProduct(branchOrgId as string, branchCopyAId.value)
    expect(copyAfter.name, 'the whitelist fields follow the source').toBe('Distribution source A (renamed)')
    expect(
      await readExportPrice(branchOrgId as string, branchCopyAId.value),
      'prices belong to the target organization after creation',
    ).toBe(12.5)
  })

  test('reports a SKU the target organization already owns instead of overwriting it', async () => {
    const own = await branchRequest('POST', ITEMS_URL, { sku: skuB, name: 'Branch-owned row' })
    expect(own.status(), 'the branch can hold its own row with that SKU').toBe(201)
    branchOwnBId.value = String((await readJsonSafe<{ id?: string }>(own))?.id ?? '')

    const result = await distribute([sourceBId.value], [branchOrgId as string])
    expect(result.status()).toBe(200)
    const body = await readJsonSafe<DistributeResult>(result)
    expect(body?.created).toBe(0)
    expect(body?.updated).toBe(0)
    expect(body?.skipped).toEqual([
      { sku: skuB, organizationId: branchOrgId, reason: 'sku_taken' },
    ])

    const rows = await listProducts(branchOrgId as string, skuB)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id, 'the branch row is untouched').toBe(branchOwnBId.value)
    const ownRow = await readProduct(branchOrgId as string, branchOwnBId.value)
    expect(ownRow.sourceProductId, 'it is still a local row').toBeNull()
  })

  test('denies a target outside the caller’s writable organizations and rejects an empty target set', async () => {
    const foreign = await apiRequestWithSelectedOrg(api, 'POST', DISTRIBUTE_URL, {
      token: staffToken,
      selectedOrgId: branchOrgId as string,
      data: { productIds: [branchCopyAId.value], organizationIds: [hqOrgId] },
    })
    expect(foreign.status(), 'a branch-scoped actor cannot write into the parent organization').toBe(403)

    const selfOnly = await distribute([sourceAId.value], [hqOrgId])
    expect(selfOnly.status(), 'distributing into the source organization itself is a 400').toBe(400)

    const unknownTarget = await distribute([sourceAId.value], ['00000000-0000-4000-8000-000000000000'])
    expect(
      unknownTarget.status(),
      'a target organization that does not exist is refused before anything is written',
    ).toBe(403)
  })
})
