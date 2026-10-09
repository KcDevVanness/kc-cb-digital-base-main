import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadCompanyOrderFields } from '../../../lib/companyOrderFields'
import { resolveOrderHubRequestScope } from '../../../lib/requestScope'
import { orderHubTag } from '../../openapi'

/**
 * The 「全字段」 read behind the workbench drawer and the hub: the 35-field summary of one company
 * order (REQ-017).
 *
 * A hand-written guarded read route (mirroring the `link-child` action route's metadata + `openApi`
 * shape): the projection is a plain handler, so it derives its trusted scope itself and returns an
 * **empty object** — never a 404 that would confirm a foreign id exists — when the root is not in
 * the caller's owner-or-collaborator scope.
 */

const logger = createLogger('order_hub').child({ component: 'fields-route' })

const amountSchema = z.object({
  currencyCode: z.string(),
  sales: z.string(),
  purchase: z.string(),
  deposit: z.string(),
  paid: z.string(),
  outstanding: z.string(),
})

const fieldsResponseSchema = z
  .object({
    order: z.object({
      number: z.string().nullable(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      orderDate: z.string().nullable(),
      etaDate: z.string().nullable(),
      childNumbers: z.array(z.string()),
    }),
    amounts: z.array(amountSchema),
    dates: z.object({
      orderedAt: z.string().nullable(),
      expectedDeliveryAt: z.string().nullable(),
      shippedAt: z.string().nullable(),
    }),
    documents: z.object({
      byKind: z.array(z.object({ kind: z.string(), numbers: z.array(z.string()) })),
      invoiceNumbers: z.array(z.string()),
    }),
    exportDocuments: z.array(
      z.object({
        docType: z.string(),
        count: z.number().int().nonnegative(),
        latestNumber: z.string().nullable(),
        latestHasAttachment: z.boolean(),
      }),
    ),
    purchaseFiles: z.object({ attachmentCount: z.number().int().nonnegative() }),
    collections: z.array(z.object({ status: z.string(), hasForeignIncomeCertificate: z.boolean() })),
    refunds: z.array(z.object({ currencyCode: z.string(), status: z.string(), amount: z.string().nullable() })),
    kcStamp: z.boolean(),
  })
  .partial()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
}

const fieldsQuerySchema = z.object({
  companyOrderId: z.string().uuid(),
})

export async function GET(request: Request) {
  const scope = await resolveOrderHubRequestScope(request)
  if (!scope.ok) return scope.response

  const url = new URL(request.url)
  const parsed = fieldsQuerySchema.safeParse({ companyOrderId: url.searchParams.get('companyOrderId') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: 'The companyOrderId parameter is required' }, { status: 400 })
  }

  try {
    const fields = await loadCompanyOrderFields(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      parsed.data.companyOrderId,
    )
    // An invisible root is an empty object, not a 404: the response must not confirm that a foreign
    // id exists.
    return NextResponse.json(fields ?? {})
  } catch (error) {
    logger.error('Failed to project the company order fields', { err: error })
    return NextResponse.json({ error: 'Failed to project the company order fields' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orderHubTag,
  summary: 'Company order full-field summary',
  methods: {
    GET: {
      summary: 'Project the 35-field summary of a company order',
      description:
        'Returns the money (grouped by currency), dates, document numbers, shipment export-document counts, purchase payment attachment count, collections/refunds and KC-stamp flag of one company order the caller may see. A root outside the caller’s owner-or-collaborator scope answers an empty object.',
      query: fieldsQuerySchema,
      responses: [
        { status: 200, description: 'The company order summary, or an empty object when not visible', schema: fieldsResponseSchema },
        { status: 400, description: 'Missing or malformed companyOrderId' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.view' },
      ],
    },
  },
}
