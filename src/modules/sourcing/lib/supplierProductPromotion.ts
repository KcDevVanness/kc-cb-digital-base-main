import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { SourcingQuote, SourcingQuoteLine, SourcingSupplierProduct } from '../data/entities'
import {
  supplierProductCrudEvents,
  supplierProductCrudIndexer,
  type SourcingScope,
} from '../commands/shared'
import {
  changedProductFields,
  desiredPriceRow,
  mergePriceRows,
  supplierProductToProductFields,
} from './productMapping'
import { findProductBySku, loadProductPrices } from './productsReads'
import { MAX_PRICE_ROWS, type CommandBusLike } from './promotion'

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
 */

export type SupplierProductPromotionResult = {
  productId: string
  action: 'created' | 'updated' | 'skipped'
  /** True when no matching quotation line existed, so no `purchase` price row was written. */
  priceSkipped: boolean
}

/**
 * The most recent quotation line that priced this supplier item.
 *
 * The library deliberately holds no price (purchasing Q-P-004): the `purchase` tier is fed from
 * the quotation that quoted the code, and a row synced without any quotation simply gets no price
 * row instead of a made-up one.
 */
async function findLatestQuotedLine(
  em: EntityManager,
  scope: SourcingScope,
  supplierId: string,
  supplierSku: string,
): Promise<SourcingQuoteLine | null> {
  return em.fork().findOne(
    SourcingQuoteLine,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      quote: { supplierId, deletedAt: null },
      $or: [{ derivedSku: supplierSku }, { itemNo: supplierSku }],
    } as FilterQuery<SourcingQuoteLine>,
    { populate: ['quote'], orderBy: { updatedAt: 'desc' } },
  )
}

export async function promoteSupplierProduct(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: SourcingScope
  de: DataEngine
  commandBus: CommandBusLike
  product: SourcingSupplierProduct
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
    syncOrigin: 'sourcing:supplier-product-promote',
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
  const quoted = await findLatestQuotedLine(input.em, scope, product.supplierId, product.supplierSku)
  if (!quoted) {
    priceSkipped = true
  } else {
    const quoteCurrency = (quoted.quote as SourcingQuote | undefined)?.currencyCode ?? 'CNY'
    const desired = desiredPriceRow(quoted, quoteCurrency)
    if (product.moqQuantity && product.moqQuantity >= 1) desired.minQuantity = Math.round(product.moqQuantity)
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
    entity: SourcingSupplierProduct,
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
