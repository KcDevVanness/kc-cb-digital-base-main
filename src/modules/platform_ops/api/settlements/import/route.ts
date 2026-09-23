import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PlatformOpsSettlement } from '../../../data/entities'
import { settlementImportSchema } from '../../../data/validators'
import { platformOpsErrorSchema, platformOpsTag } from '../../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_settlement' as const

const importResponseSchema = z.object({
  ok: z.literal(true),
  settlementId: z.string().uuid(),
  lines: z.number(),
  raised: z.number(),
  linked: z.number(),
})

/**
 * The landing point for a payout statement.
 *
 * The command upserts the settlement by `(channel, external settlement id)`, replaces its lines,
 * matches each line against the order mirror and raises a reconciliation item for every problem
 * it finds. Re-importing the same statement is a no-op apart from the counts, and a problem that
 * already has an open item raises nothing new.
 */
export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['platform_ops.settlements.manage'] },
  },
  orm: {
    entity: PlatformOpsSettlement,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  actions: {
    create: {
      commandId: 'platform_ops.settlements.import',
      schema: settlementImportSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const outcome = result as { settlementId?: string; lines?: number; raised?: number; linked?: number }
        return {
          ok: true as const,
          settlementId: String(outcome.settlementId ?? ''),
          lines: outcome.lines ?? 0,
          raised: outcome.raised ?? 0,
          linked: outcome.linked ?? 0,
        }
      },
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: platformOpsTag,
  summary: 'Settlement import',
  methods: {
    POST: {
      summary: 'Import a platform settlement with its lines',
      description:
        'Upserts the settlement by `(channel, external settlement id)` and stores its lines. Each line is matched against the order mirror; a missing order, an amount mismatch and a duplicated line each raise at most one open reconciliation item, and re-importing the same statement raises nothing new.',
      requestBody: {
        schema: settlementImportSchema,
        description: 'The channel, the settlement header, and its lines (up to 2000).',
      },
      responses: [
        {
          status: 200,
          description:
            'The stored settlement id, the number of lines written, how many reconciliation items were raised, and how many lines matched an order mirror.',
          schema: importResponseSchema,
        },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: platformOpsErrorSchema },
        { status: 403, description: 'Missing the settlements.manage feature', schema: platformOpsErrorSchema },
        { status: 404, description: 'Unknown channel in this organization', schema: platformOpsErrorSchema },
        { status: 422, description: 'Malformed payload', schema: platformOpsErrorSchema },
      ],
    },
  },
}
