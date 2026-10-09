import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { SALES_TRADE_TYPES, TRADE_TYPE_CHANNEL_CODES, type SalesTradeType } from './tradeType'

/**
 * Server-side resolution of the two trade-type channel ids for one organization.
 *
 * Deliberately free of any HTTP/`next/server` import so CLI and worker processes (which do not run
 * under Next) can reuse the exact resolver the route handler uses. `tradeTypeChannels.server.ts`
 * re-exports it for the route layer; the order-hub backfill CLI imports it directly.
 */
export type TradeTypeChannelIdMap = Record<SalesTradeType, string | null>

// MikroORM types `getKysely()`'s DB generic as `never`; cast once to the columns this read touches
// (lesson `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
type ChannelReadTable = {
  sales_channels: {
    id: string
    code: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

export async function resolveTradeTypeChannelIds(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<TradeTypeChannelIdMap> {
  const codes = SALES_TRADE_TYPES.map((type) => TRADE_TYPE_CHANNEL_CODES[type])
  const rows = (await (em.fork().getKysely() as unknown as Kysely<ChannelReadTable>)
    .selectFrom('sales_channels')
    .select(['id', 'code'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('code', 'in', codes)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string; code: string | null }>
  const byCode = new Map(rows.map((row) => [row.code ?? '', String(row.id)]))
  const result: TradeTypeChannelIdMap = { internal: null, external: null }
  for (const type of SALES_TRADE_TYPES) {
    result[type] = byCode.get(TRADE_TYPE_CHANNEL_CODES[type]) ?? null
  }
  return result
}
