import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './scope'

/**
 * The one peer fact the write path needs.
 *
 * Raw Kysely read on purpose: the app-wide rule forbids importing another module's entities, and
 * this module only needs the shipment's existence, status and number. Nothing here writes — the
 * shipment itself is owned and maintained by `cross_border`.
 */
export type ShipmentRef = {
  id: string
  number: string | null
  status: string
}

export async function loadShipmentRef(
  em: EntityManager,
  scope: Scope,
  shipmentId: string,
): Promise<ShipmentRef | null> {
  const row = (await (em.fork().getKysely<any>())
    .selectFrom('cross_border_shipments')
    .select(['id', 'number', 'status'])
    .where('id', '=', shipmentId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst()) as { id: string; number: string | null; status: string } | undefined

  if (!row) return null
  return { id: String(row.id), number: row.number ?? null, status: String(row.status ?? 'draft') }
}
