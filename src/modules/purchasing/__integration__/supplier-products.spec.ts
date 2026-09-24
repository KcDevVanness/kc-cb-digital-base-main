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
 * Supplier product library (`src/modules/purchasing`).
 *
 * Covers the contracts that carry business risk: the owning supplier of a code (a duplicate is a
 * readable 409 even when the colliding row is soft-deleted), the quotation → library import and its
 * idempotency, the sync into the product master, the order line's supplier reference (including the
 * wrong-supplier 422), and the fail-closed scope/permission behavior.
 *
 * Every call selects an organization explicitly (`om_selected_org`), which is what the backend UI
 * does — a write with no resolvable organization fails closed before it can reach any duplicate
 * check.
 *
 * See `.ai/specs/2026-09-22-supplier-product-library.md` (TEST-SPL-001..TEST-SPL-005).
 */

const LIBRARY_URL = '/api/purchasing/supplier-products'
const STAFF_PASSWORD = 'SupplierProducts!2026'
const VIEWER_PASSWORD = 'SupplierProductsViewer!2026'

const STAFF_FEATURES = [
  'sourcing.quotes.view',
  'sourcing.quotes.manage',
  'sourcing.promote.run',
  'purchasing.supplier-products.view',
  'purchasing.supplier-products.manage',
  'purchasing.supplier-products.promote',
  'purchasing.suppliers.view',
  'purchasing.suppliers.manage',
  'purchasing.orders.view',
  'purchasing.orders.manage',
  'products.items.view',
  'products.items.manage',
  'products.prices.manage',
  // Product photos go through the installed attachments module, so a buyer who can maintain a
  // library row also needs its two features.
  'attachments.view',
  'attachments.manage',
]

type LibraryItem = {
  id: string
  supplierId: string
  supplierSku: string
  itemNo: string | null
  name: string
  nameZh: string | null
  nameEn: string | null
  description: string | null
  declarationElements: string | null
  unit: string
  hsCode: string | null
  moqQuantity: number | null
  cartonQuantity: number | null
  unitNetWeight: string | null
  unitGrossWeight: string | null
  unitVolume: string | null
  innerPacking: Record<string, unknown> | null
  imageAttachmentIds: string[]
  productId: string | null
  productSku: string | null
  source: string
  status: string
}

type PriceRow = {
  id: string
  supplierProductId: string
  priceKind: string
  currencyCode: string
  minQuantity: number
  unitPrice: string
  isActive: boolean
}

/** A 1×1 PNG: the smallest payload the attachments route accepts as an image upload. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

type ListResponse<T> = { items?: T[]; total?: number }

test.describe.serial('purchasing — supplier product library', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let viewerToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let staffRoleId: string | null = null
  let viewerRoleId: string | null = null
  let staffUserId: string | null = null
  let viewerUserId: string | null = null

  let supplierId = ''
  let otherSupplierId = ''
  let libraryRowId: string | null = null
  let productId: string | null = null
  let otherSupplierProductId: string | null = null
  let quoteId: string | null = null
  let promotionQuoteId: string | null = null
  let quoteLineId: string | null = null
  let purchaseOrderId: string | null = null

  const stamp = Date.now().toString(36)
  // The supplier's own item number; the derived SKU the master gets is `${supplierCode}-UVC`.
  const supplierCode = `SPL-${stamp.toUpperCase()}`

  const staffRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: staffToken, selectedOrgId: hqOrgId, data })

  test.beforeAll(async () => {
    api = await request.newContext()
    // Fixtures that create roles and grant features need `superadmin`: the installed grant check
    // refuses a feature the actor does not itself hold, so a plain `admin` token cannot bootstrap a
    // role holding the purchasing feature set on a tenant whose admin role predates this
    // module.
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Supplier products E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `Supplier products E2E staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })
    const staffEmail = `supplier-products-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'Supplier products E2E staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    // A second role with none of the library features, to prove the gate fails closed.
    viewerRoleId = await createRoleFixture(api, rootToken, { name: `Supplier products E2E viewer ${stamp}`, tenantId })
    const viewerEmail = `supplier-products-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'Supplier products E2E viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)

    const supplier = await staffRequest('POST', '/api/purchasing/suppliers', {
      name: `E2E Petkit ${stamp}`,
      code: `PETKIT-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(supplier.status(), 'a supplier fixture is required for the library').toBe(201)
    supplierId = String((await readJsonSafe<{ id?: string }>(supplier))?.id ?? '')
    expect(supplierId).toBeTruthy()

    const otherSupplier = await staffRequest('POST', '/api/purchasing/suppliers', {
      name: `E2E Other supplier ${stamp}`,
      code: `OTHER-${stamp}`.toUpperCase(),
      defaultCurrencyCode: 'CNY',
    })
    expect(otherSupplier.status()).toBe(201)
    otherSupplierId = String((await readJsonSafe<{ id?: string }>(otherSupplier))?.id ?? '')
  })

  test.afterAll(async () => {
    if (purchaseOrderId) {
      await staffRequest('DELETE', `/api/purchasing/purchase-orders?id=${encodeURIComponent(purchaseOrderId)}`).catch(() => undefined)
    }
    for (const id of [quoteId, promotionQuoteId]) {
      if (!id) continue
      await staffRequest('DELETE', `/api/sourcing/quotes?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteUserIfExists(api, rootToken, viewerUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteRoleIfExists(api, rootToken, viewerRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('owns a supplier code per supplier, and lists it back', async () => {
    const created = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: supplierCode,
      itemNo: `P4108-${stamp.toUpperCase()}`,
      name: 'Eversweet 3 Pro',
      unit: 'PCS',
      moqQuantity: 10,
      cartonQuantity: 8,
      unitNetWeight: '1.28',
      unitGrossWeight: '1.84',
      unitVolume: '88642',
      innerPacking: { length: 21.9, width: 21.9, height: 18.5, unit: 'cm' },
    })
    const createdBody = await readJsonSafe<{ id?: string; error?: string; code?: string }>(created)
    expect(created.status(), `POST /api/purchasing/supplier-products answered ${JSON.stringify(createdBody)}`).toBe(201)
    const createdId = String(createdBody?.id ?? '')
    expect(createdId).toBeTruthy()
    libraryRowId = createdId

    // The same code for the same supplier is refused with a readable conflict, not a unique-index 500.
    const duplicate = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: supplierCode,
      name: 'Duplicate',
    })
    const duplicateBody = await readJsonSafe<{ code?: string }>(duplicate)
    expect(duplicate.status(), `duplicate answered ${JSON.stringify(duplicateBody)}`).toBe(409)
    expect(duplicateBody?.code).toBe('supplier_product_sku_taken')

    const list = await staffRequest('GET', `${LIBRARY_URL}?supplierId=${encodeURIComponent(supplierId)}&search=${encodeURIComponent(supplierCode)}`)
    expect(list.status()).toBe(200)
    const page = await readJsonSafe<ListResponse<LibraryItem>>(list)
    expect(page?.total).toBe(1)
    expect(page?.items?.[0]?.supplierSku).toBe(supplierCode)
    expect(page?.items?.[0]?.supplierId).toBe(supplierId)
    expect(page?.items?.[0]?.status).toBe('active')
    // Single-unit packing is what purchasing reads: Qty/Box, the piece's weights, its volume and
    // its size all survive the round trip, while the whole-carton figures are no longer part of the
    // row. The weight pair and the volume are optional, so each is stored only when the sheet
    // prints it.
    expect(page?.items?.[0]?.cartonQuantity).toBe(8)
    expect(Number(page?.items?.[0]?.unitNetWeight)).toBe(1.28)
    expect(Number(page?.items?.[0]?.unitGrossWeight)).toBe(1.84)
    expect(Number(page?.items?.[0]?.unitVolume)).toBe(88642)
    expect(page?.items?.[0]?.innerPacking).toEqual({ length: 21.9, width: 21.9, height: 18.5, unit: 'cm' })
  })

  test('imports an approved quotation line once and reports the second run as skipped', async () => {
    const quote = await staffRequest('POST', '/api/sourcing/quotes', {
      supplierId,
      currencyCode: 'CNY',
      sourceKind: 'manual',
    })
    expect(quote.status(), 'a manual quotation is the import source').toBe(201)
    quoteId = String((await readJsonSafe<{ id?: string }>(quote))?.id ?? '')
    expect(quoteId).toBeTruthy()

    const line = await staffRequest('POST', '/api/sourcing/quote-lines', {
      quoteId,
      itemNo: supplierCode,
      productName: 'Eversweet 3 Pro',
      derivedSku: `${supplierCode}-UVC`,
      unit: 'PCS',
      unitCost: '270',
      moqQuantity: 10,
      description: 'Material: ABS\nCapacity: 1.8L',
      hsCode: '8421219990',
    })
    expect(line.status(), 'a quotation line needs an item number to feed the library').toBe(201)
    quoteLineId = String((await readJsonSafe<{ id?: string }>(line))?.id ?? '')

    const approve = await staffRequest('POST', '/api/sourcing/quotes/approve', { id: quoteId })
    expect(approve.status(), 'the quotation must be approved first').toBe(200)

    const first = await staffRequest('POST', `${LIBRARY_URL}/import`, { quoteId, lineIds: [quoteLineId] })
    expect(first.status(), 'POST /api/purchasing/supplier-products/import should return 200').toBe(200)
    const firstResult = await readJsonSafe<{ created: number; updated: number; skipped: number; failed: unknown[] }>(first)
    expect(firstResult?.created).toBe(1)
    expect(firstResult?.skipped).toBe(0)
    expect(firstResult?.failed).toEqual([])

    const list = await staffRequest('GET', `${LIBRARY_URL}?supplierId=${encodeURIComponent(supplierId)}&search=${encodeURIComponent(`${supplierCode}-UVC`)}`)
    const page = await readJsonSafe<ListResponse<LibraryItem>>(list)
    expect(page?.total).toBe(1)
    expect(page?.items?.[0]?.source).toBe('quote')
    expect(page?.items?.[0]?.description).toBe('Material: ABS\nCapacity: 1.8L')

    // Idempotency: the values are already stored, so the same import changes nothing.
    const second = await staffRequest('POST', `${LIBRARY_URL}/import`, { quoteId, lineIds: [quoteLineId] })
    const secondResult = await readJsonSafe<{ created: number; updated: number; skipped: number }>(second)
    expect(secondResult?.created).toBe(0)
    expect(secondResult?.updated).toBe(0)
    expect(secondResult?.skipped).toBe(1)
  })

  test('syncs a library row into the product master once', async () => {
    const list = await staffRequest('GET', `${LIBRARY_URL}?supplierId=${encodeURIComponent(supplierId)}&search=${encodeURIComponent(`${supplierCode}-UVC`)}`)
    const libraryItem = (await readJsonSafe<ListResponse<LibraryItem>>(list))?.items?.[0]
    expect(libraryItem?.id, 'the imported row is the sync source').toBeTruthy()

    const promote = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: libraryItem?.id })
    expect(promote.status(), 'POST /api/purchasing/supplier-products/promote should return 200').toBe(200)
    const promoted = await readJsonSafe<{ productId?: string; action?: string; priceSkipped?: boolean }>(promote)
    expect(promoted?.action).toBe('created')
    productId = promoted?.productId ?? null
    expect(productId).toBeTruthy()
    // The quotation line priced this code, so a `purchase` price row was written.
    expect(promoted?.priceSkipped).toBe(false)

    const product = await staffRequest('GET', `/api/products/items?ids=${encodeURIComponent(String(productId))}&pageSize=1`)
    expect(product.status()).toBe(200)
    const item = (await readJsonSafe<ListResponse<{ sku: string; name: string; specSummary: string | null; hsCode: string | null }>>(product))?.items?.[0]
    expect(item?.sku).toBe(`${supplierCode}-UVC`)
    expect(item?.specSummary).toBe('Material: ABS / Capacity: 1.8L')
    expect(item?.hsCode).toBe('8421219990')

    // The library row now carries the link, so the list renders 关联商品 instead of 未同步.
    const after = await staffRequest('GET', `${LIBRARY_URL}?supplierId=${encodeURIComponent(supplierId)}&search=${encodeURIComponent(`${supplierCode}-UVC`)}`)
    const synced = (await readJsonSafe<ListResponse<LibraryItem>>(after))?.items?.[0]
    expect(synced?.productId).toBe(productId)
    expect(synced?.productSku).toBe(`${supplierCode}-UVC`)

    const again = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: libraryItem?.id })
    expect((await readJsonSafe<{ action?: string }>(again))?.action, 'a synced row writes nothing').toBe('skipped')
  })

  test('promoting quotation lines into the product master also feeds the library', async () => {
    const quote = await staffRequest('POST', '/api/sourcing/quotes', {
      supplierId,
      currencyCode: 'CNY',
      sourceKind: 'manual',
    })
    promotionQuoteId = String((await readJsonSafe<{ id?: string }>(quote))?.id ?? '')
    expect(promotionQuoteId, 'a second quotation is the promotion source').toBeTruthy()

    const line = await staffRequest('POST', '/api/sourcing/quote-lines', {
      quoteId: promotionQuoteId,
      itemNo: `${supplierCode}-2`,
      productName: 'Eversweet 5',
      derivedSku: `${supplierCode}-2`,
      unit: 'PCS',
      unitCost: '300',
    })
    const lineBody = await readJsonSafe<{ id?: string }>(line)
    expect(line.status(), `quote line answered ${JSON.stringify(lineBody)}`).toBe(201)
    const lineId = String(lineBody?.id ?? '')

    const approve = await staffRequest('POST', '/api/sourcing/quotes/approve', { id: promotionQuoteId })
    expect(approve.status()).toBe(200)

    const promote = await staffRequest('POST', '/api/sourcing/quotes/promote', {
      quoteId: promotionQuoteId,
      lineIds: [lineId],
    })
    const promoteBody = await readJsonSafe<{ created: number; updated: number; skipped: number; failed: unknown[] }>(promote)
    expect(promote.status(), `promote answered ${JSON.stringify(promoteBody)}`).toBe(200)
    expect(promoteBody?.created).toBe(1)
    expect(promoteBody?.failed).toEqual([])

    // The library row is a by-product of the promotion the operator already ran, with the master
    // link already backfilled — the two entry points converge on one row.
    const list = await staffRequest(
      'GET',
      `${LIBRARY_URL}?supplierId=${encodeURIComponent(supplierId)}&search=${encodeURIComponent(`${supplierCode}-2`)}`,
    )
    const libraryRow = (await readJsonSafe<ListResponse<LibraryItem>>(list))?.items?.[0]
    expect(libraryRow?.supplierSku).toBe(`${supplierCode}-2`)
    expect(libraryRow?.source).toBe('quote')
    expect(libraryRow?.productId, 'the promotion backfills the master link').toBeTruthy()
  })

  test('lets an order line reference a library row, and refuses another supplier’s row', async () => {
    const other = await staffRequest('POST', LIBRARY_URL, {
      supplierId: otherSupplierId,
      supplierSku: `${supplierCode}-OTHER`,
      name: 'Other supplier item',
    })
    expect(other.status()).toBe(201)
    otherSupplierProductId = String((await readJsonSafe<{ id?: string }>(other))?.id ?? '')

    // A row from a different supplier cannot be ordered on this supplier's purchase order.
    const mismatched = await staffRequest('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ supplierProductId: otherSupplierProductId, quantity: 1, unitPrice: 10 }],
    })
    expect(mismatched.status(), 'the supplier of the library row must match the order').toBe(422)
    expect((await readJsonSafe<{ code?: string }>(mismatched))?.code).toBe('supplier_product_supplier_mismatch')

    const ownLibraryRow = await staffRequest('GET', `${LIBRARY_URL}?supplierId=${encodeURIComponent(supplierId)}&search=${encodeURIComponent(`${supplierCode}-UVC`)}`)
    const ownId = (await readJsonSafe<ListResponse<LibraryItem>>(ownLibraryRow))?.items?.[0]?.id

    const order = await staffRequest('POST', '/api/purchasing/purchase-orders', {
      supplierId,
      currencyCode: 'CNY',
      lines: [{ supplierProductId: ownId, quantity: 8, unitPrice: 270, taxRate: 0, priceIncludesTax: true }],
    })
    expect(order.status(), 'POST /api/purchasing/purchase-orders should return 201').toBe(201)
    purchaseOrderId = String((await readJsonSafe<{ id?: string }>(order))?.id ?? '')
    expect(purchaseOrderId).toBeTruthy()

    const lines = await staffRequest(
      'GET',
      `/api/purchasing/purchase-orders/lines?orderId=${encodeURIComponent(purchaseOrderId)}`,
    )
    expect(lines.status()).toBe(200)
    const line = (await readJsonSafe<ListResponse<{ supplierProductId: string | null; supplierSku: string | null; productId: string | null }>>(lines))?.items?.[0]
    expect(line?.supplierProductId).toBe(ownId)
    // The synced row resolved through the product master, and the snapshot keeps the supplier's own
    // item number — what a packing list prints — not the derived master SKU.
    expect(line?.productId).toBe(productId)
    expect(line?.supplierSku).toBe(supplierCode)
  })

  test('stores our own names, declaration elements, a photo and a price list', async () => {
    const created = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: `${supplierCode}-N`,
      itemNo: `N-${stamp.toUpperCase()}`,
      name: 'Eversweet 3 Pro (supplier wording)',
      nameZh: '智能饮水机 3 代',
      nameEn: 'Eversweet 3 Pro',
      declarationElements: '品名:饮水机;品牌:Petkit;型号:W5C;材质:ABS',
      unit: 'SET',
      // A hyphenated HS code proves the column is text: a numeric one would drop the groups.
      hsCode: '8471.30.0000',
    })
    expect(created.status(), `POST /api/purchasing/supplier-products answered ${await created.text()}`).toBe(201)
    const rowId = String((await readJsonSafe<{ id?: string }>(created))?.id ?? '')
    expect(rowId).toBeTruthy()

    // The photo is uploaded against the saved row and bound by the row update, exactly as the form
    // does it (create-then-bind).
    const upload = await api.post('/api/attachments', {
      headers: {
        Authorization: `Bearer ${staffToken}`,
        Cookie: `om_selected_org=${hqOrgId}`,
      },
      multipart: {
        entityId: 'purchasing:purchasing_supplier_product',
        recordId: rowId,
        partitionCode: 'privateAttachments',
        file: { name: 'photo.png', mimeType: 'image/png', buffer: PNG_1X1 },
      },
    })
    expect(upload.status(), `POST /api/attachments answered ${await upload.text()}`).toBe(200)
    const attachmentId = String((await readJsonSafe<{ item?: { id?: string } }>(upload))?.item?.id ?? '')
    expect(attachmentId).toBeTruthy()

    const updated = await staffRequest('PUT', LIBRARY_URL, {
      id: rowId,
      supplierSku: `${supplierCode}-N`,
      name: 'Eversweet 3 Pro (supplier wording)',
      nameZh: '智能饮水机 3 代',
      nameEn: 'Eversweet 3 Pro',
      declarationElements: '品名:饮水机;品牌:Petkit;型号:W5C;材质:ABS',
      unit: 'SET',
      hsCode: '8471.30.0000',
      cartonQuantity: 8,
      unitNetWeight: '1.28',
      unitGrossWeight: '1.84',
      unitVolume: '88642',
      imageAttachmentIds: [attachmentId],
    })
    expect(updated.status(), `PUT /api/purchasing/supplier-products answered ${await updated.text()}`).toBe(200)

    const readBack = await staffRequest('GET', `${LIBRARY_URL}?id=${encodeURIComponent(rowId)}`)
    const row = (await readJsonSafe<ListResponse<LibraryItem>>(readBack))?.items?.[0]
    expect(row?.name).toBe('Eversweet 3 Pro (supplier wording)')
    expect(row?.nameZh).toBe('智能饮水机 3 代')
    expect(row?.nameEn).toBe('Eversweet 3 Pro')
    expect(row?.declarationElements).toBe('品名:饮水机;品牌:Petkit;型号:W5C;材质:ABS')
    expect(row?.unit).toBe('SET')
    expect(row?.hsCode).toBe('8471.30.0000')
    // The optional weight pair and the volume are stored as typed; the create above left them blank
    // and this update is what fills them.
    expect(Number(row?.unitNetWeight)).toBe(1.28)
    expect(Number(row?.unitGrossWeight)).toBe(1.84)
    expect(Number(row?.unitVolume)).toBe(88642)
    expect(row?.imageAttachmentIds).toEqual([attachmentId])

    const pricesUrl = `${LIBRARY_URL}/prices`
    const replaced = await staffRequest('PUT', pricesUrl, {
      supplierProductId: rowId,
      rows: [
        { priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '12.500000' },
        { priceKind: 'company_offer', currencyCode: 'USD', minQuantity: 1, unitPrice: '3.200000' },
      ],
    })
    expect(replaced.status(), `PUT …/prices answered ${await replaced.text()}`).toBe(200)

    const listed = await staffRequest('GET', `${pricesUrl}?supplierProductId=${encodeURIComponent(rowId)}`)
    const rows = (await readJsonSafe<ListResponse<PriceRow>>(listed))?.items ?? []
    expect(rows.length).toBe(2)
    expect(rows.map((entry) => `${entry.priceKind}/${entry.currencyCode}`).sort()).toEqual([
      'company_offer/USD',
      'supplier_cost/CNY',
    ])
    expect(rows.every((entry) => entry.isActive)).toBe(true)

    // The list projection carries the base price of each kind, which is what the column renders.
    const withPrices = await staffRequest('GET', `${LIBRARY_URL}?id=${encodeURIComponent(rowId)}`)
    const decorated = (await readJsonSafe<ListResponse<LibraryItem & { supplierCostPrice?: { unitPrice: string } }>>(withPrices))
      ?.items?.[0]
    expect(Number(decorated?.supplierCostPrice?.unitPrice)).toBe(12.5)

    // A duplicate `(kind, currency, minQuantity)` key is a 400; an unknown currency a 422.
    const duplicateKey = await staffRequest('PUT', pricesUrl, {
      supplierProductId: rowId,
      rows: [
        { priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '1' },
        { priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '2' },
      ],
    })
    expect(duplicateKey.status()).toBe(400)

    const unknownCurrency = await staffRequest('PUT', pricesUrl, {
      supplierProductId: rowId,
      rows: [{ priceKind: 'supplier_cost', currencyCode: 'ZZZ', minQuantity: 1, unitPrice: '1' }],
    })
    // 400, the module's own convention for a currency the dictionary does not carry (the supplier
    // and order forms answer the same way); the message names the code so the operator can fix it.
    expect(unknownCurrency.status()).toBe(400)
    expect(await unknownCurrency.text()).toContain('ZZZ')

    // Submitting a set without the offer deactivates it instead of deleting it.
    const withoutOffer = await staffRequest('PUT', pricesUrl, {
      supplierProductId: rowId,
      rows: [{ priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '12.500000' }],
    })
    expect(withoutOffer.status()).toBe(200)
    const afterRemoval = await staffRequest('GET', `${pricesUrl}?supplierProductId=${encodeURIComponent(rowId)}`)
    const remaining = (await readJsonSafe<ListResponse<PriceRow>>(afterRemoval))?.items ?? []
    expect(remaining.length, 'a withdrawn price stays readable').toBe(2)
    const offer = remaining.find((entry) => entry.priceKind === 'company_offer')
    expect(offer?.isActive).toBe(false)
    expect(Number(offer?.unitPrice)).toBe(3.2)

    // Promote: our names and the library's supplier price reach the product master.
    const promote = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowId })
    expect(promote.status(), `POST …/promote answered ${await promote.text()}`).toBe(200)
    const promoted = await readJsonSafe<{ productId?: string; action?: string }>(promote)
    expect(promoted?.action).toBe('created')
    const promotedProductId = promoted?.productId ?? ''
    expect(promotedProductId).toBeTruthy()

    const itemRead = await staffRequest('GET', `/api/products/items?ids=${encodeURIComponent(promotedProductId)}`)
    const item = (
      await readJsonSafe<
        ListResponse<{
          id: string
          name: string
          nameEn: string | null
          netWeight: string | null
          grossWeight: string | null
          volume: string | null
        }>
      >(itemRead)
    )?.items?.[0]
    expect(item?.name, 'our Chinese name is what the master displays').toBe('智能饮水机 3 代')
    expect(item?.nameEn).toBe('Eversweet 3 Pro')
    // The library's whole physical set crosses over: the weight pair and the volume (cm³) become the
    // master's own columns.
    expect(Number(item?.netWeight), 'the library net weight reaches the master').toBe(1.28)
    expect(Number(item?.grossWeight), 'the library gross weight reaches the master').toBe(1.84)
    expect(Number(item?.volume), 'the library volume reaches the master').toBe(88642)

    const masterPrices = await staffRequest(
      'GET',
      `/api/products/prices?productId=${encodeURIComponent(promotedProductId)}&isActive=true`,
    )
    const purchase = ((await readJsonSafe<ListResponse<{ priceTier: string; currencyCode: string; unitPrice: string }>>(masterPrices))
      ?.items ?? []).find((entry) => entry.priceTier === 'purchase')
    expect(purchase?.currencyCode, 'the library price wins over the quotation for the purchase tier').toBe('CNY')
    expect(Number(purchase?.unitPrice)).toBe(12.5)
  })

  test('hides another organization’s library and refuses a role without the feature', async () => {
    // A token acting in the branch organization cannot see the HQ library.
    const branchOrg = branchOrgId
    const staffRole = staffRoleId
    expect(branchOrg, 'the branch organization fixture exists').toBeTruthy()
    expect(staffRole, 'the staff role fixture exists').toBeTruthy()
    if (!branchOrg || !staffRole) return
    const branchUserEmail = `supplier-products-branch-${stamp}@example.com`
    const branchUserId = await createUserFixture(api, rootToken, {
      email: branchUserEmail,
      password: STAFF_PASSWORD,
      organizationId: branchOrg,
      roles: [staffRole],
      name: 'Supplier products E2E branch',
    })
    try {
      const branchToken = await getAuthToken(api, branchUserEmail, STAFF_PASSWORD)
      const branchList = await apiRequestWithSelectedOrg(api, 'GET', LIBRARY_URL, {
        token: branchToken,
        selectedOrgId: branchOrg,
      })
      expect(branchList.status()).toBe(200)
      expect((await readJsonSafe<ListResponse<LibraryItem>>(branchList))?.total ?? 0).toBe(0)

      // Not even by naming a row of the other organization: the scope filter fails closed.
      const branchById = await apiRequestWithSelectedOrg(
        api,
        'GET',
        `${LIBRARY_URL}?id=${encodeURIComponent(String(libraryRowId))}`,
        { token: branchToken, selectedOrgId: branchOrg },
      )
      expect(branchById.status()).toBe(200)
      expect((await readJsonSafe<ListResponse<LibraryItem>>(branchById))?.total ?? 0).toBe(0)
    } finally {
      await deleteUserIfExists(api, rootToken, branchUserId)
    }


    const viewerDenied = await apiRequestWithSelectedOrg(api, 'GET', LIBRARY_URL, {
      token: viewerToken,
      selectedOrgId: hqOrgId,
    })
    expect(viewerDenied.status(), 'a role without purchasing.supplier-products.view is refused').toBe(403)
  })

  test('Phase 8 — links, re-points and clears a library row, and refuses targets it cannot own (TEST-SPL-009)', async () => {
    const branchOrg = branchOrgId
    expect(branchOrg, 'the branch organization fixture exists').toBeTruthy()
    if (!branchOrg) return

    // Two linkable master rows in HQ and one in the child branch organization: a link written from an
    // HQ-scoped request must not be able to point at the latter, even though the branch is an
    // organization the caller can read.
    const linkTargetIds: string[] = []
    for (const suffix of ['A', 'B']) {
      const created = await staffRequest('POST', '/api/products/items', {
        sku: `${supplierCode}-LINK-${suffix}`,
        name: `Link target ${suffix} ${stamp}`,
        unit: 'PCS',
      })
      const body = await readJsonSafe<{ id?: string }>(created)
      expect(created.status(), `POST /api/products/items answered ${JSON.stringify(body)}`).toBe(201)
      linkTargetIds.push(String(body?.id ?? ''))
    }
    const [firstTargetId, secondTargetId] = linkTargetIds
    expect(firstTargetId && secondTargetId, 'both HQ link targets exist').toBeTruthy()

    const branchProduct = await apiRequestWithSelectedOrg(api, 'POST', '/api/products/items', {
      token: rootToken,
      selectedOrgId: branchOrg,
      data: { sku: `${supplierCode}-LINK-BRANCH`, name: `Branch link target ${stamp}`, unit: 'PCS' },
    })
    const branchProductBody = await readJsonSafe<{ id?: string }>(branchProduct)
    expect(branchProduct.status(), `the branch product answered ${JSON.stringify(branchProductBody)}`).toBe(201)
    const branchProductId = String(branchProductBody?.id ?? '')
    expect(branchProductId, 'the child organization owns its own product').toBeTruthy()

    // The supplier's own code deliberately differs from every master SKU: linking is exactly how a
    // code that does not match ours is attached without spawning a duplicate product.
    const rowSku = `${supplierCode}-LINK-ROW`
    const createdRow = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: rowSku,
      name: 'Linkable item',
      unit: 'PCS',
    })
    const createdRowBody = await readJsonSafe<{ id?: string }>(createdRow)
    expect(createdRow.status(), `POST ${LIBRARY_URL} answered ${JSON.stringify(createdRowBody)}`).toBe(201)
    const rowId = String(createdRowBody?.id ?? '')
    expect(rowId, 'the library row is the link source').toBeTruthy()

    const productCount = async () => {
      const list = await staffRequest('GET', `/api/products/items?pageSize=1&search=${encodeURIComponent(supplierCode)}`)
      expect(list.status(), 'the product list answers while counting').toBe(200)
      return (await readJsonSafe<ListResponse<{ id: string }>>(list))?.total ?? 0
    }
    const beforeLink = await productCount()

    const link = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: firstTargetId })
    const linkBody = await readJsonSafe<{ id?: string; productId?: string | null; code?: string }>(link)
    expect(link.status(), `POST ${LIBRARY_URL}/link answered ${JSON.stringify(linkBody)}`).toBe(200)
    expect(linkBody?.id).toBe(rowId)
    expect(linkBody?.productId, 'the link action echoes the product it points at').toBe(firstTargetId)

    const linked = await staffRequest('GET', `${LIBRARY_URL}?ids=${encodeURIComponent(rowId)}`)
    const linkedRow = (await readJsonSafe<ListResponse<LibraryItem & { productDeleted?: boolean }>>(linked))?.items?.[0]
    expect(linkedRow?.productId, 'the row stores the link (关联已有商品)').toBe(firstTargetId)
    expect(linkedRow?.productSku, 'the list resolves the linked product’s SKU').toBe(`${supplierCode}-LINK-A`)
    expect(linkedRow?.productDeleted, 'a live link is not flagged as deleted').toBe(false)
    expect(await productCount(), 'linking writes only the library row, never a product').toBe(beforeLink)

    // 换绑: the same action re-points an existing link.
    const relink = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: secondTargetId })
    expect(relink.status(), 're-pointing a link is the same action (换绑)').toBe(200)
    const relinked = await staffRequest('GET', `${LIBRARY_URL}?ids=${encodeURIComponent(rowId)}`)
    const relinkedRow = (await readJsonSafe<ListResponse<LibraryItem>>(relinked))?.items?.[0]
    expect(relinkedRow?.productId, 'the link moved to the second product').toBe(secondTargetId)
    expect(relinkedRow?.productSku).toBe(`${supplierCode}-LINK-B`)

    // 解除关联: an explicit null clears it.
    const cleared = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: null })
    const clearedBody = await readJsonSafe<{ productId?: string | null }>(cleared)
    expect(cleared.status(), `clearing the link answered ${JSON.stringify(clearedBody)}`).toBe(200)
    expect(clearedBody?.productId, 'productId: null clears the link (解除关联)').toBeNull()
    const afterClear = await staffRequest('GET', `${LIBRARY_URL}?ids=${encodeURIComponent(rowId)}`)
    const clearedRow = (await readJsonSafe<ListResponse<LibraryItem & { productDeleted?: boolean }>>(afterClear))?.items?.[0]
    expect(clearedRow?.productId, 'the cleared row carries no link').toBeNull()
    expect(clearedRow?.supplierSku, 'the row itself is still readable after clearing').toBe(rowSku)

    // A product of the child organization is outside the HQ scope the request writes in.
    const foreign = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: branchProductId })
    const foreignBody = await readJsonSafe<{ code?: string }>(foreign)
    expect(foreign.status(), `linking a product of the child organization answered ${JSON.stringify(foreignBody)}`).toBe(404)
    expect(foreignBody?.code).toBe('product_not_found')

    // A soft-deleted target is refused too, and nothing is written.
    const doomedTarget = await staffRequest('POST', '/api/products/items', {
      sku: `${supplierCode}-LINK-DELETED`,
      name: `Deleted link target ${stamp}`,
      unit: 'PCS',
    })
    const doomedTargetId = String((await readJsonSafe<{ id?: string }>(doomedTarget))?.id ?? '')
    expect(doomedTarget.status(), 'the doomed link target exists').toBe(201)
    const removeDoomed = await staffRequest('DELETE', `/api/products/items?id=${encodeURIComponent(doomedTargetId)}`)
    expect(removeDoomed.status(), 'DELETE /api/products/items soft-deletes the product').toBe(200)

    const toDeleted = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: doomedTargetId })
    const toDeletedBody = await readJsonSafe<{ code?: string }>(toDeleted)
    expect(toDeleted.status(), `linking a deleted product answered ${JSON.stringify(toDeletedBody)}`).toBe(422)
    expect(toDeletedBody?.code).toBe('product_deleted')
    const stillCleared = await staffRequest('GET', `${LIBRARY_URL}?ids=${encodeURIComponent(rowId)}`)
    expect(
      (await readJsonSafe<ListResponse<LibraryItem>>(stillCleared))?.items?.[0]?.productId,
      'a refused link leaves the row unlinked',
    ).toBeNull()

    // A link can outlive its target: link a live product, delete that product, and the row must say so
    // instead of reading as simply unlinked.
    const vanishingTarget = await staffRequest('POST', '/api/products/items', {
      sku: `${supplierCode}-LINK-GONE`,
      name: `Vanishing link target ${stamp}`,
      unit: 'PCS',
    })
    const vanishingTargetId = String((await readJsonSafe<{ id?: string }>(vanishingTarget))?.id ?? '')
    expect(vanishingTarget.status(), 'the vanishing link target exists').toBe(201)
    const linkVanishing = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: vanishingTargetId })
    expect(linkVanishing.status(), 'a live product links').toBe(200)
    const removeVanishing = await staffRequest('DELETE', `/api/products/items?id=${encodeURIComponent(vanishingTargetId)}`)
    expect(removeVanishing.status(), 'the linked product is soft-deleted afterwards').toBe(200)

    const orphaned = await staffRequest('GET', `${LIBRARY_URL}?ids=${encodeURIComponent(rowId)}`)
    const orphanedRow = (await readJsonSafe<ListResponse<LibraryItem & { productDeleted?: boolean }>>(orphaned))?.items?.[0]
    expect(orphanedRow?.productId, 'the stored link survives the product’s deletion').toBe(vanishingTargetId)
    expect(orphanedRow?.productDeleted, 'the list flags the link whose product is gone').toBe(true)

    const linkedFilter = await staffRequest('GET', `${LIBRARY_URL}?linked=linked&search=${encodeURIComponent(rowSku)}`)
    expect(linkedFilter.status()).toBe(200)
    const linkedPage = await readJsonSafe<ListResponse<LibraryItem>>(linkedFilter)
    expect(
      linkedPage?.items?.some((entry) => entry.id === rowId),
      '建档状态 filters the stored link, so a deleted target stays in 已建档',
    ).toBe(true)

    const unlinkedFilter = await staffRequest('GET', `${LIBRARY_URL}?linked=unlinked&search=${encodeURIComponent(rowSku)}`)
    expect(unlinkedFilter.status()).toBe(200)
    const unlinkedPage = await readJsonSafe<ListResponse<LibraryItem>>(unlinkedFilter)
    expect(
      unlinkedPage?.items?.some((entry) => entry.id === rowId),
      'and it is not offered as 未建档 while the link is still stored',
    ).toBe(false)

    const clearOrphan = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: rowId, productId: null })
    expect(clearOrphan.status(), 'clearing a link whose product is gone is allowed').toBe(200)
    const afterOrphanClear = await staffRequest('GET', `${LIBRARY_URL}?linked=unlinked&search=${encodeURIComponent(rowSku)}`)
    const unlinkedAfterClear = await readJsonSafe<ListResponse<LibraryItem>>(afterOrphanClear)
    expect(
      unlinkedAfterClear?.items?.some((entry) => entry.id === rowId),
      'once cleared the row moves to 未建档',
    ).toBe(true)
  })

  test('Phase 8 — sync-fields pushes the row’s values and its purchase price onto the linked product (TEST-SPL-010)', async () => {
    const syncProductSku = `${supplierCode}-SYNC`
    const createdProduct = await staffRequest('POST', '/api/products/items', {
      sku: syncProductSku,
      name: `Master name before sync ${stamp}`,
      unit: 'PCS',
    })
    const createdProductBody = await readJsonSafe<{ id?: string }>(createdProduct)
    expect(createdProduct.status(), `POST /api/products/items answered ${JSON.stringify(createdProductBody)}`).toBe(201)
    const syncProductId = String(createdProductBody?.id ?? '')
    expect(syncProductId, 'the sync target exists').toBeTruthy()

    const masterPricesUrl = '/api/products/prices'
    const replaced = await staffRequest('PUT', masterPricesUrl, {
      productId: syncProductId,
      rows: [
        { priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 1, unitPrice: '10.000000' },
        { priceTier: 'internal', currencyCode: 'CNY', minQuantity: 1, unitPrice: '20.000000' },
        { priceTier: 'export', currencyCode: 'CNY', minQuantity: 1, unitPrice: '30.000000' },
      ],
    })
    expect(replaced.status(), `PUT ${masterPricesUrl} answered ${await replaced.text()}`).toBe(200)

    const masterPrices = async () => {
      const listed = await staffRequest(
        'GET',
        `${masterPricesUrl}?productId=${encodeURIComponent(syncProductId)}&isActive=true`,
      )
      expect(listed.status(), 'the price list answers').toBe(200)
      return (
        (await readJsonSafe<ListResponse<{ id: string; priceTier: string; currencyCode: string; unitPrice: string }>>(listed))
          ?.items ?? []
      )
    }
    const pricesBefore = await masterPrices()
    const internalBefore = pricesBefore.find((entry) => entry.priceTier === 'internal')
    const exportBefore = pricesBefore.find((entry) => entry.priceTier === 'export')
    expect(internalBefore && exportBefore, 'the product starts with all three price tiers').toBeTruthy()

    const syncRowSku = `${supplierCode}-SYNC-ROW`
    const createdRow = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: syncRowSku,
      name: 'Sync source (supplier wording)',
      nameZh: '同步前的名称',
      description: 'Material: ABS',
      unit: 'PCS',
    })
    const createdRowBody = await readJsonSafe<{ id?: string }>(createdRow)
    expect(createdRow.status(), `POST ${LIBRARY_URL} answered ${JSON.stringify(createdRowBody)}`).toBe(201)
    const syncRowId = String(createdRowBody?.id ?? '')
    expect(syncRowId, 'the library row is the sync source').toBeTruthy()

    const link = await staffRequest('POST', `${LIBRARY_URL}/link`, { id: syncRowId, productId: syncProductId })
    expect(link.status(), 'the row must be linked before its fields can be pushed').toBe(200)

    // The row's own confirmed supplier cost is the price the `purchase` tier follows.
    const rowPrices = await staffRequest('PUT', `${LIBRARY_URL}/prices`, {
      supplierProductId: syncRowId,
      rows: [{ priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '18.500000' }],
    })
    expect(rowPrices.status(), `PUT ${LIBRARY_URL}/prices answered ${await rowPrices.text()}`).toBe(200)

    const rowUpdated = await staffRequest('PUT', LIBRARY_URL, {
      id: syncRowId,
      supplierSku: syncRowSku,
      name: 'Sync source (supplier wording)',
      nameZh: '同步后的名称',
      description: 'Material: ABS\nCapacity: 2.0L',
      unit: 'PCS',
    })
    expect(rowUpdated.status(), `PUT ${LIBRARY_URL} answered ${await rowUpdated.text()}`).toBe(200)

    const sync = await staffRequest('POST', `${LIBRARY_URL}/sync-fields`, { id: syncRowId })
    const syncBody = await readJsonSafe<{
      productId?: string
      fieldsChanged?: string[]
      priceChanged?: boolean
      code?: string
    }>(sync)
    expect(sync.status(), `POST ${LIBRARY_URL}/sync-fields answered ${JSON.stringify(syncBody)}`).toBe(200)
    expect(syncBody?.productId, 'the sync names the product it wrote').toBe(syncProductId)
    expect(syncBody?.fieldsChanged, 'the report names exactly the fields the sync wrote').toEqual(['name', 'specSummary'])
    expect(syncBody?.priceChanged, 'the row’s supplier cost moved the purchase tier').toBe(true)

    const detail = await staffRequest('GET', `/api/products/items/${encodeURIComponent(syncProductId)}`)
    expect(detail.status(), `GET /api/products/items/{id} answered ${await detail.text()}`).toBe(200)
    const item = (
      await readJsonSafe<{ item?: { name: string; nameEn: string | null; specSummary: string | null; unit: string } }>(detail)
    )?.item
    expect(item?.name, 'our Chinese name is what the master displays').toBe('同步后的名称')
    expect(item?.specSummary, 'the description becomes the master’s spec summary').toBe('Material: ABS / Capacity: 2.0L')

    const pricesAfter = await masterPrices()
    const purchaseAfter = pricesAfter.find((entry) => entry.priceTier === 'purchase')
    expect(purchaseAfter?.currencyCode, 'the purchase tier keeps the library row’s currency').toBe('CNY')
    expect(Number(purchaseAfter?.unitPrice), 'the purchase tier follows the library row').toBe(18.5)
    const internalAfter = pricesAfter.find((entry) => entry.priceTier === 'internal')
    const exportAfter = pricesAfter.find((entry) => entry.priceTier === 'export')
    expect(internalAfter?.id, 'the internal tier is the same row it was before the sync').toBe(internalBefore?.id)
    expect(Number(internalAfter?.unitPrice), 'the internal tier is never touched').toBe(20)
    expect(exportAfter?.id, 'the export tier is the same row it was before the sync').toBe(exportBefore?.id)
    expect(Number(exportAfter?.unitPrice), 'the export tier is never touched').toBe(30)

    const second = await staffRequest('POST', `${LIBRARY_URL}/sync-fields`, { id: syncRowId })
    const secondBody = await readJsonSafe<{ fieldsChanged?: string[]; priceChanged?: boolean }>(second)
    expect(second.status(), 'a second sync is accepted').toBe(200)
    expect(secondBody?.fieldsChanged, 'a second sync finds nothing left to write').toEqual([])
    expect(secondBody?.priceChanged, 'and no price to move').toBe(false)

    // An unlinked row has no product to push to.
    const unlinkedRow = await staffRequest('POST', LIBRARY_URL, {
      supplierId,
      supplierSku: `${supplierCode}-SYNC-UNLINKED`,
      name: 'Never linked',
      unit: 'PCS',
    })
    const unlinkedRowBody = await readJsonSafe<{ id?: string }>(unlinkedRow)
    expect(unlinkedRow.status(), `POST ${LIBRARY_URL} answered ${JSON.stringify(unlinkedRowBody)}`).toBe(201)
    const refused = await staffRequest('POST', `${LIBRARY_URL}/sync-fields`, { id: String(unlinkedRowBody?.id ?? '') })
    const refusedBody = await readJsonSafe<{ code?: string }>(refused)
    expect(refused.status(), `an unlinked row answered ${JSON.stringify(refusedBody)}`).toBe(422)
    expect(refusedBody?.code).toBe('supplier_product_not_linked')
  })

  test('Phase 8 — promote-batch isolates one row’s failure, collapses duplicates and refuses an empty payload (TEST-SPL-011)', async () => {
    const batchNewSku = `${supplierCode}-BATCH-NEW`
    const batchExistingSku = `${supplierCode}-BATCH-EXISTING`
    const batchDeletedSku = `${supplierCode}-BATCH-DELETED`

    const createRow = async (supplierSku: string, name: string) => {
      const created = await staffRequest('POST', LIBRARY_URL, { supplierId, supplierSku, name, unit: 'PCS' })
      const body = await readJsonSafe<{ id?: string }>(created)
      expect(created.status(), `POST ${LIBRARY_URL} for ${supplierSku} answered ${JSON.stringify(body)}`).toBe(201)
      return String(body?.id ?? '')
    }

    const rowNew = await createRow(batchNewSku, 'Batch item (new SKU)')
    const rowExisting = await createRow(batchExistingSku, 'Batch item (existing SKU)')
    const rowDeleted = await createRow(batchDeletedSku, 'Batch item (deleted SKU)')
    expect(rowNew && rowExisting && rowDeleted, 'the three batch rows exist').toBeTruthy()

    // The second row's SKU already exists as a live product, but under a different name, so the
    // promotion has something to write (`updated`) instead of nothing (`skipped`).
    const existingProduct = await staffRequest('POST', '/api/products/items', {
      sku: batchExistingSku,
      name: `Legacy master name ${stamp}`,
      unit: 'PCS',
    })
    const existingProductBody = await readJsonSafe<{ id?: string }>(existingProduct)
    expect(existingProduct.status(), `the existing product answered ${JSON.stringify(existingProductBody)}`).toBe(201)
    const existingProductId = String(existingProductBody?.id ?? '')
    expect(existingProductId, 'the row’s SKU is already owned by a product').toBeTruthy()

    // The third row's SKU is owned by a product that is already soft-deleted: the promotion must
    // refuse it alone instead of reviving the deleted row.
    const deletedProduct = await staffRequest('POST', '/api/products/items', {
      sku: batchDeletedSku,
      name: `Deleted master name ${stamp}`,
      unit: 'PCS',
    })
    const deletedProductBody = await readJsonSafe<{ id?: string }>(deletedProduct)
    expect(deletedProduct.status(), `the deleted product answered ${JSON.stringify(deletedProductBody)}`).toBe(201)
    const deletedProductId = String(deletedProductBody?.id ?? '')
    const removeDeletedProduct = await staffRequest('DELETE', `/api/products/items?id=${encodeURIComponent(deletedProductId)}`)
    expect(removeDeletedProduct.status(), 'the third row’s SKU belongs to a soft-deleted product').toBe(200)

    const productCount = async () => {
      const list = await staffRequest('GET', `/api/products/items?pageSize=1&search=${encodeURIComponent(supplierCode)}`)
      expect(list.status(), 'the product list answers while counting').toBe(200)
      return (await readJsonSafe<ListResponse<{ id: string }>>(list))?.total ?? 0
    }
    const beforeBatch = await productCount()

    type BatchResult = {
      created?: number
      updated?: number
      skipped?: number
      failed?: Array<{ id: string; code: string; message: string }>
    }
    const batch = await staffRequest('POST', `${LIBRARY_URL}/promote-batch`, {
      ids: [rowNew, rowExisting, rowDeleted],
    })
    const batchBody = await readJsonSafe<BatchResult>(batch)
    expect(batch.status(), `POST ${LIBRARY_URL}/promote-batch answered ${JSON.stringify(batchBody)}`).toBe(200)
    expect(batchBody?.created, 'the row whose SKU is unknown creates a product').toBe(1)
    expect(batchBody?.updated, 'the row whose SKU already existed updates that product').toBe(1)
    expect(batchBody?.skipped).toBe(0)
    expect(batchBody?.failed?.length, 'only the row owned by a deleted product fails').toBe(1)
    expect(batchBody?.failed?.[0]?.id).toBe(rowDeleted)
    expect(batchBody?.failed?.[0]?.code, 'the failure names the deleted-SKU rule').toBe('sku_belongs_to_deleted_product')

    const batchRows = await staffRequest(
      'GET',
      `${LIBRARY_URL}?ids=${encodeURIComponent([rowNew, rowExisting, rowDeleted].join(','))}`,
    )
    const batchItems = (await readJsonSafe<ListResponse<LibraryItem>>(batchRows))?.items ?? []
    expect(
      batchItems.find((entry) => entry.id === rowNew)?.productId,
      'the created row is linked to its new product',
    ).toBeTruthy()
    expect(
      batchItems.find((entry) => entry.id === rowExisting)?.productId,
      'the existing product is reused, not duplicated',
    ).toBe(existingProductId)
    expect(
      batchItems.find((entry) => entry.id === rowDeleted)?.productId,
      'the failed row is left untouched',
    ).toBeNull()
    const afterBatch = await productCount()
    expect(afterBatch, 'one product per distinct successful row, and none for the refused one').toBe(beforeBatch + 1)

    // Re-running is idempotent for the two that landed, and repeats the same failure.
    const repeat = await staffRequest('POST', `${LIBRARY_URL}/promote-batch`, {
      ids: [rowNew, rowExisting, rowDeleted],
    })
    const repeatBody = await readJsonSafe<BatchResult>(repeat)
    expect(repeat.status()).toBe(200)
    expect(repeatBody?.created, 'a repeated batch creates nothing').toBe(0)
    expect(
      (repeatBody?.updated ?? 0) + (repeatBody?.skipped ?? 0),
      'both linked rows are already done, reported as skipped or updated',
    ).toBe(2)
    expect(repeatBody?.failed?.length, 'the deleted-SKU failure repeats').toBe(1)
    expect(repeatBody?.failed?.[0]?.code).toBe('sku_belongs_to_deleted_product')
    expect(await productCount(), 'a repeated batch creates no product').toBe(afterBatch)

    // Duplicate ids collapse to their first occurrence: the counts describe distinct rows.
    const rowDuplicate = await createRow(`${supplierCode}-BATCH-DUPLICATE`, 'Batch item (duplicate ids)')
    const duplicated = await staffRequest('POST', `${LIBRARY_URL}/promote-batch`, {
      ids: [rowDuplicate, rowDuplicate, rowDuplicate],
    })
    const duplicatedBody = await readJsonSafe<BatchResult>(duplicated)
    expect(duplicated.status(), `a duplicated payload answered ${JSON.stringify(duplicatedBody)}`).toBe(200)
    expect(duplicatedBody?.created, 'the repeated id is promoted once').toBe(1)
    expect(
      (duplicatedBody?.created ?? 0) + (duplicatedBody?.updated ?? 0) + (duplicatedBody?.skipped ?? 0),
      'the row is counted once, not once per occurrence',
    ).toBe(1)
    expect(duplicatedBody?.failed, 'a collapsed duplicate is not a failure').toEqual([])
    expect(await productCount(), 'the collapsed row created exactly one product').toBe(afterBatch + 1)

    const empty = await staffRequest('POST', `${LIBRARY_URL}/promote-batch`, { ids: [] })
    expect(empty.status(), 'a payload with no ids is refused').toBe(400)
  })

  test('Phase 9 — the item discount nets the supply price into the cost tier, and our offer comes from the product (TEST-SPL-013)', async () => {
    const discountSku = `${supplierCode}-DISC`
    const rowBody = {
      supplierId,
      supplierSku: discountSku,
      name: 'Discounted item (supplier wording)',
      unit: 'PCS',
    }
    const created = await staffRequest('POST', LIBRARY_URL, { ...rowBody, discountPercent: '5' })
    const createdBody = await readJsonSafe<{ id?: string }>(created)
    expect(created.status(), `POST ${LIBRARY_URL} answered ${JSON.stringify(createdBody)}`).toBe(201)
    const rowId = String(createdBody?.id ?? '')
    expect(rowId, 'the discounted row exists').toBeTruthy()

    const priced = await staffRequest('PUT', `${LIBRARY_URL}/prices`, {
      supplierProductId: rowId,
      rows: [{ priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '100.000000' }],
    })
    expect(priced.status(), `PUT …/prices answered ${await priced.text()}`).toBe(200)

    type PricedRow = LibraryItem & {
      discountPercent?: string | null
      supplierCostPrice?: { currencyCode: string; unitPrice: string; netUnitPrice?: string | null } | null
      companyOfferPrice?: { currencyCode: string; unitPrice: string } | null
      companyOfferSource?: string | null
    }
    const readRow = async (): Promise<PricedRow | undefined> => {
      const listed = await staffRequest('GET', `${LIBRARY_URL}?id=${encodeURIComponent(rowId)}`)
      expect(listed.status(), 'the list answers').toBe(200)
      return (await readJsonSafe<ListResponse<PricedRow>>(listed))?.items?.[0]
    }

    // The row stores the discount as a whole `numeric(3,0)` percentage (owner 2026-09-24) and the list
    // derives the 折后价 — the number the column leads with and the promotion is expected to write.
    const discounted = await readRow()
    expect(Number(discounted?.discountPercent), 'the discount round-trips').toBe(5)
    expect(discounted?.discountPercent, 'a whole percent reads back without a padded fraction').toBe('5')
    expect(Number(discounted?.supplierCostPrice?.unitPrice), 'the printed supply price is kept').toBe(100)
    expect(discounted?.supplierCostPrice?.netUnitPrice, 'the net amount is derived, not stored').toBe('95.000000')

    const promote = await staffRequest('POST', `${LIBRARY_URL}/promote`, { id: rowId })
    const promoted = await readJsonSafe<{ productId?: string; action?: string }>(promote)
    expect(promote.status(), `POST …/promote answered ${JSON.stringify(promoted)}`).toBe(200)
    const productId = String(promoted?.productId ?? '')
    expect(productId, 'the promotion names the product it created').toBeTruthy()

    const masterPrices = async () => {
      const listed = await staffRequest(
        'GET',
        `/api/products/prices?productId=${encodeURIComponent(productId)}&isActive=true`,
      )
      expect(listed.status(), 'the product price list answers').toBe(200)
      return (
        (await readJsonSafe<ListResponse<{ priceTier: string; currencyCode: string; unitPrice: string }>>(listed))
          ?.items ?? []
      )
    }
    const purchase = (await masterPrices()).find((entry) => entry.priceTier === 'purchase')
    expect(purchase, 'the promotion wrote a purchase price').toBeTruthy()
    expect(
      Number(purchase?.unitPrice),
      'the cost tier receives the discounted price, not the supplier’s list price',
    ).toBe(95)

    // 本公司报价 left the library on 2026-09-24: the column reads the product's 内部结算价 tier.
    const internal = await staffRequest('PUT', '/api/products/prices', {
      productId,
      rows: [
        { priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 1, unitPrice: '95.000000' },
        { priceTier: 'internal', currencyCode: 'USD', minQuantity: 1, unitPrice: '21.500000' },
      ],
    })
    expect(internal.status(), `PUT /api/products/prices answered ${await internal.text()}`).toBe(200)
    const relisted = await readRow()
    expect(relisted?.companyOfferSource, 'the offer is read from the product, not from the row').toBe('product')
    expect(relisted?.companyOfferPrice?.currencyCode).toBe('USD')
    expect(Number(relisted?.companyOfferPrice?.unitPrice)).toBe(21.5)

    // The discount is bounded and whole-numbered, and clearing it puts the printed price back in
    // charge of the net.
    for (const discountPercent of ['101', '-1', '5.12345', '3.75']) {
      const refused = await staffRequest('PUT', LIBRARY_URL, { id: rowId, ...rowBody, discountPercent })
      expect(refused.status(), `discountPercent ${discountPercent} is refused`).toBe(400)
    }
    const cleared = await staffRequest('PUT', LIBRARY_URL, { id: rowId, ...rowBody, discountPercent: null })
    expect(cleared.status(), `clearing the discount answered ${await cleared.text()}`).toBe(200)
    const afterClear = await readRow()
    expect(afterClear?.discountPercent, 'a cleared discount reads back as none').toBeNull()
    expect(afterClear?.supplierCostPrice?.netUnitPrice, 'with no discount the net is the list price').toBe(
      '100.000000',
    )
  })
})
