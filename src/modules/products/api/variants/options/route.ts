import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ProductsProduct, ProductsVariant } from '../../../data/entities'
import { productsErrorSchema, productsTag } from '../../openapi'

const logger = createLogger('products')

const MAX_OPTIONS = 50

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
}

/**
 * Scoped option source for SKU pickers — the app-owned counterpart of the catalog variant picker.
 *
 * It exists before its consumer on purpose (REQ-V-004): the deferred wms round resolves a receipt's
 * variant from here, so that work becomes a consumer-only change instead of a second authoring pass.
 *
 * Three call shapes:
 *   - `?search=<term>` — type-ahead over the plaintext columns (`code`, `name`, `barcode`); a LIKE
 *     never matches ciphertext, and these columns are not encrypted.
 *   - `?ids=<uuid,uuid>` — resolves the labels of already-selected SKUs, which an edit form has as
 *     ids but cannot display.
 *   - `?productId=<uuid>` — narrows to one product's SKUs.
 *
 * Reads expand to the caller's readable organizations; an `organizationId` outside that set is
 * ignored rather than accepted, so the parameter can never widen what the caller may see. Variants
 * whose product is gone are left out: a picker must not offer a SKU of a deleted product, and the
 * label has no product name to show for it.
 */
export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const requestedOrganizationId = (url.searchParams.get('organizationId') ?? '').trim()
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
  // Pickers narrow the read to the organization the operator is working in (the same rule every
  // other option source follows); reads otherwise expand to the caller's descendant organizations.
  const scopeIds = requestedOrganizationId.length > 0 && readableIds.includes(requestedOrganizationId)
    ? [requestedOrganizationId]
    : readableIds

  const search = (url.searchParams.get('search') ?? '').trim()
  const productId = (url.searchParams.get('productId') ?? '').trim()
  const requestedIds = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: { $in: scopeIds },
    deletedAt: null,
    product: { tenantId: auth.tenantId, organizationId: { $in: scopeIds }, deletedAt: null },
  }
  if (productId.length > 0) {
    if (!z.string().uuid().safeParse(productId).success) {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
    }
    where.product = { id: productId, tenantId: auth.tenantId, organizationId: { $in: scopeIds }, deletedAt: null }
  }
  if (requestedIds.length > 0) {
    where.id = { $in: requestedIds }
  } else if (search.length > 0) {
    // Escaped LIKE on plaintext columns only; the escape keeps a typed `%` from widening the filter.
    const term = `%${escapeLikePattern(search)}%`
    where.$or = [{ code: { $ilike: term } }, { name: { $ilike: term } }, { barcode: { $ilike: term } }]
  }

  try {
    const em = container.resolve('em') as EntityManager
    const rows = await em.fork().find(
      ProductsVariant,
      where as FilterQuery<ProductsVariant>,
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' }, limit: MAX_OPTIONS },
    )

    const productIds = [...new Set(rows.map((row) => String(row.product.id)))].filter(
      (value) => value.length > 0,
    )
    const products = productIds.length
      ? await em.fork().find(ProductsProduct, {
          id: { $in: productIds },
          tenantId: auth.tenantId,
          organizationId: { $in: scopeIds },
          deletedAt: null,
        } as FilterQuery<ProductsProduct>)
      : []
    const productNames = new Map(products.map((product) => [String(product.id), product.name]))

    const items = rows.map((row) => {
      const productName = productNames.get(String(row.product.id))
      const sku = `${row.code} — ${row.name}`
      return { value: String(row.id), label: productName ? `${productName} · ${sku}` : sku }
    })
    return NextResponse.json({ items })
  } catch (err) {
    logger.error('Failed to resolve product variant options', { err })
    return NextResponse.json({ error: 'Could not load the product variants' }, { status: 500 })
  }
}

export const productVariantOptionsResponseSchema = z.object({
  items: z.array(z.object({ value: z.string(), label: z.string() })),
})

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product variant options',
  methods: {
    GET: {
      summary: 'List product variant options',
      description:
        'Scoped SKU option source for pickers: `<product name> · <variant code> — <variant name>`, filtered by code/name/barcode, by ids or by product.',
      tags: [productsTag],
      responses: [
        { status: 200, description: 'Available product variant options.', schema: productVariantOptionsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Malformed product id or missing organization scope', schema: productsErrorSchema },
        { status: 403, description: 'Missing products.items.view', schema: productsErrorSchema },
      ],
    },
  },
}
