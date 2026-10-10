import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PurchasingSupplierProduct } from '../../../data/entities'
import { supplierProductPromoteSchema } from '../../../data/validators'
import { purchasingCommandErrors, purchasingTag } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product' as const

const promoteListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const promoteResponseSchema = z.object({
  catalogProductId: z.string().uuid(),
  action: z.enum(['created', 'updated', 'skipped']),
  priceSkipped: z.boolean(),
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
  list: { schema: promoteListSchema, entityId: ENTITY_ID, fields: ['id', 'supplier_sku'] },
  actions: {
    create: {
      commandId: 'purchasing.supplier-products.promote',
      schema: supplierProductPromoteSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Create or sync a supplier product into the catalog store',
  methods: {
    POST: {
      summary: 'Create or sync a supplier product into the catalog store',
      description:
        'Creates the catalog product for this supplier code, or updates the existing one by SKU, and merges a `purchase`-tier price row from the library’s own supply price (after discount), falling back to the most recent quotation line that quoted the code (the other price tiers are preserved). Backfills `catalog_product_id` on the library row. Idempotent: a row that already carries `catalog_product_id` reports `action: "skipped"` and writes nothing.',
      requestBody: { schema: supplierProductPromoteSchema },
      responses: [{ status: 200, description: 'Sync finished', schema: promoteResponseSchema }],
      errors: [...purchasingCommandErrors],
    },
  },
}
