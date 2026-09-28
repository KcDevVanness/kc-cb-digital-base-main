"use client"

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The CNY rates a page needs, fetched once per page and shared by every amount on it.
 *
 * One request, not one per cell: the query key is stable across components and carries the organization
 * scope version, so switching organization refetches and every mounted `MoneyAmount` re-renders from the
 * same cache entry. The endpoint is read-only and answers only stored rates, so a missing rate is a
 * normal answer (`{}`), never an error a reader has to see — a 403 (no `currencies.view`) degrades the
 * same way, because an amount without its CNY line is still correct.
 */

export type CnyRateEntry = {
  currencyCode: string
  /** CNY per one unit of `currencyCode`. */
  rate: string
  date: string
  source: string
}

export type CnyRates = Record<string, CnyRateEntry>

export const CNY_RATES_URL = '/api/currency_policy/rates'

/** A stable empty value, so a render before the first answer does not change the object identity. */
const EMPTY_RATES: CnyRates = {}

export function useCnyRates(): { rates: CnyRates; isLoading: boolean } {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['cny-rates', scopeVersion],
    // Rates move once a day at most: a page re-render must not re-ask, and a stale cache is fine.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<CnyRates> => {
      const response = await apiCall<{ items?: CnyRateEntry[] }>(CNY_RATES_URL, { method: 'GET' }, { fallback: null })
      const items = response.ok ? response.result?.items ?? [] : []
      const rates: CnyRates = {}
      for (const entry of items) {
        if (!entry || typeof entry.currencyCode !== 'string') continue
        rates[entry.currencyCode.trim().toUpperCase()] = entry
      }
      return rates
    },
  })

  return { rates: query.data ?? EMPTY_RATES, isLoading: query.isLoading }
}
