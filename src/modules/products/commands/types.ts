import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'

/**
 * Trusted scope only. A command never reads tenant/organization from its payload — the record
 * belongs to the organization the caller is acting in, and a missing scope fails closed
 * instead of defaulting to something wider.
 */
export function ensureScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
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
