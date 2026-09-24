import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { Party } from '../data/entities'
import { partyCreateSchema, partyListSchema, partyUpdateSchema } from '../data/validators'
import { partyCrudEvents, partyCrudIndexer } from '../commands/parties'
import { createPartiesCrudOpenApi, partiesCreatedSchema, partiesOkSchema } from './openapi'

const ENTITY_ID = 'parties:party' as const

const partyListItemSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    countryCode: z.string().nullable().optional(),
    status: z.string(),
    contactName: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    addressLine1: z.string().nullable().optional(),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type PartyListQuery = z.infer<typeof partyListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

// `updated_at` is part of the projection because the optimistic-lock round trip needs it:
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`, and dropping it
// silently disables locking on this entity.
//
// The encrypted columns (`name`, contact, address, city) are listed because the query engine
// decrypts what it projects; only `code`, `country_code` and `status` may be filtered or sorted.
const listFields = [
  'id',
  'code',
  'name',
  'country_code',
  'status',
  'contact_name',
  'contact_phone',
  'email',
  'address_line1',
  'address_line2',
  'city',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['parties.view'] },
    POST: { requireAuth: true, requireFeatures: ['parties.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['parties.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['parties.manage'] },
  },
  orm: {
    entity: Party,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: partyListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      code: 'code',
      country_code: 'country_code',
      countryCode: 'country_code',
      status: 'status',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: PartyListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.countryCode && query.countryCode.trim().length === 2) {
        filters.country_code = query.countryCode.trim().toUpperCase()
      }
      if (query.search && query.search.trim().length > 0) {
        // `code` is the only plaintext identifying column, so it is the whole search surface: a
        // LIKE against an encrypted column compares a plaintext pattern with ciphertext and
        // matches nothing. Name search is recorded as Q-P-008 in the module spec.
        filters.code = { $ilike: `%${escapeLikePattern(query.search.trim())}%` }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      countryCode: (item.country_code ?? null) as string | null,
      status: String(item.status ?? 'active'),
      contactName: (item.contact_name ?? null) as string | null,
      contactPhone: (item.contact_phone ?? null) as string | null,
      email: (item.email ?? null) as string | null,
      addressLine1: (item.address_line1 ?? null) as string | null,
      addressLine2: (item.address_line2 ?? null) as string | null,
      city: (item.city ?? null) as string | null,
      tenant_id: (item.tenant_id ?? null) as string | null,
      organization_id: (item.organization_id ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'parties.parties.create',
      schema: partyCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'parties.parties.update',
      schema: partyUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'parties.parties.delete',
      response: () => ({ ok: true }),
    },
  },
})

export { partyCrudEvents, partyCrudIndexer }

export const openApi = createPartiesCrudOpenApi({
  resourceName: 'Party',
  pluralName: 'Parties',
  querySchema: partyListSchema,
  listResponseSchema: createPagedListResponseSchema(partyListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: partyCreateSchema,
    responseSchema: partiesCreatedSchema,
    description: 'Creates a party (with its roles and bank block) in the caller’s organization.',
  },
  update: {
    schema: partyUpdateSchema,
    responseSchema: partiesOkSchema,
    description: 'Updates a party; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: partiesOkSchema,
    description: 'Soft-deletes a party.',
  },
})
