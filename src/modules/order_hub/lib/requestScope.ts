import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

/**
 * Trusted request scope for this module's hand-written read route.
 *
 * `makeCrudRoute` surfaces get their scope from the ORM binding; the stage projection is a plain
 * handler, so it derives the scope here and fails closed: no session → 401, no resolvable
 * organization → 400 with the platform's `organization_scope_required` code. The organization set is
 * the directory-resolved filter set (a parent organization sees its descendants), falling back to the
 * session's own organization.
 */
export type OrderHubRequestScope = {
  ok: true
  tenantId: string
  organizationIds: string[]
  em: EntityManager
}

export type OrderHubRequestScopeFailure = {
  ok: false
  response: NextResponse
}

export async function resolveOrderHubRequestScope(
  request: Request,
): Promise<OrderHubRequestScope | OrderHubRequestScopeFailure> {
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
