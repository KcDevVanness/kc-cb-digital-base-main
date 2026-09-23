import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { ProductsCategory } from '../../data/entities'
import {
  productCategoryCreateSchema,
  productCategoryListSchema,
  productCategoryUpdateSchema,
} from '../../data/validators'
import { createProductsCrudOpenApi, productsCreatedSchema, productsOkSchema } from '../openapi'

const ENTITY_ID = 'products:products_category' as const

const categoryListItemSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    rootId: z.string().uuid().nullable().optional(),
    treePath: z.string().nullable().optional(),
    depth: z.number(),
    ancestorIds: z.array(z.string()),
    childIds: z.array(z.string()),
    descendantIds: z.array(z.string()),
    sortOrder: z.number(),
    isActive: z.boolean(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type CategoryListQuery = z.infer<typeof productCategoryListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : []
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
    POST: { requireAuth: true, requireFeatures: ['products.categories.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['products.categories.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['products.categories.manage'] },
  },
  orm: {
    entity: ProductsCategory,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: productCategoryListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'code',
      'name',
      'name_en',
      'parent_id',
      'root_id',
      'tree_path',
      'depth',
      'ancestor_ids',
      'child_ids',
      'descendant_ids',
      'sort_order',
      'is_active',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      code: 'code',
      name: 'name',
      tree_path: 'tree_path',
      treePath: 'tree_path',
      sort_order: 'sort_order',
      sortOrder: 'sort_order',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: CategoryListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      if (query.parentId) filters.parent_id = query.parentId
      if (query.rootId) filters.root_id = query.rootId
      if (query.isActive !== undefined) filters.is_active = query.isActive
      if (query.search && query.search.trim().length > 0) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ code: { $ilike: term } }, { name: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => {
      return {
        id: String(item.id),
        code: String(item.code ?? ''),
        name: String(item.name ?? ''),
        nameEn: (item.name_en ?? null) as string | null,
        parentId: (item.parent_id ?? null) as string | null,
        rootId: (item.root_id ?? null) as string | null,
        treePath: (item.tree_path ?? null) as string | null,
        depth: Number(item.depth ?? 0),
        // The display path is assembled client-side from these ids plus the sibling rows:
        // the label is a join over the list the page already holds, so the API keeps sending
        // ids only and never a second copy of every ancestor's name.
        ancestorIds: toStringArray(item.ancestor_ids),
        childIds: toStringArray(item.child_ids),
        descendantIds: toStringArray(item.descendant_ids),
        sortOrder: Number(item.sort_order ?? 0),
        isActive: item.is_active === true,
        created_at: toIsoTimestamp(item.created_at),
        updated_at: toIsoTimestamp(item.updated_at),
        updatedAt: toIsoTimestamp(item.updated_at),
      }
    },
  },
  actions: {
    create: {
      commandId: 'products.categories.create',
      schema: productCategoryCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'products.categories.update',
      schema: productCategoryUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'products.categories.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createProductsCrudOpenApi({
  resourceName: 'Product Category',
  pluralName: 'Product Categories',
  querySchema: productCategoryListSchema,
  listResponseSchema: createPagedListResponseSchema(categoryListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: productCategoryCreateSchema,
    responseSchema: productsCreatedSchema,
    description: 'Creates a category and rebuilds the organization’s category hierarchy.',
  },
  update: {
    schema: productCategoryUpdateSchema,
    responseSchema: productsOkSchema,
    description: 'Updates a category; a move under itself or a descendant is rejected with 422.',
  },
  del: {
    responseSchema: productsOkSchema,
    description: 'Soft-deletes an empty, unreferenced category and rebuilds the hierarchy.',
  },
})
