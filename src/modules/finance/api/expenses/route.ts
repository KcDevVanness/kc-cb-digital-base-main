import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { FinanceExpense } from '../../data/entities'
import { expenseCreateSchema, expenseListSchema, expenseUpdateSchema } from '../../data/validators'
import { createFinanceCrudOpenApi, financeCreatedSchema, financeOkSchema } from '../openapi'

const ENTITY_ID = 'finance:finance_expense' as const

const expenseListItemSchema = z
  .object({
    id: z.string().uuid(),
    expenseType: z.string(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    amount: z.string(),
    currencyCode: z.string(),
    exchangeRate: z.string().nullable().optional(),
    channelId: z.string().uuid().nullable().optional(),
    partyId: z.string().uuid().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    note: z.string().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type ExpenseListQuery = z.infer<typeof expenseListSchema>

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
// `CrudForm` derives the expected-version header from `initialValues.updatedAt`.
const listFields = [
  'id',
  'expense_type',
  'period_start',
  'period_end',
  'amount',
  'currency_code',
  'exchange_rate',
  'channel_id',
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
    GET: { requireAuth: true, requireFeatures: ['finance.expenses.view'] },
    POST: { requireAuth: true, requireFeatures: ['finance.expenses.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['finance.expenses.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['finance.expenses.manage'] },
  },
  orm: {
    entity: FinanceExpense,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: expenseListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      amount: 'amount',
      expense_type: 'expense_type',
      expenseType: 'expense_type',
      period_start: 'period_start',
      periodStart: 'period_start',
      period_end: 'period_end',
      periodEnd: 'period_end',
      created_at: 'created_at',
      createdAt: 'created_at',
    },
    defaultSort: { field: 'period_start', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: async (query: ExpenseListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.ids) {
        const ids = query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
        filters.id = { $in: ids }
      }
      if (query.expenseType) filters.expense_type = query.expenseType
      if (query.channelId) filters.channel_id = query.channelId
      // A period filter selects the expenses that overlap the requested window.
      if (query.periodStart) filters.period_end = { $gte: query.periodStart }
      if (query.periodEnd) filters.period_start = { $lte: query.periodEnd }
      if (query.search && query.search.trim().length > 0) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ expense_type: { $ilike: term } }, { note: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      expenseType: String(item.expense_type ?? ''),
      periodStart: toIsoDate(item.period_start),
      periodEnd: toIsoDate(item.period_end),
      amount: String(item.amount ?? '0'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      exchangeRate: (item.exchange_rate ?? null) as string | null,
      channelId: (item.channel_id ?? null) as string | null,
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
      filename: 'period-expenses',
      columns: [
        { field: 'expenseType', header: 'Expense type' },
        { field: 'periodStart', header: 'Period start' },
        { field: 'periodEnd', header: 'Period end' },
        { field: 'amount', header: 'Amount' },
        { field: 'currencyCode', header: 'Currency' },
        { field: 'exchangeRate', header: 'Rate to CNY' },
        { field: 'note', header: 'Note' },
      ],
    },
  },
  actions: {
    create: {
      commandId: 'finance.expenses.create',
      schema: expenseCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'finance.expenses.update',
      schema: expenseUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'finance.expenses.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createFinanceCrudOpenApi({
  resourceName: 'Period Expense',
  pluralName: 'Period Expenses',
  querySchema: expenseListSchema,
  listResponseSchema: createPagedListResponseSchema(expenseListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: expenseCreateSchema,
    responseSchema: financeCreatedSchema,
    description:
      'Records one expense of one reporting period. The type must exist in the finance_expense_type dictionary, the amount must be positive, and the period must not be inverted.',
  },
  update: {
    schema: expenseUpdateSchema,
    responseSchema: financeOkSchema,
    description: 'Updates a period expense; a stale `updatedAt` is rejected with 409.',
  },
  del: {
    responseSchema: financeOkSchema,
    description: 'Soft-deletes a period expense; the profit-and-loss ledger stops including it immediately.',
  },
})
