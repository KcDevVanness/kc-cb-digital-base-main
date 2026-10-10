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
 * Company-order create-time defaults and links — Phase 4.A of
 * `.ai/specs/2026-10-09-company-order-root.md` (TEST-007, REQ-011/REQ-012).
 *
 * `POST /api/order_hub/orders` accepts an optional default customer (`customerPartyId`) and supplier
 * (`supplierId`) — resolved and frozen to a name snapshot in the writer's scope, else 422 — and an
 * optional `links: [{ kind, refId }]` attached **in the same transaction** as the root. A duplicate
 * payload entry, an unknown/cross-organization reference, or a child already attached to another
 * live root is refused with 422. `PUT` re-resolves an id or clears the pair on an explicit `null`
 * (an absent key never clears).
 */

const ORDERS_URL = '/api/order_hub/orders'
const LINKS_URL = '/api/order_hub/orders/links'
const STAFF_FEATURES = ['order_hub.view', 'order_hub.manage']
const STAFF_PASSWORD = 'CompanyFields!2026'

type IdPayload = { id?: string; number?: string | null }
type ListPayload<T> = { items?: T[]; total?: number }
type CompanyOrderRow = {
  id: string
  number: string
  customerPartyId?: string | null
  customerSnapshot?: Record<string, unknown> | null
  supplierId?: string | null
  supplierSnapshot?: Record<string, unknown> | null
  updatedAt?: string | null
  updated_at?: string | null
}
type LinkRow = { id: string; companyOrderId: string; kind: string; refId: string }
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }

test.describe.serial('order_hub — company order create fields', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let branchRoleId: string | null = null
  let branchUserId: string | null = null
  let branchToken = ''
  let partyId = ''
  let supplierId = ''
  let productId = ''
  let catalogProductId = ''
  let internalChannelId = ''
  let salesOrderId = ''
  let salesOrderId2 = ''
  let purchaseOrderId = ''
  let purchaseOrderId2 = ''
  const companyOrderIds: string[] = []
  const purchaseOrderIds: string[] = []
  const salesOrderIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const createCompanyOrder = async (payload: Record<string, unknown>, token = rootToken, orgId = hqOrgId) => {
    const response = await scoped('POST', ORDERS_URL, { title: `Fields root ${stamp}`, ...payload }, token, orgId)
    return response
  }

  const readOrder = async (id: string): Promise<CompanyOrderRow | null> => {
    const response = await scoped('GET', `${ORDERS_URL}?id=${encodeURIComponent(id)}`)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<CompanyOrderRow>>(response))?.items?.[0] ?? null
  }

  const listLinks = async (companyOrderId: string): Promise<LinkRow[]> => {
    const response = await scoped('GET', `${LINKS_URL}?companyOrderId=${encodeURIComponent(companyOrderId)}`)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<LinkRow>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const party = await scoped('POST', '/api/parties', {
      code: `CFIELD-${stamp}`.toUpperCase(),
      name: `Company fields buyer ${stamp}`,
      countryCode: 'CN',
      roles: ['buyer'],
    })
    expect(party.status(), await party.text()).toBe(201)
    partyId = String((await readJsonSafe<IdPayload>(party))?.id ?? '')
    expect(partyId).toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Company fields supplier ${stamp}`,
      code: `CFIELD-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), await supplier.text()).toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    internalChannelId = String((await readJsonSafe<ChannelPayload>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded for this organization').toBeTruthy()

    // One action creates the catalog product and its default variant; the returned id is the
    // catalog product id every downstream document reference uses.
    const productSku = `CFIELD-${stamp}`.toUpperCase()
    const product = await scoped('POST', '/api/products/items', {
      sku: productSku,
      name: `Company fields product ${stamp}`,
      unit: 'PCS',
    })
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    catalogProductId = productId
    expect(productId, 'the product fixture resolved an id').toBeTruthy()

    const createSalesOrder = async (): Promise<string> => {
      const response = await scoped('POST', '/api/sales/orders', {
        currencyCode: 'CNY',
        channelId: internalChannelId,
        customerSnapshot: { name: `Company fields buyer ${stamp}`, internalSales: { organizationId: hqOrgId } },
        lines: [{ kind: 'product', productId, name: `Company fields line ${stamp}`, currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
      })
      expect(response.status(), await response.text()).toBe(201)
      return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    }
    salesOrderId = await createSalesOrder()
    salesOrderIds.push(salesOrderId)
    salesOrderId2 = await createSalesOrder()
    salesOrderIds.push(salesOrderId2)

    const createPurchaseOrder = async (): Promise<string> => {
      const response = await scoped('POST', '/api/purchasing/purchase-orders', {
        supplierId,
        currencyCode: 'CNY',
        lines: [{ catalogProductId, quantity: 3, unitPrice: 12, taxRate: 0, priceIncludesTax: true }],
      })
      expect(response.status(), await response.text()).toBe(201)
      return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    }
    purchaseOrderId = await createPurchaseOrder()
    purchaseOrderIds.push(purchaseOrderId)
    purchaseOrderId2 = await createPurchaseOrder()
    purchaseOrderIds.push(purchaseOrderId2)

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Company fields branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    branchRoleId = await createRoleFixture(api, rootToken, { name: `Company fields staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: branchRoleId, features: STAFF_FEATURES })
    const branchEmail = `company-fields-staff-${stamp}@example.com`
    branchUserId = await createUserFixture(api, rootToken, {
      email: branchEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [branchRoleId],
      name: 'Company fields staff',
    })
    branchToken = await getAuthToken(api, branchEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of companyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of purchaseOrderIds) {
      if (id) await scoped('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of salesOrderIds) {
      if (id) await scoped('DELETE', `/api/sales/orders?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (supplierId) {
      await scoped('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    }
    if (partyId) {
      await scoped('DELETE', `/api/parties?id=${encodeURIComponent(partyId)}`).catch(() => undefined)
    }
    if (productId) {
      await scoped('DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    }
    if (catalogProductId) {
      await scoped('DELETE', `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, branchUserId)
    await deleteRoleIfExists(api, rootToken, branchRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('creates a root with a frozen customer/supplier and one sales + one purchase link in a single call', async () => {
    const response = await createCompanyOrder({
      customerPartyId: partyId,
      supplierId,
      links: [
        { kind: 'internal_sales_order', refId: salesOrderId },
        { kind: 'purchase_order', refId: purchaseOrderId },
      ],
    })
    expect(response.status(), await response.text()).toBe(201)
    const created = await readJsonSafe<IdPayload>(response)
    const id = String(created?.id ?? '')
    expect(id).toBeTruthy()
    companyOrderIds.push(id)

    const order = await readOrder(id)
    expect(order?.customerPartyId).toBe(partyId)
    expect(order?.supplierId).toBe(supplierId)
    expect(String(order?.customerSnapshot?.name), 'the customer name is frozen at write time').toBe(`Company fields buyer ${stamp}`)
    expect(String(order?.supplierSnapshot?.name), 'the supplier name is frozen at write time').toBe(`Company fields supplier ${stamp}`)

    const links = await listLinks(id)
    expect(links, 'both children are visible immediately — same transaction as the root').toHaveLength(2)
    expect(links.map((row) => row.kind).sort()).toEqual(['internal_sales_order', 'purchase_order'])
  })

  test('refuses an unknown or cross-organization reference with 422', async () => {
    const unknownParty = await createCompanyOrder({ customerPartyId: '0f8fad5b-d9cb-469f-a165-70867728950e' })
    expect(unknownParty.status()).toBe(422)
    expect((await readJsonSafe<{ code?: string }>(unknownParty))?.code).toBe('customer_party_not_found')

    const unknownSupplier = await createCompanyOrder({ supplierId: '0f8fad5b-d9cb-469f-a165-70867728950e' })
    expect(unknownSupplier.status()).toBe(422)
    expect((await readJsonSafe<{ code?: string }>(unknownSupplier))?.code).toBe('supplier_not_found')

    const unknownLink = await createCompanyOrder({
      links: [{ kind: 'purchase_order', refId: '0f8fad5b-d9cb-469f-a165-70867728950e' }],
    })
    expect(unknownLink.status()).toBe(422)
    expect((await readJsonSafe<{ code?: string }>(unknownLink))?.code).toBe('link_not_found')

    expect(branchOrgId).toBeTruthy()
    const branch = branchOrgId ?? hqOrgId
    const foreign = await createCompanyOrder(
      { customerPartyId: partyId, supplierId, links: [{ kind: 'purchase_order', refId: purchaseOrderId }] },
      branchToken,
      branch,
    )
    expect(foreign.status(), 'a head-office reference is not visible in the branch').toBe(422)
  })

  test('refuses a duplicate payload entry and moves a child already attached to another root', async () => {
    const duplicate = await createCompanyOrder({
      links: [
        { kind: 'purchase_order', refId: purchaseOrderId2 },
        { kind: 'purchase_order', refId: purchaseOrderId2 },
      ],
    })
    expect(duplicate.status(), 'the same document twice is refused before the unique index sees it').toBe(422)

    // A root that owns the child, then a second root reusing it: attaching is a **move** (one child
    // belongs to one root), so the first root loses its link row in the same transaction.
    const first = await createCompanyOrder({ links: [{ kind: 'internal_sales_order', refId: salesOrderId2 }] })
    expect(first.status(), await first.text()).toBe(201)
    const firstId = String((await readJsonSafe<IdPayload>(first))?.id ?? '')
    companyOrderIds.push(firstId)

    const reuse = await createCompanyOrder({ links: [{ kind: 'internal_sales_order', refId: salesOrderId2 }] })
    expect(reuse.status(), 'the same child can be attached to a new root by moving it').toBe(201)
    const reuseId = String((await readJsonSafe<IdPayload>(reuse))?.id ?? '')
    companyOrderIds.push(reuseId)
    expect(reuseId).not.toBe(firstId)

    const branchOfRef = await scoped('GET', `${LINKS_URL}?refId=${encodeURIComponent(salesOrderId2)}`)
    const rows = (await readJsonSafe<ListPayload<LinkRow>>(branchOfRef))?.items ?? []
    expect(rows, 'the moved child has exactly one link row').toHaveLength(1)
    expect(rows[0]?.companyOrderId, 'and it points at the root that attached it last').toBe(reuseId)
    expect(await listLinks(firstId), 'the first root no longer holds the child').toHaveLength(0)
  })

  test('an explicit null clears the defaults; an absent key leaves them alone', async () => {
    const created = await createCompanyOrder({ customerPartyId: partyId, supplierId })
    expect(created.status(), await created.text()).toBe(201)
    const id = String((await readJsonSafe<IdPayload>(created))?.id ?? '')
    companyOrderIds.push(id)

    const loaded = await readOrder(id)
    const version = String(loaded?.updatedAt ?? loaded?.updated_at ?? '')
    expect(version).toBeTruthy()

    const untouched = await scoped('PUT', ORDERS_URL, { id, updatedAt: version, title: 'Renamed only' })
    expect(untouched.status(), await untouched.text()).toBe(200)
    const afterUntouched = await readOrder(id)
    expect(afterUntouched?.customerPartyId, 'an absent key does not clear the stored customer').toBe(partyId)
    expect(afterUntouched?.supplierId).toBe(supplierId)

    const nextVersion = String(afterUntouched?.updatedAt ?? afterUntouched?.updated_at ?? '')
    const cleared = await scoped('PUT', ORDERS_URL, {
      id,
      updatedAt: nextVersion,
      customerPartyId: null,
      supplierId: null,
    })
    expect(cleared.status(), await cleared.text()).toBe(200)
    const afterCleared = await readOrder(id)
    expect(afterCleared?.customerPartyId).toBeNull()
    expect(afterCleared?.customerSnapshot).toBeNull()
    expect(afterCleared?.supplierId).toBeNull()
    expect(afterCleared?.supplierSnapshot).toBeNull()
  })
})
