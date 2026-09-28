import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

/**
 * Trusted scope for a hand-written route.
 *
 * The CRUD factory derives scope from its `orm` keys, but the two read routes in this module (`parse`
 * and `sequences`) answer questions that are not "a page of rows", so they resolve scope themselves —
 * from the authenticated session and the organization the request selected, never from a query
 * parameter. A caller with no resolvable organization gets the same 400 the commands raise, so the UI
 * can prompt for an organization instead of showing a generic failure.
 */

export type RouteScope = { tenantId: string; organizationId: string }

export type RouteScopeResult =
  | { ok: true; scope: RouteScope }
  | { ok: false; status: number; error: string; code?: string }

export async function resolveRequestScope(request: Request): Promise<RouteScopeResult> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return { ok: false, status: 401, error: 'Unauthorized' }

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return {
      ok: false,
      status: 400,
      error: 'Select an organization to access this resource',
      code: 'organization_scope_required',
    }
  }
  return { ok: true, scope: { tenantId: auth.tenantId, organizationId } }
}
