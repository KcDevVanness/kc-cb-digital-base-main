import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

/**
 * Trusted request scope for this module's hand-written read routes.
 *
 * The `makeCrudRoute` surfaces get their scope from the ORM binding; the two projections and the
 * two anchor reads are plain handlers, so they derive it here and fail closed: no session → 401,
 * no resolvable organization → 400 with the platform's `organization_scope_required` code. A
 * caller's organization set is the directory-resolved filter set (a parent organization sees its
 * descendants), falling back to the session's own organization.
 */
export type RequestScope = {
  ok: true
  tenantId: string
  organizationIds: string[]
  em: EntityManager
}

export type RequestScopeFailure = {
  ok: false
  response: NextResponse
}

export async function resolveRequestScope(request: Request): Promise<RequestScope | RequestScopeFailure> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
    ? scope.filterIds
    : auth.orgId
      ? [auth.orgId]
      : []

  if (organizationIds.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Select an organization to access this resource',
          code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
        },
        { status: 400 },
      ),
    }
  }

  return {
    ok: true,
    tenantId: auth.tenantId,
    organizationIds,
    em: (container.resolve('em') as EntityManager).fork(),
  }
}
