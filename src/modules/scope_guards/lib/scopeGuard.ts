import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { Role, RoleAcl, User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isUnrestrictedOrganizationScope } from '@open-mercato/shared/lib/auth/organizationAccess'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
/** Sentinel the ACL grant model uses for "every organization in the tenant". */
const ALL_ORGANIZATIONS = '__all__'

export type ActorScope = {
  isSuperAdmin: boolean
  /** `null` = unrestricted within the tenant (or super admin); `[]` = resolved but empty. */
  allowedOrganizationIds: string[] | null
}

export type AclTargetKind = 'role' | 'user'

/**
 * Resolve the acting principal's organization scope.
 *
 * Returns `null` for trusted system contexts (no end-user actor) — callers allow those.
 * An authenticated actor whose tenant cannot be resolved is returned as a restricted,
 * empty-scope actor: `allowedIds === null` also covers "scope could not be resolved"
 * (directory/utils/organizationScope), so it must never read as unrestricted.
 */
export async function resolveActorScope(input: {
  container: AwilixContainer
  auth: AuthContext | null
  selectedOrganizationId: string | null
}): Promise<ActorScope | null> {
  const { container, auth, selectedOrganizationId } = input
  if (!auth?.sub) return null
  const tenantId = typeof auth.tenantId === 'string' && auth.tenantId.trim().length > 0
    ? auth.tenantId.trim()
    : null
  if (!tenantId) return { isSuperAdmin: false, allowedOrganizationIds: [] }

  const em = container.resolve('em') as EntityManager
  const rbac = container.resolve('rbacService') as RbacService
  const scope = await resolveOrganizationScope({
    em,
    rbac,
    auth,
    selectedId: selectedOrganizationId,
    tenantId,
  })
  return {
    isSuperAdmin: auth.isSuperAdmin === true,
    allowedOrganizationIds: Array.isArray(scope.allowedIds) ? scope.allowedIds : null,
  }
}

/**
 * Whether a restricted actor may touch the target ACL row's *existing* grant.
 *
 * Only the organization axis is judged: an unrestricted grant (`organizations_json` null or
 * `['__all__']`) or a grant naming an organization outside the actor's scope belongs to
 * someone else. Feature grants are left to the installed `assertActorCanGrantAcl`, which
 * validates the requested values and therefore keeps narrowing/reclaiming available.
 */
export async function hasAclOwnershipViolation(input: {
  container: AwilixContainer
  tenantId: string
  kind: AclTargetKind
  targetId: string
  actor: ActorScope
}): Promise<boolean> {
  const { container, tenantId, kind, targetId, actor } = input
  if (isUnrestrictedOrganizationScope({
    isSuperAdmin: actor.isSuperAdmin,
    allowedOrganizationIds: actor.allowedOrganizationIds,
  })) return false

  const em = container.resolve('em') as EntityManager
  const scope = { tenantId, organizationId: null }
  const acl = kind === 'role'
    ? await findOneWithDecryption(
      em,
      RoleAcl,
      { role: targetId as unknown as Role, tenantId } as FilterQuery<RoleAcl>,
      {},
      scope,
    )
    : await findOneWithDecryption(
      em,
      UserAcl,
      { user: targetId as unknown as User, tenantId } as FilterQuery<UserAcl>,
      {},
      scope,
    )
  if (!acl) return false
  if (acl.isSuperAdmin === true) return true

  const organizations = Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null
  if (organizations === null) return true
  if (organizations.length === 0) return false
  if (organizations.includes(ALL_ORGANIZATIONS)) return true

  const allowed = actor.allowedOrganizationIds ?? []
  return organizations.some((organizationId) => !allowed.includes(organizationId))
}
