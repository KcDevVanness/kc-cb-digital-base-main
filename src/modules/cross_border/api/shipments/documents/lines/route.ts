import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderExportDocumentLine } from '../../../../data/entities'
import { exportDocumentLineListSchema } from '../../../../data/validators'
import { createCrossBorderCrudOpenApi } from '../../../openapi'

const ENTITY_ID = 'cross_border:cross_border_export_document_line' as const

const lineItemSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    lineNumber: z.number(),
    productId: z.string().uuid().nullable().optional(),
    name: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    cartons: z.string().nullable().optional(),
    grossWeight: z.string().nullable().optional(),
    netWeight: z.string().nullable().optional(),
    volume: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough()

type LineListQuery = z.infer<typeof exportDocumentLineListSchema>

function foreignKeyId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

function nullableDecimal(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  // The jsonb display snapshot is a plain object of primitives; indexing it is safe past the guard.
  const record = snapshot as Record<string, unknown>
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Read-only list of packing-list lines.
 *
 * Lines are written exclusively through the export-document create/update commands (which replace
 * the whole set), so this surface only reads — the PL detail page and its form load from here.
 * Soft-deleted lines (their document was deleted) are filtered by the ORM soft-delete binding.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
  },
  orm: {
    entity: CrossBorderExportDocumentLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: exportDocumentLineListSchema,
    entityId: ENTITY_ID,
    defaultSort: { field: 'line_number', dir: 'asc' },
    fields: [
      'id',
      'document_id',
      'line_number',
      'product_id',
      'product_snapshot',
      'name',
      'sku',
      'unit',
      'quantity',
      'cartons',
      'gross_weight',
      'net_weight',
      'volume',
      'source_snapshot',
      'note',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    buildFilters: async (query: LineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.documentId) filters.document_id = query.documentId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      documentId: foreignKeyId(item.document_id) ?? String(item.document_id ?? ''),
      lineNumber: Number(item.line_number ?? 0),
      productId: item.product_id ? String(item.product_id) : null,
      name: (item.name ?? snapshotValue(item.product_snapshot, 'name') ?? null) as string | null,
      sku: (item.sku ?? snapshotValue(item.product_snapshot, 'sku') ?? null) as string | null,
      unit: (item.unit ?? snapshotValue(item.product_snapshot, 'unit') ?? null) as string | null,
      quantity: nullableDecimal(item.quantity),
      cartons: nullableDecimal(item.cartons),
      grossWeight: nullableDecimal(item.gross_weight),
      netWeight: nullableDecimal(item.net_weight),
      volume: nullableDecimal(item.volume),
      sourceSnapshot: (item.source_snapshot ?? null) as Record<string, unknown> | null,
      note: (item.note ?? null) as string | null,
      created_at: item.created_at instanceof Date ? item.created_at.toISOString() : (item.created_at ?? null),
      updated_at: item.updated_at instanceof Date ? item.updated_at.toISOString() : (item.updated_at ?? null),
    }),
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Export Document Line',
  pluralName: 'Export Document Lines',
  querySchema: exportDocumentLineListSchema,
  listResponseSchema: createPagedListResponseSchema(lineItemSchema, { paginationMetaOptional: true }),
})
