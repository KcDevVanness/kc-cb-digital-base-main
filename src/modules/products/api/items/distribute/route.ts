import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ProductsProduct } from '../../../data/entities'
import { productDistributeSchema } from '../../../data/validators'
import { createProductsCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'products:products_product' as const

/**
 * Distribution action surface: `POST /api/products/items/distribute`
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`).
 *
 * The write itself lives in `products.items.distribute`; this route only declares the feature gate,
 * validates the payload and maps the command's result. Targets are validated again inside the
 * command against the caller's writable organization set.
 */
const distributeListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

const distributeResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      sku: z.string(),
      organizationId: z.string().uuid(),
      reason: z.enum(['sku_taken']),
    }),
  ),
})

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['products.items.manage'] },
  },
  orm: {
    entity: ProductsProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: distributeListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'sku', 'name', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'products.items.distribute',
      schema: productDistributeSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as z.infer<typeof distributeResultSchema>,
      // Not a resource creation: the call reports per-product outcomes, so the honest status is 200.
      status: 200,
    },
  },
})

export const openApi = createProductsCrudOpenApi({
  resourceName: 'Product distribution',
  pluralName: 'Product distributions',
  querySchema: distributeListSchema,
  listResponseSchema: z.object({
    items: z.array(z.object({ id: z.string().uuid(), sku: z.string(), name: z.string() })),
  }),
  create: {
    schema: productDistributeSchema,
    responseSchema: distributeResultSchema,
    description:
      'Copies the selected products (or every non-deleted product of the current organization) into the listed target organizations: linked copies are updated, a target-owned SKU is reported as skipped, new copies take the fields, variants and a first price set, and the source link is frozen as sourceProductId. Repeating the call is an idempotent update.',
  },
})
