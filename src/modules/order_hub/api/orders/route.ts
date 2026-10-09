import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CompanyOrder } from '../../data/entities'
import {
  COMPANY_ORDER_STATUSES,
  companyOrderCreateSchema,
  companyOrderListSchema,
  companyOrderUpdateSchema,
} from '../../data/validators'
import {
  createOrderHubCrudOpenApi,
  orderHubCreatedSchema,
  orderHubOkSchema,
} from '../openapi'

const ENTITY_ID = 'order_hub:company_order' as const

/**
 * A uuid no row can carry: an empty `id $in []` is rejected by the query-engine path the factory
 * uses for a projected list, so "match nothing" is expressed as a single impossible id instead.
 */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

// The search/kind sub-reads touch this module's own two tables; the handle is cast once because
// MikroORM types `getKysely()`'s DB generic as `never`.
type CompanyOrderSearchTables = {
  order_hub_company_orders: {
    id: string
    number: string
    title: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  order_hub_company_order_links: {
    company_order_id: string
    kind: string
    ref_number: string | null
    tenant_id: string
    organization_id: string
  }
}

const companyOrderListItemSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string(),
    title: z.string().nullable().optional(),
    orderDate: z.string().nullable().optional(),
    etaDate: z.string().nullable().optional(),
    status: z.enum(COMPANY_ORDER_STATUSES),
    notes: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    /** The version the hub's link/replace dialog echoes back for the optimistic lock. */
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

type CompanyOrderListQuery = z.infer<typeof companyOrderListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }
  return null
}

const listFields = [
  'id',
  'number',
  'title',
  'order_date',
  'eta_date',
  'status',
  'notes',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

/**
 * The company-order list (REQ-002) and its CRUD actions (REQ-001).
 *
 * `search`/`kind` are not columns on the root record: the search term must also match a **child's**
 * frozen number, and the kind filter is a property of the links. Both therefore resolve a scoped id
 * set first (`buildFilters` is async) and narrow the page through it. The same-resource CRUD cache
 * is cleared by the commands; the cross-resource link collection is named there too.
 */
export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
    POST: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
  },
  orm: {
    entity: CompanyOrder,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: companyOrderListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      number: 'number',
      title: 'title',
      order_date: 'order_date',
      eta_date: 'eta_date',
      status: 'status',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: CompanyOrderListQuery, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status

      // The factory scopes the main query by the caller's *expanded* visible organization set
      // (`ctx.organizationIds`), so the search/kind sub-reads must use the same set — deriving a
      // single org from the session would drop every descendant-org row the page still shows.
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationIds = ctx.organizationIds?.length ? ctx.organizationIds : []
      if (!tenantId || organizationIds.length === 0) {
        // Fail closed, exactly like the factory's own empty-scope behavior.
        return { ...filters, id: { $in: [NO_MATCH_ID] } }
      }

      let candidateIds: Set<string> | null = null
      const narrow = (ids: string[]) => {
        const next = new Set(ids)
        candidateIds = candidateIds ? new Set([...candidateIds].filter((id) => next.has(id))) : next
      }

      const em = ctx.container.resolve('em') as EntityManager
      const db = em.fork().getKysely() as unknown as Kysely<CompanyOrderSearchTables>

      if (query.kind) {
        const rows = (await db
          .selectFrom('order_hub_company_order_links')
          .select('company_order_id')
          .where('tenant_id', '=', tenantId)
          .where('organization_id', 'in', organizationIds)
          .where('kind', '=', query.kind)
          .execute()) as Array<{ company_order_id: string }>
        narrow(rows.map((row) => String(row.company_order_id)))
      }

      const term = query.search?.trim()
      if (term) {
        // The root's number/title are plaintext columns; a child's frozen number is too. Match all
        // three so an operator can find a company order by either number.
        const like = `%${escapeLikePattern(term)}%`
        const rootRows = (await db
          .selectFrom('order_hub_company_orders')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('organization_id', 'in', organizationIds)
          .where('deleted_at', 'is', null)
          .where((eb) => eb.or([eb('number', 'ilike', like), eb('title', 'ilike', like)]))
          .execute()) as Array<{ id: string }>
        const linkRows = (await db
          .selectFrom('order_hub_company_order_links')
          .select('company_order_id')
          .where('tenant_id', '=', tenantId)
          .where('organization_id', 'in', organizationIds)
          .where('ref_number', 'ilike', like)
          .execute()) as Array<{ company_order_id: string }>
        narrow([...rootRows.map((row) => String(row.id)), ...linkRows.map((row) => String(row.company_order_id))])
      }

      if (candidateIds) {
        const ids = [...candidateIds]
        filters.id = { $in: ids.length > 0 ? ids : [NO_MATCH_ID] }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: String(item.number ?? ''),
      title: (item.title ?? null) as string | null,
      orderDate: toDateOnly(item.order_date),
      etaDate: toDateOnly(item.eta_date),
      status: String(item.status ?? 'draft'),
      notes: (item.notes ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'order_hub.orders.create',
      schema: companyOrderCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id), number: (result as { number: string }).number }),
      status: 201,
    },
    update: {
      commandId: 'order_hub.orders.update',
      schema: companyOrderUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'order_hub.orders.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createOrderHubCrudOpenApi({
  resourceName: 'Company Order',
  pluralName: 'Company Orders',
  querySchema: companyOrderListSchema,
  listResponseSchema: createPagedListResponseSchema(companyOrderListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: companyOrderCreateSchema,
    responseSchema: orderHubCreatedSchema,
    description: 'Creates a draft company order; the server assigns the `CO-<year>-<seq>` number.',
  },
  update: {
    schema: companyOrderUpdateSchema,
    responseSchema: orderHubOkSchema,
    description: 'Updates a company order; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: orderHubOkSchema,
    description: 'Soft-deletes a company order.',
  },
})
