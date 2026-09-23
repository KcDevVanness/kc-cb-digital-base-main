import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsInvoiceLine } from '../../../data/entities'
import { invoiceLineListSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_invoice_line' as const

const invoiceLineItemSchema = z
  .object({
    id: z.string().uuid(),
    invoiceId: z.string().uuid(),
    lineNumber: z.number(),
    productId: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    quantity: z.string(),
    unitPrice: z.string(),
    amount: z.string(),
    contractLineId: z.string().uuid().nullable().optional(),
  })
  .passthrough()

type InvoiceLineListQuery = z.infer<typeof invoiceLineListSchema>

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function referenceId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return String(value)
}

/**
 * Read-only line surface for the invoice detail page. Lines are written through the invoice
 * commands (create/update), which recompute the invoice totals in the same transaction.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.invoices.view'] },
  },
  orm: {
    entity: TradeDocsInvoiceLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: invoiceLineListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'invoice_id',
      'line_number',
      'product_id',
      'product_snapshot',
      'description',
      'sku',
      'unit',
      'quantity',
      'unit_price',
      'amount',
      'contract_line_id',
      'contract_line',
      'tenant_id',
      'organization_id',
    ],
    sortFieldMap: { id: 'id', line_number: 'line_number', lineNumber: 'line_number' },
    buildFilters: async (query: InvoiceLineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.invoiceId) filters.invoice_id = query.invoiceId
      if (query.contractLineId) filters.contract_line_id = query.contractLineId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      invoiceId: referenceId(item.invoice_id) ?? '',
      lineNumber: Number(item.line_number ?? 0),
      productId: (item.product_id ?? null) as string | null,
      description: (item.description ?? snapshotValue(item.product_snapshot, 'name')) as string | null,
      sku: (item.sku ?? snapshotValue(item.product_snapshot, 'sku')) as string | null,
      unit: (item.unit ?? snapshotValue(item.product_snapshot, 'unit')) as string | null,
      quantity: String(item.quantity ?? '0'),
      unitPrice: String(item.unit_price ?? '0'),
      amount: String(item.amount ?? '0'),
      contractLineId: referenceId(item.contract_line_id ?? item.contract_line),
    }),
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Invoice Line',
  pluralName: 'Invoice Lines',
  querySchema: invoiceLineListSchema,
  listResponseSchema: createPagedListResponseSchema(invoiceLineItemSchema, { paginationMetaOptional: true }),
})
