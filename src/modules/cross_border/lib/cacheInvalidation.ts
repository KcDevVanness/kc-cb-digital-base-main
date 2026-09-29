import type { AwilixContainer } from 'awilix'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { runWithCacheTenant } from '@open-mercato/cache'

/**
 * CRUD list cache invalidation for this module's collections.
 *
 * A shipment write moves more than the shipment row: its allocations (both sides), its milestones
 * and its export documents are separate list resources with their own cached payloads, and the
 * read-only allocation routes are served by the factory under their **entity** name (they declare no
 * commands). The platform only invalidates the resource a route itself owns, so the commands name
 * every collection they rewrote.
 *
 * A milestone advance is the exception in the other direction: it changes only the shipment head
 * (`current_milestone`) and appends to the milestone list, so the caller picks the shipment set.
 */

/** Resource strings match the factory's own derivation (`<module>.<entity>`, canonicalized). */
export const SHIPMENT_CACHE_RESOURCES = {
  shipment: 'cross_border.shipment',
  allocation: 'cross_border.shipment.allocation',
  salesAllocation: 'cross_border.shipment.sales.allocation',
  milestone: 'cross_border.shipment.milestone',
  exportDocument: 'cross_border.document',
} as const

/**
 * Collections **outside** this module that a shipment write moves, named as their own routes
 * derive them (`canonicalizeResourceTag(entityName)`): the order lists because `depart` transitions
 * the allocated orders to `shipped`, the order lines because the receipt raises their
 * `received_quantity`, and the wms balances because the receipt books stock.
 */
export const PEER_CACHE_RESOURCES = {
  purchaseOrder: 'purchasing.purchase.order',
  purchaseOrderLine: 'purchasing.purchase.order.line',
  inventoryBalance: 'inventory.balance',
} as const

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

/** Every collection a shipment-level write can move. */
export async function invalidateShipmentCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  const resources = Object.values(SHIPMENT_CACHE_RESOURCES)
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

/**
 * Flushes whole peer collections (no record id — the whole list payload moves) for the tenant and
 * both the org-specific and org-null tags, exactly as a same-resource invalidation would. A command
 * that dispatches a peer command through the bus bypasses that peer's route, so nothing else would
 * clear its list.
 */
export async function invalidatePeerCaches(
  scope: CacheScope,
  resources: Array<(typeof PEER_CACHE_RESOURCES)[keyof typeof PEER_CACHE_RESOURCES]>,
  reason: string,
): Promise<void> {
  if (!scope.tenantId || !scope.organizationId) return
  const [resource, ...aliases] = resources
  if (!resource) return
  await runWithCacheTenant(scope.tenantId, async () => {
    await invalidateCrudCache(
      scope.container,
      resource,
      { id: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      scope.tenantId,
      reason,
      aliases,
    )
  })
}
