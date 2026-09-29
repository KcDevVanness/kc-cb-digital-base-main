import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SALES_TRADE_TYPES, type SalesTradeType } from './tradeType'

/**
 * The trade-type channel ids of the current organization, as the module's own route resolves them.
 *
 * The route (not `/api/sales/channels`) is the source because a branch operator creating documents
 * does not necessarily hold `sales.channels.view`; the module route is gated by the document's own
 * view feature. A missing entry means the organization has not been seeded yet — callers must block
 * the write with an actionable message rather than submit a document without a marker.
 */
export type TradeTypeChannelMap = Partial<Record<SalesTradeType, string | null>>

export async function loadTradeTypeChannelIds(
  kind: 'quote' | 'order',
  errorMessage: string,
): Promise<TradeTypeChannelMap> {
  const path = kind === 'quote'
    ? '/api/internal_sales/trade-type-channels/quotes'
    : '/api/internal_sales/trade-type-channels/orders'
  const payload = await readApiResultOrThrow<{ channels?: Record<string, unknown> }>(
    path,
    undefined,
    { errorMessage },
  )
  const channels = payload.channels ?? {}
  const result: TradeTypeChannelMap = {}
  for (const type of SALES_TRADE_TYPES) {
    const id = channels[type]
    result[type] = typeof id === 'string' && id.length > 0 ? id : null
  }
  return result
}

export type TradeTypeChannelsState = {
  channels: TradeTypeChannelMap
  isLoading: boolean
  /** Both channels exist; a save must be blocked while this is false. */
  hasAll: boolean
  missingMessage: string
}

/**
 * The organization's trade-type channels for a document kind, through the module's own route.
 *
 * Shared by the list (to filter) and the form (to write the marker), so both resolve the same ids
 * from one cache entry. A missing channel is an actionable state, never a silent one: a document
 * written without a marker would disappear from both filtered lists.
 */
export function useTradeTypeChannels(kind: 'quote' | 'order'): TradeTypeChannelsState {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['internal-sales-trade-type-channels', kind, scopeVersion],
    queryFn: () => loadTradeTypeChannelIds(kind, t('internal_sales.form.tradeType.channelsLoadFailed')),
    staleTime: 5 * 60 * 1000,
  })
  // Referentially stable while the query has no data: consumers put this map into effect
  // dependency arrays, and a fresh `{}` on every render would re-run their effects forever when the
  // request fails (React Query leaves `data` undefined on failure and during the first renders).
  const channels = React.useMemo(() => query.data ?? {}, [query.data])
  return {
    channels,
    isLoading: query.isLoading,
    hasAll: Boolean(channels.internal && channels.external),
    missingMessage: t(
      'internal_sales.form.tradeType.channelsMissing',
      'This organization has no trade-type channels yet. Ask an administrator to run: yarn mercato seed:defaults --module internal_sales',
    ),
  }
}
