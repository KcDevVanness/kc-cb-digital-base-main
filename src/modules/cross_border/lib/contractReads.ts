import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './scope'

/**
 * Scoped reads of the purchase/sales contracts a shipment travels under.
 *
 * Raw Kysely on purpose, exactly like `purchasingReads`: this module must not import another
 * module's entities, it needs four columns, and every query is filtered by the caller's tenant and
 * organization. Nothing here writes — contract state changes go through their own commands.
 */
export type ContractRef = {
  id: string
  number: string | null
  direction: string
  status: string
}

type ContractRow = {
  id: string
  number: string | null
  direction: string
  status: string
}

export async function loadContractRefs(
  em: EntityManager,
  scope: Scope,
  contractIds: string[],
): Promise<Record<string, ContractRef>> {
  if (contractIds.length === 0) return {}
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('trade_docs_contracts as c')
    .select(['c.id as id', 'c.number as number', 'c.direction as direction', 'c.status as status'])
    .where('c.id', 'in', contractIds)
    .where('c.tenant_id', '=', scope.tenantId)
    .where('c.organization_id', '=', scope.organizationId)
    .where('c.deleted_at', 'is', null)
    .execute()) as ContractRow[]

  const byId: Record<string, ContractRef> = {}
  for (const row of rows) {
    byId[String(row.id)] = {
      id: String(row.id),
      number: row.number ?? null,
      direction: String(row.direction ?? 'purchase'),
      status: String(row.status ?? 'draft'),
    }
  }
  return byId
}

/**
 * Shipment ids linked to one contract, for the `?contractId=` list filters.
 *
 * The link table lives in this module, so this is a same-module read; it returns ids only, which
 * the caller turns into an `$in` filter (an empty set must match nothing, never everything). The
 * scope is the **read** scope — the visible organization set, not a single selected organization.
 */
export type ContractReadScope = { tenantId: string; organizationIds: string[] }

export async function loadShipmentIdsForContract(
  em: EntityManager,
  scope: ContractReadScope,
  contractId: string,
): Promise<string[]> {
  if (!scope.tenantId || scope.organizationIds.length === 0) return []
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('cross_border_shipment_contracts as sc')
    .innerJoin('cross_border_shipments as s', 's.id', 'sc.shipment_id')
    .select(['sc.shipment_id as shipment_id'])
    .where('sc.contract_id', '=', contractId)
    .where('sc.tenant_id', '=', scope.tenantId)
    .where('sc.organization_id', 'in', scope.organizationIds)
    .where('s.deleted_at', 'is', null)
    .execute()) as Array<{ shipment_id: string }>
  return rows.map((row) => String(row.shipment_id))
}
