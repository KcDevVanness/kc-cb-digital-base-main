import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ProductCodeAlias } from '../../data/entities'
import { productCodeAliasCreateSchema } from '../../data/validators'
import { productCodesCommandErrors, productCodesCreatedSchema, productCodesTag } from '../openapi'

const ENTITY_ID = 'product_codes:product_code_alias' as const

const aliasListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

/**
 * Record a retired code.
 *
 * Called when an operator explicitly re-codes a row that was never promoted: the old code stays
 * resolvable so search and document lookups still find the record. Nothing calls this automatically —
 * a legacy code is kept, not rewritten, unless somebody decides to.
 */
export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['product_codes.rules.manage'] },
  },
  orm: {
    entity: ProductCodeAlias,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: aliasListSchema, entityId: ENTITY_ID, fields: ['id', 'alias_code', 'target_kind', 'target_id'] },
  actions: {
    create: {
      commandId: 'product_codes.aliases.create',
      schema: productCodeAliasCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id?: string }).id ?? '') }),
      status: 201,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: productCodesTag,
  summary: 'Record a retired product code',
  methods: {
    POST: {
      summary: 'Record a retired product code',
      description:
        'Stores the mapping from a code an operator retired to the record it belonged to. The target is checked for existence and scope inside the writing transaction (the id is a cross-module scalar with no foreign key). Requires `product_codes.rules.manage`.',
      requestBody: { schema: productCodeAliasCreateSchema },
      responses: [{ status: 201, description: 'Alias recorded', schema: productCodesCreatedSchema }],
      errors: [...productCodesCommandErrors],
    },
  },
}
