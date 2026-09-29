import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeExport } from '@open-mercato/shared/lib/crud/exporters'
import { landedCostQuerySchema } from '../../data/validators'
import { loadLandedCostBySku, loadShipmentLandedCost, type LandedCostResult, type LandedCostSkuReport } from '../../lib/landedCost'
import { resolveRequestScope } from '../../lib/requestScope'
import { financeTag } from '../openapi'

const logger = createLogger('finance').child({ component: 'landed-costs-route' })

const LINE_EXPORT_COLUMNS = [
  { field: 'shipmentNumber', header: 'Container' },
  { field: 'purchaseOrder', header: 'Purchase order' },
  { field: 'lineNumber', header: 'Line' },
  { field: 'sku', header: 'SKU' },
  { field: 'quantity', header: 'Quantity' },
  { field: 'currencyCode', header: 'Currency' },
  { field: 'purchaseAmountOriginal', header: 'Purchase amount' },
  { field: 'purchaseAmountCny', header: 'Purchase CNY' },
  { field: 'allocatedCostCny', header: 'Allocated cost CNY' },
  { field: 'landedTotalCny', header: 'Landed total CNY' },
  { field: 'landedUnitCostCny', header: 'Landed unit CNY' },
  { field: 'rateMissing', header: 'Rate missing' },
] as const

const SKU_EXPORT_COLUMNS = [
  { field: 'sku', header: 'SKU' },
  { field: 'containers', header: 'Containers' },
  { field: 'quantity', header: 'Quantity' },
  { field: 'purchaseAmountCny', header: 'Purchase CNY' },
  { field: 'allocatedCostCny', header: 'Allocated cost CNY' },
  { field: 'landedTotalCny', header: 'Landed total CNY' },
  { field: 'landedUnitCostCny', header: 'Landed unit CNY' },
  { field: 'rateMissing', header: 'Rate missing' },
] as const

function csvResponse(base: string, columns: ReadonlyArray<{ field: string; header: string }>, rows: Array<Record<string, unknown>>): Response {
  const serialized = serializeExport({ columns: [...columns], rows }, 'csv')
  return new Response(serialized.body, {
    status: 200,
    headers: {
      'content-type': serialized.contentType,
      'content-disposition': `attachment; filename="${base}.csv"`,
    },
  })
}

/** One CSV row per purchase line — the same numbers the screen shows, source column included. */
function landedCostRows(result: LandedCostResult): Array<Record<string, unknown>> {
  return result.lines.map((line) => ({
    shipmentNumber: result.shipmentNumber ?? result.shipmentId,
    purchaseOrder: line.businessNumber ?? line.purchaseOrderNumber ?? line.purchaseOrderId,
    lineNumber: line.lineNumber,
    sku: line.sku ?? '',
    quantity: line.quantity,
    currencyCode: line.currencyCode,
    purchaseAmountOriginal: line.purchaseAmountOriginal,
    purchaseAmountCny: line.purchaseAmountCny ?? '',
    allocatedCostCny: line.allocatedCostCny,
    landedTotalCny: line.landedTotalCny ?? '',
    landedUnitCostCny: line.landedUnitCostCny ?? '',
    rateMissing: line.rateMissing ? 'yes' : 'no',
  }))
}

function skuReportRows(report: LandedCostSkuReport): Array<Record<string, unknown>> {
  return report.containers.map((container) => ({
    sku: report.sku,
    containers: container.shipmentNumber ?? container.shipmentId,
    quantity: container.quantity,
    purchaseAmountCny: container.purchaseAmountCny ?? '',
    allocatedCostCny: container.allocatedCostCny,
    landedTotalCny: container.landedTotalCny ?? '',
    landedUnitCostCny: container.landedUnitCostCny ?? '',
    rateMissing: container.rateMissing ? 'yes' : 'no',
  }))
}

const landedCostLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  purchaseOrderNumber: z.string().nullable(),
  businessNumber: z.string().nullable(),
  lineNumber: z.number(),
  productId: z.string().uuid().nullable(),
  productTitle: z.string().nullable(),
  sku: z.string().nullable(),
  currencyCode: z.string(),
  quantity: z.string(),
  purchaseAmountOriginal: z.string(),
  purchaseAmountCny: z.string().nullable(),
  allocatedCostCny: z.string(),
  landedTotalCny: z.string().nullable(),
  landedUnitCostCny: z.string().nullable(),
  rateMissing: z.boolean(),
})

const landedCostSkuRowSchema = z.object({
  sku: z.string().nullable(),
  quantity: z.string(),
  purchaseAmountCny: z.string().nullable(),
  allocatedCostCny: z.string(),
  landedTotalCny: z.string().nullable(),
  landedUnitCostCny: z.string().nullable(),
  rateMissing: z.boolean(),
  lineCount: z.number(),
})

const landedCostFeeSchema = z.object({
  id: z.string().uuid(),
  costType: z.string(),
  amount: z.string(),
  currencyCode: z.string(),
})

const landedCostResultSchema = z.object({
  shipmentId: z.string().uuid(),
  shipmentNumber: z.string().nullable(),
  lines: z.array(landedCostLineSchema),
  skuRows: z.array(landedCostSkuRowSchema),
  unconvertibleFees: z.array(landedCostFeeSchema),
  unallocatedFees: z.array(landedCostFeeSchema),
  totals: z.object({
    feesCny: z.string(),
    allocatedCny: z.string(),
    purchaseCny: z.string(),
    landedCny: z.string(),
    linesMissingRate: z.number(),
  }),
})

const landedCostSkuReportSchema = z.object({
  sku: z.string(),
  containers: z.array(
    z.object({
      shipmentId: z.string().uuid(),
      shipmentNumber: z.string().nullable(),
      quantity: z.string(),
      allocatedCostCny: z.string(),
      purchaseAmountCny: z.string().nullable(),
      landedTotalCny: z.string().nullable(),
      landedUnitCostCny: z.string().nullable(),
      rateMissing: z.boolean(),
    }),
  ),
  totals: z.object({
    quantity: z.string(),
    purchaseCny: z.string(),
    allocatedCny: z.string(),
    landedCny: z.string(),
    landedUnitCostCny: z.string().nullable(),
    linesMissingRate: z.number(),
  }),
  unconvertibleFees: z.array(
    landedCostFeeSchema.extend({ shipmentId: z.string().uuid(), shipmentNumber: z.string().nullable() }),
  ),
})

/**
 * 到岸成本 — the purchase value of a container plus its allocated fees, per purchase line and per
 * SKU. Derived per request: no allocation is stored, so editing a fee cannot leave a stale split.
 *
 * With `shipmentId` the answer is one container's lines; with `sku` it is every container that
 * carries the SKU plus the aggregate; with both, the container's lines narrowed to that SKU.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response
  const readScope = { tenantId: scope.tenantId, organizationIds: scope.organizationIds }

  try {
    const query = landedCostQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    if (!query.shipmentId && !query.sku) {
      return NextResponse.json({ error: 'Provide either shipmentId or sku' }, { status: 400 })
    }

    if (query.shipmentId) {
      const result = await loadShipmentLandedCost(scope.em, readScope, query.shipmentId)
      if (!result) return NextResponse.json({ result: null, report: null })
      if (!query.sku) {
        if (query.format === 'csv') return csvResponse('landed-costs', LINE_EXPORT_COLUMNS, landedCostRows(result))
        return NextResponse.json({ result, report: null })
      }

      const narrowed = {
        ...result,
        lines: result.lines.filter((line) => line.sku === query.sku),
        skuRows: result.skuRows.filter((row) => row.sku === query.sku),
      }
      if (query.format === 'csv') return csvResponse('landed-costs', LINE_EXPORT_COLUMNS, landedCostRows(narrowed))
      return NextResponse.json({ result: narrowed, report: null })
    }

    const report = await loadLandedCostBySku(scope.em, readScope, query.sku as string)
    if (query.format === 'csv') return csvResponse('landed-cost-by-sku', SKU_EXPORT_COLUMNS, report ? skuReportRows(report) : [])
    return NextResponse.json({ result: null, report })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to derive landed costs', { err: error })
    return NextResponse.json({ error: 'Failed to derive landed costs' }, { status: 500 })
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['finance.costs.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: financeTag,
  methods: {
    GET: {
      summary: 'Derive the landed cost of a container (or of one SKU across containers)',
      tags: [financeTag],
      query: landedCostQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'Per-container lines and SKU rollup, or the cross-container report for a SKU. Fees whose currency has no rate are reported as unconvertible and excluded from the allocation.',
          schema: z.object({ result: landedCostResultSchema.nullable(), report: landedCostSkuReportSchema.nullable() }),
        },
        { status: 400, description: 'Neither shipmentId nor sku was provided, or the query is invalid' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing finance.costs.view' },
      ],
    },
  },
}
