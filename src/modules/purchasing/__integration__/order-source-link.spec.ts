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
 * The purchase order's source anchor (`src/modules/purchasing`).
 *
 * `.ai/specs/2026-10-08-order-centric-entry.md` (TEST-201…TEST-203, AC-006): a purchase order can be
 * raised *for* a sales order, the anchor's kind and number are derived and frozen from the sales
 * order itself, an id that does not resolve in the caller's organization is refused with 422 rather
 * than stored, the list can be narrowed by the anchor, and clearing it clears all three columns.
 *
 * The kind is read from the sales order's channel, so the fixture has to build a real trade-type
 * document: the catalog product, the product master row, the supplier and the sales order all exist
 * before the first purchase order is written.
 */

const PURCHASE_ORDERS_URL = '/api/purchasing/purchase-orders'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const STAFF_PASSWORD = 'OrderSource!2026'
const STAFF_FEATURES = ['purchasing.orders.view', 'purchasing.orders.manage']

type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type PurchaseOrderRow = {
  id: string
  number: string | null
  sourceSalesOrderId: string | null
  sourceSalesOrderKind: string | null
  sourceSalesOrderNumber: string | null
  updatedAt?: string | null
  updated_at?: string | null
}
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }

test.describe.serial('purchasing — purchase order source link', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  let staffToken = ''
  let internalChannelId = ''
  let catalogProductId = ''
  let productId = ''
  let supplierId = ''
  let salesOrderId = ''
  let salesOrderNumber = ''
  const purchaseOrderIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const readOrder = async (id: string): Promise<PurchaseOrderRow> => {
    const response = await scoped('GET', `${PURCHASE_ORDERS_URL}?ids=${encodeURIComponent(id)}&pageSize=1`)
    expect(response.status()).toBe(200)
    const item = (await readJsonSafe<ListPayload<PurchaseOrderRow>>(response))?.items?.[0]
    expect(item, 'the purchase order must be readable back').toBeTruthy()
    return item as PurchaseOrderRow
  }

  const createOrder = async (data: Record<string, unknown>, token = rootToken, orgId = hqOrgId) => {
    const response = await scoped('POST', PURCHASE_ORDERS_URL, data, token, orgId)
    const body = await response.text()
    const id = (JSON.parse(body || '{}') as IdPayload).id
    if (id) purchaseOrderIds.push(id)
    return { status: response.status(), id: id ?? '', body }
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    expect(channels.status()).toBe(200)
    internalChannelId = String((await readJsonSafe<ChannelPayload>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded for this organization').toBeTruthy()

    const catalogSku = `SRC-LINK-${stamp}`.toUpperCase()
    const catalog = await scoped('POST', '/api/catalog/products', {
      title: `Source link product ${stamp}`,
      sku: catalogSku,
      description: 'Long enough description for the catalog create validation in QA automation flows.',
    })
    const catalogBody = await readJsonSafe<Record<string, unknown>>(catalog)
    catalogProductId = String(
      [catalogBody?.id, (catalogBody?.item as Record<string, unknown>)?.id].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ) ?? '',
    )
    expect(catalogProductId, 'the catalog product fixture resolved an id').toBeTruthy()

    const product = await scoped('POST', '/api/products/items', {
      sku: catalogSku,
      name: `Source link product ${stamp}`,
      catalogProductId,
      unit: 'PCS',
    })
    expect(product.status(), 'POST /api/products/items should return 201').toBe(201)
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    expect(productId).toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Source link supplier ${stamp}`,
      code: `SRC-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), 'POST /api/purchasing/suppliers should return 201').toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const salesOrder = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId: internalChannelId,
      customerSnapshot: { name: `Source link buyer ${stamp}`, internalSales: { organizationId: hqOrgId } },
      lines: [{ kind: 'product', name: 'Source link line', currencyCode: 'CNY', quantity: 3, unitPriceNet: 10 }],
    })
    expect(salesOrder.status(), 'POST /api/sales/orders should return 201').toBe(201)
    salesOrderId = String((await readJsonSafe<IdPayload>(salesOrder))?.id ?? '')
    expect(salesOrderId).toBeTruthy()

    const readSalesOrder = await scoped(
      'GET',
      `/api/sales/orders?ids=${encodeURIComponent(salesOrderId)}&pageSize=1`,
    )
    const orderRow = (await readJsonSafe<ListPayload<{ orderNumber?: string | null }>>(readSalesOrder))?.items?.[0]
    salesOrderNumber = String(orderRow?.orderNumber ?? '')
    expect(salesOrderNumber, 'the sales order fixture carries a number to freeze').toBeTruthy()

    // A second organization, to prove the anchor does not resolve across organizations.
    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Source link branch ${stamp}`,
      tenantId,
    })
    roleId = await createRoleFixture(api, rootToken, { name: `Source link staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: STAFF_FEATURES })
    const staffEmail = `src-link-staff-${stamp}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [roleId],
      name: 'Source link staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of purchaseOrderIds) {
      await scoped('DELETE', `${PURCHASE_ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (salesOrderId) {
      await scoped('DELETE', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`).catch(() => undefined)
    }
    if (supplierId) {
      await scoped('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    }
    if (productId) {
      await scoped('DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    }
    if (catalogProductId) {
      await scoped('DELETE', `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('the anchor is frozen from the sales order and read back', async () => {
    const created = await createOrder({
      supplierId,
      currencyCode: 'CNY',
      sourceSalesOrderId: salesOrderId,
      lines: [{ productId, quantity: 3, unitPrice: 88, taxRate: 0, priceIncludesTax: true }],
    })
    expect(created.status, created.body).toBe(201)

    const row = await readOrder(created.id)
    expect(row.sourceSalesOrderId).toBe(salesOrderId)
    expect(row.sourceSalesOrderKind).toBe('internal_sales_order')
    expect(row.sourceSalesOrderNumber).toBe(salesOrderNumber)
  })

  test('an anchor that does not resolve in this organization is refused with 422', async () => {
    const unknown = await createOrder({
      supplierId,
      currencyCode: 'CNY',
      sourceSalesOrderId: '11111111-1111-4111-8111-111111111111',
      lines: [{ productId, quantity: 1, unitPrice: 10, taxRate: 0, priceIncludesTax: true }],
    })
    expect(unknown.status, unknown.body).toBe(422)
    expect(unknown.body).toContain('source_sales_order_not_found')

    // The same id, written by an operator of another organization: the sales order exists, but not
    // in that caller's scope, so the refusal must be identical.
    const crossOrg = await createOrder(
      {
        supplierId,
        currencyCode: 'CNY',
        sourceSalesOrderId: salesOrderId,
        lines: [{ productId, quantity: 1, unitPrice: 10, taxRate: 0, priceIncludesTax: true }],
      },
      staffToken,
      branchOrgId as string,
    )
    expect(crossOrg.status, crossOrg.body).toBe(422)
    expect(crossOrg.body).toContain('source_sales_order_not_found')
  })

  test('the list can be narrowed by the source order', async () => {
    const anchored = await createOrder({
      supplierId,
      currencyCode: 'CNY',
      sourceSalesOrderId: salesOrderId,
      lines: [{ productId, quantity: 2, unitPrice: 50, taxRate: 0, priceIncludesTax: true }],
    })
    expect(anchored.status, anchored.body).toBe(201)

    const standalone = await createOrder({
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 1, unitPrice: 5, taxRate: 0, priceIncludesTax: true }],
    })
    expect(standalone.status, standalone.body).toBe(201)

    const response = await scoped(
      'GET',
      `${PURCHASE_ORDERS_URL}?sourceSalesOrderId=${encodeURIComponent(salesOrderId)}&pageSize=50`,
    )
    expect(response.status()).toBe(200)
    const rows = (await readJsonSafe<ListPayload<PurchaseOrderRow>>(response))?.items ?? []
    const ids = rows.map((row) => row.id)
    expect(ids).toContain(anchored.id)
    expect(ids).not.toContain(standalone.id)
    expect(rows.every((row) => row.sourceSalesOrderId === salesOrderId)).toBe(true)
  })

  test('clearing the anchor clears all three columns', async () => {
    const created = await createOrder({
      supplierId,
      currencyCode: 'CNY',
      sourceSalesOrderId: salesOrderId,
      lines: [{ productId, quantity: 1, unitPrice: 30, taxRate: 0, priceIncludesTax: true }],
    })
    expect(created.status, created.body).toBe(201)
    const before = await readOrder(created.id)
    const version = String(before.updatedAt ?? before.updated_at ?? '')
    expect(version, 'the detail read must carry the optimistic-lock version').toBeTruthy()

    const cleared = await api.fetch(`${PURCHASE_ORDERS_URL}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${rootToken}`,
        'Content-Type': 'application/json',
        Cookie: `om_selected_org=${hqOrgId}`,
        [LOCK_HEADER]: version,
      },
      data: { id: created.id, sourceSalesOrderId: null },
    })
    expect(cleared.status(), await cleared.text()).toBe(200)

    const after = await readOrder(created.id)
    expect(after.sourceSalesOrderId).toBeNull()
    expect(after.sourceSalesOrderKind).toBeNull()
    expect(after.sourceSalesOrderNumber).toBeNull()
  })
})
