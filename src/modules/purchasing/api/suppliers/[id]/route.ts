import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PurchasingSupplier, PurchasingSupplierBankAccount } from '../../../data/entities'
import { purchasingErrorSchema, purchasingTag } from '../../openapi'

const logger = createLogger('purchasing')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchasing.suppliers.view'] },
}

/**
 * One supplier with its bank block.
 *
 * A dedicated read rather than the CRUD factory's list projection: the factory projects a single
 * table, the bank block must never travel with a list or an option source (it is the payment target),
 * and its columns are encrypted at rest — so the children are read through the framework decryption
 * helper with the same scope the caller may see.
 */
export async function GET(request: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id ?? ''
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid supplier id' }, { status: 400 })
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
    const supplier = await em.fork().findOne(PurchasingSupplier, {
      id,
      tenantId: auth.tenantId,
      organizationId: { $in: readableIds },
      deletedAt: null,
    } as FilterQuery<PurchasingSupplier>)
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

    const bankAccounts = await findWithDecryption(
      em.fork(),
      PurchasingSupplierBankAccount,
      {
        supplier: id,
        tenantId: auth.tenantId,
        organizationId: { $in: readableIds },
      } as FilterQuery<PurchasingSupplierBankAccount>,
      { orderBy: { createdAt: 'asc' } },
      { tenantId: auth.tenantId, organizationId: readableIds[0] },
    )

    return NextResponse.json({
      item: {
        id: String(supplier.id),
        code: supplier.code,
        name: supplier.name,
        contactName: supplier.contactName ?? null,
        phone: supplier.phone ?? null,
        email: supplier.email ?? null,
        address: supplier.address ?? null,
        defaultCurrencyCode: supplier.defaultCurrencyCode,
        brandValue: supplier.brandValue ?? null,
        isActive: supplier.isActive === true,
        notes: supplier.notes ?? null,
        bankAccounts: bankAccounts.map((row) => ({
          id: String(row.id),
          beneficiaryBank: row.beneficiaryBank,
          accountNumber: row.accountNumber,
          swiftCode: row.swiftCode ?? null,
          bankAddress: row.bankAddress ?? null,
          isDefault: row.isDefault === true,
        })),
        updatedAt: supplier.updatedAt instanceof Date ? supplier.updatedAt.toISOString() : null,
      },
    })
  } catch (err) {
    logger.error('Failed to load supplier', { err })
    return NextResponse.json({ error: 'Could not load the supplier' }, { status: 500 })
  }
}

export const supplierBankAccountSchema = z.object({
  id: z.string().uuid(),
  beneficiaryBank: z.string(),
  accountNumber: z.string(),
  swiftCode: z.string().nullable(),
  bankAddress: z.string().nullable(),
  isDefault: z.boolean(),
})

const supplierDetailSchema = z.object({
  item: z
    .object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      contactName: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      address: z.string().nullable(),
      defaultCurrencyCode: z.string(),
      brandValue: z.string().nullable(),
      isActive: z.boolean(),
      notes: z.string().nullable(),
      bankAccounts: z.array(supplierBankAccountSchema),
      updatedAt: z.string().nullable(),
    })
    .passthrough(),
})

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Supplier detail',
  methods: {
    GET: {
      summary: 'Read one supplier with its bank block',
      description:
        'Returns the supplier plus its bank accounts (decrypted through the framework helper). The bank block is deliberately absent from the list and option sources: it is the payment target, not browsing data.',
      tags: [purchasingTag],
      responses: [
        { status: 200, description: 'The supplier and its bank accounts.', schema: supplierDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid id or missing organization scope', schema: purchasingErrorSchema },
        { status: 401, description: 'Not authenticated', schema: purchasingErrorSchema },
        { status: 403, description: 'Missing purchasing.suppliers.view', schema: purchasingErrorSchema },
        { status: 404, description: 'Supplier not found in the readable scope', schema: purchasingErrorSchema },
      ],
    },
  },
}
