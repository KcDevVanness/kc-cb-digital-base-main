import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { NextResponse } from 'next/server'
import { SALES_TRADE_TYPES, isSalesTradeType } from './tradeType'
import { resolveTradeTypeChannelIds } from './tradeTypeChannelIds'

/**
 * Server-side resolution of the two trade-type channels for the caller's selected organization.
 *
 * The client cannot read `/api/sales/channels` itself: that route needs `sales.channels.view`, which
 * a branch operator creating sales documents does not necessarily hold. These routes are gated by the
 * document's own view feature and read the table through a scoped Kysely projection — a scalar read
 * of an installed peer table, the same pattern the app uses elsewhere. They never write: the channels
 * are seeded by `setup.ts`.
 *
 * The resolver itself lives in the HTTP-free `tradeTypeChannelIds.ts` so non-Next runtimes (the
 * order-hub backfill CLI) can reuse it without pulling `next/server` into their bundle; this module
 * re-exports it for the route layer.
 */
export { resolveTradeTypeChannelIds }
export type { TradeTypeChannelIdMap as TradeTypeChannelMap } from './tradeTypeChannelIds'

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
