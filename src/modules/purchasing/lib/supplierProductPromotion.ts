import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { MAX_PRICE_ROWS, changedProductFields, mergePriceRows, type DesiredPriceRow } from '../../products/lib/supplierMapping'
import { PurchasingSupplierProduct } from '../data/entities'
import { supplierProductCrudEvents, supplierProductCrudIndexer, type PurchasingScope } from '../commands/shared'
import { supplierProductToProductFields } from './productMapping'
import { findProductById, findProductBySku, loadProductPrices } from './productsReads'
import { findLatestQuotedPrice } from './quoteLineReads'
import { netUnitPrice } from './priceKinds'
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
 *
 * Two shapes reach this bridge, and they share every write leg below:
 * - `promoteSupplierProduct` — no master row yet: create or update **by SKU**, then link.
 * - `syncSupplierProductFields` — already linked: push the row's current values onto *that* product,
 *   so a name, spec or price corrected in the library does not stay stranded there.
 */

export type SupplierProductPromotionResult = {
  productId: string
  action: 'created' | 'updated' | 'skipped'
  /** True when the row quotes no price and no quotation ever did, so no `purchase` row was written. */
  priceSkipped: boolean
}

/** What one master write actually changed, so the caller can say so instead of "synced". */
export type SupplierProductMasterWriteResult = {
  /** The `products.items.update` payload's keys: empty when the master already matched the row. */
  fieldsChanged: string[]
  priceChanged: boolean
}

/** The command bus this path uses to call the products module's commands. */
export type CommandBusLike = {
  execute<TInput = Record<string, unknown>, TResult = unknown>(
    commandId: string,
    options: { input: TInput; ctx: CommandRuntimeContext },
  ): Promise<{ result: TResult }>
}

/**
 * The context a master write runs under.
 *
 * The products commands read the optimistic-lock version from the request headers; the header on
 * this request belongs to the library row, so it must not be forwarded to a product write.
 */
function productWriteContext(ctx: CommandRuntimeContext): CommandRuntimeContext {
  return { ...ctx, request: undefined, syncOrigin: 'purchasing:supplier-product-promote' }
}

/**
 * The price a promotion should write: the item's own price list wins over the newest quotation
 * line — the buyer maintains it on the library row, it is the price they last confirmed, and the
 * quotation remains the document that negotiated it. Falling back to the newest matching line keeps
 * rows that never quoted a price behaving exactly as before.
 *
 * Both branches are the **折后价** (`netUnitPrice`, `lib/priceKinds.ts`): the row's discount is a term
 * of the supply price, so whatever supply price the master receives, it receives it after the
 * discount. The `purchase` tier means "what we pay", and writing the undiscounted list price there
 * would overstate every downstream cost figure by the discount.
 */
async function resolveDesiredPurchasePrice(
  em: EntityManager,
  scope: PurchasingScope,
  product: PurchasingSupplierProduct,
): Promise<DesiredPriceRow | null> {
  const libraryPrice = await findBasePriceOfItem(em, scope, String(product.id), 'supplier_cost')
  const quoted = libraryPrice ? null : await findLatestQuotedPrice(em, scope, product.supplierId, product.supplierSku)
  const discountPercent = product.discountPercent ?? null

  if (libraryPrice) {
    return {
      priceTier: 'purchase',
      currencyCode: libraryPrice.currencyCode,
      minQuantity: libraryPrice.minQuantity >= 1 ? libraryPrice.minQuantity : 1,
      // `?? libraryPrice.unitPrice` only guards an unparseable amount: the master must still receive
      // the number the buyer stored rather than nothing at all.
      unitPrice: netUnitPrice(libraryPrice.unitPrice, discountPercent) ?? libraryPrice.unitPrice,
      startsAt: null,
      endsAt: null,
      isActive: true,
    }
  }
  if (!quoted) return null

  // The library row's own MOQ is the ladder step the buyer works with; it wins over the line's.
  const minQuantity =
    product.moqQuantity && product.moqQuantity >= 1 ? Math.round(product.moqQuantity) : quoted.minQuantity
  return {
    priceTier: 'purchase',
    currencyCode: quoted.currencyCode,
    minQuantity,
    unitPrice: netUnitPrice(quoted.unitPrice, discountPercent) ?? quoted.unitPrice,
    startsAt: null,
    endsAt: null,
    isActive: true,
  }
}

/**
 * Merge the row's `purchase` price into the product's price set, submitting the whole set so the
 * other tiers survive. Returns whether anything was written.
 */
async function mergePurchasePrice(input: {
  em: EntityManager
  scope: PurchasingScope
  commandBus: CommandBusLike
  productContext: CommandRuntimeContext
  product: PurchasingSupplierProduct
  productId: string
}): Promise<{ priceChanged: boolean; priceSkipped: boolean }> {
  const desired = await resolveDesiredPurchasePrice(input.em, input.scope, input.product)
  if (!desired) return { priceChanged: false, priceSkipped: true }

  const currentPrices = await loadProductPrices(input.em, input.scope, input.productId)
  const merged = mergePriceRows(currentPrices, desired)
  if (merged.rows.length > MAX_PRICE_ROWS) {
    throw new CrudHttpError(422, {
      error: `Product ${input.product.supplierSku} already has ${merged.rows.length} price rows; the price set cannot exceed ${MAX_PRICE_ROWS}`,
      code: 'too_many_price_rows',
    })
  }
  if (!merged.changed) return { priceChanged: false, priceSkipped: false }

  await input.commandBus.execute('products.prices.replace', {
    input: { productId: input.productId, rows: merged.rows },
    ctx: input.productContext,
  })
  return { priceChanged: true, priceSkipped: false }
}

/**
 * Write one already-linked library row's values onto its product.
 *
 * Non-destructive by construction: `changedProductFields` drops null/unchanged values, so a field
 * the row does not carry is never cleared, and the price leg submits the whole set so only the
 * `purchase` tier moves. The catalog link, the `internal`/`export` tiers and the variants are never
 * touched — the master owns them.
 *
 * A linked product that is gone (deleted, or not readable in this scope) is refused instead of
 * silently skipped: `product_id` is a scalar id with no foreign key, so this is a reachable state
 * and the operator needs to hear about it (the list flags it as 已关联的商品已删除).
 */
export async function applySupplierProductToMaster(input: {
  em: EntityManager
  scope: PurchasingScope
  commandBus: CommandBusLike
  ctx: CommandRuntimeContext
  product: PurchasingSupplierProduct
  productId: string
}): Promise<SupplierProductMasterWriteResult> {
  const existing = await findProductById(input.em, input.scope, input.productId, { includeDeleted: true })
  if (!existing) {
    throw new CrudHttpError(404, {
      error: `Linked product not found in this organization: ${input.productId}`,
      code: 'product_not_found',
    })
  }
  if (existing.deletedAt) {
    throw new CrudHttpError(422, {
      error: 'The linked product is deleted; re-link this row (换绑) or clear the link first',
      code: 'product_deleted',
    })
  }

  const productContext = productWriteContext(input.ctx)
  const fields = supplierProductToProductFields(input.product)
  const payload = changedProductFields(existing, fields)
  const fieldsChanged = Object.keys(payload)
  if (fieldsChanged.length > 0) {
    await input.commandBus.execute('products.items.update', {
      input: { id: input.productId, ...payload },
      ctx: productContext,
    })
  }

  const { priceChanged } = await mergePurchasePrice({
    em: input.em,
    scope: input.scope,
    commandBus: input.commandBus,
    productContext,
    product: input.product,
    productId: input.productId,
  })
  return { fieldsChanged, priceChanged }
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

  const productContext = productWriteContext(input.ctx)
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
        grossWeight: fields.grossWeight,
        volume: fields.volume,
        dimensions: fields.dimensions,
        cartonQuantity: fields.cartonQuantity,
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

  const { priceSkipped } = await mergePurchasePrice({
    em: input.em,
    scope,
    commandBus: input.commandBus,
    productContext,
    product,
    productId,
  })

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
