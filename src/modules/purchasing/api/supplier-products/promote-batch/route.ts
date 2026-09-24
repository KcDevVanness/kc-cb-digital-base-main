import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PurchasingSupplierProduct } from '../../../data/entities'
import { supplierProductPromoteBatchSchema } from '../../../data/validators'
import { purchasingCommandErrors, purchasingTag } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product' as const

const promoteBatchListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const promoteBatchResponseSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      message: z.string(),
    }),
  ),
})

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.promote'] },
  },
  orm: {
    entity: PurchasingSupplierProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: promoteBatchListSchema, entityId: ENTITY_ID, fields: ['id', 'supplier_sku', 'product_id'] },
  actions: {
    create: {
      commandId: 'purchasing.supplier-products.promote-batch',
      schema: supplierProductPromoteBatchSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Create product records for several supplier products at once',
  methods: {
    POST: {
      summary: 'Create product records for several supplier products at once',
      description:
        'Runs the same promotion as the single-row action for every id, with per-row isolation: one row’s failure (a SKU owned by a deleted product, an unknown id) is reported in `failed[]` with its code and message while the rest are written. Duplicate ids are collapsed to their first occurrence, so the counts describe distinct rows. Bounded to 100 ids per request.',
      requestBody: { schema: supplierProductPromoteBatchSchema },
      responses: [{ status: 200, description: 'Batch finished', schema: promoteBatchResponseSchema }],
      errors: [...purchasingCommandErrors],
    },
  },
}
