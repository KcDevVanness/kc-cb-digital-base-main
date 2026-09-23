import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import { TradeDocsContract, TradeDocsInvoice } from '../data/entities'

export type TradeDocsScope = { tenantId: string; organizationId: string }

/**
 * Trusted scope only. A command never reads tenant/organization from its payload — the document
 * belongs to the organization the caller is acting in, and a missing scope fails closed instead
 * of defaulting to something wider.
 */
export function ensureScope(ctx: CommandRuntimeContext): TradeDocsScope {
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

export function contractFilter(scope: TradeDocsScope, id: string): FilterQuery<TradeDocsContract> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<TradeDocsContract>
}

export function invoiceFilter(scope: TradeDocsScope, id: string): FilterQuery<TradeDocsInvoice> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<TradeDocsInvoice>
}

export async function loadContract(
  em: EntityManager,
  scope: TradeDocsScope,
  id: string,
): Promise<TradeDocsContract> {
  const contract = await em.fork().findOne(TradeDocsContract, contractFilter(scope, id))
  if (!contract) throw notFound('Contract not found')
  return contract
}

export async function loadInvoice(
  em: EntityManager,
  scope: TradeDocsScope,
  id: string,
): Promise<TradeDocsInvoice> {
  const invoice = await em.fork().findOne(TradeDocsInvoice, invoiceFilter(scope, id))
  if (!invoice) throw notFound('Invoice not found')
  return invoice
}
