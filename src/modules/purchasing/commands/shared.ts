import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { PurchasingSupplier, PurchasingSupplierProduct, PurchasingSupplierProductPrice } from '../data/entities'

/**
 * Shared helpers for the supplier product library commands.
 *
 * The library is the module's supplier-side goods list: a row per `(supplier, supplier_sku)` with
 * its price list. Everything here is module-internal — the ids match the platform's
 * `<module>:<snake_case class>` convention, which is what the query index and the CRUD factory
 * register.
 */
export const SUPPLIER_PRODUCT_ENTITY_ID = 'purchasing:purchasing_supplier_product' as const
export const SUPPLIER_PRODUCT_PRICE_ENTITY_ID = 'purchasing:purchasing_supplier_product_price' as const

export const SUPPLIER_PRODUCT_RESOURCE_KIND = 'purchasing.supplier_product' as const
export const SUPPLIER_PRODUCT_PRICE_RESOURCE_KIND = 'purchasing.supplier_product_price' as const

export type PurchasingScope = { tenantId: string; organizationId: string }

/**
 * Trusted scope only: tenant and organization come from the command context, never from the
 * payload, and a missing organization fails closed instead of defaulting to something wider.
 *
 * The missing-scope answer is 400 with the platform's own `ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE`
 * — the code the app answers with when an authenticated caller has no resolvable organization — so
 * the UI prompts for an organization instead of showing a generic failure. 400, never 401: the
 * session is valid.
 */
export function ensureScope(ctx: CommandRuntimeContext): PurchasingScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw badRequest('Tenant context is required')
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}

export function supplierProductFilter(scope: PurchasingScope, id: string): FilterQuery<PurchasingSupplierProduct> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PurchasingSupplierProduct>
}

export async function loadSupplierProduct(
  em: EntityManager,
  scope: PurchasingScope,
  id: string,
): Promise<PurchasingSupplierProduct> {
  const row = await em.fork().findOne(PurchasingSupplierProduct, supplierProductFilter(scope, id))
  if (!row) throw notFound('Supplier product not found')
  return row
}

/**
 * A supplier code is unique per supplier **including soft-deleted rows**, so every duplicate check
 * has to see them: without this the unique index answers with a 500 instead of a readable 409.
 */
export async function findSupplierProductBySku(
  em: EntityManager,
  scope: PurchasingScope,
  supplierId: string,
  supplierSku: string,
): Promise<PurchasingSupplierProduct | null> {
  return em.fork().findOne(PurchasingSupplierProduct, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    supplierId,
    supplierSku,
  } as FilterQuery<PurchasingSupplierProduct>)
}

export const supplierProductCrudEvents: CrudEventsConfig<PurchasingSupplierProduct> = {
  module: 'purchasing',
  entity: 'supplier_product',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<PurchasingSupplierProduct>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    supplierId: ctx.entity?.supplierId ?? null,
    supplierSku: ctx.entity?.supplierSku ?? null,
    status: ctx.entity?.status ?? null,
  }),
}

export const supplierProductCrudIndexer: CrudIndexerConfig<PurchasingSupplierProduct> = {
  entityType: SUPPLIER_PRODUCT_ENTITY_ID,
}

/**
 * The price list's own event. The payload names the item, the kind and the currency — never an
 * amount — because a subscriber needs to know *which* grid to refresh, not what the price is.
 */
export const supplierProductPriceCrudEvents: CrudEventsConfig<PurchasingSupplierProductPrice> = {
  module: 'purchasing',
  // Entity name is the event-id segment: `purchasing.supplier_product_prices.updated`.
  entity: 'supplier_product_prices',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<PurchasingSupplierProductPrice>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    supplierProductId: ctx.entity ? String(ctx.entity.supplierProduct.id) : null,
    priceKind: ctx.entity?.priceKind ?? null,
    currencyCode: ctx.entity?.currencyCode ?? null,
  }),
}

export const supplierProductPriceCrudIndexer: CrudIndexerConfig<PurchasingSupplierProductPrice> = {
  entityType: SUPPLIER_PRODUCT_PRICE_ENTITY_ID,
}

/**
 * The supplier's name for the row's snapshot. Same module, so this is a plain scoped read; the
 * snapshot exists so a later rename never rewrites what the library said at the time.
 */
export async function loadSupplierName(
  em: EntityManager,
  scope: PurchasingScope,
  supplierId: string,
): Promise<string | null> {
  const supplier = await em.fork().findOne(PurchasingSupplier, {
    id: supplierId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as FilterQuery<PurchasingSupplier>)
  return supplier?.name ?? null
}
