import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { NextResponse } from 'next/server'
import {
  SALES_TRADE_TYPES,
  TRADE_TYPE_CHANNEL_CODES,
  isSalesTradeType,
  type SalesTradeType,
} from './tradeType'

/**
 * Server-side resolution of the two trade-type channels for the caller's selected organization.
 *
 * The client cannot read `/api/sales/channels` itself: that route needs `sales.channels.view`, which
 * a branch operator creating sales documents does not necessarily hold. These routes are gated by the
 * document's own view feature and read the table through a scoped Kysely projection — a scalar read
 * of an installed peer table, the same pattern the app uses elsewhere. They never write: the channels
 * are seeded by `setup.ts`.
 */

export type TradeTypeChannelMap = Record<SalesTradeType, string | null>

export async function resolveTradeTypeChannelIds(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<TradeTypeChannelMap> {
  const codes = SALES_TRADE_TYPES.map((type) => TRADE_TYPE_CHANNEL_CODES[type])
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('sales_channels')
    .select(['id', 'code'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('code', 'in', codes)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string; code: string | null }>
  const byCode = new Map(rows.map((row) => [row.code ?? '', String(row.id)]))
  const result: TradeTypeChannelMap = { internal: null, external: null }
  for (const type of SALES_TRADE_TYPES) {
    result[type] = byCode.get(TRADE_TYPE_CHANNEL_CODES[type]) ?? null
  }
  return result
}

/** Shared handler for both kind-gated routes (`/trade-type-channels/quotes|orders`). */
export async function handleTradeTypeChannelsRequest(request: Request): Promise<Response> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = scope?.selectedId ?? scope?.filterIds?.[0] ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }
  const em = container.resolve('em') as EntityManager
  const channels = await resolveTradeTypeChannelIds(em, { tenantId: auth.tenantId, organizationId })
  return NextResponse.json({ organizationId, channels, missing: SALES_TRADE_TYPES.filter((type) => !channels[type]) })
}

export function isMissingChannelsPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('missing' in value)) return false
  const missing = value.missing
  return Array.isArray(missing) && missing.some((entry) => isSalesTradeType(entry))
}
