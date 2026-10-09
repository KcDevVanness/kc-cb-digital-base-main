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
 * Company-order child links — Phase 1 of `.ai/specs/2026-10-09-company-order-root.md`.
 *
 * REQ-003: `POST /api/order_hub/orders/links` replaces one kind's whole set and freezes each peer's
 * number, counterparty and status snapshot at link time; `GET /api/order_hub/orders/links` answers
 * both the root's attach block (`?companyOrderId=`) and the reverse lookup (`?refId=`), and a
 * request naming neither is refused. `POST /api/order_hub/orders/link-child` is the idempotent
 * single attach: a sales-kind child with no target gets a fresh draft root, a purchase-kind child
 * cannot invent one, and an id outside the caller's organization is refused rather than stored.
 */

const ORDERS_URL = '/api/order_hub/orders'
const LINKS_URL = '/api/order_hub/orders/links'
const LINK_CHILD_URL = '/api/order_hub/orders/link-child'
const STAFF_FEATURES = ['order_hub.view', 'order_hub.manage']
const STAFF_PASSWORD = 'CompanyLinks!2026'

type IdPayload = { id?: string; number?: string | null; item?: { id?: string } }
type ListPayload<T> = { items?: T[]; total?: number }
type CompanyOrderRow = { id: string; number: string; updatedAt?: string | null; updated_at?: string | null }
type LinkRow = {
  id: string
  companyOrderId: string
  kind: string
  refId: string
  refNumber: string | null
  refCounterparty: string | null
  refSnapshot?: Record<string, unknown> | null
}
type LinkChildResult = { companyOrderId: string; linked: boolean; created: boolean }
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }

test.describe.serial('order_hub — company order links', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let branchRoleId: string | null = null
  let branchUserId: string | null = null
  let branchToken = ''
  let supplierId = ''
  let catalogProductId = ''
  let productId = ''
  let internalChannelId = ''
  let purchaseOrderId = ''
  let purchaseOrderNumber: string | null = null
  let purchaseOrderId2 = ''
  let purchaseOrderId3 = ''
  let salesOrderId = ''
  let salesOrderId2 = ''
  let companyOrderId = ''
  const companyOrderIds: string[] = []
  const branchCompanyOrderIds: string[] = []
  const purchaseOrderIds: string[] = []
  const salesOrderIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const createPurchaseOrder = async (): Promise<string> => {
    const response = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 3, unitPrice: 12, taxRate: 0, priceIncludesTax: true }],
    })
    expect(response.status(), await response.text()).toBe(201)
    return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
  }

  const createSalesOrder = async (channelId: string, name: string): Promise<string> => {
    const response = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId,
      customerSnapshot: { name, internalSales: { organizationId: hqOrgId } },
      lines: [{ kind: 'product', productId, name: `Company links line ${stamp}`, currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
    })
    expect(response.status(), await response.text()).toBe(201)
    return String((await readJsonSafe<IdPayload>(response))?.id ?? '')
  }

  const createCompanyOrder = async (token = rootToken, orgId = hqOrgId, sink: string[] = companyOrderIds): Promise<string> => {
    const response = await scoped('POST', ORDERS_URL, { title: `Company links root ${stamp}` }, token, orgId)
    expect(response.status(), await response.text()).toBe(201)
    const id = String((await readJsonSafe<IdPayload>(response))?.id ?? '')
    if (id) sink.push(id)
    return id
  }

  const readCompanyOrder = async (id: string, token = rootToken, orgId = hqOrgId): Promise<CompanyOrderRow | null> => {
    const response = await scoped('GET', `${ORDERS_URL}?id=${encodeURIComponent(id)}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<CompanyOrderRow>>(response))?.items?.[0] ?? null
  }

  const listLinks = async (query: string, token = rootToken, orgId = hqOrgId): Promise<LinkRow[]> => {
    const response = await scoped('GET', `${LINKS_URL}?${query}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<LinkRow>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    internalChannelId = String((await readJsonSafe<ChannelPayload>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded for this organization').toBeTruthy()

    const catalogSku = `CLINK-${stamp}`.toUpperCase()
    const catalog = await scoped('POST', '/api/catalog/products', {
      title: `Company links product ${stamp}`,
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
      name: `Company links product ${stamp}`,
      catalogProductId,
      unit: 'PCS',
    })
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    expect(productId, 'the app-owned product fixture resolved an id').toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Company links supplier ${stamp}`,
      code: `CLINK-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), await supplier.text()).toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const purchaseOrder = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ productId, quantity: 3, unitPrice: 12, taxRate: 0, priceIncludesTax: true }],
    })
    const purchaseBody = await readJsonSafe<IdPayload>(purchaseOrder)
    purchaseOrderId = String(purchaseBody?.id ?? '')
    purchaseOrderNumber = purchaseBody?.number ?? null
    expect(purchaseOrderId).toBeTruthy()
    purchaseOrderIds.push(purchaseOrderId)
    purchaseOrderId2 = await createPurchaseOrder()
    purchaseOrderIds.push(purchaseOrderId2)
    purchaseOrderId3 = await createPurchaseOrder()
    purchaseOrderIds.push(purchaseOrderId3)

    salesOrderId = await createSalesOrder(internalChannelId, `Company links buyer ${stamp}`)
    salesOrderIds.push(salesOrderId)
    salesOrderId2 = await createSalesOrder(internalChannelId, `Company links buyer two ${stamp}`)
    salesOrderIds.push(salesOrderId2)

    companyOrderId = await createCompanyOrder()

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Company links branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    branchRoleId = await createRoleFixture(api, rootToken, { name: `Company links staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: branchRoleId, features: STAFF_FEATURES })
    const branchEmail = `company-links-staff-${stamp}@example.com`
    branchUserId = await createUserFixture(api, rootToken, {
      email: branchEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrgId,
      roles: [branchRoleId],
      name: 'Company links staff',
    })
    branchToken = await getAuthToken(api, branchEmail, STAFF_PASSWORD)
  })

  test.afterAll(async () => {
    for (const id of companyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of branchCompanyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`, undefined, branchToken, branchOrgId ?? hqOrgId).catch(() => undefined)
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

  test('replaces the child set and freezes each peer snapshot', async () => {
    const replaced = await scoped('POST', LINKS_URL, {
      companyOrderId,
      kind: 'purchase_order',
      refs: [{ refId: purchaseOrderId }],
    })
    expect(replaced.status(), await replaced.text()).toBe(200)
    const body = await readJsonSafe<{ ok?: boolean; count?: number }>(replaced)
    expect(body?.ok).toBe(true)
    expect(body?.count).toBe(1)

    const rows = await listLinks(`companyOrderId=${encodeURIComponent(companyOrderId)}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('purchase_order')
    expect(rows[0]?.refId).toBe(purchaseOrderId)
    expect(rows[0]?.refNumber, 'the snapshot freezes the peer number at link time').toBe(purchaseOrderNumber)
    expect(rows[0]?.refCounterparty, 'the snapshot freezes the peer counterparty').toContain(`Company links supplier ${stamp}`)
    expect(rows[0]?.refSnapshot, 'the frozen snapshot carries the peer status/date/money').toBeTruthy()
  })

  test('refuses duplicates, unknown documents and a stale version', async () => {
    const duplicate = await scoped('POST', LINKS_URL, {
      companyOrderId,
      kind: 'purchase_order',
      refs: [{ refId: purchaseOrderId }, { refId: purchaseOrderId }],
    })
    expect(duplicate.status(), 'the same document twice is refused before the unique key sees it').toBe(422)

    const unknown = await scoped('POST', LINKS_URL, {
      companyOrderId,
      kind: 'purchase_order',
      refs: [{ refId: '0f8fad5b-d9cb-469f-a165-70867728950e' }],
    })
    expect(unknown.status(), 'an id this organization cannot see cannot be linked').toBe(422)

    const stale = await scoped('POST', LINKS_URL, {
      companyOrderId,
      kind: 'purchase_order',
      refs: [{ refId: purchaseOrderId }],
      updatedAt: '2000-01-01T00:00:00.000Z',
    })
    expect(stale.status(), 'a dialog rendered from an older version 409s').toBe(409)
    expect((await readJsonSafe<{ code?: string }>(stale))?.code).toBe('optimistic_lock_conflict')

    // The version the client actually rendered with is accepted, which proves the 409 above came
    // from the version check rather than from a broken payload.
    const root = await readCompanyOrder(companyOrderId)
    const version = String(root?.updatedAt ?? root?.updated_at ?? '')
    expect(version).toBeTruthy()
    const fresh = await scoped('POST', LINKS_URL, {
      companyOrderId,
      kind: 'purchase_order',
      refs: [{ refId: purchaseOrderId }],
      updatedAt: version,
    })
    expect(fresh.status(), await fresh.text()).toBe(200)
  })

  test('link-child attaches once and is idempotent', async () => {
    const first = await scoped('POST', LINK_CHILD_URL, {
      kind: 'purchase_order',
      refId: purchaseOrderId2,
      companyOrderId,
    })
    expect(first.status(), await first.text()).toBe(200)
    const firstBody = await readJsonSafe<LinkChildResult>(first)
    expect(firstBody?.companyOrderId).toBe(companyOrderId)
    expect(firstBody?.linked).toBe(true)
    expect(firstBody?.created).toBe(false)

    const second = await scoped('POST', LINK_CHILD_URL, {
      kind: 'purchase_order',
      refId: purchaseOrderId2,
      companyOrderId,
    })
    expect(second.status(), await second.text()).toBe(200)
    const secondBody = await readJsonSafe<LinkChildResult>(second)
    expect(secondBody?.linked, 'the second attach reports no new link').toBe(false)
    expect(secondBody?.created).toBe(false)

    const rows = await listLinks(`refId=${encodeURIComponent(purchaseOrderId2)}`)
    expect(rows, 'an idempotent attach leaves exactly one row').toHaveLength(1)
    expect(rows[0]?.companyOrderId).toBe(companyOrderId)
  })

  test('sales-kind link-child without a target creates a draft root', async () => {
    const response = await scoped('POST', LINK_CHILD_URL, {
      kind: 'internal_sales_order',
      refId: salesOrderId2,
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await readJsonSafe<LinkChildResult>(response)
    expect(body?.created, 'a sales child with no target gets a fresh root').toBe(true)
    expect(body?.linked).toBe(true)
    expect(body?.companyOrderId, 'the fresh root is not the fixture root').not.toBe(companyOrderId)
    if (body?.companyOrderId) companyOrderIds.push(body.companyOrderId)

    const rows = await listLinks(`refId=${encodeURIComponent(salesOrderId2)}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.companyOrderId).toBe(body?.companyOrderId)
    expect(rows[0]?.kind).toBe('internal_sales_order')
    const root = await readCompanyOrder(body?.companyOrderId ?? '')
    expect(root?.number, 'the auto-created root carries a CO number').toMatch(/^CO-\d{4}-\d{4}$/)
  })

  test('a purchase-kind child cannot invent a root', async () => {
    const response = await scoped('POST', LINK_CHILD_URL, {
      kind: 'purchase_order',
      refId: purchaseOrderId3,
    })
    expect(response.status(), 'a purchase order needs an explicit target').toBe(422)
    expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('company_order_required')
  })

  test('the reverse lookup resolves the owner and a bare request is refused', async () => {
    const rows = await listLinks(`refId=${encodeURIComponent(purchaseOrderId)}`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.companyOrderId).toBe(companyOrderId)

    const bare = await scoped('GET', LINKS_URL)
    expect(bare.status(), 'neither companyOrderId nor refId is refused').toBe(400)
  })

  test('a child of another organization cannot be linked', async () => {
    expect(branchOrgId).toBeTruthy()
    const branch = branchOrgId ?? hqOrgId
    const branchRoot = await createCompanyOrder(branchToken, branch, branchCompanyOrderIds)

    const foreign = await scoped(
      'POST',
      LINKS_URL,
      { companyOrderId: branchRoot, kind: 'purchase_order', refs: [{ refId: purchaseOrderId }] },
      branchToken,
      branch,
    )
    expect(foreign.status(), 'a head-office purchase order is not visible in the branch').toBe(422)

    const branchView = await listLinks(`refId=${encodeURIComponent(purchaseOrderId)}`, branchToken, branch)
    expect(branchView, 'another organization never sees the link').toHaveLength(0)
  })

  test('summaries count the child union and prefer the sales counterparty', async () => {
    const attach = await scoped('POST', LINK_CHILD_URL, {
      kind: 'internal_sales_order',
      refId: salesOrderId,
      companyOrderId,
    })
    expect(attach.status(), await attach.text()).toBe(200)

    const salesHead = await scoped('GET', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`)
    const salesItem = (await readJsonSafe<ListPayload<{ orderNumber?: string | null }>>(salesHead))?.items?.[0]
    const salesNumber = String(salesItem?.orderNumber ?? '')
    expect(salesNumber, 'the sales fixture carries an engine number').toBeTruthy()

    const response = await scoped('GET', `/api/order_hub/stages?ids=${encodeURIComponent(companyOrderId)}`)
    expect(response.status(), await response.text()).toBe(200)
    const item = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response))?.items?.[0]
    expect(item, 'the summary answers for the company order').toBeTruthy()
    expect(Number(item?.procurementCount), 'linked purchase children are counted').toBeGreaterThanOrEqual(1)
    // The purchase children were linked before this sales child: the row's counterparty must still
    // be the sales child's buyer, not whichever link row happens to come first.
    expect(String(item?.counterparty), 'a sales child wins the counterparty over purchase children').toBe(
      `Company links buyer ${stamp}`,
    )
    expect((item?.kinds as string[] | undefined) ?? []).toEqual(
      expect.arrayContaining(['internal_sales_order', 'purchase_order']),
    )
    expect((item?.childNumbers as string[] | undefined) ?? []).toContain(salesNumber)
  })

  test('summaries hide unseen ids and refuse an oversized batch', async () => {
    const unknown = await scoped('GET', '/api/order_hub/stages?ids=0f8fad5b-d9cb-469f-a165-70867728950e')
    expect(unknown.status(), await unknown.text()).toBe(200)
    expect((await readJsonSafe<{ items?: unknown[] }>(unknown))?.items ?? []).toEqual([])

    const ids = Array.from({ length: 201 }, () => '0f8fad5b-d9cb-469f-a165-70867728950e').join(',')
    const tooMany = await scoped('GET', `/api/order_hub/stages?ids=${ids}`)
    expect(tooMany.status()).toBe(400)
  })

  test('attaching a child that already sits on another root moves it', async () => {
    const otherRoot = await createCompanyOrder()
    const moved = await scoped('POST', LINKS_URL, {
      companyOrderId: otherRoot,
      kind: 'purchase_order',
      refs: [{ refId: purchaseOrderId }],
    })
    expect(moved.status(), await moved.text()).toBe(200)

    const rows = await listLinks(`refId=${encodeURIComponent(purchaseOrderId)}`)
    expect(rows, 'one child belongs to one root — exactly one link row remains').toHaveLength(1)
    expect(rows[0]?.companyOrderId, 'and it points at the root that attached it last').toBe(otherRoot)
    // The old root keeps its other children — only *this* child left it.
    const oldRootRows = await listLinks(`companyOrderId=${encodeURIComponent(companyOrderId)}`)
    expect(oldRootRows.filter((row) => row.refId === purchaseOrderId), 'the old root lost that child').toHaveLength(0)
  })
})
