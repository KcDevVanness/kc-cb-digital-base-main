import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { productDistributeSchema } from '../../../data/validators'
import { executeProductCommand, resolveProductRouteScope } from '../../../lib/routeSupport'
import type { DistributeProductsResult } from '../../../commands/distribution'

const logger = createLogger('products').child({ component: 'distribute-route' })

const productsTag = 'Products'

const productsErrorSchema = z.object({ error: z.string() }).passthrough()

const distributeResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      sku: z.string(),
      organizationId: z.string().uuid(),
      reason: z.enum(['sku_taken']),
    }),
  ),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['products.items.manage'] },
}

/**
 * Distribution action surface: `POST /api/products/items/distribute`
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`).
 *
 * The write itself lives in `products.items.distribute`; this route only declares the feature gate
 * and maps the command's result. Targets are validated again inside the command against the
 * caller's writable organization set.
 */
export async function POST(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const result = await executeProductCommand<DistributeProductsResult>(
      resolved.scope,
      request,
      'products.items.distribute',
      body,
    )
    // Not a resource creation: the call reports per-product outcomes, so the honest status is 200.
    return NextResponse.json(result ?? { created: 0, updated: 0, skipped: [] })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to distribute products', { err: error })
    return NextResponse.json({ error: 'Could not distribute the products' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product distribution',
  methods: {
    POST: {
      summary: 'Copy products into other organizations',
      tags: [productsTag],
      requestBody: { schema: productDistributeSchema },
      responses: [
        {
          status: 200,
          description: 'Per-product outcome of the distribution.',
          schema: distributeResultSchema,
        },
      ],
      errors: [
        { status: 400, description: 'No target other than the current organization', schema: productsErrorSchema },
        { status: 403, description: 'A target outside the caller’s writable organization set', schema: productsErrorSchema },
        { status: 404, description: 'One or more source products were not found', schema: productsErrorSchema },
      ],
    },
  },
}
