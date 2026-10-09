import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CompanyOrderCollaborator } from '../../../data/entities'
import {
  companyOrderCollaboratorsListSchema,
  companyOrderCollaboratorsReplaceSchema,
} from '../../../data/validators'
import { loadCollaboratorCompanyOrderIds } from '../../../lib/collaborators'
import { createOrderHubCrudOpenApi, orderHubOkSchema } from '../../openapi'

const ENTITY_ID = 'order_hub:company_order_collaborator' as const

/**
 * A uuid no row can carry: an empty `id $in []` is rejected by the query-engine path the factory
 * uses for a projected list, so "match nothing" is expressed as a single impossible id instead.
 */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

// The visibility probe reads the module's own root table; the handle is cast once because MikroORM
// types `getKysely()`'s DB generic as `never`.
type VisibilityTables = {
  order_hub_company_orders: {
    id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

const companyOrderCollaboratorItemSchema = z
  .object({
    id: z.string().uuid(),
    companyOrderId: z.string().uuid(),
    organizationId: z.string().uuid(),
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
 * The collaborating organizations of one company order (REQ-014).
 *
 * `GET ?companyOrderId=` is the hub dialog's read — the rows are owned by the **collaborator**
 * organization, so the factory's automatic organization filter cannot express "the set of the root
 * I am looking at". The scope is therefore applied here: the caller must be able to *see* the root
 * (its own organization owns it, or it collaborates on it), else the collection answers empty.
 *
 * `POST` is the whole-set **replace** (`order_hub.orders.collaborators.replace`): owner-only,
 * de-duplicated, optimistic-locked on the root version the dialog rendered with.
 */
export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
    POST: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
  },
  orm: {
    entity: CompanyOrderCollaborator,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: null,
  },
  list: {
    schema: companyOrderCollaboratorsListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'company_order_id', 'organization_id', 'created_at', 'updated_at', 'tenant_id'],
    defaultSort: { field: 'created_at', dir: 'asc' },
    buildFilters: async (query, ctx) => {
      if (!query.companyOrderId) throw badRequest('companyOrderId is required')
      const filters: Record<string, unknown> = { company_order_id: query.companyOrderId }
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationIds = ctx.organizationIds?.length ? ctx.organizationIds : []
      if (!tenantId || organizationIds.length === 0 || ctx.organizationScope?.selectionRejected) {
        return { ...filters, id: { $in: [NO_MATCH_ID] } }
      }

      const em = ctx.container.resolve('em') as EntityManager
      const db = em.fork().getKysely() as unknown as Kysely<VisibilityTables>
      const owned = await db
        .selectFrom('order_hub_company_orders')
        .select('id')
        .where('id', '=', query.companyOrderId)
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', organizationIds)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
      const collaboratorRootIds = owned
        ? []
        : await loadCollaboratorCompanyOrderIds(em, tenantId, organizationIds)
      if (!owned && !collaboratorRootIds.includes(query.companyOrderId)) {
        return { ...filters, id: { $in: [NO_MATCH_ID] } }
      }
      return { ...filters, tenant_id: tenantId }
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      companyOrderId: String(item.company_order_id),
      organizationId: String(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'order_hub.orders.collaborators.replace',
      schema: companyOrderCollaboratorsReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const organizationIds: unknown = result?.organizationIds
        return { ok: true as const, count: Array.isArray(organizationIds) ? organizationIds.length : 0 }
      },
      status: 200,
    },
  },
})

export const openApi = createOrderHubCrudOpenApi({
  resourceName: 'Company Order Collaborator',
  pluralName: 'Company Order Collaborators',
  querySchema: companyOrderCollaboratorsListSchema,
  listResponseSchema: createPagedListResponseSchema(companyOrderCollaboratorItemSchema),
  create: {
    schema: companyOrderCollaboratorsReplaceSchema,
    responseSchema: orderHubOkSchema,
    description:
      'Replaces the collaborating organizations of a company order. Owner-organization only; a stale `updatedAt` answers 409.',
  },
})
