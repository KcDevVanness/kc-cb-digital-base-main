import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsInvoice } from '../../data/entities'
import {
  INVOICE_DIRECTIONS,
  INVOICE_STATUSES,
  invoiceCreateSchema,
  invoiceListSchema,
  invoiceUpdateSchema,
} from '../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsCreatedSchema, tradeDocsOkSchema } from '../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_invoice' as const

const invoiceListItemSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable().optional(),
    direction: z.enum(INVOICE_DIRECTIONS),
    status: z.enum(INVOICE_STATUSES),
    counterpartyKind: z.string(),
    counterpartyId: z.string().uuid().nullable().optional(),
    counterpartyName: z.string().nullable().optional(),
    contractId: z.string().uuid().nullable().optional(),
    contractNumber: z.string().nullable().optional(),
    currencyCode: z.string(),
    subtotal: z.string(),
    total: z.string(),
    issuedAt: z.string().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type InvoiceListQuery = z.infer<typeof invoiceListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function toDateOnly(value: unknown): string | null {
  const iso = toIsoTimestamp(value)
  return iso ? iso.slice(0, 10) : null
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

function referenceId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return String(value)
}

function referenceNumber(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const number = (value as { number?: unknown }).number
  return typeof number === 'string' && number.length > 0 ? number : null
}

function counterpartyNameFrom(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const source = snapshot as Record<string, unknown>
  for (const key of ['name', 'title', 'companyName', 'label']) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

// `updated_at` is part of the projection because the attach/confirm round trips need it:
// the client sends the version it rendered, and a stale one must fail with 409.
const listFields = [
  'id',
  'number',
  'direction',
  'status',
  'counterparty_kind',
  'counterparty_id',
  'counterparty_snapshot',
  'contract_id',
  'contract',
  'source_kind',
  'source_id',
  'currency_code',
  'subtotal',
  'total',
  'issued_at',
  'attachment_id',
  'notes',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.invoices.view'] },
    POST: { requireAuth: true, requireFeatures: ['trade_docs.invoices.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.invoices.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['trade_docs.invoices.manage'] },
  },
  orm: {
    entity: TradeDocsInvoice,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: invoiceListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      number: 'number',
      status: 'status',
      total: 'total',
      issued_at: 'issued_at',
      issuedAt: 'issued_at',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: InvoiceListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      if (query.direction) filters.direction = query.direction
      if (query.status) filters.status = query.status
      if (query.contractId) filters.contract_id = query.contractId
      if (query.counterpartyId) filters.counterparty_id = query.counterpartyId
      if (query.search && query.search.trim().length > 0) {
        filters.number = { $ilike: `%${escapeLikePattern(query.search.trim())}%` }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: asNullableString(item.number),
      direction: String(item.direction ?? 'inbound'),
      status: String(item.status ?? 'draft'),
      counterpartyKind: String(item.counterparty_kind ?? 'supplier'),
      counterpartyId: asNullableString(item.counterparty_id),
      counterpartyName: counterpartyNameFrom(item.counterparty_snapshot),
      contractId: referenceId(item.contract_id ?? item.contract),
      contractNumber: referenceNumber(item.contract),
      currencyCode: String(item.currency_code ?? 'CNY'),
      subtotal: String(item.subtotal ?? '0'),
      total: String(item.total ?? '0'),
      issuedAt: toDateOnly(item.issued_at),
      attachmentId: asNullableString(item.attachment_id),
      notes: asNullableString(item.notes),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  hooks: {
    /**
     * Fills in the bound contract's number for the page that was returned.
     *
     * The list projection carries `contract_id` only (a scalar reference, the module's durable
     * pattern), so one extra scoped query names the contract the operator is about to open rather
     * than making the grid show a UUID prefix.
     */
    async afterList(payload, ctx) {
      const items = Array.isArray(payload?.items) ? (payload.items as Array<Record<string, unknown>>) : []
      const contractIds = Array.from(
        new Set(items.map((item) => item.contractId).filter((id): id is string => typeof id === 'string' && id.length > 0)),
      )
      if (contractIds.length === 0) return

      const em = ctx.container.resolve<EntityManager>('em')
      const tenantId = ctx.auth?.tenantId ?? null
      const numbers = new Map<string, string | null>()
      const rows = (await (em.fork().getKysely<any>())
        .selectFrom('trade_docs_contracts')
        .select(['id', 'number'])
        .where('id', 'in', contractIds)
        .where('deleted_at', 'is', null)
        .$if(!!tenantId, (qb) => qb.where('tenant_id', '=', tenantId as string))
        .execute()) as Array<{ id: string; number: string | null }>
      for (const row of rows) numbers.set(String(row.id), row.number ?? null)

      for (const item of items) {
        const contractId = typeof item.contractId === 'string' ? item.contractId : null
        if (contractId) item.contractNumber = numbers.get(contractId) ?? null
      }
    },
  },
  actions: {
    create: {
      commandId: 'trade_docs.invoices.create',
      schema: invoiceCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'trade_docs.invoices.update',
      schema: invoiceUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'trade_docs.invoices.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Invoice',
  pluralName: 'Invoices',
  querySchema: invoiceListSchema,
  listResponseSchema: createPagedListResponseSchema(invoiceListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: invoiceCreateSchema,
    responseSchema: tradeDocsCreatedSchema,
    description: 'Creates a draft invoice (optionally bound to a contract) with its lines.',
  },
  update: {
    schema: invoiceUpdateSchema,
    responseSchema: tradeDocsOkSchema,
    description: 'Updates a draft invoice and replaces its lines when provided; requires the expected version.',
  },
  del: {
    responseSchema: tradeDocsOkSchema,
    description: 'Soft-deletes a draft or void invoice and releases its influence on the contract head.',
  },
})
