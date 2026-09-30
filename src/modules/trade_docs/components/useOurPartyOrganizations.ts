"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { organizationChainEntries, type RelatedOrganizationNode } from '@/lib/orgs/organizationOptions'
import { parseOrganizationSwitcherScope } from '../../dictionaries/lib/dictionariesLibraryApi'

const ORGANIZATION_SWITCHER_URL = '/api/directory/organization-switcher'
const QUERY_KEY_ROOT = 'trade-docs-our-party-organizations'
const STALE_MS = 60_000

/**
 * The organizations a document's 我方主体 may name: every node the top-bar switcher payload carries —
 * the caller's own company, its ancestors as context and everything below it
 * (`organizationChainEntries`) — because our own side of a contract is a legal entity of ours, not a
 * counterparty. The same payload the top bar renders carries exactly the organizations the caller's
 * ACL grants, so no `directory.organizations.view` feature is needed here.
 *
 * A failed read yields no options; the picker then keeps whatever the form already holds instead of
 * offering a list it cannot vouch for.
 */
export function useOurPartyOrganizations(): {
  entries: Array<{ id: string; name: string }>
  failed: boolean
} {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: [QUERY_KEY_ROOT, scopeVersion],
    staleTime: STALE_MS,
    queryFn: async (): Promise<RelatedOrganizationNode[]> => {
      const call = await apiCall<Record<string, unknown>>(ORGANIZATION_SWITCHER_URL)
      if (!call.ok) return []
      return parseOrganizationSwitcherScope(call.result).organizations
    },
  })
  const entries = React.useMemo(() => organizationChainEntries(query.data ?? []), [query.data])
  return { entries, failed: query.isError }
}
