import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { ProductsProduct } from '../../data/entities'
import {
  productCreateSchema,
  productListSchema,
  productUpdateSchema,
  productStatuses,
} from '../../data/validators'
import { createProductsCrudOpenApi, productsCreatedSchema, productsOkSchema } from '../openapi'

const ENTITY_ID = 'products:products_product' as const

const productListItemSchema = z
  .object({
    id: z.string().uuid(),
    sku: z.string(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    brand: z.string(),
    manufacturerModel: z.string().nullable().optional(),
    typeId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    unit: z.string(),
    status: z.enum(productStatuses),
    containsLithiumBattery: z.boolean(),
    hsCode: z.string().nullable().optional(),
    countryOfOriginCode: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

export { productListSchema }

type ProductListQuery = z.infer<typeof productListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

// `updated_at` is part of the projection because the optimistic-lock round trip needs it:
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`, and dropping
// it silently disables locking on this entity.
const listFields = [
  'id',
  'sku',
  'name',
  'name_en',
  'brand',
  'series',
  'manufacturer_model',
  'type_id',
  'category_id',
  'spec_summary',
  'barcode',
  'unit',
  'hs_code',
  'cn_code',
  'country_of_origin_code',
  'net_weight',
  'gross_weight',
  'dimensions',
  'carton_quantity',
  'battery_capacity_mah',
  'battery_wh',
  'contains_lithium_battery',
  'certifications',
  'status',
  'catalog_product_id',
  'catalog_snapshot',
  'notes',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
    POST: { requireAuth: true, requireFeatures: ['products.items.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['products.items.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['products.items.manage'] },
  },
  orm: {
    entity: ProductsProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: productListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      sku: 'sku',
      name: 'name',
      status: 'status',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: ProductListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      if (query.typeId) filters.type_id = query.typeId
      if (query.categoryId) filters.category_id = query.categoryId
      if (query.status !== 'all') filters.status = query.status
      if (query.containsLithiumBattery !== undefined) {
        filters.contains_lithium_battery = query.containsLithiumBattery
      }
      if (query.search && query.search.trim().length > 0) {
        // Escaped LIKE on plaintext columns; the escape keeps a typed `%` from widening the filter.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { sku: { $ilike: term } },
          { name: { $ilike: term } },
          { manufacturer_model: { $ilike: term } },
        ]
      }
      return filters
    },
    export: {
      columns: [
        { field: 'sku' },
        { field: 'name' },
        { field: 'nameEn', header: 'Name EN' },
        { field: 'brand' },
        { field: 'manufacturerModel', header: 'Model' },
        { field: 'specSummary', header: 'Spec' },
        { field: 'unit' },
        { field: 'barcode' },
        { field: 'hsCode', header: 'HS Code' },
        { field: 'countryOfOriginCode', header: 'Origin' },
        { field: 'status' },
        { field: 'updatedAt', header: 'Updated At' },
      ],
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      sku: String(item.sku ?? ''),
      name: String(item.name ?? ''),
      nameEn: asNullableString(item.name_en),
      brand: String(item.brand ?? ''),
      series: asNullableString(item.series),
      manufacturerModel: asNullableString(item.manufacturer_model),
      typeId: asNullableString(item.type_id),
      categoryId: asNullableString(item.category_id),
      specSummary: asNullableString(item.spec_summary),
      barcode: asNullableString(item.barcode),
      unit: String(item.unit ?? 'PCS'),
      hsCode: asNullableString(item.hs_code),
      cnCode: asNullableString(item.cn_code),
      countryOfOriginCode: asNullableString(item.country_of_origin_code),
      netWeight: asNullableString(item.net_weight),
      grossWeight: asNullableString(item.gross_weight),
      dimensions: item.dimensions ?? null,
      cartonQuantity: item.carton_quantity === null || item.carton_quantity === undefined ? null : Number(item.carton_quantity),
      batteryCapacityMah:
        item.battery_capacity_mah === null || item.battery_capacity_mah === undefined
          ? null
          : Number(item.battery_capacity_mah),
      batteryWh: asNullableString(item.battery_wh),
      containsLithiumBattery: item.contains_lithium_battery === true,
      certifications: Array.isArray(item.certifications) ? item.certifications : null,
      status: String(item.status ?? 'active'),
      catalogProductId: asNullableString(item.catalog_product_id),
      catalogSnapshot: item.catalog_snapshot ?? null,
      notes: asNullableString(item.notes),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'products.items.create',
      schema: productCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'products.items.update',
      schema: productUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'products.items.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createProductsCrudOpenApi({
  resourceName: 'Product',
  pluralName: 'Products',
  querySchema: productListSchema,
  listResponseSchema: createPagedListResponseSchema(productListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: productCreateSchema,
    responseSchema: productsCreatedSchema,
    description: 'Creates a product in the caller’s organization.',
  },
  update: {
    schema: productUpdateSchema,
    responseSchema: productsOkSchema,
    description: 'Updates a product; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: productsOkSchema,
    description: 'Soft-deletes a product. Contracts keep their own snapshots.',
  },
})
