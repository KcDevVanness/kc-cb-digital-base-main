import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PlatformOpsOrderMirror } from '../../../data/entities'
import { orderIngestSchema } from '../../../data/validators'
import { platformOpsErrorSchema, platformOpsTag } from '../../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_order_mirror' as const

const ingestResponseSchema = z.object({
  ok: z.literal(true),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
})

/**
 * The landing point for platform orders.
 *
 * The command is the contract: it upserts every order by `(channel, external order id)`, so a
 * retry, a re-import and a concurrent import converge on one row per order and a re-posted batch
 * reports `unchanged` without writing anything. Idempotency lives there — not in this route —
 * because the transport that will call it (Phase C) is still undecided.
 */
export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['platform_ops.channels.manage'] },
  },
  orm: {
    entity: PlatformOpsOrderMirror,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  actions: {
    create: {
      commandId: 'platform_ops.orders.ingest',
      schema: orderIngestSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const outcome = result as { created?: number; updated?: number; unchanged?: number }
        return {
          ok: true as const,
          created: outcome.created ?? 0,
          updated: outcome.updated ?? 0,
          unchanged: outcome.unchanged ?? 0,
        }
      },
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: platformOpsTag,
  summary: 'Platform order ingestion',
  methods: {
    POST: {
      summary: 'Ingest a batch of platform orders',
      description:
        'Upserts each order by `(channel, external order id)`. A re-posted batch reports `unchanged` and writes nothing. Amounts and statuses are stored verbatim as the platform reported them.',
      requestBody: {
        schema: orderIngestSchema,
        description: 'The channel and the orders to land. Up to 500 orders per request.',
      },
      responses: [
        {
          status: 200,
          description: 'Per-batch counts: rows created, rows updated, rows already current.',
          schema: ingestResponseSchema,
        },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: platformOpsErrorSchema },
        { status: 403, description: 'Missing the channels.manage feature', schema: platformOpsErrorSchema },
        { status: 404, description: 'Unknown channel in this organization', schema: platformOpsErrorSchema },
        { status: 422, description: 'Malformed payload or a duplicated external order id in the batch', schema: platformOpsErrorSchema },
      ],
    },
  },
}
