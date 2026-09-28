import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { ProductCodeRule } from '../../data/entities'
import {
  productCodeRuleCreateSchema,
  productCodeRuleListSchema,
  productCodeRuleUpdateSchema,
} from '../../data/validators'
import {
  createProductCodesCrudOpenApi,
  productCodesCreatedSchema,
  productCodesOkSchema,
} from '../openapi'

const ENTITY_ID = 'product_codes:product_code_rule' as const

const ruleListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mode: z.string(),
  segments: z.array(z.record(z.string(), z.unknown())),
  separator: z.string(),
  serialLength: z.number(),
  serialScope: z.string(),
  enforce: z.string(),
  isActive: z.boolean(),
  updatedAt: z.string().nullable(),
})

/**
 * Code rules — the list the 编码规则 page renders and the writes it performs.
 *
 * The route is thin by design: validation of what a rule may *produce* lives in the command, because
 * it needs the organization's current brand and category code lists, which a route schema cannot see.
 */
export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['product_codes.rules.view'] },
    POST: { requireAuth: true, requireFeatures: ['product_codes.rules.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['product_codes.rules.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['product_codes.rules.manage'] },
  },
  orm: {
    entity: ProductCodeRule,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: productCodeRuleListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'name', 'mode', 'segments', 'separator', 'serial_length', 'serial_scope', 'enforce', 'is_active', 'updated_at'],
    sortFieldMap: {
      name: 'name',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query: z.infer<typeof productCodeRuleListSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.search && query.search.trim().length > 0) {
        // Escaped LIKE on a plaintext column: the escape keeps a typed `%` from widening the filter.
        filters.name = { $ilike: `%${escapeLikePattern(query.search.trim())}%` }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      mode: String(item.mode ?? 'generate'),
      segments: Array.isArray(item.segments) ? (item.segments as Record<string, unknown>[]) : [],
      separator: String(item.separator ?? '-'),
      serialLength: Number(item.serial_length ?? 3),
      serialScope: String(item.serial_scope ?? 'brand_category'),
      enforce: String(item.enforce ?? 'warn'),
      isActive: item.is_active === true,
      updatedAt: item.updated_at instanceof Date ? item.updated_at.toISOString() : (item.updated_at as string | null),
    }),
  },
  actions: {
    create: {
      commandId: 'product_codes.rules.create',
      schema: productCodeRuleCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id?: string }).id ?? '') }),
      status: 201,
    },
    update: {
      commandId: 'product_codes.rules.update',
      schema: productCodeRuleUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'product_codes.rules.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createProductCodesCrudOpenApi({
  resourceName: 'Code rule',
  pluralName: 'Code rules',
  querySchema: productCodeRuleListSchema,
  listResponseSchema: createPagedListResponseSchema(ruleListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: productCodeRuleCreateSchema,
    responseSchema: productCodesCreatedSchema,
    description:
      'Stores a rule after checking its worst case against the current brand and category code lists: a rule that could emit a code outside the product SKU charset is refused with the offending problem code.',
  },
  update: {
    schema: productCodeRuleUpdateSchema,
    responseSchema: productCodesOkSchema,
    description: 'Updates a rule; requires the rule’s expected version for optimistic locking.',
  },
  del: {
    responseSchema: productCodesOkSchema,
    description: 'Soft-deletes a rule. Codes already issued under it keep working, and its name stays owned.',
  },
})
