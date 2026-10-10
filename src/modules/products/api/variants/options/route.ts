import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getStoreProduct, listStoreProducts, type StoreProduct, type StoreVariant } from '../../../lib/store'
import { resolveProductRouteScope } from '../../../lib/routeSupport'

const logger = createLogger('products').child({ component: 'variant-options-route' })

const productsTag = 'Products'

const productsErrorSchema = z.object({ error: z.string() }).passthrough()

const MAX_OPTIONS = 50

/** One page of the store's read model; the option walk never asks for more than the store caps at. */
const OPTION_PAGE_SIZE = 200

/**
 * How many pages the by-id walk may read before it gives up. An edit form resolves the labels of a
 * handful of SKUs it already holds, so the walk normally stops on its first page; the bound keeps a
 * stale id from turning one option read into a scan of the whole organization.
 */
const MAX_OPTION_PAGES = 10

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
}

/**
 * Whether a variant answers a type-ahead term.
 *
 * The store's read model searches products (SKU, title, legacy alias), not variants, so a term is
 * matched against the product a variant belongs to as well as against the variant's own code, name
 * and barcode: an operator typing a product name wants that product's SKUs.
 */
function matchesVariant(product: StoreProduct, variant: StoreVariant, term: string): boolean {
  if (term.length === 0) return true
  return [product.sku, product.name, variant.sku, variant.name ?? '', variant.barcode ?? ''].some((value) =>
    value.toLowerCase().includes(term),
  )
}

/**
 * Three call shapes, read through the product store:
 *   - `?search=<term>` — type-ahead over the products of the selected organization and their SKUs.
 *   - `?ids=<uuid,uuid>` — resolves the labels of already-selected SKUs, which an edit form has as
 *     ids but cannot display.
 *   - `?productId=<uuid>` — one product's SKUs.
 *
 * The store has no variant-by-id read, so the `ids` shape walks the organization's products page by
 * page until every requested variant has been matched (bounded; see `MAX_OPTION_PAGES`). A variant
 * whose product is gone is never offered, and the option value stays the variant id, which is the
 * id a document stores.
 */
export async function GET(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response
  const { em, tenantId, selectedOrganizationId } = resolved.scope
  const scope = { tenantId, organizationId: selectedOrganizationId }

  const url = new URL(request.url)
  const search = (url.searchParams.get('search') ?? '').trim()
  const productId = (url.searchParams.get('productId') ?? '').trim()
  if (productId.length > 0 && !z.string().uuid().safeParse(productId).success) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }
  const requestedIds = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  try {
    const products = await loadCandidateProducts({ em, scope, productId, requestedIds, search })
    const wanted = new Set(requestedIds)
    const term = search.toLowerCase()
    const items = products
      .flatMap((product) =>
        product.variants
          .filter((variant) => (wanted.size > 0 ? wanted.has(variant.id) : matchesVariant(product, variant, term)))
          .map((variant) => ({
            value: variant.id,
            label: variant.name ? `${product.name} · ${variant.sku} — ${variant.name}` : `${product.name} · ${variant.sku}`,
          })),
      )
      .slice(0, MAX_OPTIONS)
    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Failed to resolve product variant options', { err: error })
    return NextResponse.json({ error: 'Could not load the product variants' }, { status: 500 })
  }
}

async function loadCandidateProducts(input: {
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
  productId: string
  requestedIds: string[]
  search: string
}): Promise<StoreProduct[]> {
  const { em, scope, productId, requestedIds, search } = input
  if (productId.length > 0) {
    const product = await getStoreProduct({ em, scope, id: productId })
    return product ? [product] : []
  }

  const remaining = new Set(requestedIds)
  const products: StoreProduct[] = []
  let page = 1
  for (;;) {
    const { items, total } = await listStoreProducts({
      em,
      scope,
      // Ids win over the term, the same precedence the picker's call shapes have always had.
      search: remaining.size > 0 ? null : search || null,
      status: 'all',
      page,
      pageSize: OPTION_PAGE_SIZE,
    })
    for (const product of items) {
      products.push(product)
      for (const variant of product.variants) remaining.delete(variant.id)
    }
    if (remaining.size === 0 || items.length === 0 || products.length >= total || page >= MAX_OPTION_PAGES) {
      return products
    }
    page += 1
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product variant options',
  methods: {
    GET: {
      summary: 'List product variant options',
      tags: [productsTag],
      query: z.object({
        search: z.string().optional(),
        ids: z.string().optional(),
        productId: z.string().uuid().optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'Available product variant options.',
          schema: z.object({ items: z.array(z.object({ value: z.string(), label: z.string() })) }),
        },
      ],
      errors: [
        { status: 400, description: 'Malformed product id or missing organization scope', schema: productsErrorSchema },
        { status: 403, description: 'Missing products.items.view', schema: productsErrorSchema },
      ],
    },
  },
}
