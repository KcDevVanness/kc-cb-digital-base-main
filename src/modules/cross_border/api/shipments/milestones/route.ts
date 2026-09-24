import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderShipmentMilestone } from '../../../data/entities'
import { milestoneAdvanceSchema, milestoneListSchema, SHIPMENT_MILESTONES } from '../../../data/validators'
import { createCrossBorderCrudOpenApi, crossBorderOkSchema } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment_milestone' as const

const milestoneItemSchema = z
  .object({
    id: z.string().uuid(),
    milestone: z.enum(SHIPMENT_MILESTONES),
    occurredAt: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough()

type MilestoneListQuery = z.infer<typeof milestoneListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
    POST: { requireAuth: true, requireFeatures: ['cross_border.shipments.manage'] },
  },
  orm: {
    entity: CrossBorderShipmentMilestone,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: milestoneListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'shipment_id', 'milestone', 'occurred_at', 'note', 'tenant_id', 'organization_id'],
    buildFilters: async (query: MilestoneListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.shipmentId) filters.shipment_id = query.shipmentId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      milestone: String(item.milestone),
      occurredAt: toIsoTimestamp(item.occurred_at),
      note: (item.note ?? null) as string | null,
    }),
  },
  actions: {
    create: {
      commandId: 'cross_border.shipments.advance-milestone',
      schema: milestoneAdvanceSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ ok: true, currentMilestone: (result as { currentMilestone?: string | null }).currentMilestone ?? null }),
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Milestone',
  pluralName: 'Shipment Milestones',
  querySchema: milestoneListSchema,
  listResponseSchema: createPagedListResponseSchema(milestoneItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: milestoneAdvanceSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Records the next transit milestone; a stage earlier than the current one is rejected.',
  },
})
