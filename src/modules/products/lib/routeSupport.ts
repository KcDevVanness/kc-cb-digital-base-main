import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'

/**
 * Shared plumbing for this module's hand-written routes.
 *
 * Two things every handler needs and neither belongs in a route file: the trusted request scope
 * (the product store reads and writes exactly one organization — the one the caller is acting in)
 * and a typed door to the command bus.
 *
 * Scope resolution fails closed: no session → 401, no resolvable organization → 400 with the
 * platform's `organization_scope_required` code. The writable organization set (`organizationIds`)
 * is derived the same way `makeCrudRoute` derives it, because a hand-written command route has to
 * hand the command the same guard input the CRUD factory would.
 */

export type ProductRouteScope = {
  container: AppContainer
  auth: NonNullable<AuthContext>
  organizationScope: OrganizationScope | null
  tenantId: string
  selectedOrganizationId: string
  organizationIds: string[] | null
  em: EntityManager
}

export type ProductRouteScopeResult = { ok: true; scope: ProductRouteScope } | { ok: false; response: NextResponse }

export async function resolveProductRouteScope(request: Request): Promise<ProductRouteScopeResult> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const selectedOrganizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!selectedOrganizationId) {
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

  // `null` means unrestricted (an actor with no ACL organization list); an empty array means the
  // caller may write nowhere. Mirrors the factory's derivation so the distribution command's
  // cross-organization guard sees the same set it would have seen through a CRUD route.
  const filterIds = Array.isArray(organizationScope?.filterIds)
    ? organizationScope.filterIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null
  let organizationIds: string[] | null
  if (!organizationScope) {
    organizationIds = [selectedOrganizationId]
  } else if (filterIds === null) {
    organizationIds = organizationScope.allowedIds === null ? null : [selectedOrganizationId]
  } else if (filterIds.length > 0) {
    organizationIds = [...new Set(filterIds)]
  } else {
    const allowedIds = organizationScope.allowedIds
    organizationIds =
      allowedIds === null || allowedIds.length === 0 || allowedIds.includes(selectedOrganizationId)
        ? [selectedOrganizationId]
        : []
  }

  return {
    ok: true,
    scope: {
      container,
      auth,
      organizationScope,
      tenantId: auth.tenantId,
      selectedOrganizationId,
      organizationIds,
      em: (container.resolve('em') as EntityManager).fork(),
    },
  }
}

type CommandBusLike = {
  execute<TResult>(
    commandId: string,
    options: { input: unknown; ctx: CommandRuntimeContext },
  ): Promise<{ result: TResult }>
}

/**
 * Dispatch one of the module's commands with the scope resolved above.
 *
 * The cast is the DI boundary: `container.resolve()` is untyped, so this is the one place that names
 * the slice of the bus the routes use (the CRUD factory does the same internally). The command's own
 * zod schema validates the input, and a rejected write arrives as a `CrudHttpError`.
 */
export async function executeProductCommand<TResult>(
  scope: ProductRouteScope,
  request: Request,
  commandId: string,
  input: unknown,
): Promise<TResult> {
  const bus = scope.container.resolve('commandBus') as CommandBusLike
  const { result } = await bus.execute<TResult>(commandId, {
    input,
    ctx: {
      container: scope.container,
      auth: scope.auth,
      organizationScope: scope.organizationScope,
      selectedOrganizationId: scope.selectedOrganizationId,
      organizationIds: scope.organizationIds,
      request,
    },
  })
  return result
}
