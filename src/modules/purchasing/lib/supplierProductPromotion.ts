import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { MAX_PRICE_ROWS, changedProductFields, mergePriceRows, type DesiredPriceRow } from '../../products/lib/supplierMapping'
import { PurchasingSupplierProduct } from '../data/entities'
import { supplierProductCrudEvents, supplierProductCrudIndexer, type PurchasingScope } from '../commands/shared'
import { supplierProductToProductFields } from './productMapping'
import { findProductBySku, loadProductPrices } from './productsReads'
import { findLatestQuotedPrice } from './quoteLineReads'
import { findBasePriceOfItem } from './supplierProductPrices'

/**
 * Syncing one supplier library row into the product master.
 *
 * This is the *only* bridge between the supplier-facing list and `products_products`, and it is
 * explicit by design: quoted-but-never-synced goods can be ordered (the order line freezes a
 * supplier snapshot) but cannot be received, because stock receipt is variant-level and only the
 * master carries the catalog link. Three properties make it safe to click twice:
 *
 * 1. **Idempotent** — a row that already carries `product_id` reports `skipped` and writes nothing.
 * 2. **Matching is by SKU, not by name** — a fuzzy match would silently merge two supplier items
 *    into one product; a SKU owned by a soft-deleted product is refused explicitly.
 * 3. **Non-destructive** — only non-empty, changed values reach `products.items.update`, and the
 *    price write submits the product's whole price set so the `internal`/`export` tiers survive.
 *
 * Every write goes through the products module's commands, because that is where the product's
 * events, query-index entries, audit rows and validation live.
 */

export type SupplierProductPromotionResult = {
  productId: string
  action: 'created' | 'updated' | 'skipped'
  /** True when the row quotes no price and no quotation ever did, so no `purchase` row was written. */
  priceSkipped: boolean
}

/** The command bus this path uses to call the products module's commands. */
export type CommandBusLike = {
  execute<TInput = Record<string, unknown>, TResult = unknown>(
    commandId: string,
    options: { input: TInput; ctx: CommandRuntimeContext },
  ): Promise<{ result: TResult }>
}

export async function promoteSupplierProduct(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: PurchasingScope
  de: DataEngine
  commandBus: CommandBusLike
  product: PurchasingSupplierProduct
}): Promise<SupplierProductPromotionResult> {
  const { product, scope } = input
  if (product.productId) {
    return { productId: product.productId, action: 'skipped', priceSkipped: false }
  }

  // The products commands read the optimistic-lock version from the request headers; the header on
  // this request belongs to the library row, so it must not be forwarded to a product write.
  const productContext: CommandRuntimeContext = {
    ...input.ctx,
    request: undefined,
    syncOrigin: 'purchasing:supplier-product-promote',
  }

  const fields = supplierProductToProductFields(product)
  const existing = await findProductBySku(input.em, scope, product.supplierSku)
  if (existing?.deletedAt) {
    throw new CrudHttpError(422, {
      error: `SKU ${product.supplierSku} belongs to a deleted product; restore it or change the supplier code to sync this item`,
      code: 'sku_belongs_to_deleted_product',
    })
  }

  let productId: string
  let action: SupplierProductPromotionResult['action']
  if (!existing) {
    if (!fields.name) throw new CrudHttpError(422, { error: 'Supplier product has no name', code: 'supplier_product_name_required' })
    const created = await input.commandBus.execute<Record<string, unknown>, { id: string }>('products.items.create', {
      input: {
        sku: product.supplierSku,
        name: fields.name,
        nameEn: fields.nameEn,
        specSummary: fields.specSummary,
        hsCode: fields.hsCode,
        unit: fields.unit ?? 'PCS',
        netWeight: fields.netWeight,
        dimensions: fields.dimensions,
        cartonQuantity: fields.cartonQuantity,
        cartonDimensions: fields.cartonDimensions,
        cartonGrossWeight: fields.cartonGrossWeight,
        cartonNetWeight: fields.cartonNetWeight,
        status: 'active',
      },
      ctx: productContext,
    })
    productId = String(created.result.id)
    action = 'created'
  } else {
    productId = existing.id
    const payload = changedProductFields(existing, fields)
    if (Object.keys(payload).length > 0) {
      await input.commandBus.execute('products.items.update', {
        input: { id: productId, ...payload },
        ctx: productContext,
      })
      action = 'updated'
    } else {
      action = 'skipped'
    }
  }

  let priceSkipped = false
  // The item's own price list wins over the newest quotation line: the buyer maintains it on the
  // library row, it is the price they last confirmed, and the quotation remains the document that
  // negotiated it. Falling back to the newest matching line keeps rows that never quoted a price
  // behaving exactly as before.
  const libraryPrice = await findBasePriceOfItem(input.em, scope, String(product.id), 'supplier_cost')
  const quoted = libraryPrice ? null : await findLatestQuotedPrice(input.em, scope, product.supplierId, product.supplierSku)

  let desired: DesiredPriceRow | null = null
  if (libraryPrice) {
    desired = {
      priceTier: 'purchase',
      currencyCode: libraryPrice.currencyCode,
      minQuantity: libraryPrice.minQuantity >= 1 ? libraryPrice.minQuantity : 1,
      unitPrice: libraryPrice.unitPrice,
      startsAt: null,
      endsAt: null,
      isActive: true,
    }
  } else if (quoted) {
    desired = {
      priceTier: 'purchase',
      currencyCode: quoted.currencyCode,
      minQuantity: quoted.minQuantity,
      unitPrice: quoted.unitPrice,
      startsAt: null,
      endsAt: null,
      isActive: true,
    }
    // The library row's own MOQ is the ladder step the buyer works with; it wins over the line's.
    if (product.moqQuantity && product.moqQuantity >= 1) desired.minQuantity = Math.round(product.moqQuantity)
  }

  if (!desired) {
    priceSkipped = true
  } else {
    const currentPrices = await loadProductPrices(input.em, scope, productId)
    const merged = mergePriceRows(currentPrices, desired)
    if (merged.rows.length > MAX_PRICE_ROWS) {
      throw new CrudHttpError(422, {
        error: `Product ${product.supplierSku} already has ${merged.rows.length} price rows; the price set cannot exceed ${MAX_PRICE_ROWS}`,
        code: 'too_many_price_rows',
      })
    }
    if (merged.changed) {
      await input.commandBus.execute('products.prices.replace', {
        input: { productId, rows: merged.rows },
        ctx: productContext,
      })
    }
  }

  const updated = await input.de.updateOrmEntity({
    entity: PurchasingSupplierProduct,
    where: { id: String(product.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
    apply: (entity) => {
      entity.productId = productId
    },
  })
  if (!updated) throw new CrudHttpError(404, { error: 'Supplier product not found', code: 'not_found' })
  await emitCrudSideEffects({
    dataEngine: input.de,
    action: 'updated',
    entity: updated,
    identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
    events: supplierProductCrudEvents,
    indexer: supplierProductCrudIndexer,
  })

  return { productId, action, priceSkipped }
}
