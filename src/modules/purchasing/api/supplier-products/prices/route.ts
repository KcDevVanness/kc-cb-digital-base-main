import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingSupplierProductPrice } from '../../../data/entities'
import { SUPPLIER_PRODUCT_PRICE_KINDS } from '../../../lib/priceKinds'
import {
  supplierProductPriceListSchema,
  supplierProductPricesReplaceSchema,
} from '../../../data/validators'
import { createPurchasingCrudOpenApi, purchasingOkSchema } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product_price' as const

const priceListItemSchema = z
  .object({
    id: z.string().uuid(),
    supplierProductId: z.string().uuid(),
    priceKind: z.enum(SUPPLIER_PRODUCT_PRICE_KINDS),
    currencyCode: z.string(),
    minQuantity: z.number(),
    unitPrice: z.string(),
    isActive: z.boolean(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type PriceListQuery = z.infer<typeof supplierProductPriceListSchema>

function supplierProductIdFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

/**
 * The price list of the supplier library.
 *
 * `PUT` submits an item's **whole** price set through `purchasing.supplier-products.replace-prices`:
 * a row that disappears is deactivated (never deleted), so a purchase order line's snapshot can
 * still explain where its price came from. There is deliberately no optimistic lock on this action
 * — the same decision the product master's price route documents: the payload is the complete
 * desired state, so refusing one of two complete submissions would only leave the operator unable
 * to save. The rows carry no per-row version, and the item's own version covers its scalars and
 * photo list, not its prices.
 */
export const { metadata, GET, PUT } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.view'] },
    PUT: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
  },
  orm: {
    entity: PurchasingSupplierProductPrice,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: supplierProductPriceListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'supplier_product_id',
      'price_kind',
      'currency_code',
      'min_quantity',
      'unit_price',
      'is_active',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      price_kind: 'price_kind',
      priceKind: 'price_kind',
      currency_code: 'currency_code',
      currencyCode: 'currency_code',
      min_quantity: 'min_quantity',
      minQuantity: 'min_quantity',
      created_at: 'created_at',
    },
    buildFilters: async (query: PriceListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.supplierProductId) filters.supplier_product_id = query.supplierProductId
      if (query.supplierProductIds) {
        filters.supplier_product_id = {
          $in: query.supplierProductIds
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        }
      }
      if (query.priceKind) filters.price_kind = query.priceKind
      if (query.currencyCode) filters.currency_code = query.currencyCode.toUpperCase()
      if (query.isActive !== undefined) filters.is_active = query.isActive
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      supplierProductId: supplierProductIdFrom(item.supplier_product_id) ?? String(item.supplier_product_id ?? ''),
      priceKind: String(item.price_kind ?? 'supplier_cost'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      minQuantity: Number(item.min_quantity ?? 1),
      unitPrice: String(item.unit_price ?? '0'),
      isActive: item.is_active === true,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    update: {
      commandId: 'purchasing.supplier-products.replace-prices',
      schema: supplierProductPricesReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Supplier Product Price',
  pluralName: 'Supplier Product Prices',
  querySchema: supplierProductPriceListSchema,
  listResponseSchema: createPagedListResponseSchema(priceListItemSchema, { paginationMetaOptional: true }),
  update: {
    schema: supplierProductPricesReplaceSchema,
    responseSchema: purchasingOkSchema,
    description:
      'Submits the item’s whole price set: one row per kind (`supplier_cost`, `company_offer`) × currency × minimum quantity. Rows missing from the payload are deactivated rather than deleted, a duplicate `(kind, currency, minQuantity)` key answers 400, and a currency that is not in the currency dictionary answers 422 `currency_not_in_dictionary`.',
  },
})
