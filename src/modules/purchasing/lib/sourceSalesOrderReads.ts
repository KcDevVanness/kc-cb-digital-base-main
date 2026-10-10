import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PurchasingScope } from '../commands/shared'
import { SOURCE_KIND_BY_CHANNEL_CODE, type SourceSalesOrderKind } from './sourceSalesOrder'

/**
 * Scoped resolution of a purchase order's source sales order.
 *
 * A raw Kysely projection, like every other cross-module read in this app: the `purchasing` module
 * must not import `sales` entities, it needs four columns, and the query carries the same scope the
 * caller is acting in (tenant + organization + not soft-deleted). The channel join is what makes the
 * kind trustworthy — it is read from `sales_channels.code`, not from the caller.
 */

export type ResolvedSourceSalesOrder = {
  id: string
  kind: SourceSalesOrderKind
  number: string | null
}

type SourceOrderDbRow = {
  id: string
  order_number: string | null
  channel_code: string | null
}

/**
 * Returns the sales order the purchase order may point at, or `null` when it does not exist in the
 * caller's organization, is soft-deleted, or sits on a channel that is not one of the two trade-type
 * channels. `null` is a refusal: the caller turns it into a 422 rather than storing a dangling id.
 */
export async function resolveSourceSalesOrder(
  em: EntityManager,
  scope: PurchasingScope,
  salesOrderId: string,
): Promise<ResolvedSourceSalesOrder | null> {
  const rows = (await em
    .fork()
    .getKysely<any>()
    .selectFrom('sales_orders as o')
    .leftJoin('sales_channels as c', (join) =>
      join
        .onRef('c.id', '=', 'o.channel_id')
        .on('c.tenant_id', '=', scope.tenantId)
        .on('c.organization_id', '=', scope.organizationId),
    )
    .select(['o.id as id', 'o.order_number as order_number', 'c.code as channel_code'])
    .where('o.id', '=', salesOrderId)
    .where('o.tenant_id', '=', scope.tenantId)
    .where('o.organization_id', '=', scope.organizationId)
    .where('o.deleted_at', 'is', null)
    .limit(1)
    .execute()) as SourceOrderDbRow[]

  const row = rows[0]
  if (!row) return null
  const kind = row.channel_code ? SOURCE_KIND_BY_CHANNEL_CODE[row.channel_code] : undefined
  if (!kind) return null
  return {
    id: String(row.id),
    kind,
    number: row.order_number ?? null,
  }
}

/**
 * The same read, as a precondition: a write that names a source order refuses with 422
 * `source_sales_order_not_found` rather than storing a dangling id. Both refusal reasons — "no such
 * order in this organization" and "the order is not on a trade-type channel" — answer with the same
 * code on purpose: telling a caller *which* of the two it is would confirm the existence of another
 * organization's record.
 */
export async function requireSourceSalesOrder(
  em: EntityManager,
  scope: PurchasingScope,
  salesOrderId: string,
): Promise<ResolvedSourceSalesOrder> {
  const resolved = await resolveSourceSalesOrder(em, scope, salesOrderId)
  if (!resolved) {
    throw new CrudHttpError(422, {
      error: 'The source sales order was not found in this organization',
      code: 'source_sales_order_not_found',
    })
  }
  return resolved
}
