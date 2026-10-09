import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CompanyOrderLink } from '../../../data/entities'
import {
  COMPANY_ORDER_LINK_KINDS,
  companyOrderLinksListSchema,
  companyOrderLinksReplaceSchema,
} from '../../../data/validators'
import { createOrderHubCrudOpenApi, orderHubOkSchema } from '../../openapi'

const ENTITY_ID = 'order_hub:company_order_link' as const

const companyOrderLinkItemSchema = z
  .object({
    id: z.string().uuid(),
    companyOrderId: z.string().uuid(),
    kind: z.enum(COMPANY_ORDER_LINK_KINDS),
    refId: z.string().uuid(),
    refNumber: z.string().nullable().optional(),
    refCounterparty: z.string().nullable().optional(),
    refSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

/**
 * The company-order links: the attach block of one root, and the reverse lookup by child.
 *
 * `GET` answers both reads through one scoped collection — `?companyOrderId=` for the hub's attach
 * blocks, `?refId=` for "which company order holds this document" (the legacy-URL resolution). A
 * request that names neither is refused. `POST` is the **replace** action
 * (`order_hub.orders.links.replace`): a whole-set write for one kind, not a per-row CRUD update,
 * because the dialog edits the set as a whole and the command owns uniqueness, scope and the lock.
 */
export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
    POST: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
  },
  orm: {
    entity: CompanyOrderLink,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  list: {
    schema: companyOrderLinksListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'company_order_id',
      'kind',
      'ref_id',
      'ref_number',
      'ref_counterparty',
      'ref_snapshot',
      'created_at',
      'updated_at',
      'tenant_id',
      'organization_id',
    ],
    defaultSort: { field: 'created_at', dir: 'asc' },
    buildFilters: async (query) => {
      if (!query.companyOrderId && !query.refId) {
        throw badRequest('Either companyOrderId or refId is required')
      }
      const filters: Record<string, unknown> = {}
      if (query.companyOrderId) filters.company_order_id = query.companyOrderId
      if (query.refId) filters.ref_id = query.refId
      if (query.kind) filters.kind = query.kind
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      companyOrderId: String(item.company_order_id),
      kind: String(item.kind),
      refId: String(item.ref_id),
      refNumber: (item.ref_number ?? null) as string | null,
      refCounterparty: (item.ref_counterparty ?? null) as string | null,
      refSnapshot: (item.ref_snapshot ?? null) as Record<string, unknown> | null,
      created_at: toIsoTimestamp(item.created_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'order_hub.orders.links.replace',
      schema: companyOrderLinksReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({
        ok: true,
        count: (result as { refIds: string[] }).refIds.length,
      }),
      status: 200,
    },
  },
})

export const openApi = createOrderHubCrudOpenApi({
  resourceName: 'Company Order Link',
  pluralName: 'Company Order Links',
  querySchema: companyOrderLinksListSchema,
  listResponseSchema: createPagedListResponseSchema(companyOrderLinkItemSchema),
  create: {
    schema: companyOrderLinksReplaceSchema,
    responseSchema: orderHubOkSchema,
    description:
      'Replaces the child documents of one kind attached to a company order, freezing each child’s number, counterparty and status snapshot.',
  },
})
