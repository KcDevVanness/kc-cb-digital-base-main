import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CompanyOrder, CompanyOrderCollaborator } from '../data/entities'
import {
  COMPANY_ORDER_COLLABORATOR_FIELD_CODE,
  COMPANY_ORDER_COLLABORATOR_ORGANIZATION_CODE,
  COMPANY_ORDER_OWNER_REQUIRED_CODE,
} from '../data/validators'
import type { CompanyOrderScope } from './companyOrderNumber'

/**
 * Collaboration (REQ-014/REQ-016) — the read and write helpers behind the collaborator set.
 *
 * A company order belongs to exactly one **owner** organization (its `organization_id`). The owner
 * may additionally name other organizations as **collaborators**; each of them may then see the root
 * in its own workbench and hub and may write `status`/`notes` on it — and nothing else. The
 * whitelist is enforced in the update command (server side); everything here only answers the two
 * questions the read and write paths ask: *which roots does my organization collaborate on*, and
 * *which side of this root is my caller on*.
 */

/** The caller's visible organization set: the expanded scope, or just the selected org. */
export function scopeOrganizationIds(scope: CompanyOrderScope): string[] {
  const expanded = scope.organizationIds
  if (Array.isArray(expanded) && expanded.length > 0) return Array.from(new Set(expanded))
  return scope.organizationId ? [scope.organizationId] : []
}

// The handle is cast once because MikroORM types `getKysely()`'s DB generic as `never`
// (lesson `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
type CollaboratorReadTables = {
  order_hub_company_order_collaborators: {
    company_order_id: string
    organization_id: string
    tenant_id: string
  }
  organizations: {
    id: string
    tenant_id: string
    deleted_at: Date | null
  }
}

const COLLABORATOR_TABLE = 'order_hub_company_order_collaborators'
const ORGANIZATION_TABLE = 'organizations'

const readDb = (em: EntityManager): Kysely<CollaboratorReadTables> =>
  em.fork().getKysely() as unknown as Kysely<CollaboratorReadTables>

/**
 * The company-order ids the caller's organizations collaborate on — the set the list/stage/link
 * reads widen their `organization_id ∈ <scope>` filter with (REQ-016).
 *
 * One scoped read; empty for the ordinary caller whose organizations only ever own their roots.
 */
export async function loadCollaboratorCompanyOrderIds(
  em: EntityManager,
  tenantId: string,
  organizationIds: readonly string[],
): Promise<string[]> {
  if (organizationIds.length === 0) return []
  const rows = (await readDb(em)
    .selectFrom(COLLABORATOR_TABLE)
    .select('company_order_id')
    .where('tenant_id', '=', tenantId)
    .where('organization_id', 'in', [...organizationIds])
    .execute()) as Array<{ company_order_id: string }>
  return Array.from(new Set(rows.map((row) => String(row.company_order_id))))
}

/** The collaborating organizations of one root, newest first — the hub dialog's read. */
export async function loadCompanyOrderCollaboratorOrganizationIds(
  em: EntityManager,
  scope: CompanyOrderScope,
  companyOrderId: string,
): Promise<string[]> {
  const rows = await em.fork().find(
    CompanyOrderCollaborator,
    { tenantId: scope.tenantId, companyOrder: { id: companyOrderId } } as never,
    { orderBy: { createdAt: 'asc' } },
  )
  return rows.map((row) => String(row.organizationId))
}

/**
 * Refuses a requested collaborator organization that is unknown / soft-deleted in this tenant
 * (422, fail closed, never a dangling row). The **owner's own** organization is not an error: it is
 * dropped by the caller before this runs, since a root is never its own collaborator.
 */
export async function assertCollaboratorOrganizationsExist(
  em: EntityManager,
  tenantId: string,
  organizationIds: readonly string[],
): Promise<void> {
  const unique = Array.from(new Set(organizationIds))
  if (unique.length === 0) return
  const rows = (await readDb(em)
    .selectFrom(ORGANIZATION_TABLE)
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('id', 'in', unique)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string }>
  const known = new Set(rows.map((row) => String(row.id)))
  const unknown = unique.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw new CrudHttpError(422, {
      error: `Unknown organization: ${unknown.join(', ')}`,
      code: COMPANY_ORDER_COLLABORATOR_ORGANIZATION_CODE,
    })
  }
}

export type CompanyOrderAccessSide = 'owner' | 'collaborator'

export type CompanyOrderAccess = {
  order: CompanyOrder
  side: CompanyOrderAccessSide
}

/**
 * Loads a root inside the **tenant** and tells the caller which side of it they are on:
 * `owner` (their organization set contains the root's organization), `collaborator` (a collaborator
 * row names one of their organizations), or `null` (neither → the caller must not learn it exists;
 * every caller answers 404 for that case, exactly like an out-of-scope id did before).
 *
 * This is the *only* place the owner/collaborator split is decided, so the read scope, the update
 * whitelist and every owner-only action stay in agreement.
 */
export async function resolveCompanyOrderAccess(
  em: EntityManager,
  scope: CompanyOrderScope,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<CompanyOrderAccess | null> {
  const order = await em.fork().findOne(CompanyOrder, {
    id,
    tenantId: scope.tenantId,
    ...(options.includeDeleted ? {} : { deletedAt: null }),
  } as never)
  if (!order) return null

  const organizations = scopeOrganizationIds(scope)
  if (organizations.includes(String(order.organizationId))) return { order, side: 'owner' }

  const collaborator = organizations.length > 0
    ? await em.fork().findOne(CompanyOrderCollaborator, {
      tenantId: scope.tenantId,
      companyOrder: { id },
      organizationId: { $in: organizations },
    } as never)
    : null
  return collaborator ? { order, side: 'collaborator' } : null
}

/** The owner-only refusal (403): the caller may see the root but the action belongs to its owner. */
export function ownerRequired(): CrudHttpError {
  return new CrudHttpError(403, {
    error: 'Only the owner organization may change this company order',
    code: COMPANY_ORDER_OWNER_REQUIRED_CODE,
  })
}

/**
 * The update fields a **collaborator** may write. `id`/`updatedAt` are addressing, not data.
 *
 * A collaborator's write is whitelisted by *presence*: the update command is handed exactly the
 * schema-parsed payload (`mapInput: ({ parsed }) => parsed`), so any other key in it — `title`,
 * `orderDate`, `etaDate`, `customerPartyId`, `supplierId` — is a deliberate write attempt and is
 * refused with 422 rather than silently ignored.
 */
export const COLLABORATOR_WRITABLE_FIELDS = ['id', 'updatedAt', 'status', 'notes'] as const

/** The keys of a collaborator's update payload that the whitelist forbids (empty when writable). */
export function forbiddenCollaboratorFields(input: Record<string, unknown>): string[] {
  const writable = new Set<string>(COLLABORATOR_WRITABLE_FIELDS)
  return Object.keys(input).filter((key) => !writable.has(key))
}

/** The 422 a collaborator's out-of-whitelist write is refused with. */
export function collaboratorFieldRefused(fields: readonly string[]): CrudHttpError {
  return new CrudHttpError(422, {
    error: `A collaborating organization may only change status and notes (refused: ${fields.join(', ')})`,
    code: COMPANY_ORDER_COLLABORATOR_FIELD_CODE,
  })
}
