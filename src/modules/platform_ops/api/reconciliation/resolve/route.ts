import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PlatformOpsReconciliationItem } from '../../../data/entities'
import { reconciliationResolveSchema } from '../../../data/validators'
import { platformOpsErrorSchema, platformOpsTag } from '../../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_reconciliation_item' as const

const decisionResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('resolved'),
})

/**
 * Closing an item is a decision, not an edit: the command requires a note, records who decided,
 * and refuses an item that is not open — so a double-submit cannot overwrite the first decision's
 * evidence.
 */
export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['platform_ops.reconciliation.manage'] },
  },
  orm: {
    entity: PlatformOpsReconciliationItem,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  actions: {
    create: {
      commandId: 'platform_ops.reconciliation.resolve',
      schema: reconciliationResolveSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({
        ok: true as const,
        status: ((result as { status?: string }).status ?? 'resolved') as 'resolved',
      }),
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: platformOpsTag,
  summary: 'Reconciliation decision',
  methods: {
    POST: {
      summary: 'Resolve a reconciliation item',
      description:
        'Closes an open item as resolved and records the note as its justification. The item keeps its evidence and never reopens; a problem that comes back raises a new item.',
      requestBody: {
        schema: reconciliationResolveSchema,
        description: 'The item id and the note explaining the decision.',
      },
      responses: [
        {
          status: 200,
          description: 'The item is resolved.',
          schema: decisionResponseSchema,
        },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: platformOpsErrorSchema },
        { status: 403, description: 'Missing the reconciliation.manage feature', schema: platformOpsErrorSchema },
        { status: 404, description: 'Unknown item in this organization', schema: platformOpsErrorSchema },
        { status: 422, description: 'Missing note, or the item is already resolved or ignored', schema: platformOpsErrorSchema },
      ],
    },
  },
}
