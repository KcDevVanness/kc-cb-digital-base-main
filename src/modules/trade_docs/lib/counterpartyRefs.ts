import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import type { TradeDocsScope } from './scope'

/**
 * Guards the counterparty of a contract / document / invoice.
 *
 * Three rules live here because a partial update can send only one half of the pair:
 *   1. the direction decides the kind (`purchase ⇒ supplier`, `sales ⇒ customer`; an invoice's
 *      `inbound ⇒ supplier`, `outbound ⇒ customer`) — the stored kind is derived, and a caller that
 *      spells out a conflicting kind is rejected;
 *   2. a non-null id must resolve in the master data of that kind, inside the writer's scope;
 *   3. only those two namespaces exist.
 *
 * The id check is a scalar read on purpose: the app forbids cross-module ORM relations, so the peer
 * tables are read through the same raw scoped handle the module already uses for products.
 */

export type CounterpartyKind = 'supplier' | 'customer'

/** Peer master tables, keyed by the stored kind. */
const COUNTERPARTY_TABLES: Record<CounterpartyKind, string> = {
  supplier: 'purchasing_suppliers',
  customer: 'parties_parties',
}

/**
 * The effective kind of a write. An omitted `counterpartyKind` is derived from the direction, which
 * keeps `{ direction: 'sales' }` a valid create; an explicit value that contradicts the direction is
 * a payload mistake and answers 400 rather than being silently rewritten.
 */
export function resolveCounterpartyKind(
  direction: string,
  explicitKind: string | undefined,
  kindByDirection: Record<string, string>,
): CounterpartyKind {
  const derived = kindByDirection[direction]
  if (!derived) {
    throw badRequest(`Unknown direction: ${direction}`)
  }
  if (explicitKind && explicitKind !== derived) {
    throw badRequest(`counterpartyKind must be "${derived}" when direction is "${direction}"`)
  }
  return derived as CounterpartyKind
}

/**
 * A non-null `counterpartyId` must exist, un-deleted, in the master table of its own kind and in the
 * organization the write lands in — the same narrowing the pickers apply. A record the operator could
 * never have been offered (another tenant's, another namespace's, a soft-deleted one, or one owned by
 * a sibling organization) is a 400 rather than a dangling cross-scope reference.
 */
export async function assertCounterpartyReference(
  em: EntityManager,
  scope: TradeDocsScope,
  counterpartyKind: CounterpartyKind,
  counterpartyId: string | null | undefined,
): Promise<void> {
  if (!counterpartyId) return
  const table = COUNTERPARTY_TABLES[counterpartyKind]
  if (!table) throw badRequest(`Unknown counterparty kind: ${counterpartyKind}`)
  const row = await (em.fork().getKysely<any>())
    .selectFrom(`${table} as counterparty`)
    .select(['counterparty.id'])
    .where('counterparty.id', '=', counterpartyId)
    .where('counterparty.tenant_id', '=', scope.tenantId)
    .where('counterparty.organization_id', '=', scope.organizationId)
    .where('counterparty.deleted_at', 'is', null)
    .executeTakeFirst()
  if (!row) {
    throw badRequest(
      `counterparty_not_found: the selected ${counterpartyKind} is not available in this organization`,
    )
  }
}
