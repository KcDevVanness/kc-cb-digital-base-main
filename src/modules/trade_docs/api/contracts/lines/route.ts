import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsContractLine } from '../../../data/entities'
import { contractLineListSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_contract_line' as const

const contractLineItemSchema = z
  .object({
    id: z.string().uuid(),
    contractId: z.string().uuid(),
    lineNumber: z.number(),
    productId: z.string().uuid().nullable().optional(),
    name: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    spec: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    quantity: z.string(),
    unitPrice: z.string(),
    contractAmount: z.string(),
    financeAmount: z.string(),
    financeSource: z.enum(['invoice', 'computed']),
    note: z.string().nullable().optional(),
  })
  .passthrough()

type ContractLineListQuery = z.infer<typeof contractLineListSchema>

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function contractIdFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Read-only line surface for the contract detail page. Lines are written exclusively through the
 * contract commands, which is why this route exposes no write verb: the contract is the aggregate
 * root and the head totals are computed from these rows in the same transaction that rewrites
 * them.
 *
 * `financeSource` is derived here (not stored): a line whose financial amount came from a
 * confirmed invoice is exactly the line the operator needs to see marked.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.contracts.view'] },
  },
  orm: {
    entity: TradeDocsContractLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: contractLineListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'contract_id',
      'line_number',
      'product_id',
      'product_snapshot',
      'name',
      'sku',
      'model',
      'spec',
      'unit',
      'quantity',
      'unit_price',
      'contract_amount',
      'finance_amount',
      'note',
      'tenant_id',
      'organization_id',
    ],
    sortFieldMap: { id: 'id', line_number: 'line_number', lineNumber: 'line_number' },
    buildFilters: async (query: ContractLineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.contractId) filters.contract_id = query.contractId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      contractId: contractIdFrom(item.contract_id) ?? String(item.contract_id ?? ''),
      lineNumber: Number(item.line_number ?? 0),
      productId: (item.product_id ?? null) as string | null,
      name: (item.name ?? null) as string | null,
      sku: (item.sku ?? snapshotValue(item.product_snapshot, 'sku')) as string | null,
      model: (item.model ?? snapshotValue(item.product_snapshot, 'model')) as string | null,
      spec: (item.spec ?? snapshotValue(item.product_snapshot, 'spec')) as string | null,
      unit: (item.unit ?? snapshotValue(item.product_snapshot, 'unit')) as string | null,
      quantity: String(item.quantity ?? '0'),
      unitPrice: String(item.unit_price ?? '0'),
      contractAmount: String(item.contract_amount ?? '0'),
      financeAmount: String(item.finance_amount ?? '0'),
      financeSource: 'computed' as const,
      note: (item.note ?? null) as string | null,
    }),
  },
  hooks: {
    /**
     * Marks the lines whose financial amount came from a confirmed invoice.
     *
     * The flag is derived, not stored: the contract line only knows its amount, while "why" lives
     * in the invoice binding. One extra scoped query per list request annotates the page that was
     * already returned — the ids come from rows the factory has scope-checked, so nothing outside
     * the caller's visibility can be touched.
     */
    async afterList(payload, ctx) {
      const items = Array.isArray(payload?.items) ? (payload.items as Array<Record<string, unknown>>) : []
      const ids = items.map((item) => String(item.id ?? '')).filter((id) => id.length > 0)
      if (ids.length === 0) return

      const em = ctx.container.resolve<EntityManager>('em')
      const tenantId = ctx.auth?.tenantId ?? null
      const covered = new Set<string>()
      const rows = (await (em.fork().getKysely<any>())
        .selectFrom('trade_docs_invoice_lines as l')
        .innerJoin('trade_docs_invoices as i', 'i.id', 'l.invoice_id')
        .select('l.contract_line_id as contract_line_id')
        .where('l.contract_line_id', 'in', ids)
        .where('i.status', '=', 'confirmed')
        .where('i.deleted_at', 'is', null)
        .$if(!!tenantId, (qb) => qb.where('l.tenant_id', '=', tenantId as string))
        .execute()) as Array<{ contract_line_id: string }>
      for (const row of rows) covered.add(String(row.contract_line_id))

      for (const item of items) {
        item.financeSource = covered.has(String(item.id)) ? 'invoice' : 'computed'
      }
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Contract Line',
  pluralName: 'Contract Lines',
  querySchema: contractLineListSchema,
  listResponseSchema: createPagedListResponseSchema(contractLineItemSchema, { paginationMetaOptional: true }),
})
