"use client"

import * as React from 'react'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
import { parseSelectedOrganizationCookie } from '@open-mercato/core/modules/directory/utils/scopeCookies'
import { subscribeOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export type SelectedOrganizationScope = {
  /**
   * The organization the operator is working in — the one every write lands in and that
   * organization-scoped reads narrow to. `null` while the scope is "all organizations".
   */
  organizationId: string | null
  /**
   * False only while the selection is genuinely unknown: no cookie and no scope event yet.
   * A surface that must not guess (a maintenance list, a picker feeding a write) waits instead
   * of rendering the tenant-wide answer, which would offer rows the write path rejects.
   */
  settled: boolean
}

/**
 * The selected organization, known from the first paint.
 *
 * `useOrganizationScopeDetail()` only carries the selection after the top-bar switcher's own request
 * resolves, so a surface gating on it alone would claim "no organization selected" for the first
 * frames of every load. The switcher's cookie holds the same value, is what the server reads per
 * request, and is readable synchronously, so it answers the first paint; the scope event — fired in
 * the same tick the cookie is written — then takes over for the rest of the session.
 *
 * The cookie is read in an effect rather than during render because it exists only in the browser:
 * reading it while rendering would make the client's first output differ from the server-rendered one.
 */
export function useSelectedOrganizationId(): SelectedOrganizationScope {
  const { organizationId: scopeOrganizationId, tenantId } = useOrganizationScopeDetail()
  const [cookieValue, setCookieValue] = React.useState<string | null>(null)

  React.useEffect(() => {
    setCookieValue(parseSelectedOrganizationCookie(document.cookie))
    return subscribeOrganizationScopeChanged(() => {
      setCookieValue(parseSelectedOrganizationCookie(document.cookie))
    })
  }, [])

  return React.useMemo<SelectedOrganizationScope>(() => {
    if (cookieValue !== null) {
      // `__all__` is a real selection ("all organizations"), not a missing one.
      return {
        organizationId: cookieValue === ALL_ORGANIZATIONS_COOKIE_VALUE ? null : cookieValue,
        settled: true,
      }
    }
    if (scopeOrganizationId) return { organizationId: scopeOrganizationId, settled: true }
    // No cookie: the switcher sets a tenant as it emits, so a null scope carrying a tenant is an
    // operator who chose "all organizations", while a null tenant means it has not answered yet.
    return { organizationId: null, settled: tenantId !== null }
  }, [cookieValue, scopeOrganizationId, tenantId])
}
