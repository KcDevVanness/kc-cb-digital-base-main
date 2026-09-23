import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { SourcingQuoteLine } from '../../data/entities'
import { quoteLineCreateSchema, quoteLineListSchema, quoteLinesBatchUpdateSchema } from '../../data/validators'
import { createSourcingCrudOpenApi, sourcingCreatedSchema, sourcingOkSchema } from '../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote_line' as const

const quoteLineListItemSchema = z
  .object({
    id: z.string().uuid(),
    quoteId: z.string().uuid(),
    lineNumber: z.number(),
    sourceRowNumber: z.number().nullable().optional(),
    sectionLabel: z.string().nullable().optional(),
    itemNo: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
    variantLabel: z.string().nullable().optional(),
    derivedSku: z.string().nullable().optional(),
    hsCode: z.string().nullable().optional(),
    unit: z.string(),
    unitCost: z.string().nullable().optional(),
    currencyCode: z.string().nullable().optional(),
    suggestedRsp: z.string().nullable().optional(),
    moqRaw: z.string().nullable().optional(),
    moqQuantity: z.number().nullable().optional(),
    cartonQuantity: z.number().nullable().optional(),
    unitNetWeight: z.string().nullable().optional(),
    innerPacking: z.unknown().nullable().optional(),
    raw: z.unknown().nullable().optional(),
    warnings: z.array(z.string()),
    rowStatus: z.string(),
    selected: z.boolean(),
    promotedProductId: z.string().uuid().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type QuoteLineListQuery = z.infer<typeof quoteLineListSchema>

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

const listFields = [
  'id',
  'quote_id',
  'line_number',
  'source_row_number',
  'section_label',
  'item_no',
  'product_name',
  'variant_label',
  'derived_sku',
  'hs_code',
  'description',
  'unit',
  'unit_cost',
  'currency_code',
  'suggested_rsp',
  'moq_raw',
  'moq_quantity',
  'carton_quantity',
  'unit_net_weight',
  'inner_packing',
  'raw',
  'warnings',
  'row_status',
  'selected',
  'promoted_product_id',
  'promoted_price_id',
  'promoted_at',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

/**
 * Quotation lines are rows of the quotation aggregate: they are created, re-mapped and promoted
 * through their own commands, and the review grid saves many of them at once. The `PUT` action
 * therefore takes the batch payload (1..200 rows) rather than a single record — one request
 * saves a whole review, and a single-row edit is simply a batch of one.
 */
export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
    POST: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
  },
  orm: {
    entity: SourcingQuoteLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: quoteLineListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      line_number: 'line_number',
      unit_cost: 'unit_cost',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: QuoteLineListQuery) => {
      const filters: Record<string, unknown> = { quote_id: query.quoteId }
      if (query.rowStatus) filters.row_status = query.rowStatus
      if (query.selected !== undefined) filters.selected = query.selected
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      quoteId: String(item.quote_id),
      lineNumber: Number(item.line_number ?? 0),
      sourceRowNumber: asNullableNumber(item.source_row_number),
      sectionLabel: asNullableString(item.section_label),
      itemNo: asNullableString(item.item_no),
      productName: asNullableString(item.product_name),
      variantLabel: asNullableString(item.variant_label),
      derivedSku: asNullableString(item.derived_sku),
      hsCode: asNullableString(item.hs_code),
      description: asNullableString(item.description),
      unit: String(item.unit ?? 'PCS'),
      unitCost: asNullableString(item.unit_cost),
      currencyCode: asNullableString(item.currency_code),
      suggestedRsp: asNullableString(item.suggested_rsp),
      moqRaw: asNullableString(item.moq_raw),
      moqQuantity: asNullableNumber(item.moq_quantity),
      cartonQuantity: asNullableNumber(item.carton_quantity),
      unitNetWeight: asNullableString(item.unit_net_weight),
      innerPacking: item.inner_packing ?? null,
      raw: item.raw ?? null,
      warnings: Array.isArray(item.warnings) ? item.warnings : [],
      rowStatus: String(item.row_status ?? 'staged'),
      selected: item.selected === true,
      promotedProductId: asNullableString(item.promoted_product_id),
      promotedPriceId: asNullableString(item.promoted_price_id),
      promotedAt: toIsoTimestamp(item.promoted_at),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'sourcing.quote-lines.create',
      schema: quoteLineCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'sourcing.quote-lines.update-batch',
      schema: quoteLinesBatchUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
    delete: {
      commandId: 'sourcing.quote-lines.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createSourcingCrudOpenApi({
  resourceName: 'Quotation Line',
  pluralName: 'Quotation Lines',
  querySchema: quoteLineListSchema,
  listResponseSchema: createPagedListResponseSchema(quoteLineListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: quoteLineCreateSchema,
    responseSchema: sourcingCreatedSchema,
    description: 'Adds one hand-typed line to a draft quotation.',
  },
  update: {
    schema: quoteLinesBatchUpdateSchema,
    responseSchema: sourcingOkSchema,
    description:
      'Saves the review grid in one request (1..200 rows). Every row is version-checked before anything is written; a conflict returns 409 with the row ids to reload.',
  },
  del: {
    responseSchema: sourcingOkSchema,
    description: 'Removes a line from a draft quotation. A promoted line cannot be deleted.',
  },
})
