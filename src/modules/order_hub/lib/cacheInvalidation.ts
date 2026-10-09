import type { AwilixContainer } from 'awilix'
import { deriveResourceFromCommandId, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { runWithCacheTenant } from '@open-mercato/cache'

/**
 * CRUD list-cache invalidation for this module's collections.
 *
 * The platform caches CRUD list payloads per resource + tenant + organization when
 * `ENABLE_CRUD_API_CACHE` is on, and only the same-resource case is covered by the factory: a write
 * through the orders route clears the company-order collection, but the **links** collection it also
 * moved (a replace rewrites the whole set) keeps answering the pre-write payload until its TTL — and
 * vice versa. Every writer therefore names both collections explicitly (lesson
 * `crud-cache-invalidation-spans-resources`).
 */

/** Resource strings match the factory's own derivation (`<module>.<entity>`, canonicalized). */
const COMPANY_ORDER = deriveResourceFromCommandId('order_hub.orders.create') ?? 'order_hub.order'
const COMPANY_ORDER_LINK = deriveResourceFromCommandId('order_hub.orders.links.replace') ?? 'order_hub.order'

/**
 * The link collection's own tag. Today both derivations above collapse to `order_hub.order`, so this
 * explicit name is a no-op alias; it is kept so a future command-id change that splits the two
 * resources keeps both invalidated instead of silently dropping one.
 */
const COMPANY_ORDER_LINK_TAG = 'order_hub.company_order.link'

/**
 * The collaborator collection's own tag, named explicitly for the same reason as the link tag: the
 * command-id derivation collapses every `order_hub.orders.*` writer onto `order_hub.order`, so this
 * alias only matters if that ever splits — but it must not be silently forgotten when it does.
 */
const COMPANY_ORDER_COLLABORATOR_TAG = 'order_hub.company_order.collaborator'

export type CacheScope = {
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

export type CacheIdentifiers = {
  id: string
  tenantId: string
  organizationId: string
}

/**
 * The cache is tenant-scoped (`tenant:<id>:…` keys/tags), so an invalidation outside the tenant
 * context would silently reach nothing — the installed bulk paths wrap their calls for this reason.
 */
async function invalidate(
  scope: CacheScope,
  resources: string[],
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  const [resource, ...aliases] = resources
  await runWithCacheTenant(scope.tenantId ?? identifiers.tenantId, async () => {
    await invalidateCrudCache(
      scope.container,
      resource,
      { id: identifiers.id, tenantId: identifiers.tenantId, organizationId: identifiers.organizationId },
      scope.tenantId ?? identifiers.tenantId,
      reason,
      aliases,
    )
  })
}

/** A company-order write moves both the orders list and the link collection. */
export async function invalidateCompanyOrderCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  await invalidate(scope, [COMPANY_ORDER, COMPANY_ORDER_LINK, COMPANY_ORDER_LINK_TAG], identifiers, reason)
}

/** A link-only write still moves the orders list (its counts/search read the links). */
export async function invalidateCompanyOrderLinkCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  await invalidate(scope, [COMPANY_ORDER_LINK, COMPANY_ORDER_LINK_TAG, COMPANY_ORDER], identifiers, reason)
}

/**
 * A collaborator-set write moves the orders list too — the set decides which organizations see the
 * row at all, so a cached list of the caller's organization (and of every collaborator's) is stale
 * the moment it changes.
 */
export async function invalidateCompanyOrderCollaboratorCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  await invalidate(
    scope,
    [COMPANY_ORDER_COLLABORATOR_TAG, COMPANY_ORDER, COMPANY_ORDER_LINK, COMPANY_ORDER_LINK_TAG],
    identifiers,
    reason,
  )
}
