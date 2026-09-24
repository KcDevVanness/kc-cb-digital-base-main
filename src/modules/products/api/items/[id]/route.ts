import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ProductsProduct, ProductsVariant } from '../../../data/entities'
import { PRODUCT_VARIANT_STATUSES } from '../../../data/validators'
import { serializeProduct } from '../../../commands/items'
import { productsErrorSchema, productsTag } from '../../openapi'

const logger = createLogger('products')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
}

/**
 * One product with the aggregate the product form edits: the header row plus its variants (SKUs).
 *
 * A dedicated read rather than the list projection: the CRUD factory projects a single table, and a
 * product's variants live in their own table — folding them into the list would make every page of
 * the list carry child rows no table column renders. Reads expand to the caller's readable
 * organizations, the same rule every other read path in the app follows.
 */
export async function GET(request: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id ?? ''
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const readableIds = organizationScope?.filterIds?.length
    ? organizationScope.filterIds
    : organizationScope?.selectedId
      ? [organizationScope.selectedId]
      : auth.orgId
        ? [auth.orgId]
        : []
  if (readableIds.length === 0) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  try {
    const em = container.resolve('em') as EntityManager
    const product = await em.fork().findOne(ProductsProduct, {
      id,
      tenantId: auth.tenantId,
      organizationId: { $in: readableIds },
      deletedAt: null,
    } as FilterQuery<ProductsProduct>)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const variants = await em.fork().find(
      ProductsVariant,
      { product: id, tenantId: auth.tenantId, organizationId: { $in: readableIds }, deletedAt: null } as FilterQuery<ProductsVariant>,
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
    )

    return NextResponse.json({
      item: {
        ...serializeProduct(product),
        // `CrudForm` derives its expected-version header from `initialValues.updatedAt`, so the detail
        // read must carry the lock version or the edit form would save without one — silently.
        updatedAt: product.updatedAt instanceof Date ? product.updatedAt.toISOString() : null,
        variants: variants.map((variant) => ({
          id: String(variant.id),
          code: variant.code,
          name: variant.name,
          barcode: variant.barcode ?? null,
          status: variant.status,
          isDefault: variant.isDefault === true,
          attributes: variant.attributes ?? null,
          sortOrder: variant.sortOrder,
        })),
      },
    })
  } catch (err) {
    logger.error('Failed to load product', { err })
    return NextResponse.json({ error: 'Could not load the product' }, { status: 500 })
  }
}

const productVariantItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  barcode: z.string().nullable(),
  status: z.enum(PRODUCT_VARIANT_STATUSES),
  isDefault: z.boolean(),
  attributes: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number(),
})

const productDetailSchema = z.object({
  item: z
    .object({
      id: z.string().uuid(),
      sku: z.string(),
      name: z.string(),
      status: z.string(),
      catalogProductId: z.string().nullable(),
      variants: z.array(productVariantItemSchema),
      updatedAt: z.string().nullable(),
    })
    .passthrough(),
})

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product detail',
  methods: {
    GET: {
      summary: 'Get one product with its variants',
      description: 'Scoped read: the product header plus every live variant (SKU) it carries.',
      tags: [productsTag],
      responses: [
        { status: 200, description: 'The product aggregate.', schema: productDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Malformed id or missing organization scope', schema: productsErrorSchema },
        { status: 404, description: 'Product not found', schema: productsErrorSchema },
      ],
    },
  },
}
