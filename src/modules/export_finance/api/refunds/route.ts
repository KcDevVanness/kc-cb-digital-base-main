import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ExportFinanceRefund } from '../../data/entities'
import { refundSaveSchema, EXPORT_FINANCE_TAX_REFUND_STATUSES } from '../../data/validators'
import { resolveRequestScope } from '../../lib/requestScope'
import { createExportFinanceCrudOpenApi, exportFinanceCreatedSchema } from '../openapi'

const ENTITY_ID = 'export_finance:export_finance_refund' as const

const logger = createLogger('export_finance').child({ component: 'refunds-route' })

const refundReadSchema = z.object({
  shipmentId: z.string().uuid(),
})

const refundItemSchema = z
  .object({
    id: z.string().uuid(),
    shipmentId: z.string().uuid(),
    shipmentNumber: z.string().nullable().optional(),
    currencyCode: z.string(),
    taxRefundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES),
    taxRefundAmount: z.string().nullable().optional(),
    taxRefundNote: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

function toIsoTimestamp(value: Date | null | undefined): string | null {
  if (!value) return null
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function toRefundItem(refund: ExportFinanceRefund) {
  return {
    id: String(refund.id),
    shipmentId: String(refund.shipmentId),
    shipmentNumber: refund.shipmentNumber ?? null,
    currencyCode: refund.currencyCode,
    taxRefundStatus: refund.taxRefundStatus,
    taxRefundAmount: refund.taxRefundAmount ?? null,
    taxRefundNote: refund.taxRefundNote ?? null,
    createdAt: toIsoTimestamp(refund.createdAt),
    updatedAt: toIsoTimestamp(refund.updatedAt),
  }
}

/**
 * One container's 出口退税档案, or `null` when finance has not registered one yet. The per-order
 * figures are deliberately absent here: they are derived by the container-file projection, which
 * is the only place that knows the container's order mix.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = refundReadSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const refund = await scope.em.findOne(ExportFinanceRefund, {
      tenantId: scope.tenantId,
      organizationId: { $in: scope.organizationIds },
      shipmentId: query.shipmentId,
      deletedAt: null,
    } as FilterQuery<ExportFinanceRefund>)
    return NextResponse.json({ item: refund ? toRefundItem(refund) : null })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to load the tax refund record', { err: error })
    return NextResponse.json({ error: 'Failed to load the tax refund record' }, { status: 500 })
  }
}

export const { PUT } = makeCrudRoute({
  metadata: {
    PUT: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
  },
  orm: {
    entity: ExportFinanceRefund,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: refundReadSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'shipment_id', 'tax_refund_status', 'tenant_id', 'organization_id'],
  },
  actions: {
    update: {
      commandId: 'export_finance.refunds.save',
      schema: refundSaveSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
    },
  },
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['export_finance.cabinets.view'] },
  PUT: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
}

export const openApi = createExportFinanceCrudOpenApi({
  resourceName: 'Tax Refund Record',
  pluralName: 'Tax Refund Records',
  querySchema: refundReadSchema,
  listResponseSchema: z.object({ item: refundItemSchema.nullable() }),
  update: {
    schema: refundSaveSchema,
    responseSchema: exportFinanceCreatedSchema,
    description:
      'Upserts the 出口退税档案 of one container; a shipment that is missing or cancelled is refused with 409.',
  },
})
