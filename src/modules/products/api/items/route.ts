import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { productCreateSchema, productListSchema, productUpdateSchema, productStatuses } from '../../data/validators'
import { listStoreProducts } from '../../lib/store'
import { executeProductCommand, resolveProductRouteScope } from '../../lib/routeSupport'

const logger = createLogger('products').child({ component: 'items-route' })

const productsTag = 'Products'

const productsErrorSchema = z.object({ error: z.string() }).passthrough()

const productListItemSchema = z
  .object({
    id: z.string().uuid(),
    sku: z.string(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    brand: z.string(),
    manufacturerModel: z.string().nullable().optional(),
    unit: z.string(),
    status: z.enum(productStatuses),
    containsLithiumBattery: z.boolean(),
    hsCode: z.string().nullable().optional(),
    countryOfOriginCode: z.string().nullable().optional(),
    /** Compatibility alias: the product id **is** the catalog product id. */
    catalogProductId: z.string().uuid(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
  POST: { requireAuth: true, requireFeatures: ['products.items.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['products.items.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['products.items.manage'] },
}

/**
 * The own-product library's API, backed by the installed catalog through `lib/store.ts`.
 *
 * The list is a scoped read of the catalog products of the caller's **selected** organization: the
 * store's read model is organization-private, so there is no descendant expansion and no
 * `organizationId` override — a picker can only offer a product the write commands would accept.
 * `sortField`/`sortDir` are part of the query contract for callers that send them, but the store's
 * read model decides the order (newest first); the projection is not ours to sort.
 *
 * `catalogProductId` is echoed on every item as a compatibility alias for the product id: a product
 * has no separate catalog link any more, and existing pickers/mappers read that field.
 */
export async function GET(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response
  const { em, tenantId, selectedOrganizationId } = resolved.scope

  const url = new URL(request.url)

  try {
    const parsed = productListSchema.parse(Object.fromEntries(url.searchParams.entries()))
    const { items, total } = await listStoreProducts({
      em,
      scope: { tenantId, organizationId: selectedOrganizationId },
      search: parsed.search ?? null,
      status: parsed.status,
      ids: parsed.ids?.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
      skus: parsed.skus?.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
      page: parsed.page,
      pageSize: parsed.pageSize,
    })
    return NextResponse.json({
      items: items.map((item) => ({ ...item, catalogProductId: item.id })),
      total,
      page: parsed.page,
      pageSize: parsed.pageSize,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to list products', { err: error })
    return NextResponse.json({ error: 'Could not load the products' }, { status: 500 })
  }
}

/** Create a product: catalog product + its variants (catalog's default variant when none are sent). */
export async function POST(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const created = await executeProductCommand<{ id?: string }>(
      resolved.scope,
      request,
      'products.items.create',
      body,
    )
    return NextResponse.json({ id: String(created.id ?? '') }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to create a product', { err: error })
    return NextResponse.json({ error: 'Could not create the product' }, { status: 500 })
  }
}

/** Update a product; the payload may carry the whole variant set (the store deletes the rows it omits). */
export async function PUT(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    await executeProductCommand(resolved.scope, request, 'products.items.update', body)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to update a product', { err: error })
    return NextResponse.json({ error: 'Could not update the product' }, { status: 500 })
  }
}

/** Delete a product (`?id=`); the catalog row is soft-deleted and its SKU stays occupied. */
export async function DELETE(request: Request) {
  const resolved = await resolveProductRouteScope(request)
  if (!resolved.ok) return resolved.response

  try {
    const url = new URL(request.url)
    await executeProductCommand(resolved.scope, request, 'products.items.delete', {
      query: { id: url.searchParams.get('id') ?? undefined },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to delete a product', { err: error })
    return NextResponse.json({ error: 'Could not delete the product' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: productsTag,
  summary: 'Product items',
  methods: {
    GET: {
      summary: 'List products',
      tags: [productsTag],
      query: productListSchema,
      responses: [
        {
          status: 200,
          description: 'Products of the selected organization.',
          schema: z.object({
            items: z.array(productListItemSchema),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Malformed query or missing organization scope', schema: productsErrorSchema },
        { status: 403, description: 'Missing products.items.view', schema: productsErrorSchema },
      ],
    },
    POST: {
      summary: 'Create a product',
      tags: [productsTag],
      requestBody: { schema: productCreateSchema },
      responses: [{ status: 201, description: 'The created catalog product id.', schema: z.object({ id: z.string() }) }],
      errors: [
        { status: 409, description: 'The SKU is already used in this organization', schema: productsErrorSchema },
        { status: 403, description: 'Missing products.items.manage', schema: productsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update a product',
      tags: [productsTag],
      requestBody: { schema: productUpdateSchema },
      responses: [{ status: 200, description: 'Updated.', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        { status: 409, description: 'SKU conflict or stale version (optimistic lock)', schema: productsErrorSchema },
        { status: 404, description: 'Product not found', schema: productsErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete a product',
      tags: [productsTag],
      responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        { status: 404, description: 'Product not found', schema: productsErrorSchema },
        { status: 409, description: 'Stale version (optimistic lock)', schema: productsErrorSchema },
      ],
    },
  },
}
