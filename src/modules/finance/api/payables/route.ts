import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeExport } from '@open-mercato/shared/lib/crud/exporters'
import { loadPayables } from '../../lib/ledger'
import { resolveRequestScope } from '../../lib/requestScope'
import { financeTag } from '../openapi'

const logger = createLogger('finance').child({ component: 'payables-route' })

const payablesQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  paymentStatus: z.enum(['unpaid', 'deposit_paid', 'partially_paid', 'paid']).optional(),
  format: z.enum(['json', 'csv']).optional(),
})

const payableRowSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  number: z.string().nullable(),
  businessNumber: z.string().nullable(),
  supplierId: z.string().uuid(),
  supplierName: z.string().nullable(),
  currencyCode: z.string(),
  orderTotal: z.string(),
  paidAmount: z.string(),
  outstandingAmount: z.string(),
  paymentStatus: z.enum(['unpaid', 'deposit_paid', 'partially_paid', 'paid']),
  placedAt: z.string().nullable(),
  expectedShipAt: z.string().nullable(),
  shipments: z.array(z.object({ number: z.string().nullable(), status: z.string() })),
})

const payablesResultSchema = z.object({
  rows: z.array(payableRowSchema),
  groups: z.array(
    z.object({
      supplierId: z.string().uuid(),
      supplierName: z.string().nullable(),
      currencyCode: z.string(),
      orderCount: z.number(),
      orderTotal: z.string(),
      paidAmount: z.string(),
      outstandingAmount: z.string(),
    }),
  ),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['finance.ledger.view'] },
}

/**
 * 应付台账 — one row per placed purchase order, with the payment state derived by `purchasing`'s
 * own `derivePaymentState`. Grouped per supplier **and currency**: amounts in different currencies
 * are never added together.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = payablesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadPayables(scope.em, { tenantId: scope.tenantId, organizationIds: scope.organizationIds }, {
      supplierId: query.supplierId,
      paymentStatus: query.paymentStatus,
    })

    if (query.format === 'csv') {
      const serialized = serializeExport(
        {
          columns: [
            { field: 'supplierName', header: 'Supplier' },
            { field: 'number', header: 'Purchase order' },
            { field: 'businessNumber', header: 'Business order no.' },
            { field: 'currencyCode', header: 'Currency' },
            { field: 'orderTotal', header: 'Order total' },
            { field: 'paidAmount', header: 'Paid' },
            { field: 'outstandingAmount', header: 'Outstanding' },
            { field: 'paymentStatus', header: 'Payment status' },
            { field: 'placedAt', header: 'Placed on' },
            { field: 'expectedShipAt', header: 'Expected ship on' },
          ],
          rows: result.rows.map((row) => ({
            supplierName: row.supplierName ?? '',
            number: row.number ?? '',
            businessNumber: row.businessNumber ?? '',
            currencyCode: row.currencyCode,
            orderTotal: row.orderTotal,
            paidAmount: row.paidAmount,
            outstandingAmount: row.outstandingAmount,
            paymentStatus: row.paymentStatus,
            placedAt: row.placedAt ?? '',
            expectedShipAt: row.expectedShipAt ?? '',
          })),
        },
        'csv',
      )
      return new Response(serialized.body, {
        status: 200,
        headers: {
          'content-type': serialized.contentType,
          'content-disposition': 'attachment; filename="payables.csv"',
        },
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to derive the payable ledger', { err: error })
    return NextResponse.json({ error: 'Failed to derive the payable ledger' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: financeTag,
  methods: {
    GET: {
      summary: 'Derive the 应付台账 (payables) per purchase order, grouped by supplier and currency',
      tags: [financeTag],
      query: payablesQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'One row per placed purchase order whose payment state comes from purchasing’s own derivation, plus per supplier+currency groups.',
          schema: payablesResultSchema,
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing finance.ledger.view' },
      ],
    },
  },
}
