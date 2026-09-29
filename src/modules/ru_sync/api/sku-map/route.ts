import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { RuSyncSkuMap } from '../../data/entities'
import { SKU_MAP_STATUSES, skuMapListSchema, skuMapUpdateSchema } from '../../data/validators'
import { loadSkuMap } from '../../lib/skuMap'
import { resolveRequestScope } from '../../lib/requestScope'
import { ruSyncTag } from '../openapi'

const ENTITY_ID = 'ru_sync:ru_sync_sku_map' as const

const logger = createLogger('ru_sync').child({ component: 'sku-map-route' })

const skuMapRowSchema = z.object({
  ruSku: z.string(),
  status: z.enum(SKU_MAP_STATUSES),
  productId: z.string().uuid().nullable(),
  productSku: z.string().nullable(),
  productName: z.string().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string().nullable(),
  sources: z.array(z.object({ endpoint: z.string(), count: z.number(), lastAsOf: z.string().nullable() })),
})

const skuMapResponseSchema = z.object({
  items: z.array(skuMapRowSchema),
  total: z.number(),
  counts: z.object({ mapped: z.number(), ignored: z.number(), unmapped: z.number() }),
  hasUnmapped: z.boolean(),
})

/**
 * The RU code registry: every code the snapshots have seen, joined with the decision recorded for
 * it. A code with no decision is `unmapped` by construction — the list is derived from the two
 * sources, never maintained by hand.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = skuMapListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadSkuMap(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      { status: query.status ?? 'all', search: query.search, page: query.page, pageSize: query.pageSize },
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to load the RU SKU map', { err: error })
    return NextResponse.json({ error: 'Failed to load the RU SKU map' }, { status: 500 })
  }
}

/**
 * Records a decision: bind the code to a product, or ignore it. The factory route keeps auth,
 * feature gating, mutation guards and audit logging on the same path as every other write in the
 * app; the command owns the invariants (the product must be in this organization, `ignored` clears
 * the product) and the upsert keyed by the RU code.
 */
export const { PUT, metadata } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['ru_sync.view'] },
    PUT: { requireAuth: true, requireFeatures: ['ru_sync.map.manage'] },
  },
  orm: {
    entity: RuSyncSkuMap,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  list: {
    schema: skuMapListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'ru_sku', 'product_id', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    update: {
      commandId: 'ru_sync.sku-map.update',
      schema: skuMapUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ ok: true, id: String((result as { id: string }).id) }),
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: ruSyncTag,
  methods: {
    GET: {
      summary: 'List the RU SKU codes with their mapping decision',
      tags: [ruSyncTag],
      query: skuMapListSchema,
      responses: [
        { status: 200, description: 'Derived list of RU codes; unmapped rows first.', schema: skuMapResponseSchema },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing ru_sync.view' },
      ],
    },
    PUT: {
      summary: 'Bind a RU code to a product, or ignore it',
      tags: [ruSyncTag],
      requestBody: { schema: skuMapUpdateSchema },
      responses: [
        {
          status: 200,
          description: 'Decision recorded.',
          schema: z.object({ ok: z.literal(true), id: z.string().uuid() }),
        },
        { status: 400, description: 'Invalid input' },
        { status: 404, description: 'The product is not in this organization' },
        { status: 403, description: 'Missing ru_sync.map.manage' },
      ],
    },
  },
}
