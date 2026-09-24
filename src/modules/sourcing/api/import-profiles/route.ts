import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { SourcingImportProfile } from '../../data/entities'
import { importProfileListSchema } from '../../data/validators'
import { createSourcingCrudOpenApi, sourcingOkSchema } from '../openapi'

const ENTITY_ID = 'sourcing:sourcing_import_profile' as const

const profileListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    supplierId: z.string().uuid().nullable().optional(),
    layoutSignature: z.string(),
    sheetName: z.string().nullable().optional(),
    headerRowIndex: z.number(),
    columnMap: z.unknown(),
    usageCount: z.number(),
    lastUsedAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type ProfileListQuery = z.infer<typeof importProfileListSchema>

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

const listFields = [
  'id',
  'name',
  'supplier_id',
  'layout_signature',
  'sheet_name',
  'header_row_index',
  'column_map',
  'section_rules',
  'field_options',
  'built_in',
  'usage_count',
  'last_used_at',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
    DELETE: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
  },
  orm: {
    entity: SourcingImportProfile,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: importProfileListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      name: 'name',
      usage_count: 'usage_count',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: ProfileListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.search && query.search.trim().length > 0) filters.name = { $ilike: `%${query.search.trim()}%` }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      supplierId: asNullableString(item.supplier_id),
      layoutSignature: String(item.layout_signature ?? ''),
      sheetName: asNullableString(item.sheet_name),
      headerRowIndex: Number(item.header_row_index ?? 0),
      columnMap: item.column_map ?? {},
      sectionRules: item.section_rules ?? null,
      builtIn: item.built_in === true,
      usageCount: Number(item.usage_count ?? 0),
      lastUsedAt: toIsoTimestamp(item.last_used_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    delete: {
      commandId: 'sourcing.import-profiles.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createSourcingCrudOpenApi({
  resourceName: 'Import Profile',
  pluralName: 'Import Profiles',
  querySchema: importProfileListSchema,
  listResponseSchema: createPagedListResponseSchema(profileListItemSchema, { paginationMetaOptional: true }),
  del: {
    responseSchema: sourcingOkSchema,
    description: 'Deletes a saved column mapping. The next workbook with that layout is mapped by the alias dictionary again.',
  },
})
