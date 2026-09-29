import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeExport } from '@open-mercato/shared/lib/crud/exporters'
import { loadReceivables } from '../../lib/ledger'
import { resolveRequestScope } from '../../lib/requestScope'
import { financeTag } from '../openapi'

const logger = createLogger('finance').child({ component: 'receivables-route' })

const receivablesQuerySchema = z.object({
  kind: z.enum(['export_collection', 'platform_settlement', 'internal_sales']).optional(),
  format: z.enum(['json', 'csv']).optional(),
})

const receivableRowSchema = z.object({
  kind: z.enum(['export_collection', 'platform_settlement', 'internal_sales']),
  reference: z.string(),
  counterpartyName: z.string().nullable(),
  currencyCode: z.string(),
  amount: z.string().nullable(),
  receivedAmount: z.string(),
  outstandingAmount: z.string().nullable(),
  occurredAt: z.string().nullable(),
  status: z.string(),
})

const receivablesResultSchema = z.object({
  rows: z.array(receivableRowSchema),
  totalsByCurrency: z.array(
    z.object({
      currencyCode: z.string(),
      receivedAmount: z.string(),
      outstandingAmount: z.string().nullable(),
      rowCount: z.number(),
    }),
  ),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['finance.ledger.view'] },
}

/**
 * 应收台账 — export collections, platform settlements and internal sales orders in one row shape.
 * Whether money has arrived is judged by the receipt **date**, never by a status word, and the
 * totals stay per currency: three currencies are not one number.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = receivablesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadReceivables(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      { kind: query.kind },
    )

    if (query.format === 'csv') {
      const serialized = serializeExport(
        {
          columns: [
            { field: 'kind', header: 'Source' },
            { field: 'reference', header: 'Reference' },
            { field: 'counterpartyName', header: 'Counterparty' },
            { field: 'currencyCode', header: 'Currency' },
            { field: 'amount', header: 'Amount' },
            { field: 'receivedAmount', header: 'Received' },
            { field: 'outstandingAmount', header: 'Outstanding' },
            { field: 'occurredAt', header: 'Date' },
            { field: 'status', header: 'Status' },
          ],
          rows: result.rows.map((row) => ({
            kind: row.kind,
            reference: row.reference,
            counterpartyName: row.counterpartyName ?? '',
            currencyCode: row.currencyCode,
            amount: row.amount ?? '',
            receivedAmount: row.receivedAmount,
            outstandingAmount: row.outstandingAmount ?? '',
            occurredAt: row.occurredAt ?? '',
            status: row.status,
          })),
        },
        'csv',
      )
      return new Response(serialized.body, {
        status: 200,
        headers: {
          'content-type': serialized.contentType,
          'content-disposition': 'attachment; filename="receivables.csv"',
        },
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to derive the receivable ledger', { err: error })
    return NextResponse.json({ error: 'Failed to derive the receivable ledger' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: financeTag,
  methods: {
    GET: {
      summary: 'Derive the 应收台账 (receivables) over export collections, platform settlements and internal sales',
      tags: [financeTag],
      query: receivablesQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'Unified rows plus per-currency totals. A null amount means nobody recorded one; receipt is judged by the receipt date, not by a status field.',
          schema: receivablesResultSchema,
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing finance.ledger.view' },
      ],
    },
  },
}
