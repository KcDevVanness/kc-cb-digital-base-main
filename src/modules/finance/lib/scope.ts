import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'

export type Scope = { tenantId: string; organizationId: string }

/**
 * The scope of a hand-written **read** route: the caller's organization set as the directory
 * resolved it (a parent organization sees its descendants), never a single id the payload named.
 * Commands stay on {@link Scope} — a write always lands in exactly the selected organization.
 */
export type ReadScope = { tenantId: string; organizationIds: string[] }

/**
 * The scope `currency_policy`'s rate lookup takes.
 *
 * Exchange rates are **organization-owned configuration** (`exchange_rates` carries
 * `organization_id`), so a rate read cannot span a set of organizations. This picks the caller's
 * first readable organization — the same choice `currency_policy/api/rates/route.ts` makes
 * (`readableIds[0]`) — rather than inventing an aggregate rate, and it stays deterministic for a
 * caller that reads exactly one organization, which is every write-side path here.
 */
export function rateScope(scope: ReadScope): { tenantId: string; organizationId: string } {
  return { tenantId: scope.tenantId, organizationId: scope.organizationIds[0] }
}

/**
 * Trusted scope only: tenant and organization come from the authenticated context, never from a
 * payload, and an unresolvable organization fails closed with the platform's
 * `organization_scope_required` code so the UI can prompt for an organization instead of showing a
 * generic failure.
 */
export function ensureScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw badRequest('Tenant context is required')
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}
