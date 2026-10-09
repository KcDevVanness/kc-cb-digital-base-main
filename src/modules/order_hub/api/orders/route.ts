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
import { loadCollaboratorCompanyOrderIds } from '../../lib/collaborators'

const ENTITY_ID = 'order_hub:company_order' as const

/**
 * A uuid no row can carry: an empty `id $in []` is rejected by the query-engine path the factory
 * uses for a projected list, so "match nothing" is expressed as a single impossible id instead.
 */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

// The search/kind sub-reads touch this module's own two tables (plus the collaborator set); the
// handle is cast once because MikroORM types `getKysely()`'s DB generic as `never`.
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
  order_hub_company_order_collaborators: {
    company_order_id: string
    organization_id: string
    tenant_id: string
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
    customerPartyId: z.string().uuid().nullable().optional(),
    customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    supplierSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    /** The version the hub's link/replace dialog echoes back for the optimistic lock. */
    updatedAt: z.string().nullable().optional(),
    /**
     * True when the caller sees this row as a **collaborator** rather than as its owner
     * organization: the workbench badges it and the hub offers only status/notes.
     */
    viewerIsCollaborator: z.boolean().optional(),
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
  'customer_party_id',
  'customer_snapshot',
  'supplier_id',
  'supplier_snapshot',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

/**
 * The company-order list (REQ-002), its CRUD actions (REQ-001) and the collaboration read scope
 * (REQ-016).
 *
 * `search`/`kind` are not columns on the root record: the search term must also match a **child's**
 * frozen number, and the kind filter is a property of the links. Both therefore resolve a scoped id
 * set first (`buildFilters` is async) and narrow the page through it. The same-resource CRUD cache
 * is cleared by the commands; the cross-resource link and collaborator collections are named there
 * too.
 *
 * `orm.orgField: null` deliberately turns the factory's automatic organization filter **off**: the
 * row's scope is no longer a single `organization_id ∈ <visible set>`, because an organization also
 * sees the roots it is a **collaborator** of (a different `organization_id`). `buildFilters` is
 * therefore the one and only place the list's scope is applied — tenant plus
 * (`organization_id ∈ <visible set>` OR the root is in the caller's collaborator set).
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
    // The collaboration-aware scope lives in `buildFilters` (see the comment above).
    orgField: null,
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
      // (`ctx.organizationIds`), so the scope below must use the same set — deriving a single org
      // from the session would drop every descendant-org row the page still shows.
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationIds = ctx.organizationIds?.length ? ctx.organizationIds : []
      // Two states the factory used to refuse for us while `orgField` was set: an empty visible set,
      // and a selected organization the caller may no longer use (stale switcher cookie). Both fail
      // closed here with an impossible id instead of silently widening the scope.
      if (!tenantId || organizationIds.length === 0 || ctx.organizationScope?.selectionRejected) {
        return { ...filters, id: { $in: [NO_MATCH_ID] } }
      }

      const em = ctx.container.resolve('em') as EntityManager
      const db = em.fork().getKysely() as unknown as Kysely<CompanyOrderSearchTables>

      // The roots this caller's organizations collaborate on — the second disjunct of the scope, and
      // the reason the search/kind sub-reads below cannot simply filter the link table by the
      // caller's own organizations (a collaborator's link rows carry the owner's organization).
      const collaboratorRootIds = await loadCollaboratorCompanyOrderIds(em, tenantId, organizationIds)
      // `$in []` is not an empty disjunct the engine can express (an empty `$in` matches nothing but
      // the planners reject it), so "no collaborator roots" is spelled as a single impossible id.
      const collaboratorIds = collaboratorRootIds.length > 0 ? collaboratorRootIds : [NO_MATCH_ID]

      filters.tenant_id = tenantId
      // The scope, in the primary `$or` form: the caller's visible organizations **or** the roots
      // they collaborate on. The equivalent id-set contingency (first read every visible root id,
      // then `filters.id = { $in: <that set> }`) is what the sub-reads below effectively use; it is
      // only a contingency for an engine that rejects an `$or` subtree, because it costs a full id
      // read on every list.
      filters.$or = [
        { organization_id: { $in: organizationIds } },
        { id: { $in: collaboratorIds } },
      ]

      let candidateIds: Set<string> | null = null
      const narrow = (ids: string[]) => {
        const next = new Set(ids)
        candidateIds = candidateIds ? new Set([...candidateIds].filter((id) => next.has(id))) : next
      }

      if (query.kind) {
        const rows = (await db
          .selectFrom('order_hub_company_order_links')
          .select('company_order_id')
          .where('tenant_id', '=', tenantId)
          .where((eb) => eb.or([
            eb('organization_id', 'in', organizationIds),
            eb('company_order_id', 'in', collaboratorIds),
          ]))
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
          .where((eb) => eb.or([
            eb('organization_id', 'in', organizationIds),
            eb('id', 'in', collaboratorIds),
          ]))
          .where('deleted_at', 'is', null)
          .where((eb) => eb.or([eb('number', 'ilike', like), eb('title', 'ilike', like)]))
          .execute()) as Array<{ id: string }>
        const linkRows = (await db
          .selectFrom('order_hub_company_order_links')
          .select('company_order_id')
          .where('tenant_id', '=', tenantId)
          .where((eb) => eb.or([
            eb('organization_id', 'in', organizationIds),
            eb('company_order_id', 'in', collaboratorIds),
          ]))
          .where('ref_number', 'ilike', like)
          .execute()) as Array<{ company_order_id: string }>
        narrow([...rootRows.map((row) => String(row.id)), ...linkRows.map((row) => String(row.company_order_id))])
      }

      if (candidateIds) {
        // The annotation is load-bearing: `candidateIds` is only ever assigned inside `narrow` above,
        // so the compiler's flow analysis narrows it to the declared initializer (`null`) here and
        // the spread alone would come out as `never[]`.
        const ids: string[] = [...candidateIds]
        // Intersect with an explicit `?id=` rather than replacing it: the hub's single-row read
        // (`?id=` + pageSize 1) must not be widened by a stray search term.
        if (query.id) {
          filters.id = { $in: ids.includes(query.id) ? [query.id] : [NO_MATCH_ID] }
        } else {
          filters.id = { $in: ids.length > 0 ? ids : [NO_MATCH_ID] }
        }
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
      // Default customer/supplier: the id plus the name frozen at write time, so the form's pickers
      // can resolve a label and the child forms can prefill without a second read.
      customerPartyId: (item.customer_party_id ?? null) as string | null,
      customerSnapshot: (item.customer_snapshot ?? null) as Record<string, unknown> | null,
      supplierId: (item.supplier_id ?? null) as string | null,
      supplierSnapshot: (item.supplier_snapshot ?? null) as Record<string, unknown> | null,
      tenantId: (item.tenant_id ?? null) as string | null,
      organizationId: (item.organization_id ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  hooks: {
    /**
     * Marks the rows the caller sees as a **collaborator** rather than as the root's own
     * organization (REQ-016) — the workbench badges them and the hub switches to the reduced view.
     *
     * `transformItem` is synchronous and holds no caller context, so the split cannot live there;
     * the hook runs before the list is cached (and the cached payload already carries the flag), and
     * the cache key is partitioned by the caller's organization scope, so the flag is per-viewer.
     */
    afterList: async (res, ctx) => {
      const payload = res as { items?: Array<Record<string, unknown>> } | null
      if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return
      const organizationIds = new Set(ctx.organizationIds?.length ? ctx.organizationIds : [])
      for (const item of payload.items) {
        const owner = typeof item.organizationId === 'string' ? item.organizationId : null
        item.viewerIsCollaborator = owner !== null && !organizationIds.has(owner)
      }
    },
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
