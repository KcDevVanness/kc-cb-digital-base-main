import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SourcingSupplierProduct } from '../../../data/entities'
import { supplierProductImportSchema } from '../../../data/validators'
import { sourcingCommandErrors, sourcingTag } from '../../openapi'

const ENTITY_ID = 'sourcing:sourcing_supplier_product' as const

const importListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const importResponseSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.array(
    z.object({
      lineId: z.string().uuid(),
      lineNumber: z.number(),
      message: z.string(),
    }),
  ),
})

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['sourcing.supplier-products.manage'] },
  },
  orm: {
    entity: SourcingSupplierProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: importListSchema, entityId: ENTITY_ID, fields: ['id', 'supplier_id'] },
  actions: {
    create: {
      commandId: 'sourcing.supplier-products.import-from-quote',
      schema: supplierProductImportSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Add quotation lines to a supplier’s product library',
  methods: {
    POST: {
      summary: 'Add quotation lines to a supplier’s product library',
      description:
        'Creates or refreshes one library row per selected quotation line, keyed by `derived_sku ?? item_no` inside the quotation’s supplier. Only non-empty, changed values are written, so re-importing the same quotation reports `skipped` and changes nothing. Per-line failures (a line with no item number, or a code owned by a soft-deleted row) are reported without stopping the other lines.',
      requestBody: { schema: supplierProductImportSchema },
      responses: [{ status: 200, description: 'Import finished', schema: importResponseSchema }],
      errors: [...sourcingCommandErrors],
    },
  },
}
