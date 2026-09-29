import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { ReadScope } from '../lib/readScope'

/**
 * Trusted request scope for this module's hand-written read routes (the mapping list and the health
 * view). No session → 401, no resolvable organization → 400 with the platform's
 * `organization_scope_required` code, exactly like the other app modules' read paths.
 */
export type RequestScope = { ok: true; em: EntityManager } & ReadScope

export type RequestScopeFailure = { ok: false; response: NextResponse }

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
