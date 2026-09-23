import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { ProductsType } from '../../data/entities'
import { productTypeCreateSchema, productTypeListSchema, productTypeUpdateSchema } from '../../data/validators'
import { createProductsCrudOpenApi, productsCreatedSchema, productsOkSchema } from '../openapi'

const ENTITY_ID = 'products:products_type' as const

const typeListItemSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    sortOrder: z.number(),
    isActive: z.boolean(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type TypeListQuery = z.infer<typeof productTypeListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
    POST: { requireAuth: true, requireFeatures: ['products.types.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['products.types.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['products.types.manage'] },
  },
  orm: {
    entity: ProductsType,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: productTypeListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'code', 'name', 'name_en', 'sort_order', 'is_active', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: {
      id: 'id',
      code: 'code',
      name: 'name',
      sort_order: 'sort_order',
      sortOrder: 'sort_order',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: TypeListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      if (query.isActive !== undefined) filters.is_active = query.isActive
      if (query.search && query.search.trim().length > 0) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ code: { $ilike: term } }, { name: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      nameEn: (item.name_en ?? null) as string | null,
      sortOrder: Number(item.sort_order ?? 0),
      isActive: item.is_active === true,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'products.types.create',
      schema: productTypeCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'products.types.update',
      schema: productTypeUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'products.types.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createProductsCrudOpenApi({
  resourceName: 'Product Type',
  pluralName: 'Product Types',
  querySchema: productTypeListSchema,
  listResponseSchema: createPagedListResponseSchema(typeListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: productTypeCreateSchema,
    responseSchema: productsCreatedSchema,
    description: 'Creates a product type in the caller’s organization.',
  },
  update: {
    schema: productTypeUpdateSchema,
    responseSchema: productsOkSchema,
    description: 'Updates a product type; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: productsOkSchema,
    description: 'Soft-deletes a product type that no product references.',
  },
})
