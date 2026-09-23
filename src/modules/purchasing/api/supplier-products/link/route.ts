import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PurchasingSupplierProduct } from '../../../data/entities'
import { supplierProductLinkSchema } from '../../../data/validators'
import { purchasingCommandErrors, purchasingTag } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product' as const

const linkListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const linkResponseSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable(),
})

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
  },
  orm: {
    entity: PurchasingSupplierProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: linkListSchema, entityId: ENTITY_ID, fields: ['id', 'supplier_sku', 'product_id'] },
  actions: {
    create: {
      commandId: 'purchasing.supplier-products.link',
      schema: supplierProductLinkSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Link a supplier product to an existing product master row',
  methods: {
    POST: {
      summary: 'Link a supplier product to an existing product master row',
      description:
        'Points the library row at a product that already exists (关联已有商品), re-points it (换绑), or clears the link with `productId: null` (解除关联). Writes only `product_id`: the master’s fields and prices are never touched. The target’s scope and liveness are re-checked inside the transaction that performs the write, so a product deleted between the picker’s read and the write is refused (422 `product_deleted`) with nothing written; a product outside the caller’s organization is a 404.',
      requestBody: { schema: supplierProductLinkSchema },
      responses: [{ status: 200, description: 'Link written', schema: linkResponseSchema }],
      errors: [...purchasingCommandErrors],
    },
  },
}
