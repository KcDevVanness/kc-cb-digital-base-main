import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PlatformOpsChannel } from '../../data/entities'
import { channelCreateSchema, channelListSchema, channelUpdateSchema } from '../../data/validators'
import { createPlatformOpsCrudOpenApi, platformOpsCreatedSchema, platformOpsOkSchema } from '../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_channel' as const

const channelListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    platform: z.string(),
    externalAccountId: z.string().nullable().optional(),
    currencyCode: z.string(),
    isActive: z.boolean(),
    notes: z.string().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type ChannelListQuery = z.infer<typeof channelListSchema>

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
  'platform',
  'external_account_id',
  'currency_code',
  'is_active',
  'notes',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['platform_ops.channels.view'] },
    POST: { requireAuth: true, requireFeatures: ['platform_ops.channels.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['platform_ops.channels.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['platform_ops.channels.manage'] },
  },
  orm: {
    entity: PlatformOpsChannel,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: channelListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      name: 'name',
      code: 'code',
      platform: 'platform',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: ChannelListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.platform) filters.platform = query.platform
      if (query.isActive !== undefined) filters.is_active = query.isActive
      if (query.search && query.search.trim().length > 0) {
        // `name`/`code` are plaintext columns; the escape keeps a typed `%` literal
        // from widening the filter.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ name: { $ilike: term } }, { code: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      code: String(item.code ?? ''),
      platform: String(item.platform ?? ''),
      externalAccountId: (item.external_account_id ?? null) as string | null,
      currencyCode: String(item.currency_code ?? 'USD'),
      isActive: item.is_active === true,
      notes: (item.notes ?? null) as string | null,
      tenant_id: (item.tenant_id ?? null) as string | null,
      organization_id: (item.organization_id ?? null) as string | null,
      createdAt: toIsoTimestamp(item.created_at),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'platform_ops.channels.create',
      schema: channelCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'platform_ops.channels.update',
      schema: channelUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'platform_ops.channels.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createPlatformOpsCrudOpenApi({
  resourceName: 'Channel',
  pluralName: 'Channels',
  querySchema: channelListSchema,
  listResponseSchema: createPagedListResponseSchema(channelListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: channelCreateSchema,
    responseSchema: platformOpsCreatedSchema,
    description: 'Creates a storefront binding in the caller’s organization; the code is unique per organization.',
  },
  update: {
    schema: channelUpdateSchema,
    responseSchema: platformOpsOkSchema,
    description: 'Updates a storefront binding; renaming the code to one already in use is rejected with 409.',
  },
  del: {
    responseSchema: platformOpsOkSchema,
    description: 'Soft-deletes a storefront binding; its orders, settlements and reconciliation items stay in the database.',
  },
})
