import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { SourcingSupplierProduct } from '../../data/entities'
import {
  supplierProductCreateSchema,
  supplierProductListSchema,
  supplierProductUpdateSchema,
} from '../../data/validators'
import { loadProductLabels } from '../../lib/productsReads'
import { createSourcingCrudOpenApi, sourcingCreatedSchema, sourcingOkSchema } from '../openapi'

const ENTITY_ID = 'sourcing:sourcing_supplier_product' as const

const supplierProductListItemSchema = z
  .object({
    id: z.string().uuid(),
    supplierId: z.string().uuid(),
    supplierName: z.string().nullable().optional(),
    supplierSku: z.string(),
    itemNo: z.string().nullable().optional(),
    name: z.string(),
    description: z.string().nullable().optional(),
    unit: z.string(),
    hsCode: z.string().nullable().optional(),
    moqQuantity: z.number().nullable().optional(),
    cartonQuantity: z.number().nullable().optional(),
    unitNetWeight: z.string().nullable().optional(),
    cartonGrossWeight: z.string().nullable().optional(),
    cartonNetWeight: z.string().nullable().optional(),
    innerPacking: z.record(z.string(), z.unknown()).nullable().optional(),
    outerPacking: z.record(z.string(), z.unknown()).nullable().optional(),
    productId: z.string().uuid().nullable().optional(),
    productSku: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
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

// `updated_at` is part of the projection because the optimistic-lock round trip needs it:
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`.
const listFields = [
  'id',
  'supplier_id',
  'supplier_name_snapshot',
  'supplier_sku',
  'item_no',
  'name',
  'description',
  'unit',
  'hs_code',
  'moq_quantity',
  'carton_quantity',
  'unit_net_weight',
  'carton_gross_weight',
  'carton_net_weight',
  'inner_packing',
  'outer_packing',
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
    GET: { requireAuth: true, requireFeatures: ['sourcing.supplier-products.view'] },
    POST: { requireAuth: true, requireFeatures: ['sourcing.supplier-products.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sourcing.supplier-products.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sourcing.supplier-products.manage'] },
  },
  orm: {
    entity: SourcingSupplierProduct,
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
    buildFilters: async (query: SupplierProductListQuery) => {
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
      if (query.search && query.search.trim().length > 0) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { supplier_sku: { $ilike: term } },
          { name: { $ilike: term } },
          { item_no: { $ilike: term } },
        ]
      }
      return filters
    },
    export: {
      columns: [
        { field: 'supplierName', header: 'Supplier' },
        { field: 'supplierSku', header: 'Supplier code' },
        { field: 'itemNo', header: 'Item no.' },
        { field: 'name', header: 'Name' },
        { field: 'unit', header: 'Unit' },
        { field: 'moqQuantity', header: 'MOQ' },
        { field: 'cartonQuantity', header: 'Carton qty' },
        { field: 'hsCode', header: 'HS code' },
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
      name: String(item.name ?? ''),
      description: asNullableString(item.description),
      unit: String(item.unit ?? 'PCS'),
      hsCode: asNullableString(item.hs_code),
      moqQuantity: asNullableNumber(item.moq_quantity),
      cartonQuantity: asNullableNumber(item.carton_quantity),
      unitNetWeight: asNullableString(item.unit_net_weight),
      cartonGrossWeight: asNullableString(item.carton_gross_weight),
      cartonNetWeight: asNullableString(item.carton_net_weight),
      innerPacking: asNullableRecord(item.inner_packing),
      outerPacking: asNullableRecord(item.outer_packing),
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
      const productIds = Array.from(
        new Set(
          payload.items
            .map((item) => (typeof item.productId === 'string' ? item.productId : null))
            .filter((id): id is string => id !== null),
        ),
      )
      if (productIds.length === 0) return
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) return
      const labels = await loadProductLabels(
        ctx.container.resolve('em') as EntityManager,
        { tenantId, organizationId },
        productIds,
      )
      for (const item of payload.items) {
        const productId = typeof item.productId === 'string' ? item.productId : null
        const label = productId ? labels[productId] : undefined
        item.productSku = label?.sku ?? null
        item.productName = label?.name ?? null
      }
    },
  },
  actions: {
    create: {
      commandId: 'sourcing.supplier-products.create',
      schema: supplierProductCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'sourcing.supplier-products.update',
      schema: supplierProductUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sourcing.supplier-products.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createSourcingCrudOpenApi({
  resourceName: 'Supplier Product',
  pluralName: 'Supplier Products',
  querySchema: supplierProductListSchema,
  listResponseSchema: createPagedListResponseSchema(supplierProductListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: supplierProductCreateSchema,
    responseSchema: sourcingCreatedSchema,
    description:
      'Adds one item to a supplier’s product library in the caller’s organization. The supplier code is unique per supplier including soft-deleted rows, so a duplicate answers 409 `supplier_product_sku_taken`.',
  },
  update: {
    schema: supplierProductUpdateSchema,
    responseSchema: sourcingOkSchema,
    description:
      'Updates a library row; requires the expected version for optimistic locking. The supplier cannot be changed — a code is only unique per supplier.',
  },
  del: {
    responseSchema: sourcingOkSchema,
    description:
      'Soft-deletes a library row. Purchase order lines that reference it keep their frozen snapshot, and the code stays owned until the row is restored.',
  },
})
