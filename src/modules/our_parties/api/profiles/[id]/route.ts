import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { OurPartyBankAccount, OurPartyProfile } from '../../../data/entities'
import { ourPartiesErrorSchema, ourPartyProfileDetailResponseSchema, ourPartiesTag } from '../../openapi'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const logger = createLogger('our_parties')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['our_parties.view'] },
}

/**
 * One profile with its bank block — the aggregate read.
 *
 * A dedicated read rather than the CRUD factory's list projection: the factory projects a single
 * table, and the edit form plus the trade-docs pickers need the child rows with it. Child rows are
 * encrypted columns, so they are read through the framework decryption helper with the caller's
 * readable organization set.
 */
export async function GET(request: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id ?? ''
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid profile id' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const readableIds = organizationScope?.filterIds?.length
    ? organizationScope.filterIds
    : organizationScope?.selectedId
      ? [organizationScope.selectedId]
      : auth.orgId
        ? [auth.orgId]
        : []
  if (readableIds.length === 0) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  try {
    const em = container.resolve('em') as EntityManager
    const scope = { tenantId: auth.tenantId, organizationId: readableIds[0] }
    const profile = await findOneWithDecryption(
      em,
      OurPartyProfile,
      {
        id,
        tenantId: auth.tenantId,
        organizationId: { $in: readableIds },
        deletedAt: null,
      } as FilterQuery<OurPartyProfile>,
      undefined,
      scope,
    )
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const bankAccounts = await findWithDecryption(
      em,
      OurPartyBankAccount,
      {
        profile: id,
        tenantId: auth.tenantId,
        organizationId: { $in: readableIds },
      } as FilterQuery<OurPartyBankAccount>,
      { orderBy: { createdAt: 'asc' } },
      scope,
    )

    return NextResponse.json({
      item: {
        id: String(profile.id),
        organizationId: String(profile.organizationId),
        addressLine1: profile.addressLine1 ?? null,
        addressLine2: profile.addressLine2 ?? null,
        city: profile.city ?? null,
        countryCode: profile.countryCode ?? null,
        contactName: profile.contactName ?? null,
        contactPhone: profile.contactPhone ?? null,
        email: profile.email ?? null,
        notes: profile.notes ?? null,
        bankAccounts: bankAccounts.map((row) => ({
          id: String(row.id),
          beneficiaryBank: row.beneficiaryBank,
          accountNumber: row.accountNumber,
          swiftCode: row.swiftCode ?? null,
          bankAddress: row.bankAddress ?? null,
          isDefault: row.isDefault === true,
        })),
        updatedAt: profile.updatedAt instanceof Date ? profile.updatedAt.toISOString() : null,
      },
    })
  } catch (err) {
    logger.error('Failed to load our-entity profile', { err })
    return NextResponse.json({ error: 'Could not load the profile' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ourPartiesTag,
  summary: 'Our-entity profile detail',
  methods: {
    GET: {
      summary: 'One our-entity profile with its bank block',
      tags: [ourPartiesTag],
      responses: [
        { status: 200, description: 'The profile.', schema: ourPartyProfileDetailResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Missing our_parties.view', schema: ourPartiesErrorSchema },
        { status: 404, description: 'Unknown profile or organization outside scope.', schema: ourPartiesErrorSchema },
      ],
    },
  },
}
