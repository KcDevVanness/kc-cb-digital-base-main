"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  flattenOrganizationNodes,
  parseOrganizationSwitcherScope,
} from '../../dictionaries/lib/dictionariesLibraryApi'

const ORGANIZATION_SWITCHER_API = '/api/directory/organization-switcher'
const QUERY_KEY_ROOT = 'products-organization-names'
const NO_NAMES: Record<string, string> = {}

/**
 * Organization id → display name, for labelling rows that can come from more than one organization.
 *
 * The source is the top-bar switcher's own payload: it already carries every organization the caller
 * may see, with names, and it is the same list the operator picks from — so a row labelled
 * 「俄罗斯 AB 有限公司」 names exactly the entry they would switch to. The parser is the dictionaries
 * module's (its library page groups rows by organization for the same reason), reused rather than
 * re-implemented so both pages read that payload the same way.
 */
export function useOrganizationNames(): (organizationId: string | null | undefined) => string | null {
  const scopeVersion = useOrganizationScopeVersion()
  const { data } = useQuery({
    queryKey: [QUERY_KEY_ROOT, scopeVersion],
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(ORGANIZATION_SWITCHER_API)
      if (!call.ok) return NO_NAMES
      const scope = parseOrganizationSwitcherScope(call.result)
      return Object.fromEntries(
        flattenOrganizationNodes(scope.organizations).map((node) => [node.id, node.name]),
      )
    },
  })

  const namesById = data ?? NO_NAMES
  return React.useCallback(
    (organizationId: string | null | undefined) =>
      (organizationId ? namesById[organizationId] : undefined) ?? null,
    [namesById],
  )
}
