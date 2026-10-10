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
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * FLOW-G1 — the whole chain in one test: 供应商 → 采购单 → 定金 → 发运 → 收货 → 柜费用 → 到岸成本 →
 * 尾款 → 收汇 → 退税.
 *
 * The assertions are the plan's AC-017:
 *
 * - the purchase line's `received_quantity` equals what the `wms` balance holds (the receipt wrote
 *   both sides through their own commands);
 * - Σ of the landed-cost shares equals Σ of the container's fees converted at the recorded rate;
 * - the collection record's amount reaches the receivables ledger and the tax refund reaches the
 *   order through its allocation.
 *
 * Everything is created through the real APIs, and the fixtures are torn down in `finally` so a
 * failed run does not leave a half-built chain behind.
 */

const FEATURES = [
  // The ids the chain's routes actually require, read from each module's `acl.ts` and route
  // metadata — a guessed id is accepted by the ACL route and then fails the call.
  'purchasing.suppliers.view',
  'purchasing.suppliers.manage',
  'purchasing.orders.view',
  'purchasing.orders.manage',
  'purchasing.payments.manage',
  'cross_border.shipments.view',
  'cross_border.shipments.manage',
  'cross_border.shipments.depart',
  'cross_border.shipments.receive',
  'export_finance.orders.view',
  'export_finance.manage',
  'finance.costs.view',
  'finance.costs.manage',
  'finance.ledger.view',
  'wms.view',
  'wms.manage_warehouses',
  'wms.manage_locations',
]

const STAFF_PASSWORD = 'FinanceFlow!2026'

type Json = Record<string, unknown>

async function post(api: APIRequestContext, path: string, token: string, orgId: string, data: Json) {
  return apiRequestWithSelectedOrg(api, 'POST', path, { token, selectedOrgId: orgId, data })
}

async function put(api: APIRequestContext, path: string, token: string, orgId: string, data: Json) {
  return apiRequestWithSelectedOrg(api, 'PUT', path, { token, selectedOrgId: orgId, data })
}

async function get(api: APIRequestContext, path: string, token: string, orgId: string) {
  return apiRequestWithSelectedOrg(api, 'GET', path, { token, selectedOrgId: orgId })
}

/** One dictionary with its entries, for the fixture organization. */
async function seedDictionary(
  api: APIRequestContext,
  token: string,
  orgId: string,
  key: string,
  name: string,
  entries: Array<readonly [string, string]>,
): Promise<void> {
  const created = await expectJson<{ id: string }>(
    await post(api, '/api/dictionaries', token, orgId, { key, name, isSystem: true }),
    201,
  )
  for (const [value, label] of entries) {
    await expectJson<{ id: string }>(
      await post(api, `/api/dictionaries/${created.id}/entries`, token, orgId, { value, label }),
      201,
    )
  }
}

/** The `currency` dictionary the supplier and order contracts validate their codes against. */
async function seedCurrencyDictionary(api: APIRequestContext, token: string, orgId: string): Promise<void> {
  await seedDictionary(api, token, orgId, 'currency', 'Currency', [
    ['CNY', '人民币'],
    ['USD', '美元'],
  ])
}

/** A body the test then reads: `readJsonSafe` answers `T | null`, and a null here is a failed call. */
async function readBody<T>(
  response: Awaited<ReturnType<APIRequestContext['fetch']>>,
): Promise<T> {
  const body = await readJsonSafe<T>(response as never)
  expect(body, 'response body should be JSON').not.toBeNull()
  return body as T
}

/**
 * For the command routes: the framework answers 200 or 201 depending on the route, and what the
 * chain cares about is that the command ran and what it reports — not which of the two came back.
 */
async function expectOk<T extends Json>(
  response: Awaited<ReturnType<APIRequestContext['fetch']>>,
): Promise<T> {
  const body = await readBody<T>(response)
  expect([200, 201], JSON.stringify(body)).toContain(response.status())
  return body
}

async function expectJson<T extends Json>(
  response: Awaited<ReturnType<APIRequestContext['fetch']>>,
  status: number,
): Promise<T> {
  const body = await readBody<T>(response)
  expect(response.status(), JSON.stringify(body)).toBe(status)
  return body
}

test.describe.serial('finance — end-to-end chain (FLOW-G1)', () => {
  // A per-run token: the chain's records are unique even when the suite runs against a reused
  // ephemeral environment.
  const stamp = Date.now()
  const unique = (value: string) => `${value}-${stamp}`
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let tenantId = ''
  let organizationId = ''
  let roleId: string | null = null
  let userId: string | null = null

  const createdSupplierIds: string[] = []
  const createdOrderIds: string[] = []

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:3000' })
    rootToken = await getAuthToken(api)
    organizationId = await createOrganizationFixture(api, rootToken, { name: unique('Finance Flow') })
    // A role carrying exactly the features the chain needs (no wildcard: the point is that the
    // concrete ids the chain touches are the ones it is granted).
    roleId = await createRoleFixture(api, rootToken, { name: unique('finance-flow') })
    const staffEmail = `${unique('finance-flow')}@example.com`
    userId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId,
      roles: [roleId],
    })
    // The concrete feature ids the chain touches, granted through the platform's own ACL route.
    await setRoleAclFeatures(api, rootToken, { roleId, features: FEATURES })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    // A fresh organization carries no dictionaries unless `seed:defaults` ran for it, and the
    // supplier/order contracts validate their currency against the `currency` dictionary — so the
    // fixture seeds exactly what the chain needs, the same way a real tenant's first run does.
    await seedCurrencyDictionary(api, rootToken, organizationId)
    // The module's own `setup.ts` seeds these for a tenant created through onboarding; a fixture
    // organization gets the two dictionaries the chain's commands validate against.
    await seedDictionary(api, rootToken, organizationId, 'shipment_cost_type', '柜费用类型', [
      ['ocean_freight', '海运'],
      ['air_freight', '空运'],
    ])
    await seedDictionary(api, rootToken, organizationId, 'finance_expense_type', '期间费用类型', [
      ['advertising', '广告费'],
      ['logistics', '物流费'],
    ])
  })

  test.afterAll(async () => {
    for (const orderId of createdOrderIds) {
      await apiRequestWithSelectedOrg(api, 'DELETE', '/api/purchasing/purchase-orders', {
        token: staffToken,
        selectedOrgId: organizationId,
        data: { id: orderId },
      }).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, userId)
    await deleteRoleIfExists(api, rootToken, roleId)
    await deleteOrganizationIfExists(api, rootToken, organizationId)
    await api.dispose()
  })

  test('runs the whole chain and reconciles receipt, landed cost and collection', async () => {
    // 1. supplier — the number is issued by the create, so it is read back rather than sent
    const supplier = await expectJson<{ id: string }>(
      await post(api, '/api/purchasing/suppliers', staffToken, organizationId, {
        name: unique('Flow Supplier'),
        defaultCurrencyCode: 'CNY',
      }),
      201,
    )
    createdSupplierIds.push(supplier.id)
    const supplierRow = (
      await readBody<{ items?: Array<{ id: string; code: string }> }>(
        await get(api, `/api/purchasing/suppliers?ids=${supplier.id}&pageSize=1`, staffToken, organizationId),
      )
    ).items?.[0]
    expect(supplierRow?.code).toMatch(/^SUP-\d+$/)

    // 2. a warehouse and a location to receive into (the receipt books stock at variant level)
    const warehouse = await expectJson<{ id: string }>(
      await post(api, '/api/wms/warehouses', staffToken, organizationId, {
        name: 'Flow Warehouse',
        code: unique('FW'),
      }),
      201,
    )
    const location = await expectJson<{ id: string }>(
      await post(api, '/api/wms/locations', staffToken, organizationId, {
        warehouseId: warehouse.id,
        code: 'A-01',
        type: 'bin',
      }),
      201,
    )

    // 3. a product — one action creates the catalog product and its default variant; the receipt
    //    path resolves the purchase line through the catalog product, so the product must carry one.
    const catalogProduct = await expectJson<{ id: string }>(
      await post(api, '/api/products/items', rootToken, organizationId, {
        sku: unique('FLOW'),
        name: unique('Flow Product'),
      }),
      201,
    )

    // 4. purchase order with one line linked to the catalog product
    const order = await expectJson<{ id: string }>(
      await post(api, '/api/purchasing/purchase-orders', staffToken, organizationId, {
        supplierId: supplier.id,
        currencyCode: 'CNY',
        expectedShipAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        lines: [
          {
            catalogProductId: catalogProduct.id,
            quantity: '10',
            unitPrice: '100',
            taxRate: '0',
            priceIncludesTax: true,
          },
        ],
      }),
      201,
    )
    createdOrderIds.push(order.id)

    const placed = await expectOk<{ status?: string }>(
      await post(api, '/api/purchasing/purchase-orders/transitions', staffToken, organizationId, {
        id: order.id,
        action: 'place',
      }),
    )
    expect(placed.status).toBe('placed')

    const lines = await get(api, `/api/purchasing/purchase-orders/lines?orderId=${order.id}&pageSize=10`, staffToken, organizationId)
    const lineRows = (await readBody<{ items?: Array<{ id: string; productId?: string | null; catalogProductId?: string | null }> }>(lines)).items ?? []
    expect(lineRows.length).toBe(1)
    const lineId = lineRows[0].id

    // 5. deposit (50% of 1000)
    await expectJson<{ id: string }>(
      await post(api, '/api/purchasing/purchase-orders/payments', staffToken, organizationId, {
        orderId: order.id,
        stage: 'deposit',
        amount: 500,
        paidAt: new Date().toISOString().slice(0, 10),
      }),
      201,
    )

    // 6. shipment with an allocation of the whole line, then depart
    const shipment = await expectJson<{ id: string }>(
      await post(api, '/api/cross_border/shipments', staffToken, organizationId, {
        containerNumber: unique('FLOW-C'),
        allocations: [{ purchaseOrderLineId: lineId, quantity: 10 }],
      }),
      201,
    )
    await expectOk<{ ok?: boolean }>(
      await post(api, '/api/cross_border/shipments/depart', staffToken, organizationId, { id: shipment.id }),
    )

    // 7. a container fee: USD 200 at an explicit rate of 7
    await expectJson<{ id: string }>(
      await post(api, '/api/finance/shipment-costs', staffToken, organizationId, {
        shipmentId: shipment.id,
        costType: 'ocean_freight',
        allocationBasis: 'amount',
        amount: '200',
        currencyCode: 'USD',
        exchangeRate: '7',
      }),
      201,
    )

    // 8. receive: the shipment books stock in `wms` and writes back the line's received quantity
    await expectOk<{ ok?: boolean }>(
      await post(api, '/api/cross_border/shipments/receive', staffToken, organizationId, {
        id: shipment.id,
        warehouseId: warehouse.id,
        locationId: location.id,
      }),
    )

    const receivedLines = await get(
      api,
      `/api/purchasing/purchase-orders/lines?orderId=${order.id}&pageSize=10`,
      staffToken,
      organizationId,
    )
    const receivedRow = ((await readBody<{ items?: Array<{ receivedQuantity?: string | null }> }>(receivedLines)).items ?? [])[0]
    // The column is `numeric(18,4)`, so the value is compared as a number rather than by its text.
    expect(Number.parseFloat(receivedRow?.receivedQuantity ?? '0')).toBe(10)

    const stock = await get(
      api,
      `/api/wms/inventory/balances?warehouseId=${warehouse.id}&pageSize=50`,
      rootToken,
      organizationId,
    )
    const stockRows =
      (await readBody<{ items?: Array<{ quantity_on_hand?: string | number | null }> }>(stock)).items ?? []
    const onHand = stockRows.reduce((total, row) => total + Number.parseFloat(String(row.quantity_on_hand ?? '0')), 0)
    // AC-017: the purchase line says 10 received and the warehouse holds exactly 10.
    expect(onHand).toBe(10)

    // 9. landed cost: Σ shares == the fee converted at the recorded rate
    const landed = await get(api, `/api/finance/landed-costs?shipmentId=${shipment.id}`, staffToken, organizationId)
    const landedBody = await readBody<{
      result?: {
        lines: Array<{ allocatedCostCny: string; landedUnitCostCny: string | null; quantity: string; purchaseAmountCny: string | null }>
        totals: { allocatedCny: string; feesCny: string; purchaseCny: string }
      }
    }>(landed)
    expect(landedBody?.result?.totals.allocatedCny).toBe('1400.00')
    expect(landedBody?.result?.totals.feesCny).toBe('1400.00')
    expect(landedBody?.result?.totals.purchaseCny).toBe('1000.00')
    expect(landedBody?.result?.lines[0]?.landedUnitCostCny).toBe('240.0000')

    // 10. balance payment, then the order closes
    await expectJson<{ id: string }>(
      await post(api, '/api/purchasing/purchase-orders/payments', staffToken, organizationId, {
        orderId: order.id,
        stage: 'balance',
        amount: 500,
        paidAt: new Date().toISOString().slice(0, 10),
      }),
      201,
    )
    const payables = await get(api, '/api/finance/payables', staffToken, organizationId)
    const payableRow = ((await readBody<{ rows?: Array<{ purchaseOrderId: string; paidAmount: string; outstandingAmount: string; paymentStatus: string }> }>(payables)).rows ?? [])
      .find((row) => row.purchaseOrderId === order.id)
    expect(payableRow?.paidAmount).toBe('1000.00')
    expect(payableRow?.outstandingAmount).toBe('0.00')
    expect(payableRow?.paymentStatus).toBe('paid')

    // 11. collection record with an amount, and the receivables ledger picks it up
    await expectOk<{ id: string }>(
      await put(api, '/api/export_finance/collections', staffToken, organizationId, {
        purchaseOrderId: order.id,
        currencyCode: 'CNY',
        collectionStatus: 'received',
        collectedAmount: '1200',
        collectedAt: new Date().toISOString().slice(0, 10),
      }),
    )
    const receivables = await get(api, '/api/finance/receivables?kind=export_collection', staffToken, organizationId)
    const receivableRows = (await readBody<{ rows?: Array<{ amount: string | null; receivedAmount: string; outstandingAmount: string | null }> }>(receivables)).rows ?? []
    const collectionRow = receivableRows.find((row) => row.receivedAmount === '1200.00')
    expect(collectionRow, JSON.stringify(receivableRows)).toBeTruthy()
    expect(collectionRow?.outstandingAmount).toBe('0.00')

    // 12. tax refund at the container level, allocated back to the order
    await expectOk<{ id: string }>(
      await put(api, '/api/export_finance/refunds', staffToken, organizationId, {
        shipmentId: shipment.id,
        currencyCode: 'CNY',
        taxRefundStatus: 'applied',
        taxRefundAmount: '130',
      }),
    )
    const orderFile = await get(api, `/api/export_finance/order-files?purchaseOrderId=${order.id}&pageSize=1`, staffToken, organizationId)
    const orderRow = ((await readBody<{ items?: Array<{ allocatedRefundAmount?: string | null; refundStatus?: string }> }>(orderFile)).items ?? [])[0]
    expect(orderRow?.refundStatus).toBe('applied')
    expect(orderRow?.allocatedRefundAmount).toBe('130.00')
  })
})
