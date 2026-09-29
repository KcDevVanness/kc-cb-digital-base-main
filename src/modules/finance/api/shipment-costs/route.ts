import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { FinanceShipmentCost } from '../../data/entities'
import { shipmentCostCreateSchema, shipmentCostListSchema, shipmentCostUpdateSchema } from '../../data/validators'
import { createFinanceCrudOpenApi, financeCreatedSchema, financeOkSchema } from '../openapi'

const ENTITY_ID = 'finance:finance_shipment_cost' as const

const shipmentCostListItemSchema = z
  .object({
    id: z.string().uuid(),
    shipmentId: z.string().uuid(),
    shipmentNumber: z.string().nullable().optional(),
    costType: z.string(),
    allocationBasis: z.string(),
    amount: z.string(),
    currencyCode: z.string(),
    exchangeRate: z.string().nullable().optional(),
    incurredAt: z.string().nullable().optional(),
    partyId: z.string().uuid().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    note: z.string().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type ShipmentCostListQuery = z.infer<typeof shipmentCostListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function toIsoDate(value: unknown): string | null {
  const timestamp = toIsoTimestamp(value)
  return timestamp === null ? null : timestamp.slice(0, 10)
}

// `updated_at` is part of the projection because the optimistic-lock round trip needs it:
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`, and dropping it
// silently disables locking on this entity.
const listFields = [
  'id',
  'shipment_id',
  'shipment_number',
  'cost_type',
  'allocation_basis',
  'amount',
  'currency_code',
  'exchange_rate',
  'incurred_at',
  'party_id',
  'attachment_id',
  'note',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['finance.costs.view'] },
    POST: { requireAuth: true, requireFeatures: ['finance.costs.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['finance.costs.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['finance.costs.manage'] },
  },
  orm: {
    entity: FinanceShipmentCost,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: shipmentCostListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      amount: 'amount',
      cost_type: 'cost_type',
      costType: 'cost_type',
      incurred_at: 'incurred_at',
      incurredAt: 'incurred_at',
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: async (query: ShipmentCostListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.ids) {
        const ids = query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
        filters.id = { $in: ids }
      }
      if (query.shipmentId) filters.shipment_id = query.shipmentId
      if (query.costType) filters.cost_type = query.costType
      if (query.search && query.search.trim().length > 0) {
        // `cost_type`, `shipment_number` and `note` are plaintext columns; the escape keeps a typed
        // `%` literal from widening the filter.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { cost_type: { $ilike: term } },
          { shipment_number: { $ilike: term } },
          { note: { $ilike: term } },
        ]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      shipmentId: String(item.shipment_id ?? ''),
      shipmentNumber: (item.shipment_number ?? null) as string | null,
      costType: String(item.cost_type ?? ''),
      allocationBasis: String(item.allocation_basis ?? 'amount'),
      amount: String(item.amount ?? '0'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      exchangeRate: (item.exchange_rate ?? null) as string | null,
      incurredAt: toIsoDate(item.incurred_at),
      partyId: (item.party_id ?? null) as string | null,
      attachmentId: (item.attachment_id ?? null) as string | null,
      note: (item.note ?? null) as string | null,
      tenant_id: (item.tenant_id ?? null) as string | null,
      organization_id: (item.organization_id ?? null) as string | null,
      createdAt: toIsoTimestamp(item.created_at),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
    export: {
      filename: 'shipment-costs',
      columns: [
        { field: 'shipmentNumber', header: 'Container' },
        { field: 'costType', header: 'Cost type' },
        { field: 'allocationBasis', header: 'Allocation basis' },
        { field: 'amount', header: 'Amount' },
        { field: 'currencyCode', header: 'Currency' },
        { field: 'exchangeRate', header: 'Rate to CNY' },
        { field: 'incurredAt', header: 'Incurred at' },
        { field: 'note', header: 'Note' },
      ],
    },
  },
  actions: {
    create: {
      commandId: 'finance.shipment-costs.create',
      schema: shipmentCostCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'finance.shipment-costs.update',
      schema: shipmentCostUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'finance.shipment-costs.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createFinanceCrudOpenApi({
  resourceName: 'Shipment Cost',
  pluralName: 'Shipment Costs',
  querySchema: shipmentCostListSchema,
  listResponseSchema: createPagedListResponseSchema(shipmentCostListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: shipmentCostCreateSchema,
    responseSchema: financeCreatedSchema,
    description:
      'Records one cost of one container. The cost type must exist in the shipment_cost_type dictionary, the container must be live in the caller’s organization, and the amount must be positive.',
  },
  update: {
    schema: shipmentCostUpdateSchema,
    responseSchema: financeOkSchema,
    description: 'Updates a cost row; a stale `updatedAt` is rejected with 409 instead of overwriting a newer edit.',
  },
  del: {
    responseSchema: financeOkSchema,
    description: 'Soft-deletes a cost row; the landed-cost projection stops including it immediately.',
  },
})
