import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PRODUCT_PRICE_TIERS } from '../../lib/tiers'
import { listStorePrices } from '../../lib/store'
import { productPricesReplaceSchema } from '../../data/validators'
import { executeProductCommand, resolveProductRouteScope } from '../../lib/routeSupport'

const logger = createLogger('products').child({ component: 'prices-route' })

const productsTag = 'Products'

const productsErrorSchema = z.object({ error: z.string() }).passthrough()

const priceRowSchema = z.object({
  id: z.string().uuid(),
  tier: z.enum(PRODUCT_PRICE_TIERS),
  currencyCode: z.string(),
  minQuantity: z.number(),
  unitPrice: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  isActive: z.boolean(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
  PUT: { requireAuth: true, requireFeatures: ['products.prices.manage'] },
}

/**
 * A product's three-tier price set, read from and written to catalog.
 *
 * The rows are catalog price rows: `tier` is the price-kind code, and a row has no separate product
 * id because the request names the product. The write is a whole-set replace
 * (`products.prices.replace`): a tier that disappears from the payload is **closed**, never deleted,
 * so a contract snapshot can still explain where its price came from.
 *
 * There is deliberately no optimistic lock here: the payload is the complete desired state of the
 * product's price list, so a concurrent edit is resolved by the last submitted set rather than by
 * rejecting one of two edits with a version conflict.
 */
export async function GET(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response
  const { em, tenantId, selectedOrganizationId } = resolved.scope

  const productId = (new URL(request.url).searchParams.get('productId') ?? '').trim()
  if (!z.string().uuid().safeParse(productId).success) {
    return NextResponse.json({ error: 'A valid productId is required' }, { status: 400 })
  }

  try {
    const items = await listStorePrices({
      em,
      scope: { tenantId, organizationId: selectedOrganizationId },
      productId,
    })
    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Failed to load product prices', { err: error })
    return NextResponse.json({ error: 'Could not load the product prices' }, { status: 500 })
  }
}

/** Replace a product's whole price set; the command validates the currencies against the dictionary. */
export async function PUT(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    await executeProductCommand(resolved.scope, request, 'products.prices.replace', body)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to replace product prices', { err: error })
    return NextResponse.json({ error: 'Could not save the product prices' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product prices',
  methods: {
    GET: {
      summary: 'List one product’s price rows',
      tags: [productsTag],
      query: z.object({ productId: z.string().uuid() }),
      responses: [
        {
          status: 200,
          description: 'The product’s price rows.',
          schema: z.object({ items: z.array(priceRowSchema) }),
        },
      ],
      errors: [
        { status: 400, description: 'Missing or malformed productId', schema: productsErrorSchema },
        { status: 403, description: 'Missing products.items.view', schema: productsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Replace one product’s price set',
      tags: [productsTag],
      requestBody: { schema: productPricesReplaceSchema },
      responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        { status: 400, description: 'Duplicate row or currency outside the dictionary', schema: productsErrorSchema },
        { status: 404, description: 'Product not found', schema: productsErrorSchema },
      ],
    },
  },
}
