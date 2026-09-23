import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingSupplier } from '../../data/entities'
import { supplierCreateSchema, supplierListSchema, supplierUpdateSchema } from '../../data/validators'
import { supplierCrudEvents, supplierCrudIndexer } from '../../commands/suppliers'
import { createPurchasingCrudOpenApi, purchasingCreatedSchema, purchasingOkSchema } from '../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier' as const

const supplierListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    contactName: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    defaultCurrencyCode: z.string(),
    isActive: z.boolean(),
    notes: z.string().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type SupplierListQuery = z.infer<typeof supplierListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

// `updated_at` is part of the projection because the optimistic-lock round trip needs
// it: `CrudForm` derives the expected-version header from `initialValues.updatedAt`,
// and dropping it silently disables locking on this entity.
const listFields = [
  'id',
  'name',
  'code',
  'contact_name',
  'phone',
  'email',
  'address',
  'default_currency_code',
  'is_active',
  'notes',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.suppliers.view'] },
    POST: { requireAuth: true, requireFeatures: ['purchasing.suppliers.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['purchasing.suppliers.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['purchasing.suppliers.manage'] },
  },
  orm: {
    entity: PurchasingSupplier,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: supplierListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      name: 'name',
      code: 'code',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: SupplierListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.isActive !== undefined) filters.is_active = query.isActive
      if (query.search && query.search.trim().length > 0) {
        // `name`/`code` are plaintext columns, so an escaped LIKE is safe here; the
        // escape keeps a user-typed `%` from widening the filter.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ name: { $ilike: term } }, { code: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      code: String(item.code ?? ''),
      contactName: (item.contact_name ?? null) as string | null,
      phone: (item.phone ?? null) as string | null,
      email: (item.email ?? null) as string | null,
      address: (item.address ?? null) as string | null,
      defaultCurrencyCode: String(item.default_currency_code ?? 'CNY'),
      isActive: item.is_active === true,
      notes: (item.notes ?? null) as string | null,
      tenant_id: (item.tenant_id ?? null) as string | null,
      organization_id: (item.organization_id ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'purchasing.suppliers.create',
      schema: supplierCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.suppliers.update',
      schema: supplierUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.suppliers.delete',
      response: () => ({ ok: true }),
    },
  },
})

export { supplierCrudEvents, supplierCrudIndexer }

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Supplier',
  pluralName: 'Suppliers',
  querySchema: supplierListSchema,
  listResponseSchema: createPagedListResponseSchema(supplierListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: supplierCreateSchema,
    responseSchema: purchasingCreatedSchema,
    description: 'Creates a supplier in the caller’s organization.',
  },
  update: {
    schema: supplierUpdateSchema,
    responseSchema: purchasingOkSchema,
    description: 'Updates a supplier; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: purchasingOkSchema,
    description: 'Soft-deletes a supplier.',
  },
})
