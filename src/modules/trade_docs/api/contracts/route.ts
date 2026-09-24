import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsContract } from '../../data/entities'
import {
  CONTRACT_DIRECTIONS,
  CONTRACT_STATUSES,
  contractCreateSchema,
  contractListSchema,
  contractUpdateSchema,
} from '../../data/validators'
import { PRODUCT_PRICE_TIERS } from '../../../products/lib/tiers'
import { readCurrencyScaleInfo } from '../../lib/currencyScale'
import { createTradeDocsCrudOpenApi, tradeDocsCreatedSchema, tradeDocsOkSchema } from '../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_contract' as const

const contractListItemSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable().optional(),
    direction: z.enum(CONTRACT_DIRECTIONS),
    status: z.enum(CONTRACT_STATUSES),
    counterpartyKind: z.string(),
    counterpartyId: z.string().uuid().nullable().optional(),
    counterpartyName: z.string().nullable().optional(),
    priceTier: z.enum(PRODUCT_PRICE_TIERS).nullable().optional(),
    currencyCode: z.string(),
    contractTotal: z.string(),
    financeTotal: z.string(),
    differenceTotal: z.string(),
    currencyScale: z.number().nullable().optional(),
    currencyScaleFallback: z.boolean().optional(),
    signedAt: z.string().nullable().optional(),
    deliveryDate: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type ContractListQuery = z.infer<typeof contractListSchema>

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

/**
 * The counterparty's display name comes from the frozen snapshot, not from the peer module: a
 * rename after signing must not change what the contract list shows for an issued document.
 */
export function counterpartyNameFrom(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const source = snapshot as Record<string, unknown>
  for (const key of ['name', 'title', 'companyName', 'label']) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

export const contractListFields = [
  'id',
  'number',
  'direction',
  'status',
  'counterparty_kind',
  'counterparty_id',
  'counterparty_snapshot',
  'our_party_snapshot',
  'price_tier',
  'currency_code',
  'exchange_rate',
  'source_kind',
  'source_id',
  'contract_total',
  'finance_total',
  'difference_total',
  'signed_at',
  'delivery_date',
  'payment_terms',
  'shipping_method',
  'destination',
  'marks',
  'notes',
  'generated_attachment_id',
  'attachment_id',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.contracts.view'] },
    POST: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
  },
  orm: {
    entity: TradeDocsContract,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: contractListSchema,
    entityId: ENTITY_ID,
    fields: contractListFields,
    sortFieldMap: {
      id: 'id',
      number: 'number',
      status: 'status',
      contract_total: 'contract_total',
      contractTotal: 'contract_total',
      finance_total: 'finance_total',
      financeTotal: 'finance_total',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: ContractListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      if (query.direction) filters.direction = query.direction
      if (query.status) filters.status = query.status
      if (query.counterpartyId) filters.counterparty_id = query.counterpartyId
      if (query.priceTier) filters.price_tier = query.priceTier
      if (query.search && query.search.trim().length > 0) {
        filters.number = { $ilike: `%${escapeLikePattern(query.search.trim())}%` }
      }
      return filters
    },
    export: {
      columns: [
        { field: 'number' },
        { field: 'direction' },
        { field: 'status' },
        { field: 'counterpartyName', header: 'Counterparty' },
        { field: 'currencyCode', header: 'Currency' },
        // The three calibers the business asked for, in the order an operator reads them.
        { field: 'contractTotal', header: 'Contract Amount' },
        { field: 'financeTotal', header: 'Finance Amount' },
        { field: 'differenceTotal', header: 'Difference' },
        { field: 'priceTier', header: 'Price Tier' },
        { field: 'signedAt', header: 'Signed At' },
        { field: 'updatedAt', header: 'Updated At' },
      ],
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: asNullableString(item.number),
      direction: String(item.direction ?? 'purchase'),
      status: String(item.status ?? 'draft'),
      counterpartyKind: String(item.counterparty_kind ?? 'supplier'),
      counterpartyId: asNullableString(item.counterparty_id),
      counterpartyName: counterpartyNameFrom(item.counterparty_snapshot),
      // Both snapshots travel with the head payload: the detail page prints the party blocks from
      // them, and a rename of the master record must not change a signed contract's copy.
      counterpartySnapshot: item.counterparty_snapshot ?? null,
      ourPartySnapshot: item.our_party_snapshot ?? null,
      priceTier: asNullableString(item.price_tier),
      currencyCode: String(item.currency_code ?? 'CNY'),
      exchangeRate: asNullableString(item.exchange_rate),
      sourceKind: asNullableString(item.source_kind),
      sourceId: asNullableString(item.source_id),
      contractTotal: String(item.contract_total ?? '0'),
      financeTotal: String(item.finance_total ?? '0'),
      differenceTotal: String(item.difference_total ?? '0'),
      signedAt: toDateOnly(item.signed_at),
      deliveryDate: toDateOnly(item.delivery_date),
      paymentTerms: asNullableString(item.payment_terms),
      shippingMethod: asNullableString(item.shipping_method),
      destination: asNullableString(item.destination),
      marks: asNullableString(item.marks),
      notes: asNullableString(item.notes),
      generatedAttachmentId: asNullableString(item.generated_attachment_id),
      attachmentId: asNullableString(item.attachment_id),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  hooks: {
    /**
     * Publishes the rounding scale the head totals were computed with.
     *
     * The stored totals do not say whether the currency's own `decimal_places` was used or the
     * two-decimal fallback, and finance must be able to see that difference: a scope whose
     * `currencies` rows were never seeded rounds every financial amount to two decimals.
     */
    async afterList(payload, ctx) {
      const items = Array.isArray(payload?.items) ? (payload.items as Array<Record<string, unknown>>) : []
      const codes = Array.from(
        new Set(
          items
            .map((item) => (typeof item.currencyCode === 'string' ? item.currencyCode : ''))
            .filter((code) => code.length > 0),
        ),
      )
      if (codes.length === 0) return

      const em = ctx.container.resolve<EntityManager>('em')
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) {
        for (const item of items) {
          item.currencyScale = null
          item.currencyScaleFallback = false
        }
        return
      }

      const scope = { tenantId, organizationId }
      const byCode = new Map<string, { scale: number; configured: boolean }>()
      for (const code of codes) {
        byCode.set(code.toUpperCase(), await readCurrencyScaleInfo(em, scope, code))
      }
      for (const item of items) {
        const code = typeof item.currencyCode === 'string' ? item.currencyCode.toUpperCase() : ''
        const info = byCode.get(code)
        item.currencyScale = info?.scale ?? null
        item.currencyScaleFallback = info ? !info.configured : false
      }
    },
  },
  actions: {
    create: {
      commandId: 'trade_docs.contracts.create',
      schema: contractCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'trade_docs.contracts.update',
      schema: contractUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'trade_docs.contracts.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Contract',
  pluralName: 'Contracts',
  querySchema: contractListSchema,
  listResponseSchema: createPagedListResponseSchema(contractListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: contractCreateSchema,
    responseSchema: tradeDocsCreatedSchema,
    description: 'Creates a draft purchase/sales contract with its lines in the caller’s organization.',
  },
  update: {
    schema: contractUpdateSchema,
    responseSchema: tradeDocsOkSchema,
    description: 'Updates a draft contract (and replaces its lines when provided); requires the expected version.',
  },
  del: {
    responseSchema: tradeDocsOkSchema,
    description: 'Soft-deletes a draft or cancelled contract.',
  },
})
