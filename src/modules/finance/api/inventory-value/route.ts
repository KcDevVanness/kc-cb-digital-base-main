import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeExport } from '@open-mercato/shared/lib/crud/exporters'
import { inventoryValueQuerySchema } from '../../data/validators'
import { loadInventoryValue } from '../../lib/costResolver'
import { resolveRequestScope } from '../../lib/requestScope'
import { financeTag } from '../openapi'

const logger = createLogger('finance').child({ component: 'inventory-value-route' })

const inventoryValueRowSchema = z.object({
  sku: z.string().nullable(),
  productId: z.string().uuid().nullable(),
  quantity: z.string(),
  unitCostCny: z.string().nullable(),
  valueCny: z.string().nullable(),
  source: z.enum(['landed', 'price_tier', 'missing']),
  landedUnitCostCny: z.string().nullable(),
  purchaseUnitCostCny: z.string().nullable(),
})

const inventoryValueResultSchema = z.object({
  asOf: z.string(),
  rows: z.array(inventoryValueRowSchema),
  totals: z.object({
    value: z.string(),
    missingQuantity: z.string(),
    unconvertible: z.array(
      z.object({
        sku: z.string().nullable(),
        productId: z.string().uuid().nullable(),
        currencyCode: z.string(),
        unitPrice: z.string(),
      }),
    ),
  }),
})

/**
 * 库存资金占用 — what the stock on hand is worth, with each SKU's cost resolved as *the latest
 * received container's landed unit cost*, else *the product's purchase price row*, else
 * *unpriced*. The two calibers are returned side by side (the decision on record is to show both),
 * and an unpriced row is reported with its quantity instead of being valued at an invented number.
 *
 * `wms` keeps no cost layer and no history, so the quantities are the current balances; `asOf` is
 * the label the caller asked the report to carry.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response
  const readScope = { tenantId: scope.tenantId, organizationIds: scope.organizationIds }

  try {
    const query = inventoryValueQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadInventoryValue(scope.em, readScope, {
      warehouseId: query.warehouseId,
      asOf: query.asOf,
    })
    if (query.format === 'csv') {
      const serialized = serializeExport(
        {
          columns: [
            { field: 'sku', header: 'SKU' },
            { field: 'quantity', header: 'Quantity' },
            { field: 'purchaseUnitCostCny', header: 'Purchase unit CNY' },
            { field: 'landedUnitCostCny', header: 'Landed unit CNY' },
            { field: 'unitCostCny', header: 'Valued unit CNY' },
            { field: 'valueCny', header: 'Value CNY' },
            { field: 'source', header: 'Source' },
          ],
          rows: result.rows.map((row) => ({
            sku: row.sku ?? '',
            quantity: row.quantity,
            purchaseUnitCostCny: row.purchaseUnitCostCny ?? '',
            landedUnitCostCny: row.landedUnitCostCny ?? '',
            unitCostCny: row.unitCostCny ?? '',
            valueCny: row.valueCny ?? '',
            source: row.source,
          })),
        },
        'csv',
      )
      return new Response(serialized.body, {
        status: 200,
        headers: {
          'content-type': serialized.contentType,
          'content-disposition': `attachment; filename="inventory-value-${result.asOf}.csv"`,
        },
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to derive the inventory value', { err: error })
    return NextResponse.json({ error: 'Failed to derive the inventory value' }, { status: 500 })
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['finance.ledger.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: financeTag,
  methods: {
    GET: {
      summary: 'Derive the inventory value of the organization (landed cost, else purchase price)',
      tags: [financeTag],
      query: inventoryValueQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'One row per SKU with both calibers and the resolving source; quantity that could not be priced is reported in totals.missingQuantity.',
          schema: inventoryValueResultSchema,
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing finance.ledger.view' },
      ],
    },
  },
}
