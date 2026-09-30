import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { OurPartyProfile } from '../../data/entities'
import {
  ourPartyProfileCreateSchema,
  ourPartyProfileListSchema,
  ourPartyProfileUpdateSchema,
} from '../../data/validators'
import { ourPartyCrudEvents, ourPartyCrudIndexer } from '../../commands/profiles'
import { createOurPartiesCrudOpenApi, ourPartiesCreatedSchema, ourPartiesOkSchema } from '../openapi'

const ENTITY_ID = 'our_parties:our_party_profile' as const

const profileListItemSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    addressLine1: z.string().nullable().optional(),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
    contactName: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type OurPartyListQuery = z.infer<typeof ourPartyProfileListSchema>

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
const listFields = [
  'id',
  'organization_id',
  'address_line1',
  'address_line2',
  'city',
  'country_code',
  'contact_name',
  'contact_phone',
  'email',
  'notes',
  'tenant_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['our_parties.view'] },
    POST: { requireAuth: true, requireFeatures: ['our_parties.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['our_parties.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['our_parties.manage'] },
  },
  orm: {
    entity: OurPartyProfile,
    idField: 'id',
    tenantField: 'tenantId',
    // The row's organization IS the company the profile describes, so the framework's scope filter
    // needs no extra predicate: a caller only ever sees profiles of companies it may read.
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: ourPartyProfileListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      organization_id: 'organization_id',
      organizationId: 'organization_id',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: OurPartyListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      organizationId: String(item.organization_id ?? ''),
      addressLine1: (item.address_line1 ?? null) as string | null,
      addressLine2: (item.address_line2 ?? null) as string | null,
      city: (item.city ?? null) as string | null,
      countryCode: (item.country_code ?? null) as string | null,
      contactName: (item.contact_name ?? null) as string | null,
      contactPhone: (item.contact_phone ?? null) as string | null,
      email: (item.email ?? null) as string | null,
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
      commandId: 'our_parties.profiles.create',
      schema: ourPartyProfileCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'our_parties.profiles.update',
      schema: ourPartyProfileUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'our_parties.profiles.delete',
      response: () => ({ ok: true }),
    },
  },
})

export { ourPartyCrudEvents, ourPartyCrudIndexer }

export const openApi = createOurPartiesCrudOpenApi({
  resourceName: 'OurEntityProfile',
  pluralName: 'OurEntities',
  querySchema: ourPartyProfileListSchema,
  listResponseSchema: createPagedListResponseSchema(profileListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: ourPartyProfileCreateSchema,
    responseSchema: ourPartiesCreatedSchema,
    description:
      'Creates the print profile of one of our companies (its organization id is the key); the caller must be allowed to address that organization.',
  },
  update: {
    schema: ourPartyProfileUpdateSchema,
    responseSchema: ourPartiesOkSchema,
    description: 'Updates a profile (and replaces its bank block when provided); requires the expected version.',
  },
  del: {
    responseSchema: ourPartiesOkSchema,
    description: 'Soft-deletes a profile.',
  },
})
