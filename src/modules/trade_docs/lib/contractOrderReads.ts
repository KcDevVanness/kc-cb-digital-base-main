import type { EntityManager } from '@mikro-orm/postgresql'
import type { TradeDocsScope } from './scope'

/**
 * Scoped reads of the orders a contract covers.
 *
 * Raw Kysely on purpose, exactly like the module's other peer reads: a contract link stores only
 * `(kind, id)` plus a display snapshot, and neither `purchasing` nor the installed `sales` engine
 * exposes a "give me these ids" contract this module should import. Every query is filtered by the
 * caller's tenant and organization, and nothing here writes.
 *
 * The counterparty and the order date come from columns the peer modules already keep for exactly
 * this purpose — `supplier_snapshot` on a purchase order, `customer_snapshot` on a sales order —
 * so no name is recomputed and no encrypted column is read.
 */
export type ContractOrderKind = 'purchase_order' | 'internal_sales_order' | 'external_sales_order'

export type ContractOrderRef = {
  kind: ContractOrderKind
  id: string
  number: string | null
  counterpartyName: string | null
  orderedAt: string | null
  status: string | null
}

const PURCHASE_ORDER_TABLE = 'purchasing_purchase_orders'
const SALES_ORDER_TABLE = 'sales_orders'

export const contractOrderKey = (kind: string, id: string) => `${kind}:${id}`

function snapshotName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const name = (snapshot as { name?: unknown }).name
  return typeof name === 'string' && name.trim().length > 0 ? name : null
}

function toIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Resolves each requested `(kind, id)` to its number, counterparty, date and status; ids outside
 * the caller's scope are left out on purpose — the caller turns a missing one into a 422 rather
 * than recording a dangling link.
 */
export async function loadContractOrderRefs(
  em: EntityManager,
  scope: TradeDocsScope,
  entries: Array<{ orderKind: ContractOrderKind; orderId: string }>,
): Promise<Map<string, ContractOrderRef>> {
  const db = em.fork().getKysely<any>()
  const resolved = new Map<string, ContractOrderRef>()

  const purchaseIds = entries.filter((entry) => entry.orderKind === 'purchase_order').map((entry) => entry.orderId)
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom(`${PURCHASE_ORDER_TABLE} as o`)
      .select([
        'o.id as id',
        'o.number as number',
        'o.status as status',
        'o.supplier_snapshot as counterparty_snapshot',
        'o.created_at as created_at',
      ])
      .where('o.id', 'in', purchaseIds)
      .where('o.tenant_id', '=', scope.tenantId)
      .where('o.organization_id', '=', scope.organizationId)
      .where('o.deleted_at', 'is', null)
      .execute()) as Array<{
        id: string
        number: string | null
        status: string | null
        counterparty_snapshot: unknown
        created_at: unknown
      }>
    for (const row of rows) {
      resolved.set(contractOrderKey('purchase_order', String(row.id)), {
        kind: 'purchase_order',
        id: String(row.id),
        number: row.number ?? null,
        counterpartyName: snapshotName(row.counterparty_snapshot),
        orderedAt: toIso(row.created_at),
        status: row.status ?? null,
      })
    }
  }

  const salesEntries = entries.filter((entry) => entry.orderKind !== 'purchase_order')
  const salesIds = salesEntries.map((entry) => entry.orderId)
  if (salesIds.length > 0) {
    // Both sales kinds live in the installed engine's `sales_orders`; the kind is the trade-type
    // label the operator picked and the row only records it.
    const rows = (await db
      .selectFrom(`${SALES_ORDER_TABLE} as o`)
      .select([
        'o.id as id',
        'o.order_number as number',
        'o.status as status',
        'o.customer_snapshot as counterparty_snapshot',
        'o.created_at as created_at',
      ])
      .where('o.id', 'in', salesIds)
      .where('o.tenant_id', '=', scope.tenantId)
      .where('o.organization_id', '=', scope.organizationId)
      .where('o.deleted_at', 'is', null)
      .execute()) as Array<{
        id: string
        number: string | null
        status: string | null
        counterparty_snapshot: unknown
        created_at: unknown
      }>
    for (const row of rows) {
      for (const kind of ['internal_sales_order', 'external_sales_order'] as const) {
        if (!salesEntries.some((entry) => entry.orderKind === kind && entry.orderId === String(row.id))) continue
        resolved.set(contractOrderKey(kind, String(row.id)), {
          kind,
          id: String(row.id),
          number: row.number ?? null,
          counterpartyName: snapshotName(row.counterparty_snapshot),
          orderedAt: toIso(row.created_at),
          status: row.status ?? null,
        })
      }
    }
  }

  return resolved
}
