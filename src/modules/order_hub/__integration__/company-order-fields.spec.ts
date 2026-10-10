import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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
 * The company-order 35-field summary — Phase 5.A of `.ai/specs/2026-10-09-company-order-root.md`
 * (REQ-017, TEST-011).
 *
 * One fixture chain builds a root, a sales child, a purchase order with a deposit and a payment, a
 * sales contract with a PI and a commercial invoice, a shipment carrying a customs declaration and a
 * telex release (one with a filed scan), a collection with a foreign-income certificate, a refund,
 * and a KC stamp on the contract. `GET /api/order_hub/orders/fields` must report every group back
 * exactly — money grouped by currency, the earliest departure, the `INV.NO` list, the per-type
 * export-document counts, the purchase payment attachment count, collections/refunds and the stamp.
 * An unrelated organization reads an empty object, never a leak.
 */

const ORDERS_URL = '/api/order_hub/orders'
const FIELDS_URL = '/api/order_hub/orders/fields'
const LINK_CHILD_URL = '/api/order_hub/orders/link-child'
const ATTACHMENTS_URL = '/api/attachments'
const BASE_URL = process.env.BASE_URL ?? ''
const STAFF_PASSWORD = 'CompanyFields!2026'
const STAFF_FEATURES = ['order_hub.view']

type IdPayload = { id?: string; number?: string | null; item?: { id?: string } }
type ListPayload<T> = { items?: T[] }

type CurrencyAmounts = {
  currencyCode: string
  sales: string
  purchase: string
  deposit: string
  paid: string
  outstanding: string
}

type FieldsPayload = {
  order?: { number?: string | null; childNumbers?: string[] }
  amounts?: CurrencyAmounts[]
  dates?: { orderedAt?: string | null; expectedDeliveryAt?: string | null; shippedAt?: string | null }
  documents?: {
    byKind?: Array<{ kind: string; numbers: string[] }>
    invoiceNumbers?: string[]
    bySlot?: SlotGroup[]
  }
  exportDocuments?: Array<{ docType: string; count: number; latestNumber: string | null; latestHasAttachment: boolean }>
  purchaseFiles?: { attachmentCount: number }
  collections?: Array<{ status: string; hasForeignIncomeCertificate: boolean }>
  refunds?: Array<{ currencyCode: string; status: string; amount: string | null }>
  kcStamp?: boolean
}

type SlotGroup = {
  slot: string
  files: Array<{ attachmentId: string; fileName: string; createdAt: string }>
  childSources: Array<{ source: string; label: string; count?: number }>
}

const SLOT_CODES = [
  'commercial_invoice',
  'packing_list',
  'bill_of_lading',
  'telex_release',
  'customs_declaration',
  'domestic_freight_receipt',
  'booking_charges_receipt',
  'purchase_slip_invoice',
  'foreign_income_certificate',
  'kc_invoice_stamp',
]

const isOk = (status: number) => status >= 200 && status < 300

test.describe.serial('order_hub — company order fields', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let branchRoleId: string | null = null
  let branchUserId: string | null = null
  let branchToken = ''
  let internalChannelId = ''
  let supplierId = ''
  let catalogProductId = ''
  let productId = ''
  let companyOrderId = ''
  let salesOrderId = ''
  let purchaseOrderId = ''
  let paymentId = ''
  let contractId = ''
  let shipmentId = ''
  let piNumber: string | null = null
  let ciNumber: string | null = null
  const customsNumber = `CD-${Date.now().toString(36)}`.toUpperCase()
  let slotDocumentId = ''
  let slotAttachmentId = ''
  const companyOrderIds: string[] = []
  const salesOrderIds: string[] = []
  const purchaseOrderIds: string[] = []
  const shipmentIds: string[] = []
  const contractIds: string[] = []
  const documentIds: string[] = []
  const attachmentIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown, token = rootToken, orgId = hqOrgId) =>
    apiRequestWithSelectedOrg(api, method, path, { token, selectedOrgId: orgId, data })

  const expectOk = async (response: APIResponse): Promise<void> => {
    expect(isOk(response.status()), await response.text()).toBe(true)
  }

  const uploadAttachment = async (entityId: string, recordId: string): Promise<string> => {
    const upload = await api.post(`${BASE_URL}${ATTACHMENTS_URL}`, {
      headers: {
        Authorization: `Bearer ${rootToken}`,
        Cookie: `om_selected_org=${hqOrgId}`,
      },
      multipart: {
        entityId,
        recordId,
        file: { name: `fields-${stamp}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`fields ${stamp}`) },
      },
    })
    expect(upload.status(), await upload.text()).toBe(200)
    const id = String((await readJsonSafe<{ item?: { id?: string } }>(upload))?.item?.id ?? '')
    expect(id, 'the attachment upload answers an id').toBeTruthy()
    attachmentIds.push(id)
    return id
  }

  const readFields = async (
    token = rootToken,
    orgId = hqOrgId,
  ): Promise<FieldsPayload> => {
    const response = await scoped('GET', `${FIELDS_URL}?companyOrderId=${encodeURIComponent(companyOrderId)}`, undefined, token, orgId)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<FieldsPayload>(response)) ?? {}
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    internalChannelId = String((await readJsonSafe<{ channels?: { internal?: string | null } }>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded').toBeTruthy()

    // One action creates the catalog product and its default variant; the returned id is the
    // catalog product id every downstream document reference uses (shipment allocations included).
    const productSku = `FIELDS-${stamp}`.toUpperCase()
    const product = await scoped('POST', '/api/products/items', {
      sku: productSku,
      name: `Fields product ${stamp}`,
      unit: 'PCS',
    })
    productId = String((await readJsonSafe<IdPayload>(product))?.id ?? '')
    catalogProductId = productId
    expect(productId, 'the product fixture resolved an id').toBeTruthy()

    const supplier = await scoped('POST', '/api/purchasing/suppliers', {
      name: `Fields supplier ${stamp}`,
      code: `FIELDS-SUP-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), await supplier.text()).toBe(201)
    supplierId = String((await readJsonSafe<IdPayload>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    companyOrderId = String(
      (await readJsonSafe<IdPayload>(await scoped('POST', ORDERS_URL, { title: `Fields root ${stamp}` })))?.id ?? '',
    )
    expect(companyOrderId).toBeTruthy()
    companyOrderIds.push(companyOrderId)

    // Sales child with one line.
    const salesOrder = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId: internalChannelId,
      customerSnapshot: { name: `Fields buyer ${stamp}`, internalSales: { organizationId: hqOrgId } },
      lines: [{ kind: 'product', productId, name: `Fields line ${stamp}`, currencyCode: 'CNY', quantity: 1, unitPriceNet: 10 }],
    })
    expect(salesOrder.status(), await salesOrder.text()).toBe(201)
    salesOrderId = String((await readJsonSafe<IdPayload>(salesOrder))?.id ?? '')
    expect(salesOrderId).toBeTruthy()
    salesOrderIds.push(salesOrderId)
    const salesLines = await scoped('GET', `/api/sales/order-lines?orderId=${encodeURIComponent(salesOrderId)}&pageSize=10`)
    const salesOrderLineId = String((await readJsonSafe<ListPayload<{ id?: string }>>(salesLines))?.items?.[0]?.id ?? '')

    // Purchase child: total 36, planned deposit 10.
    const purchaseOrder = await scoped('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      depositAmount: '10.00',
      lines: [{ catalogProductId, quantity: 3, unitPrice: 12, taxRate: 0, priceIncludesTax: true }],
    })
    expect(purchaseOrder.status(), await purchaseOrder.text()).toBe(201)
    purchaseOrderId = String((await readJsonSafe<IdPayload>(purchaseOrder))?.id ?? '')
    expect(purchaseOrderId).toBeTruthy()
    purchaseOrderIds.push(purchaseOrderId)
    const purchaseLines = await scoped('GET', `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}&pageSize=10`)
    const purchaseOrderLineId = String((await readJsonSafe<ListPayload<{ id?: string }>>(purchaseLines))?.items?.[0]?.id ?? '')
    expect(purchaseOrderLineId).toBeTruthy()
    await expectOk(await scoped('POST', '/api/purchasing/purchase-orders/transitions', { id: purchaseOrderId, action: 'place' }))

    // A recorded deposit payment against the purchase order, with its own voucher attachment.
    const payment = await scoped('POST', '/api/purchasing/purchase-orders/payments', {
      orderId: purchaseOrderId,
      stage: 'deposit',
      amount: 10,
      paidAt: '2026-10-01',
    })
    expect(payment.status(), await payment.text()).toBe(201)
    paymentId = String((await readJsonSafe<IdPayload>(payment))?.id ?? '')
    expect(paymentId).toBeTruthy()
    await uploadAttachment('purchasing:purchase_payment', paymentId)

    // Contract linking both children, plus a PI and a commercial invoice, and the KC stamp scan.
    const contract = await scoped('POST', '/api/trade_docs/contracts', {
      direction: 'sales',
      counterpartyKind: 'customer',
      counterpartySnapshot: { name: `Fields buyer ${stamp}` },
      currencyCode: 'CNY',
      lines: [{ name: `Fields contract line ${stamp}`, quantity: '1', unitPrice: '10' }],
    })
    expect(contract.status(), await contract.text()).toBe(201)
    contractId = String((await readJsonSafe<IdPayload>(contract))?.id ?? '')
    expect(contractId).toBeTruthy()
    contractIds.push(contractId)
    await expectOk(await scoped('POST', '/api/trade_docs/contracts/orders', {
      contractId,
      orders: [
        { orderKind: 'internal_sales_order', orderId: salesOrderId },
        { orderKind: 'purchase_order', orderId: purchaseOrderId },
      ],
    }))
    const stampAttachment = await uploadAttachment('trade_docs:trade_docs_contract', contractId)
    await expectOk(await scoped('PUT', '/api/trade_docs/contracts/attach', { id: contractId, attachmentId: stampAttachment }))

    const pi = await scoped('POST', '/api/trade_docs/documents', {
      kind: 'proforma',
      direction: 'sales',
      counterpartyKind: 'customer',
      counterpartySnapshot: { name: `Fields buyer ${stamp}` },
      currencyCode: 'CNY',
      orderKind: 'internal_sales_order',
      orderId: salesOrderId,
      lines: [{ name: `Fields PI line ${stamp}`, quantity: '1', unitPrice: '5' }],
    })
    expect(pi.status(), await pi.text()).toBe(201)
    documentIds.push(String((await readJsonSafe<IdPayload>(pi))?.id ?? ''))
    const piIssued = await scoped('POST', '/api/trade_docs/documents/transitions', {
      id: String((await readJsonSafe<IdPayload>(pi))?.id ?? ''),
      action: 'issue',
    })
    await expectOk(piIssued)
    piNumber = (await readJsonSafe<{ number?: string | null }>(piIssued))?.number ?? null

    const ci = await scoped('POST', '/api/trade_docs/documents', {
      kind: 'commercial',
      direction: 'sales',
      counterpartyKind: 'customer',
      counterpartySnapshot: { name: `Fields buyer ${stamp}` },
      currencyCode: 'CNY',
      orderKind: 'internal_sales_order',
      orderId: salesOrderId,
      lines: [{ name: `Fields CI line ${stamp}`, quantity: '1', unitPrice: '10' }],
    })
    expect(ci.status(), await ci.text()).toBe(201)
    const ciId = String((await readJsonSafe<IdPayload>(ci))?.id ?? '')
    documentIds.push(ciId)
    const ciIssued = await scoped('POST', '/api/trade_docs/documents/transitions', { id: ciId, action: 'issue' })
    await expectOk(ciIssued)
    ciNumber = (await readJsonSafe<{ number?: string | null }>(ciIssued))?.number ?? null

    // Shipment serving both children, departed, with two export documents (one filed).
    const shipment = await scoped('POST', '/api/cross_border/shipments', {
      containerNumber: `FIELDS-${stamp}`.toUpperCase(),
      allocations: [{ purchaseOrderLineId, quantity: 1 }],
      salesAllocations: [
        { salesOrderId, salesOrderLineId, catalogProductId, quantity: 1, unitPrice: 200, currencyCode: 'CNY' },
      ],
    })
    expect(shipment.status(), await shipment.text()).toBe(201)
    shipmentId = String((await readJsonSafe<IdPayload>(shipment))?.id ?? '')
    expect(shipmentId).toBeTruthy()
    shipmentIds.push(shipmentId)
    await expectOk(await scoped('POST', '/api/cross_border/shipments/depart', { id: shipmentId }))

    const shipmentScan = await uploadAttachment('cross_border:shipment', shipmentId)
    await expectOk(await scoped('POST', '/api/cross_border/shipments/documents', {
      shipmentId,
      docType: 'customs_declaration',
      documentNumber: customsNumber,
      issuedAt: '2026-10-02',
      attachmentId: shipmentScan,
    }))
    await expectOk(await scoped('POST', '/api/cross_border/shipments/documents', {
      shipmentId,
      docType: 'telex_release',
    }))

    // Collection with a foreign-income certificate, and a refund.
    await expectOk(await scoped('PUT', '/api/export_finance/collections', {
      purchaseOrderId,
      currencyCode: 'CNY',
      collectionStatus: 'received',
      collectedAmount: '10',
      collectedAt: '2026-10-03',
    }))
    const collection = await scoped('GET', `/api/export_finance/collections?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`)
    const collectionId = String(
      (await readJsonSafe<{ item?: { id?: string } }>(collection))?.item?.id ?? '',
    )
    expect(collectionId).toBeTruthy()
    await expectOk(await scoped('POST', '/api/export_finance/collection-documents', {
      collectionId,
      docType: 'foreign_income_certificate',
    }))
    await expectOk(await scoped('PUT', '/api/export_finance/refunds', {
      shipmentId,
      currencyCode: 'CNY',
      taxRefundStatus: 'applied',
      taxRefundAmount: '130',
    }))

    // A voucher on the purchase order itself, so the attachment count spans order + payment.
    await uploadAttachment('purchasing:purchase_order', purchaseOrderId)

    // Attach both children to the root.
    await expectOk(await scoped('POST', LINK_CHILD_URL, { kind: 'internal_sales_order', refId: salesOrderId, companyOrderId }))
    await expectOk(await scoped('POST', LINK_CHILD_URL, { kind: 'purchase_order', refId: purchaseOrderId, companyOrderId }))

    // A file the order itself files under the 报关单 slot — the same family as the shipment's own
    // customs declaration, so the summary must report both the order's file and the child source.
    slotDocumentId = randomUUID()
    slotAttachmentId = await uploadAttachment('order_hub:company_order_document', slotDocumentId)
    await expectOk(await scoped('POST', '/api/order_hub/orders/documents', {
      id: slotDocumentId,
      companyOrderId,
      slot: 'customs_declaration',
      attachmentId: slotAttachmentId,
    }))

    // An unrelated (sibling) organization: sees nothing of the root's deal.
    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Fields branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })
    branchRoleId = await createRoleFixture(api, rootToken, { name: `Fields staff ${stamp}`, tenantId })
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
    if (slotDocumentId) {
      await scoped('DELETE', `/api/order_hub/orders/documents?id=${encodeURIComponent(slotDocumentId)}`).catch(() => undefined)
    }
    for (const id of attachmentIds) {
      await scoped('DELETE', `${ATTACHMENTS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of documentIds) {
      if (id) await scoped('DELETE', `/api/trade_docs/documents?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of contractIds) {
      if (id) await scoped('DELETE', `/api/trade_docs/contracts?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of shipmentIds) {
      if (id) await scoped('DELETE', `/api/cross_border/shipments?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of purchaseOrderIds) {
      if (id) await scoped('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of salesOrderIds) {
      if (id) await scoped('DELETE', `/api/sales/orders?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    for (const id of companyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (supplierId) await scoped('DELETE', `/api/purchasing/suppliers?id=${encodeURIComponent(supplierId)}`).catch(() => undefined)
    if (productId) await scoped('DELETE', `/api/products/items?id=${encodeURIComponent(productId)}`).catch(() => undefined)
    if (catalogProductId) await scoped('DELETE', `/api/catalog/products?id=${encodeURIComponent(catalogProductId)}`).catch(() => undefined)
    await deleteUserIfExists(api, rootToken, branchUserId)
    await deleteRoleIfExists(api, rootToken, branchRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('summarizes every group of the constructed deal', async () => {
    const fields = await readFields()

    expect(fields.order?.number).toBeTruthy()
    expect(fields.order?.childNumbers ?? []).toEqual(expect.arrayContaining([expect.any(String)]))

    const amounts = fields.amounts ?? []
    const cny = amounts.find((amount) => amount.currencyCode === 'CNY')
    expect(cny, 'the CNY slice is present').toBeTruthy()
    expect(cny?.sales).toBe('10.00')
    expect(cny?.purchase).toBe('36.00')
    expect(cny?.deposit).toBe('10.00')
    expect(cny?.paid).toBe('10.00')
    expect(cny?.outstanding).toBe('26.00')

    expect(fields.dates?.orderedAt).toBeTruthy()
    expect(fields.dates?.expectedDeliveryAt ?? null).toBeNull()
    expect(fields.dates?.shippedAt, 'the departed shipment supplies the shipped date').toBeTruthy()

    const byKind = fields.documents?.byKind ?? []
    const proforma = byKind.find((group) => group.kind === 'proforma')
    expect(proforma?.numbers).toContain(piNumber)
    const commercial = byKind.find((group) => group.kind === 'commercial')
    expect(commercial?.numbers).toContain(ciNumber)
    expect(fields.documents?.invoiceNumbers, 'INV.NO is the commercial number').toContain(ciNumber)

    const customs = (fields.exportDocuments ?? []).find((group) => group.docType === 'customs_declaration')
    expect(customs?.count).toBe(1)
    expect(customs?.latestNumber).toBe(customsNumber)
    expect(customs?.latestHasAttachment, 'the customs declaration carries the uploaded scan').toBe(true)
    const telex = (fields.exportDocuments ?? []).find((group) => group.docType === 'telex_release')
    expect(telex?.count).toBe(1)
    expect(telex?.latestHasAttachment).toBe(false)

    expect(fields.purchaseFiles?.attachmentCount, 'purchase order + payment voucher').toBe(2)

    expect(fields.collections).toEqual([
      { status: 'received', hasForeignIncomeCertificate: true },
    ])
    expect(fields.refunds).toEqual([{ currencyCode: 'CNY', status: 'applied', amount: '130.00' }])
    expect(fields.kcStamp).toBe(true)
  })

  test('reports every named document slot with its order file and child source (TEST-016)', async () => {
    const fields = await readFields()
    const bySlot = fields.documents?.bySlot ?? []

    // One entry per slot, in the enum order the hub renders its upload rows in.
    expect(bySlot.map((group) => group.slot)).toEqual(SLOT_CODES)

    // The 报关单 slot carries both halves of the same family: the order's own uploaded file and the
    // shipment's export document derived as a child source.
    const customs = bySlot.find((group) => group.slot === 'customs_declaration')
    expect(customs, 'the customs declaration slot is projected').toBeTruthy()
    const orderFile = (customs?.files ?? []).find((file) => file.attachmentId === slotAttachmentId)
    expect(orderFile, 'the order-uploaded file is listed under its slot').toBeTruthy()
    expect(orderFile?.fileName).toContain(`fields-${stamp}`)
    expect(typeof orderFile?.createdAt).toBe('string')
    expect(orderFile?.createdAt).not.toBe('')
    const shipmentSource = (customs?.childSources ?? []).find((source) => source.source === 'shipment')
    expect(shipmentSource?.count).toBe(1)
    expect(shipmentSource?.label).toBe(customsNumber)

    // The other child-derived signals map to their own slots, without a second read of the child.
    const stampSlot = bySlot.find((group) => group.slot === 'kc_invoice_stamp')
    expect((stampSlot?.childSources ?? []).some((source) => source.source === 'contract')).toBe(true)
    const income = bySlot.find((group) => group.slot === 'foreign_income_certificate')
    expect((income?.childSources ?? []).some((source) => source.source === 'collection' && source.count === 1)).toBe(true)
    const purchaseSlip = bySlot.find((group) => group.slot === 'purchase_slip_invoice')
    expect((purchaseSlip?.childSources ?? []).some((source) => source.source === 'purchasing' && source.count === 2)).toBe(true)

    // The booleans the summary already carried keep their meaning next to the slot projection.
    expect(fields.kcStamp).toBe(true)
    expect(fields.purchaseFiles?.attachmentCount).toBe(2)
    expect(fields.documents?.invoiceNumbers, 'INV.NO still comes from the commercial document').toContain(ciNumber)
  })

  test('an unrelated organization reads an empty object', async () => {
    const response = await scoped(
      'GET',
      `${FIELDS_URL}?companyOrderId=${encodeURIComponent(companyOrderId)}`,
      undefined,
      branchToken,
      branchOrgId ?? hqOrgId,
    )
    expect(response.status(), await response.text()).toBe(200)
    const body = (await readJsonSafe<Record<string, unknown>>(response)) ?? {}
    expect(body).toEqual({})
  })

  test('refuses a request without the companyOrderId parameter', async () => {
    const response = await scoped('GET', FIELDS_URL)
    expect(response.status()).toBe(400)
  })
})
