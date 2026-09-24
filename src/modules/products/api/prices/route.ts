import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { ProductsPrice } from '../../data/entities'
import { PRODUCT_PRICE_TIERS } from '../../lib/tiers'
import { productPriceListSchema, productPricesReplaceSchema } from '../../data/validators'
import { createProductsCrudOpenApi, productsOkSchema } from '../openapi'

const ENTITY_ID = 'products:products_price' as const

const priceListItemSchema = z
  .object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
    priceTier: z.enum(PRODUCT_PRICE_TIERS),
    currencyCode: z.string(),
    minQuantity: z.number(),
    unitPrice: z.string(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    isActive: z.boolean(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type PriceListQuery = z.infer<typeof productPriceListSchema>

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }
  return null
}

function productIdFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Price rows are read here and written through `products.prices.replace` (PUT), which submits a
 * product's whole price set: a tier that disappears from the payload is deactivated, never
 * deleted, so a contract snapshot can still explain where its price came from.
 *
 * There is deliberately no optimistic lock on this action: the payload is the complete desired
 * state of the product's price list, so a concurrent edit is resolved by the last submitted set
 * rather than by rejecting one of two edits with a version conflict — there is no per-row client
 * version to compare against, and refusing a complete submission would leave the operator
 * unable to save.
 */
export const { metadata, GET, PUT, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['products.items.view'] },
    PUT: { requireAuth: true, requireFeatures: ['products.prices.manage'] },
    POST: { requireAuth: true, requireFeatures: ['products.prices.manage'] },
  },
  orm: {
    entity: ProductsPrice,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: productPriceListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'product_id',
      'price_tier',
      'currency_code',
      'min_quantity',
      'unit_price',
      'starts_at',
      'ends_at',
      'is_active',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      price_tier: 'price_tier',
      priceTier: 'price_tier',
      currency_code: 'currency_code',
      currencyCode: 'currency_code',
      min_quantity: 'min_quantity',
      minQuantity: 'min_quantity',
      created_at: 'created_at',
    },
    buildFilters: async (query: PriceListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.productId) filters.product_id = query.productId
      if (query.priceTier) filters.price_tier = query.priceTier
      if (query.currencyCode) filters.currency_code = query.currencyCode.toUpperCase()
      if (query.isActive !== undefined) filters.is_active = query.isActive
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      productId: productIdFrom(item.product_id) ?? String(item.product_id ?? ''),
      priceTier: String(item.price_tier ?? 'purchase'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      minQuantity: Number(item.min_quantity ?? 1),
      unitPrice: String(item.unit_price ?? '0'),
      startsAt: toIsoDate(item.starts_at),
      endsAt: toIsoDate(item.ends_at),
      isActive: item.is_active === true,
      created_at: toIsoDate(item.created_at),
      updated_at: toIsoDate(item.updated_at),
    }),
  },
  actions: {
    update: {
      commandId: 'products.prices.replace',
      schema: productPricesReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    create: {
      commandId: 'products.prices.replace',
      schema: productPricesReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createProductsCrudOpenApi({
  resourceName: 'Product Price',
  pluralName: 'Product Prices',
  querySchema: productPriceListSchema,
  listResponseSchema: createPagedListResponseSchema(priceListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: productPricesReplaceSchema,
    responseSchema: productsOkSchema,
    description: 'Replaces a product’s whole price set (upsert by tier/currency/min quantity, missing rows deactivated).',
  },
  update: {
    schema: productPricesReplaceSchema,
    responseSchema: productsOkSchema,
    description: 'Replaces a product’s whole price set (upsert by tier/currency/min quantity, missing rows deactivated).',
  },
})
