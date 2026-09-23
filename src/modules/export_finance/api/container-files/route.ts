import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { serializeExport, type CrudExportColumn } from '@open-mercato/shared/lib/crud/exporters'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SHIPMENT_MILESTONES, SHIPMENT_STATUSES } from '../../../cross_border/data/validators'
import {
  containerFileListSchema,
  EXPORT_FINANCE_TAX_REFUND_STATUSES,
} from '../../data/validators'
import {
  CONTAINER_EXPORT_CHECKLIST_KEYS,
  CONTAINER_REFUND_CHECKLIST_KEYS,
  loadContainerFiles,
  type ContainerFileRow,
} from '../../lib/containerFileProjection'
import { resolveRequestScope } from '../../lib/requestScope'
import { exportFinanceTag } from '../openapi'

export const metadata = {
  path: '/export_finance/container-files',
  requireAuth: true,
  requireFeatures: ['export_finance.cabinets.view'],
}

const logger = createLogger('export_finance').child({ component: 'container-files-route' })

const checklistSchema = z.object({
  so: z.boolean(),
  telexRelease: z.boolean(),
  customsDeclaration: z.boolean(),
  domesticFreight: z.boolean(),
  bookingCharges: z.boolean(),
  taxRefundPackage: z.boolean(),
  reportDraft: z.boolean(),
})

const containerFileItemSchema = z
  .object({
    shipmentId: z.string().uuid(),
    shipmentNumber: z.string().nullable(),
    shipmentStatus: z.enum(SHIPMENT_STATUSES),
    currentMilestone: z.enum(SHIPMENT_MILESTONES).nullable(),
    carrierName: z.string().nullable(),
    departurePort: z.string().nullable(),
    departedAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
    etd: z.string().nullable(),
    eta: z.string().nullable(),
    containerType: z.string().nullable(),
    containerNumber: z.string().nullable(),
    sealNumber: z.string().nullable(),
    bookingNumber: z.string().nullable(),
    orders: z.array(
      z.object({
        purchaseOrderId: z.string().uuid(),
        number: z.string().nullable(),
        businessNumber: z.string().nullable(),
        ownerName: z.string().nullable(),
        customerName: z.string().nullable(),
        total: z.string(),
        allocatedRefundAmount: z.string().nullable(),
        sharePercent: z.string().nullable(),
      }),
    ),
    taxRefundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES),
    taxRefundAmount: z.string().nullable(),
    taxRefundNote: z.string().nullable(),
    checklist: checklistSchema,
    checklistMissing: z.array(z.string()),
  })
  .passthrough()

type Translate = (key: string, fallback: string) => string

function checklistCounter(row: ContainerFileRow, keys: readonly string[]): string {
  const hits = keys.filter((key) => row.checklist[key as keyof ContainerFileRow['checklist']]).length
  return `${hits}/${keys.length}`
}

function containerColumns(translate: Translate): CrudExportColumn[] {
  return [
    { field: 'shipmentNumber', header: translate('export_finance.cabinets.csv.number', 'Container no.') },
    { field: 'containerType', header: translate('export_finance.cabinets.csv.containerType', 'Container type') },
    { field: 'containerNumber', header: translate('export_finance.cabinets.csv.containerNumber', 'Container no. (box)') },
    { field: 'sealNumber', header: translate('export_finance.cabinets.csv.sealNumber', 'Seal no.') },
    { field: 'bookingNumber', header: translate('export_finance.cabinets.csv.bookingNumber', 'Booking / B/L no.') },
    { field: 'shipmentStatus', header: translate('export_finance.cabinets.csv.status', 'Shipment status') },
    { field: 'currentMilestone', header: translate('export_finance.cabinets.csv.milestone', 'Latest milestone') },
    { field: 'departedAt', header: translate('export_finance.cabinets.csv.departedAt', 'Departed on') },
    { field: 'eta', header: translate('export_finance.cabinets.csv.eta', 'ETA') },
    { field: 'orders', header: translate('export_finance.cabinets.csv.orders', 'Orders in this container') },
    { field: 'taxRefundStatus', header: translate('export_finance.cabinets.csv.refundStatus', 'Tax refund status') },
    { field: 'taxRefundAmount', header: translate('export_finance.cabinets.csv.refundAmount', 'Tax refund amount') },
    { field: 'exportChecklist', header: translate('export_finance.cabinets.csv.exportChecklist', 'Export documents') },
    { field: 'refundChecklist', header: translate('export_finance.cabinets.csv.refundChecklist', 'Refund documents') },
  ]
}

function toCsvRow(row: ContainerFileRow, translate: Translate): Record<string, unknown> {
  return {
    shipmentNumber: row.shipmentNumber ?? '',
    containerType: row.containerType ?? '',
    containerNumber: row.containerNumber ?? '',
    sealNumber: row.sealNumber ?? '',
    bookingNumber: row.bookingNumber ?? '',
    shipmentStatus: translate(`cross_border.shipments.status.${row.shipmentStatus}`, row.shipmentStatus),
    currentMilestone: row.currentMilestone
      ? translate(`cross_border.shipments.milestones.${row.currentMilestone}`, row.currentMilestone)
      : '',
    departedAt: row.departedAt ?? '',
    eta: row.eta ?? '',
    orders: row.orders.map((order) => order.businessNumber ?? order.number ?? order.purchaseOrderId).join(' | '),
    taxRefundStatus: translate(`export_finance.refund.status.${row.taxRefundStatus}`, row.taxRefundStatus),
    taxRefundAmount: row.taxRefundAmount ?? '',
    exportChecklist: checklistCounter(row, CONTAINER_EXPORT_CHECKLIST_KEYS),
    refundChecklist: checklistCounter(row, CONTAINER_REFUND_CHECKLIST_KEYS),
  }
}

export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = containerFileListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadContainerFiles(scope.em, {
      tenantId: scope.tenantId,
      organizationIds: scope.organizationIds,
      filters: {
        shipmentId: query.shipmentId,
        status: query.status,
        taxRefundStatus: query.taxRefundStatus,
        search: query.search,
      },
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDir: query.sortDir,
    })

    if (query.format === 'csv') {
      const { translate } = await resolveTranslations()
      const serialized = serializeExport(
        { columns: containerColumns(translate), rows: result.items.map((row) => toCsvRow(row, translate)) },
        'csv',
      )
      return new Response(serialized.body, {
        status: 200,
        headers: {
          'content-type': serialized.contentType,
          'content-disposition': 'attachment; filename="container-files.csv"',
        },
      })
    }

    return NextResponse.json({
      items: result.items,
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to load the container file list', { err: error })
    return NextResponse.json({ error: 'Failed to load the container file list' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: exportFinanceTag,
  methods: {
    GET: {
      summary: 'List the 柜档案 (container file): container facts, orders with allocated refunds, and the refund application',
      tags: [exportFinanceTag],
      query: containerFileListSchema,
      responses: [
        {
          status: 200,
          description: 'Container file rows, or a CSV export when `format=csv`',
          schema: createPagedListResponseSchema(containerFileItemSchema, { paginationMetaOptional: true }),
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing export_finance.cabinets.view' },
      ],
    },
  },
}
