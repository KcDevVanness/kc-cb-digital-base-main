import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
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
import { loadCollaboratorCompanyOrderIds } from '../../../lib/collaborators'

const ENTITY_ID = 'order_hub:company_order_link' as const

/** The one cross-table read this route's scope needs; the handle is cast once (see the orders route). */
type VisibilityRootTable = {
  order_hub_company_orders: {
    id: string
    tenant_id: string
    organization_id: string
  }
}

/**
 * A uuid no row can carry: an empty `id $in []` is rejected by the query-engine path the factory
 * uses for a projected list, so "match nothing" is expressed as a single impossible id instead.
 */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

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
 * `GET` answers three reads through one scoped collection — `?companyOrderId=` for the hub's attach
 * blocks, `?refId=` for "which company order holds this document" (the legacy-URL resolution), and
 * `?refIds=` for the same question about a whole page of children (the purchase-order list marks
 * each row 打开公司订单 / 未关联公司订单 before the operator clicks anything). A request that names
 * none is refused. `POST` is the **replace** action
 * (`order_hub.orders.links.replace`): a whole-set write for one kind, not a per-row CRUD update,
 * because the dialog edits the set as a whole and the command owns uniqueness, scope and the lock.
 *
 * `orm.orgField: null` for the same reason the orders route uses it: a collaborator must read the
 * attach block of a root whose links belong to the **owner's** organization, so the organization
 * scope is applied in `buildFilters` as "the caller's own links **or** the links of a root the
 * caller collaborates on". Everything outside the caller's visibility is simply absent from the
 * answer, exactly as before.
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
    orgField: null,
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
    buildFilters: async (query, ctx) => {
      if (!query.companyOrderId && !query.refId && !query.refIds) {
        throw badRequest('Either companyOrderId, refId or refIds is required')
      }
      const filters: Record<string, unknown> = {}
      if (query.companyOrderId) filters.company_order_id = query.companyOrderId
      if (query.refId) filters.ref_id = query.refId
      // The batched reverse lookup: unknown or malformed entries are dropped (a page of ids the
      // caller could not name simply matches nothing), and the count is capped like `pageSize`.
      if (query.refIds) {
        const refIds = Array.from(new Set(
          query.refIds
            .split(',')
            .map((id) => id.trim())
            .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),
        )).slice(0, 200)
        filters.ref_id = { $in: refIds.length > 0 ? refIds : [NO_MATCH_ID] }
      }
      if (query.kind) filters.kind = query.kind

      const tenantId = ctx.auth?.tenantId ?? null
      const organizationIds = ctx.organizationIds?.length ? ctx.organizationIds : []
      if (!tenantId || organizationIds.length === 0 || ctx.organizationScope?.selectionRejected) {
        // Fail closed: `orgField: null` means this function carries the whole scope, including the
        // empty-set and stale-selected-org cases the factory used to refuse on its own.
        return { ...filters, id: { $in: [NO_MATCH_ID] } }
      }
      const em = ctx.container.resolve('em') as EntityManager
      const collaboratorRootIds = await loadCollaboratorCompanyOrderIds(em, tenantId, organizationIds)
      const collaboratorIds = collaboratorRootIds.length > 0 ? collaboratorRootIds : [NO_MATCH_ID]
      // The same explicit visible-root-id scope the orders list applies: the engine mishandles a
      // top-level `id` filter next to an `$or` subtree, and the factory's generic `?id=`/`?ids=`
      // params must stay intersective rather than silently matching nothing.
      const visibleRoots = (await (em.fork().getKysely() as unknown as Kysely<VisibilityRootTable>)
        .selectFrom('order_hub_company_orders')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where((eb) => eb.or([
          eb('organization_id', 'in', organizationIds),
          eb('id', 'in', collaboratorIds),
        ]))
        .execute()) as Array<{ id: string }>
      const visibleRootIds = visibleRoots.map((row) => String(row.id))
      filters.tenant_id = tenantId
      // A collaborator reads the attach block of a root whose links belong to the owner's
      // organization, so the root — not the link row's own organization — is what the scope keys on.
      filters.company_order_id = query.companyOrderId
        ? (visibleRootIds.includes(query.companyOrderId) ? query.companyOrderId : NO_MATCH_ID)
        : { $in: visibleRootIds.length > 0 ? visibleRootIds : [NO_MATCH_ID] }
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
