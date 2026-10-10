import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getStoreProduct } from '../../../lib/store'
import { resolveProductRouteScope } from '../../../lib/routeSupport'

const logger = createLogger('products').child({ component: 'item-detail-route' })

const productsTag = 'Products'

const productsErrorSchema = z.object({ error: z.string() }).passthrough()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
}

const productDetailSchema = z.object({
  item: z
    .object({
      id: z.string().uuid(),
      sku: z.string(),
      name: z.string(),
      status: z.string(),
      /** Compatibility alias: the product id **is** the catalog product id. */
      catalogProductId: z.string().uuid(),
      variants: z.array(
        z.object({
          id: z.string().uuid(),
          sku: z.string(),
          name: z.string().nullable(),
          barcode: z.string().nullable(),
          isDefault: z.boolean(),
          isActive: z.boolean(),
          updatedAt: z.string().nullable(),
        }),
      ),
      updatedAt: z.string().nullable(),
    })
    .passthrough(),
})

/**
 * One product with the aggregate the product form edits: the catalog product plus its variants
 * (SKUs), read through `lib/store.ts`.
 *
 * A dedicated read rather than the list projection: the store's list already carries the variants,
 * but a form wants one row — with the `updatedAt` the optimistic lock compares against — without a
 * page of siblings around it.
 */
export async function GET(request: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id ?? ''
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response
  const { em, tenantId, selectedOrganizationId } = resolved.scope

  try {
    const product = await getStoreProduct({
      em,
      scope: { tenantId, organizationId: selectedOrganizationId },
      id,
    })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    return NextResponse.json({ item: { ...product, catalogProductId: product.id } })
  } catch (error) {
    logger.error('Failed to load a product', { err: error })
    return NextResponse.json({ error: 'Could not load the product' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product detail',
  methods: {
    GET: {
      summary: 'Get one product with its variants',
      tags: [productsTag],
      responses: [{ status: 200, description: 'The product aggregate.', schema: productDetailSchema }],
      errors: [
        { status: 400, description: 'Malformed id or missing organization scope', schema: productsErrorSchema },
        { status: 404, description: 'Product not found', schema: productsErrorSchema },
      ],
    },
  },
}
