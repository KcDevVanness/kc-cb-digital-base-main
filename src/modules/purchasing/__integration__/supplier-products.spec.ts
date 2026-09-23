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
    const item = (await readJsonSafe<ListResponse<{ id: string; name: string; nameEn: string | null }>>(itemRead))?.items?.[0]
    expect(item?.name, 'our Chinese name is what the master displays').toBe('智能饮水机 3 代')
    expect(item?.nameEn).toBe('Eversweet 3 Pro')

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
})
