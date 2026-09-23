import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { SourcingQuote } from '../../data/entities'
import { quoteCreateSchema, quoteListSchema, quoteUpdateSchema } from '../../data/validators'
import { createSourcingCrudOpenApi, sourcingCreatedSchema, sourcingOkSchema } from '../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote' as const

const quoteListItemSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    supplierNameSnapshot: z.string().nullable().optional(),
    quoteDate: z.string().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    currencyCode: z.string(),
    status: z.string(),
    sourceKind: z.string(),
    sourceFileName: z.string().nullable().optional(),
    sourceSheetName: z.string().nullable().optional(),
    lineCount: z.number(),
    promotedCount: z.number(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type QuoteListQuery = z.infer<typeof quoteListSchema>

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

// `updated_at` is part of the projection because the optimistic-lock round trip needs it:
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`.
const listFields = [
  'id',
  'number',
  'supplier_id',
  'supplier_name_snapshot',
  'quote_date',
  'valid_until',
  'currency_code',
  'status',
  'source_kind',
  'source_attachment_id',
  'source_file_name',
  'source_sheet_name',
  'source_layout_signature',
  'source_profile_id',
  'header_row_index',
  'line_count',
  'promoted_count',
  'notes',
  'approved_at',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
    POST: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
  },
  orm: {
    entity: SourcingQuote,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: quoteListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      number: 'number',
      quote_date: 'quote_date',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: QuoteListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.supplierId) filters.supplier_id = query.supplierId
      if (query.search && query.search.trim().length > 0) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { number: { $ilike: term } },
          { supplier_name_snapshot: { $ilike: term } },
          { source_file_name: { $ilike: term } },
        ]
      }
      return filters
    },
    export: {
      columns: [
        { field: 'number' },
        { field: 'supplierNameSnapshot', header: 'Supplier' },
        { field: 'quoteDate', header: 'Quote date' },
        { field: 'currencyCode', header: 'Currency' },
        { field: 'lineCount', header: 'Lines' },
        { field: 'promotedCount', header: 'Promoted' },
        { field: 'status' },
        { field: 'sourceFileName', header: 'Source file' },
        { field: 'updatedAt', header: 'Updated At' },
      ],
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: asNullableString(item.number),
      supplierId: asNullableString(item.supplier_id),
      supplierNameSnapshot: asNullableString(item.supplier_name_snapshot),
      quoteDate: asNullableString(item.quote_date)?.slice(0, 10) ?? null,
      validUntil: asNullableString(item.valid_until)?.slice(0, 10) ?? null,
      currencyCode: String(item.currency_code ?? 'CNY'),
      status: String(item.status ?? 'draft'),
      sourceKind: String(item.source_kind ?? 'excel_import'),
      sourceAttachmentId: asNullableString(item.source_attachment_id),
      sourceFileName: asNullableString(item.source_file_name),
      sourceSheetName: asNullableString(item.source_sheet_name),
      sourceLayoutSignature: asNullableString(item.source_layout_signature),
      sourceProfileId: asNullableString(item.source_profile_id),
      headerRowIndex: item.header_row_index === null || item.header_row_index === undefined ? null : Number(item.header_row_index),
      lineCount: item.line_count === null || item.line_count === undefined ? 0 : Number(item.line_count),
      promotedCount: item.promoted_count === null || item.promoted_count === undefined ? 0 : Number(item.promoted_count),
      notes: asNullableString(item.notes),
      approvedAt: toIsoTimestamp(item.approved_at),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'sourcing.quotes.create',
      schema: quoteCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'sourcing.quotes.update',
      schema: quoteUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sourcing.quotes.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createSourcingCrudOpenApi({
  resourceName: 'Supplier Quotation',
  pluralName: 'Supplier Quotations',
  querySchema: quoteListSchema,
  listResponseSchema: createPagedListResponseSchema(quoteListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: quoteCreateSchema,
    responseSchema: sourcingCreatedSchema,
    description: 'Creates a draft supplier quotation in the caller’s organization.',
  },
  update: {
    schema: quoteUpdateSchema,
    responseSchema: sourcingOkSchema,
    description: 'Updates a draft quotation header; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: sourcingOkSchema,
    description: 'Soft-deletes a draft or cancelled quotation. Approved quotations are archived instead.',
  },
})
