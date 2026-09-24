import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findAliasTargetIds } from '../../../product_codes/lib/aliasLookup'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingSupplierProduct } from '../../data/entities'
import {
  supplierProductCreateSchema,
  supplierProductListSchema,
  supplierProductUpdateSchema,
} from '../../data/validators'
import { loadProductLabels, loadBaseTierPricesByProduct } from '../../lib/productsReads'
import { loadBasePricesByItem, type SupplierProductPriceCell } from '../../lib/supplierProductPrices'
import { netUnitPrice } from '../../lib/priceKinds'
import { createPurchasingCrudOpenApi, purchasingCreatedSchema, purchasingOkSchema } from '../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product' as const

/**
 * The base price of one kind, attached to a list row by the `afterList` hook.
 *
 * Both prices travel as a cell rather than a formatted string: the amount and the currency are
 * separate facts, and only the client knows the reader's locale. `minQuantity` rides along so the
 * column can mark a price that only applies from a carton up.
 *
 * `netUnitPrice` is the 折后价 (`unit_price × (1 − discount/100)`, six decimals, computed by
 * `lib/priceKinds.ts`) — the number the business actually pays, and the one the promotion writes into
 * the product master. `unitPrice` stays on the cell as the supplier's printed 供货价 so the column can
 * show both.
 */
const supplierProductPriceCellSchema = z.object({
  currencyCode: z.string(),
  unitPrice: z.string(),
  netUnitPrice: z.string().nullable().optional(),
  minQuantity: z.number(),
})

const supplierProductListItemSchema = z
  .object({
    id: z.string().uuid(),
    supplierId: z.string().uuid(),
    supplierName: z.string().nullable().optional(),
    supplierSku: z.string(),
    itemNo: z.string().nullable().optional(),
    brandValue: z.string().nullable().optional(),
    name: z.string(),
    nameZh: z.string().nullable().optional(),
    nameEn: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    declarationElements: z.string().nullable().optional(),
    unit: z.string(),
    hsCode: z.string().nullable().optional(),
    supplierCostPrice: supplierProductPriceCellSchema.nullable().optional(),
    companyOfferPrice: supplierProductPriceCellSchema.nullable().optional(),
    /**
     * Where the 本公司报价 column's value came from: the linked product's `internal`（内部结算价）tier
     * (the only entry point since 2026-09-24) or a library `company_offer` row stored before that
     * change. Presentation only — the row itself no longer owns an editable offer.
     */
    companyOfferSource: z.enum(['product', 'library']).nullable().optional(),
    discountPercent: z.string().nullable().optional(),
    imageAttachmentIds: z.array(z.string()).optional(),
    moqQuantity: z.number().nullable().optional(),
    cartonQuantity: z.number().nullable().optional(),
    unitNetWeight: z.string().nullable().optional(),
    unitGrossWeight: z.string().nullable().optional(),
    unitVolume: z.string().nullable().optional(),
    innerPacking: z.record(z.string(), z.unknown()).nullable().optional(),
    productId: z.string().uuid().nullable().optional(),
    productSku: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
    /**
     * Phase 8: `productId` is set but no live product resolves for it (deleted, or outside this
     * scope). Presentation only — the list still counts the row as 已建档.
     */
    productDeleted: z.boolean().optional(),
    status: z.string(),
    source: z.string(),
    lastQuoteId: z.string().uuid().nullable().optional(),
    notes: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type SupplierProductListQuery = z.infer<typeof supplierProductListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  const text = String(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** A jsonb array read defensively: anything that is not a string array reads as "no images". */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** `CNY 12.500000` for the CSV/XLSX export, where a nested object would print as `[object Object]`. */
function formatPriceCell(cell: unknown, amountField: 'unitPrice' | 'netUnitPrice' = 'unitPrice'): string {
  if (!cell || typeof cell !== 'object') return ''
  const record = cell as Partial<SupplierProductPriceCell>
  const currencyCode = record.currencyCode
  const amount = record[amountField]
  if (!currencyCode || amount === undefined || amount === null) return ''
  const ladder = record.minQuantity && record.minQuantity > 1 ? ` (≥${record.minQuantity})` : ''
  return `${currencyCode} ${amount}${ladder}`
}

// `updated_at` is part of the projection because the optimistic-lock round trip needs it:
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`.
const listFields = [
  'id',
  'supplier_id',
  'supplier_name_snapshot',
  'supplier_sku',
  'item_no',
  'brand_value',
  'name',
  'name_zh',
  'name_en',
  'description',
  'declaration_elements',
  'unit',
  'hs_code',
  'moq_quantity',
  'carton_quantity',
  'unit_net_weight',
  'unit_gross_weight',
  'unit_volume',
  'discount_percent',
  'inner_packing',
  'image_attachment_ids',
  'product_id',
  'status',
  'source',
  'last_quote_id',
  'last_quote_line_id',
  'notes',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.view'] },
    POST: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
  },
  orm: {
    entity: PurchasingSupplierProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: supplierProductListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      supplier_sku: 'supplier_sku',
      name: 'name',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    // The 关联商品 column is resolved live from `products_products`, so the payload must not be
    // served from the CRUD list cache: a product renamed in the master would otherwise keep
    // showing its old name here until the cache expired.
    disableListCache: true,
    buildFilters: async (query: SupplierProductListQuery, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.ids) {
        const ids = query.ids
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
        filters.id = { $in: ids }
      }
      if (query.supplierId) filters.supplier_id = query.supplierId
      if (query.status !== 'all') filters.status = query.status
      // 建档状态 (Phase 8): the row's **stored** link decides the bucket, so a row whose product was
      // deleted afterwards stays in 已建档 (the list marks it `productDeleted` instead of dropping it
      // out of sight, which is what a live-label filter would do).
      if (query.linked === 'linked') filters.product_id = { $ne: null }
      else if (query.linked === 'unlinked') filters.product_id = null
      if (query.search && query.search.trim().length > 0) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        // Our own names are searchable because they are what the list leads with; the supplier's
        // raw name and the two codes stay searchable so an old spreadsheet column still finds a row.
        // A retired code (`改用规范编码` recorded it as an alias) resolves to its row here, which is
        // the whole point of keeping the mapping: the operator still searches what is on the paper.
        const aliasIds = await findAliasTargetIds(
          ctx.container.resolve('em') as EntityManager,
          // The factory hands the trusted scope to `buildFilters`; nothing here reads the request body.
          { tenantId: ctx.auth?.tenantId ?? '', organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? '' },
          'supplier_product',
          term,
        )
        filters.$or = [
          { supplier_sku: { $ilike: term } },
          { name: { $ilike: term } },
          { name_zh: { $ilike: term } },
          { name_en: { $ilike: term } },
          { item_no: { $ilike: term } },
          ...(aliasIds.length > 0 ? [{ id: { $in: aliasIds } }] : []),
        ]
      }
      return filters
    },
    /**
     * CSV/JSON export columns. The factory takes a static `header` string — there is no per-request
     * locale on this seam — so the export stays in one language (English, like most of its columns)
     * instead of mixing Chinese and English in the same header row.
     */
    export: {
      columns: [
        { field: 'supplierName', header: 'Supplier' },
        { field: 'supplierSku', header: 'Supplier code' },
        { field: 'itemNo', header: 'Item no.' },
        { field: 'name', header: 'Name (supplier)' },
        { field: 'nameZh', header: 'Chinese name' },
        { field: 'nameEn', header: 'English name' },
        { field: 'unit', header: 'Unit' },
        { field: 'moqQuantity', header: 'MOQ' },
        { field: 'cartonQuantity', header: 'Qty/Box' },
        { field: 'hsCode', header: 'HS code' },
        { field: 'declarationElements', header: 'Declaration elements' },
        { field: 'discountPercent', header: 'Discount %' },
        {
          field: 'supplierCostPrice',
          header: 'Supplier cost (net)',
          resolve: (item: Record<string, unknown>) => formatPriceCell(item.supplierCostPrice, 'netUnitPrice'),
        },
        {
          field: 'supplierCostListPrice',
          header: 'Supplier list price',
          resolve: (item: Record<string, unknown>) => formatPriceCell(item.supplierCostPrice),
        },
        {
          field: 'companyOfferPrice',
          header: 'Our offer (internal)',
          resolve: (item: Record<string, unknown>) => formatPriceCell(item.companyOfferPrice),
        },
        { field: 'status' },
        { field: 'updatedAt', header: 'Updated At' },
      ],
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      supplierId: String(item.supplier_id),
      supplierName: asNullableString(item.supplier_name_snapshot),
      supplierSku: String(item.supplier_sku ?? ''),
      itemNo: asNullableString(item.item_no),
      brandValue: asNullableString(item.brand_value),
      name: String(item.name ?? ''),
      nameZh: asNullableString(item.name_zh),
      nameEn: asNullableString(item.name_en),
      description: asNullableString(item.description),
      declarationElements: asNullableString(item.declaration_elements),
      unit: String(item.unit ?? 'PCS'),
      hsCode: asNullableString(item.hs_code),
      imageAttachmentIds: asStringArray(item.image_attachment_ids),
      moqQuantity: asNullableNumber(item.moq_quantity),
      cartonQuantity: asNullableNumber(item.carton_quantity),
      unitNetWeight: asNullableString(item.unit_net_weight),
      unitGrossWeight: asNullableString(item.unit_gross_weight),
      unitVolume: asNullableString(item.unit_volume),
      discountPercent: asNullableString(item.discount_percent),
      innerPacking: asNullableRecord(item.inner_packing),
      productId: asNullableString(item.product_id),
      status: String(item.status ?? 'active'),
      source: String(item.source ?? 'manual'),
      lastQuoteId: asNullableString(item.last_quote_id),
      notes: asNullableString(item.notes),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  hooks: {
    /**
     * Resolves the linked product's label for the whole page in one scoped read.
     *
     * The CRUD factory's `transformItem` is synchronous, so the label cannot be looked up per row;
     * and the browser must never have to join two list responses to render one column.
     */
    afterList: async (res, ctx) => {
      const payload = res as { items?: Array<Record<string, unknown>> } | null
      if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) return
      const em = ctx.container.resolve('em') as EntityManager

      const productIds = Array.from(
        new Set(
          payload.items
            .map((item) => (typeof item.productId === 'string' ? item.productId : null))
            .filter((id): id is string => id !== null),
        ),
      )
      if (productIds.length > 0) {
        const labels = await loadProductLabels(em, { tenantId, organizationId }, productIds)
        for (const item of payload.items) {
          const productId = typeof item.productId === 'string' ? item.productId : null
          const label = productId ? labels[productId] : undefined
          item.productSku = label?.sku ?? null
          item.productName = label?.name ?? null
          // The link can outlive its target: `product_id` is a scalar id with no foreign key, so a
          // linked row that resolves to no live product is flagged instead of rendering as if it
          // were simply unlinked — promote would skip it and sync-fields would refuse it.
          item.productDeleted = productId !== null && label === undefined
        }
      }

      // Price columns: the page's base prices in one scoped query, plus the linked products'
      // 内部结算价 for the 本公司报价 column. The read is deliberately not
      // cached with the list (`disableListCache`), so a price edited in the form shows up here
      // immediately instead of after the cache expires.
      const itemIds = payload.items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => id !== null)
      const prices = await loadBasePricesByItem(em, { tenantId, organizationId }, itemIds)
      const internalPrices = await loadBaseTierPricesByProduct(
        em,
        { tenantId, organizationId },
        productIds,
        'internal',
      )
      for (const item of payload.items) {
        const entry = typeof item.id === 'string' ? prices.get(item.id) : undefined
        const listCost = entry?.supplierCost ?? null
        // 供应商供货价 leads with the 折后价 — the supplier's printed price after this row's discount,
        // which is what we pay and what the promotion writes into the master. The list price stays on
        // the cell so the column can show the arithmetic behind the number.
        item.supplierCostPrice = listCost
          ? {
              ...listCost,
              netUnitPrice: netUnitPrice(
                listCost.unitPrice,
                typeof item.discountPercent === 'string' ? item.discountPercent : null,
              ),
            }
          : null
        // 本公司报价 is no longer entered on the library row (2026-09-24): the column reads the linked
        // product's 内部结算价. A `company_offer` row stored before that change is still shown when the
        // product quotes no such price, so historical data does not vanish from the page.
        const productId = typeof item.productId === 'string' ? item.productId : null
        const internal = productId ? internalPrices[productId] ?? null : null
        const legacyOffer = entry?.companyOffer ?? null
        item.companyOfferPrice = internal ?? legacyOffer
        item.companyOfferSource = internal ? 'product' : legacyOffer ? 'library' : null
      }
    },
  },
  actions: {
    create: {
      commandId: 'purchasing.supplier-products.create',
      schema: supplierProductCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.supplier-products.update',
      schema: supplierProductUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.supplier-products.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Supplier Product',
  pluralName: 'Supplier Products',
  querySchema: supplierProductListSchema,
  listResponseSchema: createPagedListResponseSchema(supplierProductListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: supplierProductCreateSchema,
    responseSchema: purchasingCreatedSchema,
    description:
      'Adds one item to a supplier’s product library in the caller’s organization. The supplier code is unique per supplier including soft-deleted rows, so a duplicate answers 409 `supplier_product_sku_taken`.',
  },
  update: {
    schema: supplierProductUpdateSchema,
    responseSchema: purchasingOkSchema,
    description:
      'Updates a library row; requires the expected version for optimistic locking. The supplier cannot be changed — a code is only unique per supplier.',
  },
  del: {
    responseSchema: purchasingOkSchema,
    description:
      'Soft-deletes a library row. Purchase order lines that reference it keep their frozen snapshot, and the code stays owned until the row is restored.',
  },
})
