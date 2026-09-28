import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Party, PartyRole } from '../../data/entities'
import { PARTY_ROLE_VALUES } from '../../data/validators'
import { partyOptionsOpenApi } from '../openapi'

const logger = createLogger('parties')

const MAX_OPTIONS = 50

/**
 * Role vocabulary lookup, derived from the validator-owned list so the two cannot drift.
 * A static string-keyed table (not a Set) — see the repo's `ts-set-map` rule.
 */
const PARTY_ROLE_LOOKUP: Record<string, true> = Object.fromEntries(
  PARTY_ROLE_VALUES.map((role) => [role, true]),
)

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['parties.view'] },
}

/**
 * Scoped option source for pickers.
 *
 * Three call shapes:
 *   - `?search=<term>` — type-ahead. Only `code` is filtered: the name and the contact block are
 *     encrypted, and a plaintext LIKE never matches ciphertext. Searching by name is Q-P-008 in
 *     `.ai/specs/2026-09-22-app-owned-party-master.md`.
 *   - `?ids=<uuid,uuid>` — resolves the labels of already-selected parties (an edit form has ids
 *     and needs display names).
 *   - `?roles=<role>[,<role>]` — narrows to parties holding **any** of the listed roles (the
 *     internal-sales buyer picker asks for `buyer`, so a group branch's printable record — role
 *     `branch` — does not show up twice, and forwarders/banks stay out). An
 *     unknown role name answers 400 rather than silently widening the list; the values are the
 *     same vocabulary the party form validates against. Combined with the shapes above by AND.
 *
 * Reads expand to the caller's readable organization set, matching every other read path in the app;
 * the rows themselves are decrypted through the framework helper because `name` is an encrypted
 * column.
 */
export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const requestedOrganizationId = (url.searchParams.get('organizationId') ?? '').trim()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const readableIds = organizationScope?.filterIds?.length
    ? organizationScope.filterIds
    : organizationScope?.selectedId
      ? [organizationScope.selectedId]
      : auth.orgId
        ? [auth.orgId]
        : []
  if (readableIds.length === 0) {
    return NextResponse.json({ error: 'Select an organization to access this resource', code: 'organization_scope_required' }, { status: 400 })
  }
  // Pickers narrow the read to the organization the operator is working in (the same rule every
  // other option source follows); reads otherwise expand to the caller's descendant organizations.
  const scopeIds = requestedOrganizationId.length > 0 && readableIds.includes(requestedOrganizationId)
    ? [requestedOrganizationId]
    : readableIds

  const search = (url.searchParams.get('search') ?? '').trim()
  const idsParam = (url.searchParams.get('ids') ?? '').trim()
  const requestedIds = idsParam
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const rolesParam = (url.searchParams.get('roles') ?? '').trim()
  const requestedRoles = rolesParam.length > 0
    ? [...new Set(rolesParam.split(',').map((value) => value.trim()).filter((value) => value.length > 0))]
    : []
  const unknownRoles = requestedRoles.filter((role) => PARTY_ROLE_LOOKUP[role] !== true)
  if (unknownRoles.length > 0) {
    return NextResponse.json({ error: `Unknown party role: ${unknownRoles.join(', ')}` }, { status: 400 })
  }

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: { $in: scopeIds },
    deletedAt: null,
  }
  if (requestedIds.length > 0) {
    where.id = { $in: requestedIds }
  } else if (search.length > 0) {
    where.code = { $ilike: `%${escapeLikePattern(search)}%` }
  }

  try {
    const em = container.resolve('em') as EntityManager
    if (requestedRoles.length > 0) {
      // `role` and the scope columns are plaintext, so the id set can come straight from the role
      // rows; the party read below still applies the encrypted-column helper and the same scope.
      const roleRows = await em.find(
        PartyRole,
        {
          tenantId: auth.tenantId,
          organizationId: { $in: scopeIds },
          role: { $in: requestedRoles },
        } as FilterQuery<PartyRole>,
      )
      // Dynamic membership over runtime rows — a Set, not a table.
      const roleHolderIds = new Set(roleRows.map((row) => String(row.party.id)))
      const explicitIds = (where.id as { $in: string[] } | undefined)?.$in
      const candidateIds = explicitIds
        ? explicitIds.filter((id) => roleHolderIds.has(id))
        : [...roleHolderIds]
      if (candidateIds.length === 0) {
        return NextResponse.json({ items: [] })
      }
      where.id = { $in: candidateIds }
    }
    const rows = await findWithDecryption(
      em,
      Party,
      where as FilterQuery<Party>,
      { orderBy: { code: 'asc' }, limit: MAX_OPTIONS },
      { tenantId: auth.tenantId, organizationId: scopeIds[0] },
    )
    const items = rows.map((row) => ({
      value: String(row.id),
      label: `${row.code} — ${row.name}`,
    }))
    return NextResponse.json({ items })
  } catch (err) {
    logger.error('Failed to resolve party options', { err })
    return NextResponse.json({ error: 'Could not load parties' }, { status: 500 })
  }
}

export const openApi = partyOptionsOpenApi
