import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PurchasingSupplierProduct } from '../../../data/entities'
import { supplierProductSyncFieldsSchema } from '../../../data/validators'
import { purchasingCommandErrors, purchasingTag } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product' as const

const syncFieldsListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const syncFieldsResponseSchema = z.object({
  productId: z.string().uuid(),
  fieldsChanged: z.array(z.string()),
  priceChanged: z.boolean(),
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
  list: { schema: syncFieldsListSchema, entityId: ENTITY_ID, fields: ['id', 'supplier_sku', 'product_id'] },
  actions: {
    create: {
      commandId: 'purchasing.supplier-products.sync-fields',
      schema: supplierProductSyncFieldsSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Push a supplier product’s current values onto its linked product',
  methods: {
    POST: {
      summary: 'Push a supplier product’s current values onto its linked product',
      description:
        'Re-applies the same non-empty/changed field mapping and the `purchase`-tier price merge that promotion uses, on the product this row is already linked to — `promote` itself is idempotent (`skipped`) once a link exists. Reports `fieldsChanged` and `priceChanged`. The catalog link, the `internal`/`export` price tiers and the variants are never touched. An unlinked row (422 `supplier_product_not_linked`) and a deleted product (422 `product_deleted`) are refused. Requires `purchasing.supplier-products.promote`, because it writes the master.',
      requestBody: { schema: supplierProductSyncFieldsSchema },
      responses: [{ status: 200, description: 'Fields synced', schema: syncFieldsResponseSchema }],
      errors: [...purchasingCommandErrors],
    },
  },
}
