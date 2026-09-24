import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Party, PartyBankAccount, PartyRole } from '../../data/entities'
import { partiesErrorSchema, partiesTag } from '../openapi'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const logger = createLogger('parties')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['parties.view'] },
}

/**
 * One party with its aggregate: roles and the bank block.
 *
 * A dedicated read rather than the CRUD factory's list projection: the factory projects a single
 * table, and the edit form plus the detail page both need the child rows with them. Reads expand to
 * the caller's readable organizations and decrypt through the framework helper (the name and the
 * whole bank block are encrypted columns).
 */
export async function GET(request: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id ?? ''
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid party id' }, { status: 400 })
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
    const party = await findOneWithDecryption(
      em,
      Party,
      {
        id,
        tenantId: auth.tenantId,
        organizationId: { $in: readableIds },
        deletedAt: null,
      } as FilterQuery<Party>,
      undefined,
      scope,
    )
    if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

    const fork = em.fork()
    const [roles, bankAccounts] = await Promise.all([
      fork.find(PartyRole, {
        party: id,
        tenantId: auth.tenantId,
        organizationId: { $in: readableIds },
      } as FilterQuery<PartyRole>, { orderBy: { role: 'asc' } }),
      fork.find(PartyBankAccount, {
        party: id,
        tenantId: auth.tenantId,
        organizationId: { $in: readableIds },
      } as FilterQuery<PartyBankAccount>, { orderBy: { createdAt: 'asc' } }),
    ])

    return NextResponse.json({
      item: {
        id: String(party.id),
        code: party.code,
        name: party.name,
        countryCode: party.countryCode ?? null,
        status: party.status,
        contactName: party.contactName ?? null,
        contactPhone: party.contactPhone ?? null,
        email: party.email ?? null,
        addressLine1: party.addressLine1 ?? null,
        addressLine2: party.addressLine2 ?? null,
        city: party.city ?? null,
        roles: roles.map((row) => row.role),
        bankAccounts: bankAccounts.map((row) => ({
          id: String(row.id),
          beneficiaryBank: row.beneficiaryBank,
          accountNumber: row.accountNumber,
          swiftCode: row.swiftCode ?? null,
          bankAddress: row.bankAddress ?? null,
          isDefault: row.isDefault === true,
        })),
        updatedAt: party.updatedAt instanceof Date ? party.updatedAt.toISOString() : null,
      },
    })
  } catch (err) {
    logger.error('Failed to load party', { err })
    return NextResponse.json({ error: 'Could not load the party' }, { status: 500 })
  }
}

const partyDetailSchema = z.object({
  item: z
    .object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      countryCode: z.string().nullable(),
      status: z.string(),
      contactName: z.string().nullable(),
      contactPhone: z.string().nullable(),
      email: z.string().nullable(),
      addressLine1: z.string().nullable(),
      addressLine2: z.string().nullable(),
      city: z.string().nullable(),
      roles: z.array(z.string()),
      bankAccounts: z.array(
        z.object({
          id: z.string().uuid(),
          beneficiaryBank: z.string(),
          accountNumber: z.string(),
          swiftCode: z.string().nullable(),
          bankAddress: z.string().nullable(),
          isDefault: z.boolean(),
        }),
      ),
      updatedAt: z.string().nullable(),
    })
    .passthrough(),
})

export const openApi: OpenApiRouteDoc = {
  tag: partiesTag,
  summary: 'Party detail',
  methods: {
    GET: {
      summary: 'Get one party with its roles and bank accounts',
      description: 'Scoped read; encrypted fields are decrypted for the response.',
      tags: [partiesTag],
      responses: [
        { status: 200, description: 'The party aggregate.', schema: partyDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Malformed id or missing organization scope', schema: partiesErrorSchema },
        { status: 404, description: 'Party not found', schema: partiesErrorSchema },
      ],
    },
  },
}
