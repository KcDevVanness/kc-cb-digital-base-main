import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { serializeExport, type CrudExportColumn } from '@open-mercato/shared/lib/crud/exporters'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  EXPORT_FINANCE_COLLECTION_STATUSES,
  EXPORT_FINANCE_TAX_REFUND_STATUSES,
  ORDER_FILE_STATUSES,
  orderFileListSchema,
  type OrderFileView,
} from '../../data/validators'
import {
  loadOrderFiles,
  ORDER_EXPORT_CHECKLIST_KEYS,
  ORDER_PURCHASE_CHECKLIST_KEYS,
  type OrderFileRow,
} from '../../lib/orderFileProjection'
import { resolveRequestScope } from '../../lib/requestScope'
import { exportFinanceTag } from '../openapi'

export const metadata = {
  path: '/export_finance/order-files',
  requireAuth: true,
  requireFeatures: ['export_finance.orders.view'],
}

const logger = createLogger('export_finance').child({ component: 'order-files-route' })

const checklistSchema = z.object({
  supplierInvoice: z.boolean(),
  packingList: z.boolean(),
  purchasePaymentReceipt: z.boolean(),
  purchaseContract: z.boolean(),
  salesContract: z.boolean(),
  kcInvoiceStamped: z.boolean(),
  foreignIncomeCertificate: z.boolean(),
  so: z.boolean(),
  telexRelease: z.boolean(),
  customsDeclaration: z.boolean(),
  domesticFreight: z.boolean(),
  bookingCharges: z.boolean(),
})

const orderFileItemSchema = z
  .object({
    purchaseOrderId: z.string().uuid(),
    number: z.string().nullable(),
    businessNumber: z.string().nullable(),
    supplierName: z.string().nullable(),
    ownerName: z.string().nullable(),
    customerName: z.string().nullable(),
    productCategory: z.string().nullable(),
    businessStatus: z.enum(ORDER_FILE_STATUSES),
    placedAt: z.string().nullable(),
    expectedDeliveryAt: z.string().nullable(),
    shipmentEtd: z.string().nullable(),
    shipmentDepartedAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
    containerType: z.string().nullable(),
    containerNumber: z.string().nullable(),
    sealNumber: z.string().nullable(),
    bookingNumber: z.string().nullable(),
    shipmentCount: z.number(),
    finance: z.object({
      orderAmount: z.string(),
      depositPlanned: z.string().nullable(),
      balancePlanned: z.string().nullable(),
      paidAmount: z.string(),
      outstandingAmount: z.string(),
      kcPriceAmount: z.string().nullable(),
      kcPriceCurrency: z.string().nullable(),
      subsidiaryInvoiceAmount: z.string().nullable(),
      subsidiaryInvoiceCurrency: z.string().nullable(),
      exchangeRate: z.string().nullable(),
    }),
    collectionStatus: z.enum(EXPORT_FINANCE_COLLECTION_STATUSES),
    refundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES),
    allocatedRefundAmount: z.string().nullable(),
    containers: z.array(
      z.object({
        shipmentId: z.string().uuid(),
        shipmentNumber: z.string().nullable(),
        status: z.string(),
        currentMilestone: z.string().nullable(),
        containerNumber: z.string().nullable(),
        departedAt: z.string().nullable(),
        receivedAt: z.string().nullable(),
        taxRefundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES),
        taxRefundAmount: z.string().nullable(),
        taxRefundNote: z.string().nullable(),
      }),
    ),
    checklist: checklistSchema,
    checklistMissing: z.array(z.string()),
  })
  .passthrough()

type Translate = (key: string, fallback: string) => string

/** `n/7` style counter of one checklist class, for the CSV cells the screen shows as a badge. */
function checklistCounter(row: OrderFileRow, keys: readonly string[]): string {
  const hits = keys.filter((key) => row.checklist[key as keyof OrderFileRow['checklist']]).length
  return `${hits}/${keys.length}`
}

function businessColumns(translate: Translate): CrudExportColumn[] {
  return [
    { field: 'businessNumber', header: translate('export_finance.orders.csv.businessNumber', 'Business order no.') },
    { field: 'number', header: translate('export_finance.orders.csv.number', 'System order no.') },
    { field: 'supplierName', header: translate('export_finance.orders.csv.supplier', 'Supplier') },
    { field: 'customerName', header: translate('export_finance.orders.csv.customer', 'Customer') },
    { field: 'ownerName', header: translate('export_finance.orders.csv.owner', 'Purchaser') },
    { field: 'businessStatus', header: translate('export_finance.orders.csv.status', 'Order status') },
    { field: 'placedAt', header: translate('export_finance.orders.csv.placedAt', 'Ordered on') },
    { field: 'expectedDeliveryAt', header: translate('export_finance.orders.csv.expectedDeliveryAt', 'Expected delivery') },
    { field: 'shipmentDepartedAt', header: translate('export_finance.orders.csv.departedAt', 'Departed on') },
    { field: 'containerType', header: translate('export_finance.orders.csv.containerType', 'Container type') },
    { field: 'containerNumber', header: translate('export_finance.orders.csv.containerNumber', 'Container no.') },
    { field: 'sealNumber', header: translate('export_finance.orders.csv.sealNumber', 'Seal no.') },
    { field: 'bookingNumber', header: translate('export_finance.orders.csv.bookingNumber', 'Booking / B/L no.') },
    { field: 'purchaseChecklist', header: translate('export_finance.orders.csv.purchaseChecklist', 'Purchase & contract documents') },
    { field: 'exportChecklist', header: translate('export_finance.orders.csv.exportChecklist', 'Export documents') },
  ]
}

function financeColumns(translate: Translate): CrudExportColumn[] {
  return [
    { field: 'number', header: translate('export_finance.orders.csv.number', 'System order no.') },
    { field: 'businessNumber', header: translate('export_finance.orders.csv.businessNumber', 'Business order no.') },
    { field: 'orderAmount', header: translate('export_finance.orders.csv.orderAmount', 'Order amount') },
    { field: 'depositPlanned', header: translate('export_finance.orders.csv.depositPlanned', 'Deposit (planned)') },
    { field: 'balancePlanned', header: translate('export_finance.orders.csv.balancePlanned', 'Balance (planned)') },
    { field: 'paidAmount', header: translate('export_finance.orders.csv.paidAmount', 'Paid') },
    { field: 'outstandingAmount', header: translate('export_finance.orders.csv.outstandingAmount', 'Outstanding') },
    { field: 'kcPriceAmount', header: translate('export_finance.orders.csv.kcPrice', 'KC order price') },
    { field: 'subsidiaryInvoiceAmount', header: translate('export_finance.orders.csv.subsidiaryInvoice', 'Subsidiary invoice (USD)') },
    { field: 'collectionStatus', header: translate('export_finance.orders.csv.collectionStatus', 'Collection status') },
    { field: 'refundStatus', header: translate('export_finance.orders.csv.refundStatus', 'Tax refund status') },
    { field: 'allocatedRefundAmount', header: translate('export_finance.orders.csv.allocatedRefund', 'Allocated refund') },
    { field: 'containers', header: translate('export_finance.orders.csv.containers', 'Containers') },
  ]
}

function toCsvRow(row: OrderFileRow, view: OrderFileView, translate: Translate): Record<string, unknown> {
  const containers = row.containers
    .map((container) => [container.shipmentNumber ?? container.shipmentId, translate(`export_finance.refund.status.${container.taxRefundStatus}`, container.taxRefundStatus)].join(' · '))
    .join(' | ')
  const shared = {
    number: row.number ?? '',
    businessNumber: row.businessNumber ?? '',
    containers,
  }

  if (view === 'finance') {
    return {
      ...shared,
      orderAmount: row.finance.orderAmount,
      depositPlanned: row.finance.depositPlanned ?? '',
      balancePlanned: row.finance.balancePlanned ?? '',
      paidAmount: row.finance.paidAmount,
      outstandingAmount: row.finance.outstandingAmount,
      kcPriceAmount: row.finance.kcPriceAmount === null
        ? ''
        : `${row.finance.kcPriceAmount} ${row.finance.kcPriceCurrency ?? ''}`.trim(),
      subsidiaryInvoiceAmount: row.finance.subsidiaryInvoiceAmount === null
        ? ''
        : `${row.finance.subsidiaryInvoiceAmount} ${row.finance.subsidiaryInvoiceCurrency ?? ''}`.trim(),
      collectionStatus: translate(`export_finance.collection.status.${row.collectionStatus}`, row.collectionStatus),
      refundStatus: translate(`export_finance.refund.status.${row.refundStatus}`, row.refundStatus),
      allocatedRefundAmount: row.allocatedRefundAmount ?? '',
    }
  }

  return {
    ...shared,
    supplierName: row.supplierName ?? '',
    customerName: row.customerName ?? '',
    ownerName: row.ownerName ?? '',
    businessStatus: translate(`export_finance.orders.status.${row.businessStatus}`, row.businessStatus),
    placedAt: row.placedAt ?? '',
    expectedDeliveryAt: row.expectedDeliveryAt ?? '',
    shipmentDepartedAt: row.shipmentDepartedAt ?? '',
    containerType: row.containerType ?? '',
    containerNumber: row.containerNumber ?? '',
    sealNumber: row.sealNumber ?? '',
    bookingNumber: row.bookingNumber ?? '',
    purchaseChecklist: checklistCounter(row, ORDER_PURCHASE_CHECKLIST_KEYS),
    exportChecklist: checklistCounter(row, ORDER_EXPORT_CHECKLIST_KEYS),
  }
}

export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = orderFileListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadOrderFiles(scope.em, {
      tenantId: scope.tenantId,
      organizationIds: scope.organizationIds,
      filters: {
        purchaseOrderId: query.purchaseOrderId,
        status: query.status,
        collectionStatus: query.collectionStatus,
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
      const columns = query.view === 'finance' ? financeColumns(translate) : businessColumns(translate)
      const serialized = serializeExport(
        { columns, rows: result.items.map((row) => toCsvRow(row, query.view, translate)) },
        'csv',
      )
      return new Response(serialized.body, {
        status: 200,
        headers: {
          'content-type': serialized.contentType,
          'content-disposition': `attachment; filename="order-files-${query.view}.csv"`,
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
    logger.error('Failed to load the order file list', { err: error })
    return NextResponse.json({ error: 'Failed to load the order file list' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: exportFinanceTag,
  methods: {
    GET: {
      summary: 'List the 订单档案 (order file) in both the business and the finance view',
      tags: [exportFinanceTag],
      query: orderFileListSchema,
      responses: [
        {
          status: 200,
          description: 'Order file rows, or a CSV export when `format=csv`',
          schema: createPagedListResponseSchema(orderFileItemSchema, { paginationMetaOptional: true }),
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing export_finance.orders.view' },
      ],
    },
  },
}
