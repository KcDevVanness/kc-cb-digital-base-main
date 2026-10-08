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
 * The workbench's stage projection (`src/modules/order_hub`).
 *
 * `.ai/specs/2026-10-08-order-centric-entry.md` (TEST-301/TEST-302, REQ-009): one read answers the fill
 * progress of a batch of orders — the purchase orders a sales order was sourced with, the shipments
 * carrying its goods, the documents its contracts and shipments carry, and whether the money came back
 * (收汇) and the tax refund exists — and an id outside the caller's organization produces no entry at
 * all, so the response never confirms that a foreign record exists.
 *
 * The fixture builds one order of each kind end to end: a placed purchase order, an internal sales
 * order, a shipment carrying both, a contract linked to the sales order with a PI and a tax invoice, a
 * received collection on the purchase order and a tax-refund record on the shipment.
 */

const STAGES_URL = '/api/order_hub/stages'
const VIEWER_FEATURES = ['order_hub.view']
const VIEWER_PASSWORD = 'StageRead!2026'

type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type StageItem = {
  id: string
  source: 'sales_order' | 'purchase_order'
  procurementCount: number
  shipmentCount: number
  documentCount: number
  collected: boolean
  refunded: boolean
}
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }

test.describe.serial('order_hub — stage projection', () => {
  let api: APIRequestContext
  let rootToken = ''
  let viewerToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  let catalogProductId = ''
  let productId = ''
  let supplierId = ''
  let purchaseOrderId = ''
  let purchaseOrderLineId = ''
  let salesOrderId = ''
  let salesOrderLineId = ''
  let shipmentId = ''
  let contractId = ''
  let documentId = ''
  let invoiceId = ''
  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const readStages = async (ids: string[], token = rootToken, orgId = hqOrgId): Promise<StageItem[]> => {
    const response = await scoped('GET', `${STAGES_URL}?ids=${encodeURIComponent(ids.join(','))}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<StageItem>>(response))?.items ?? []
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    const internalChannelId = String((await readJsonSafe<ChannelPayload>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded').toBeTruthy()

    const catalogSku = `STAGE-${stamp}`.toUpperCase()
    const catalog = await scoped('POST', '/api/catalog/products', {
      title: `Stage product ${stamp}`,
      sku: catalogSku,
      description: 'Long enough description for the catalog create validation in QA automation flows.',
    })
    const catalogBody = await readJsonSafe<Record<string, unknown>>(catalog)
    catalogProductId = String(
      [catalogBody?.id, (catalogBody?.item as Record<string, unknown>)?.id].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ) ?? '',
    )
    const product = await scoped('POST', '/api/products/items', {
      sku: catalogSku,
      name: `Stage product ${stamp}`,
      catalogProductId,
      unit: 'PCS',
    })
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    expect(productId).toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Stage supplier ${stamp}`,
      code: `STAGE-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')

    const salesOrder = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId: internalChannelId,
      customerSnapshot: { name: `Stage buyer ${stamp}`, internalSales: { organizationId: hqOrgId } },
      lines: [
        {
          kind: 'product',
          productId,
          name: `Stage line ${stamp}`,
          currencyCode: 'CNY',
          quantity: 10,
          unitPriceNet: 200,
        },
      ],
    })
    expect(salesOrder.status(), await salesOrder.text()).toBe(201)
    salesOrderId = String((await readJsonSafe<IdPayload>(salesOrder))?.id ?? '')
    const salesLines = await scoped('GET', `/api/sales/order-lines?orderId=${encodeURIComponent(salesOrderId)}&pageSize=10`)
    salesOrderLineId = String((await readJsonSafe<ListPayload<{ id: string }>>(salesLines))?.items?.[0]?.id ?? '')
    expect(salesOrderLineId).toBeTruthy()

    // Raised *for* the sales order: the workbench's 采购 column counts exactly these.
    const purchaseOrder = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      sourceSalesOrderId: salesOrderId,
      lines: [{ productId, quantity: 10, unitPrice: 100, taxRate: 0, priceIncludesTax: true }],
    })
    expect(purchaseOrder.status(), await purchaseOrder.text()).toBe(201)
    purchaseOrderId = String((await readJsonSafe<IdPayload>(purchaseOrder))?.id ?? '')
    const placed = await scoped('POST', '/api/purchasing/purchase-orders/transitions', { id: purchaseOrderId, action: 'place' })
    expect(placed.status(), await placed.text()).toBeLessThan(300)
    const lines = await scoped('GET', `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}`)
    purchaseOrderLineId = String((await readJsonSafe<ListPayload<{ id: string }>>(lines))?.items?.[0]?.id ?? '')

    const shipment = await scoped('POST', '/api/cross_border/shipments', {
      containerNumber: `STAGE-${stamp}`.toUpperCase(),
      allocations: [{ purchaseOrderLineId, quantity: 10 }],
      salesAllocations: [
        { salesOrderId, salesOrderLineId, catalogProductId, quantity: 10, unitPrice: 200, currencyCode: 'CNY' },
      ],
    })
    expect(shipment.status(), await shipment.text()).toBe(201)
    shipmentId = String((await readJsonSafe<IdPayload>(shipment))?.id ?? '')

    const contract = await scoped('POST', '/api/trade_docs/contracts', {
      direction: 'sales',
      counterpartyKind: 'customer',
      counterpartySnapshot: { name: `Stage customer ${stamp}` },
      currencyCode: 'CNY',
      lines: [{ name: `Stage contract line ${stamp}`, quantity: '10', unitPrice: '200' }],
    })
    expect(contract.status(), await contract.text()).toBe(201)
    contractId = String((await readJsonSafe<IdPayload>(contract))?.id ?? '')
    const link = await scoped('POST', '/api/trade_docs/contracts/orders', {
      contractId,
      orders: [{ orderKind: 'internal_sales_order', orderId: salesOrderId }],
    })
    expect(link.status(), await link.text()).toBeLessThan(300)

    const document = await scoped('POST', '/api/trade_docs/documents', {
      kind: 'proforma',
      direction: 'sales',
      contractId,
      counterpartySnapshot: { name: `Stage customer ${stamp}` },
      currencyCode: 'CNY',
      lines: [{ name: `Stage PI line ${stamp}`, quantity: '10', unitPrice: '200' }],
    })
    expect(document.status(), await document.text()).toBe(201)
    documentId = String((await readJsonSafe<IdPayload>(document))?.id ?? '')

    const invoice = await scoped('POST', '/api/trade_docs/invoices', {
      // Invoices carry the printed direction (`outbound` = issued to the customer) and a line amount:
      // the tax invoice is a document that has been printed, not a sales order line.
      direction: 'outbound',
      invoiceKind: 'export',
      contractId,
      counterpartySnapshot: { name: `Stage customer ${stamp}` },
      currencyCode: 'CNY',
      // An invoice line is labelled by `description` (a contract line by `name`) and carries the
      // printed `amount` — the tax invoice schema is its own contract, not the contract line's.
      lines: [{ description: `Stage invoice line ${stamp}`, quantity: '10', unitPrice: '200', amount: '2000' }],
    })
    expect(invoice.status(), await invoice.text()).toBe(201)
    invoiceId = String((await readJsonSafe<IdPayload>(invoice))?.id ?? '')

    // 收汇 and 退税 are upserts, not creates: one archive per purchase order / container.
    const collection = await scoped('PUT', '/api/export_finance/collections', {
      purchaseOrderId,
      currencyCode: 'CNY',
      collectionStatus: 'received',
      collectedAmount: '1000',
      collectedAt: '2026-10-01',
    })
    expect(collection.status(), await collection.text()).toBeLessThan(300)

    const refund = await scoped('PUT', '/api/export_finance/refunds', {
      shipmentId,
      currencyCode: 'CNY',
      taxRefundStatus: 'applied',
      taxRefundAmount: '120',
    })
    expect(refund.status(), await refund.text()).toBeLessThan(300)

    branchOrgId = await createOrganizationFixture(api, rootToken, { name: `Stage branch ${stamp}`, tenantId })
    roleId = await createRoleFixture(api, rootToken, { name: `Stage viewer ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId, features: VIEWER_FEATURES })
    const viewerEmail = `stage-viewer-${stamp}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: branchOrgId,
      roles: [roleId],
      name: 'Stage viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)
  })

  test.afterAll(async () => {
    const cleanups: Array<[string, string]> = [
      [`/api/export_finance/refunds?shipmentId=${encodeURIComponent(shipmentId)}`, 'DELETE'],
      [`/api/export_finance/collections?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`, 'DELETE'],
      [`/api/trade_docs/invoices?id=${encodeURIComponent(invoiceId)}`, 'DELETE'],
      [`/api/trade_docs/documents?id=${encodeURIComponent(documentId)}`, 'DELETE'],
      [`/api/trade_docs/contracts?id=${encodeURIComponent(contractId)}`, 'DELETE'],
      [`/api/cross_border/shipments?id=${encodeURIComponent(shipmentId)}`, 'DELETE'],
      [`/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`, 'DELETE'],
      [`/api/purchasing/purchase-orders?id=${encodeURIComponent(purchaseOrderId)}`, 'DELETE'],
      [`/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`, 'DELETE'],
      [`/api/products/items?id=${encodeURIComponent(productId)}`, 'DELETE'],
      [`/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`, 'DELETE'],
    ]
    for (const [path, method] of cleanups) {
      if (path.includes('=undefined') || path.includes('id=&')) continue
      await scoped(method, path).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('projects each order kind from the rows the fixture wrote', async () => {
    const items = await readStages([salesOrderId, purchaseOrderId])
    expect(items).toHaveLength(2)

    const sales = items.find((item) => item.id === salesOrderId)
    expect(sales, 'the sales order is projected').toBeTruthy()
    expect(sales?.source).toBe('sales_order')
    expect(sales?.procurementCount).toBe(1)
    expect(sales?.shipmentCount).toBe(1)
    // PI + tax invoice of the linked contract; the shipment carries no export document of its own.
    expect(sales?.documentCount).toBe(2)
    expect(sales?.collected).toBe(true)
    expect(sales?.refunded).toBe(true)

    const purchase = items.find((item) => item.id === purchaseOrderId)
    expect(purchase?.source).toBe('purchase_order')
    expect(purchase?.procurementCount).toBe(0)
    expect(purchase?.shipmentCount).toBe(1)
    expect(purchase?.documentCount).toBe(0)
    expect(purchase?.collected).toBe(true)
    expect(purchase?.refunded).toBe(true)
  })

  test('a cancelled purchase order stops counting as procurement', async () => {
    const second = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      sourceSalesOrderId: salesOrderId,
      lines: [{ productId, quantity: 1, unitPrice: 50, taxRate: 0, priceIncludesTax: true }],
    })
    expect(second.status(), await second.text()).toBe(201)
    const secondId = String((await readJsonSafe<IdPayload>(second))?.id ?? '')
    // A cancellation carries its reason: the command refuses a bare cancel with 400, so the fixture
    // asserts the transition instead of assuming it happened.
    const cancelled = await scoped('POST', '/api/purchasing/purchase-orders/transitions', {
      id: secondId,
      action: 'cancel',
      reason: 'fixture: the order was superseded',
    })
    expect(cancelled.status(), await cancelled.text()).toBeLessThan(300)

    const items = await readStages([salesOrderId])
    expect(items[0]?.procurementCount).toBe(1)
    await scoped('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(secondId)}`).catch(() => undefined)
  })

  test('an unknown id produces no entry', async () => {
    const items = await readStages(['11111111-1111-4111-8111-111111111111'])
    expect(items).toEqual([])
  })

  test('another organization sees no entry for the same ids', async () => {
    const items = await readStages([salesOrderId, purchaseOrderId], viewerToken, branchOrgId as string)
    expect(items).toEqual([])
  })

  test('refuses more than the batch cap', async () => {
    const ids = Array.from({ length: 201 }, () => '11111111-1111-4111-8111-111111111111')
    const response = await scoped('GET', `${STAGES_URL}?ids=${encodeURIComponent(ids.join(','))}`)
    expect(response.status()).toBe(400)
  })
})
