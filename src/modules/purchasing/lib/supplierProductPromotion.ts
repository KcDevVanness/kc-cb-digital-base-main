import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { MAX_PRICE_ROWS, changedProductFields } from '../../products/lib/supplierMapping'
import {
  createStoreProduct,
  findStoreProductBySku,
  getStoreProduct,
  listStorePrices,
  replaceStorePrices,
  updateStoreProduct,
  type StorePrice,
  type StorePriceInput,
  type StoreProduct,
  type StoreProductInput,
} from '../../products/lib/store'
import { PRICE_SCALE, toScaledUnits } from '../../trade_docs/lib/money'
import { PurchasingSupplierProduct } from '../data/entities'
import { supplierProductCrudEvents, supplierProductCrudIndexer, type PurchasingScope } from '../commands/shared'
import { storeDimensionsFromRecord, supplierProductToProductFields } from './productMapping'
import { findDeletedProductIdBySku, loadProductLiveness } from './productsReads'
import { findLatestQuotedPrice } from './quoteLineReads'
import { netUnitPrice } from './priceKinds'
import { findBasePriceOfItem } from './supplierProductPrices'

/**
 * Syncing one supplier library row into the catalog product store.
 *
 * This is the *only* bridge between the supplier-facing list and the one product store
 * (`catalog_products`), and it is explicit by design: quoted-but-never-promoted goods can be ordered
 * (the order line freezes a supplier snapshot) but cannot be received, because stock receipt is
 * variant-level and only the catalog product carries a variant. Three properties make it safe to
 * click twice:
 *
 * 1. **Idempotent** — a row that already carries `catalog_product_id` reports `skipped` and writes
 *    nothing.
 * 2. **Matching is by SKU, not by name** — a fuzzy match would silently merge two supplier items
 *    into one product; a SKU owned by a soft-deleted product is refused explicitly.
 * 3. **Non-destructive** — only non-empty, changed values reach the store's update, and the price
 *    write submits the product's whole three-tier set so the `internal`/`export` tiers survive.
 *
 * Every write goes through the store (`createStoreProduct` / `updateStoreProduct` /
 * `replaceStorePrices`), which routes it through the catalog's own commands — that is where the
 * product's events, query-index entries, audit rows and validation live.
 *
 * Two shapes reach this bridge, and they share every write leg below:
 * - `promoteSupplierProduct` — no catalog product yet: create or update **by SKU**, then link.
 * - `applySupplierProductToMaster` — already linked: push the row's current values onto *that*
 *   product, so a name, spec or price corrected in the library does not stay stranded there.
 */

export type SupplierProductPromotionResult = {
  catalogProductId: string
  action: 'created' | 'updated' | 'skipped'
  /** True when the row quotes no price and no quotation ever did, so no `purchase` row was written. */
  priceSkipped: boolean
}

/** What one store write actually changed, so the caller can say so instead of "synced". */
export type SupplierProductMasterWriteResult = {
  /** The changed product-field keys: empty when the store already matched the row. */
  fieldsChanged: string[]
  priceChanged: boolean
}

/**
 * The price a promotion should write: the item's own price list wins over the newest quotation
 * line — the buyer maintains it on the library row, it is the price they last confirmed, and the
 * quotation remains the document that negotiated it. Falling back to the newest matching line keeps
 * rows that never quoted a price behaving exactly as before.
 *
 * Both branches are the **折后价** (`netUnitPrice`, `lib/priceKinds.ts`): the row's discount is a term
 * of the supply price, so whatever supply price the store receives, it receives it after the
 * discount. The `purchase` tier means "what we pay", and writing the undiscounted list price there
 * would overstate every downstream cost figure by the discount.
 */
async function resolveDesiredPurchasePrice(
  em: EntityManager,
  scope: PurchasingScope,
  product: PurchasingSupplierProduct,
): Promise<StorePriceInput | null> {
  const libraryPrice = await findBasePriceOfItem(em, scope, String(product.id), 'supplier_cost')
  const quoted = libraryPrice ? null : await findLatestQuotedPrice(em, scope, product.supplierId, product.supplierSku)
  const discountPercent = product.discountPercent ?? null

  if (libraryPrice) {
    return {
      tier: 'purchase',
      currencyCode: libraryPrice.currencyCode,
      minQuantity: libraryPrice.minQuantity >= 1 ? libraryPrice.minQuantity : 1,
      // `?? libraryPrice.unitPrice` only guards an unparseable amount: the store must still receive
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
    tier: 'purchase',
    currencyCode: quoted.currencyCode,
    minQuantity,
    unitPrice: netUnitPrice(quoted.unitPrice, discountPercent) ?? quoted.unitPrice,
    startsAt: null,
    endsAt: null,
    isActive: true,
  }
}

/**
 * Merge the desired `purchase` row into the product's current three-tier price set.
 *
 * `replaceStorePrices` closes every tier row the payload omits, so the payload has to carry the
 * rows we want to keep — the active `internal`/`export` rows (and any other active `purchase`
 * ladder step) — next to the desired row. Already-closed rows are left alone: they are history, not
 * part of the current set. Returns whether anything actually changed, so the caller can skip the
 * command when the price already matches.
 */
function buildPriceSet(
  existing: readonly StorePrice[],
  desired: StorePriceInput,
): { rows: StorePriceInput[]; changed: boolean } {
  const desiredKey = `${desired.tier}|${desired.currencyCode.toUpperCase()}|${desired.minQuantity}`
  const rows: StorePriceInput[] = []
  let matched = false
  let changed = false
  for (const price of existing) {
    if (!price.isActive) continue
    const key = `${price.tier}|${price.currencyCode.toUpperCase()}|${price.minQuantity}`
    if (key === desiredKey) {
      matched = true
      // Compare at the column scale, never as floats: `230` and `230.0000` are the same price and a
      // real change is never hidden by an epsilon. Min-quantity and currency are the key itself.
      if (toScaledUnits(price.unitPrice, PRICE_SCALE) !== toScaledUnits(desired.unitPrice, PRICE_SCALE)) {
        changed = true
      }
      rows.push({
        tier: price.tier,
        currencyCode: price.currencyCode,
        minQuantity: price.minQuantity,
        unitPrice: desired.unitPrice,
        startsAt: null,
        endsAt: null,
        isActive: true,
      })
    } else {
      rows.push({
        tier: price.tier,
        currencyCode: price.currencyCode,
        minQuantity: price.minQuantity,
        unitPrice: price.unitPrice,
        startsAt: price.startsAt,
        endsAt: price.endsAt,
        isActive: true,
      })
    }
  }
  if (!matched) {
    changed = true
    rows.push(desired)
  }
  return { rows, changed }
}

/**
 * Fold the changed product fields onto the product's current state so the store's update receives a
 * complete `StoreProductInput`. The store's native payload writes every native column, so an update
 * that omitted a field the row does not carry would blank it; carrying the current value back is
 * what keeps the write non-destructive.
 */
function mergeStoreInput(existing: StoreProduct, payload: Record<string, unknown>): StoreProductInput {
  const text = (key: string, fallback: string | null): string | null =>
    typeof payload[key] === 'string' ? (payload[key] as string) : fallback
  return {
    sku: existing.sku,
    name: typeof payload.name === 'string' ? payload.name : existing.name,
    nameEn: text('nameEn', existing.nameEn),
    specSummary: text('specSummary', existing.specSummary),
    hsCode: text('hsCode', existing.hsCode),
    cnCode: existing.cnCode,
    countryOfOriginCode: existing.countryOfOriginCode,
    unit: typeof payload.unit === 'string' ? payload.unit : existing.unit,
    netWeight: text('netWeight', existing.netWeight),
    grossWeight: text('grossWeight', existing.grossWeight),
    volume: text('volume', existing.volume),
    dimensions:
      storeDimensionsFromRecord((payload.dimensions as Record<string, unknown> | undefined) ?? null) ??
      existing.dimensions,
    cartonQuantity:
      typeof payload.cartonQuantity === 'number' ? payload.cartonQuantity : existing.cartonQuantity,
    status: existing.status,
  }
}

/**
 * Merge the row's `purchase` price into the product's price set, submitting the whole set so the
 * other tiers survive. Returns whether anything was written.
 */
async function mergePurchasePrice(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: PurchasingScope
  product: PurchasingSupplierProduct
  productId: string
}): Promise<{ priceChanged: boolean; priceSkipped: boolean }> {
  const desired = await resolveDesiredPurchasePrice(input.em, input.scope, input.product)
  if (!desired) return { priceChanged: false, priceSkipped: true }

  const currentPrices = await listStorePrices({
    em: input.em,
    scope: input.scope,
    productId: input.productId,
  })
  const merged = buildPriceSet(currentPrices, desired)
  if (merged.rows.length > MAX_PRICE_ROWS) {
    throw new CrudHttpError(422, {
      error: `Product ${input.product.supplierSku} already has ${merged.rows.length} price rows; the price set cannot exceed ${MAX_PRICE_ROWS}`,
      code: 'too_many_price_rows',
    })
  }
  if (!merged.changed) return { priceChanged: false, priceSkipped: false }

  await replaceStorePrices({
    em: input.em,
    ctx: input.ctx,
    scope: input.scope,
    productId: input.productId,
    rows: merged.rows,
    origin: 'purchasing:supplier-product-promote',
  })
  return { priceChanged: true, priceSkipped: false }
}

/**
 * Write one already-linked library row's values onto its catalog product.
 *
 * Non-destructive by construction: `changedProductFields` drops null/unchanged values, so a field
 * the row does not carry is never cleared, and the price leg submits the whole set so only the
 * `purchase` tier moves. The `internal`/`export` tiers and the variants are never touched — the
 * product owns them.
 *
 * A linked product that is gone (deleted, or not readable in this scope) is refused instead of
 * silently skipped: `catalog_product_id` is a scalar id with no foreign key, so this is a reachable
 * state and the operator needs to hear about it (the list flags it as 已关联的商品已删除).
 */
export async function applySupplierProductToMaster(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: PurchasingScope
  product: PurchasingSupplierProduct
  productId: string
}): Promise<SupplierProductMasterWriteResult> {
  const liveness = await loadProductLiveness(input.em, input.scope, input.productId)
  if (liveness === 'missing') {
    throw new CrudHttpError(404, {
      error: `Linked product not found in this organization: ${input.productId}`,
      code: 'product_not_found',
    })
  }
  if (liveness === 'deleted') {
    throw new CrudHttpError(422, {
      error: 'The linked product is deleted; re-link this row (换绑) or clear the link first',
      code: 'product_deleted',
    })
  }
  const existing = await getStoreProduct({ em: input.em, scope: input.scope, id: input.productId })
  if (!existing) {
    throw new CrudHttpError(404, {
      error: `Linked product not found in this organization: ${input.productId}`,
      code: 'product_not_found',
    })
  }

  const fields = supplierProductToProductFields(input.product)
  const payload = changedProductFields(existing, fields)
  const fieldsChanged = Object.keys(payload)
  if (fieldsChanged.length > 0) {
    await updateStoreProduct({
      em: input.em,
      ctx: input.ctx,
      scope: input.scope,
      id: input.productId,
      input: mergeStoreInput(existing, payload),
      origin: 'purchasing:supplier-product-sync',
    })
  }

  const { priceChanged } = await mergePurchasePrice({
    em: input.em,
    ctx: input.ctx,
    scope: input.scope,
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
  product: PurchasingSupplierProduct
}): Promise<SupplierProductPromotionResult> {
  const { product, scope } = input
  if (product.catalogProductId) {
    return { catalogProductId: product.catalogProductId, action: 'skipped', priceSkipped: false }
  }

  const fields = supplierProductToProductFields(product)
  const existing = await findStoreProductBySku({ em: input.em, scope, sku: product.supplierSku })
  if (!existing) {
    // The store reads live rows only, but `catalog_products.sku` is unique *including* soft-deleted
    // rows, so a deleted owner has to be named here or the create would fail on the unique index.
    const deletedId = await findDeletedProductIdBySku(input.em, scope, product.supplierSku)
    if (deletedId) {
      throw new CrudHttpError(422, {
        error: `SKU ${product.supplierSku} belongs to a deleted product; restore it or change the supplier code to promote this item`,
        code: 'sku_belongs_to_deleted_product',
      })
    }
  }
  if (existing) {
    // One catalog SKU, one supplier row. When another live row already owns this product, writing
    // this row's values onto it would replace that supplier's data (name, spec, packaging) with a
    // different purchase source's — silently, and in the direction the operator did not intend. The
    // intent behind a second row for the same item is 关联已有商品 (a link, no store write), so the
    // refusal names it and nothing is written.
    const owner = await input.em.fork().findOne(PurchasingSupplierProduct, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      catalogProductId: existing.id,
      id: { $ne: product.id },
      deletedAt: null,
    } as FilterQuery<PurchasingSupplierProduct>)
    if (owner) {
      const ownerLabel = owner.supplierNameSnapshot ? `${owner.supplierSku} (${owner.supplierNameSnapshot})` : owner.supplierSku
      throw new CrudHttpError(422, {
        error: `SKU ${product.supplierSku} is already the catalog product of supplier code ${ownerLabel}; use 关联已有商品 to point this row at the same product instead of overwriting it`,
        code: 'sku_owned_by_another_supplier_product',
      })
    }
  }

  let catalogProductId: string
  let action: SupplierProductPromotionResult['action']
  if (!existing) {
    if (!fields.name) throw new CrudHttpError(422, { error: 'Supplier product has no name', code: 'supplier_product_name_required' })
    const created = await createStoreProduct({
      em: input.em,
      ctx: input.ctx,
      scope,
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
        dimensions: storeDimensionsFromRecord(product.innerPacking),
        cartonQuantity: fields.cartonQuantity,
        status: 'active',
      },
      origin: 'purchasing:supplier-product-promote',
    })
    catalogProductId = created.id
    action = 'created'
  } else {
    catalogProductId = existing.id
    const payload = changedProductFields(existing, fields)
    if (Object.keys(payload).length > 0) {
      await updateStoreProduct({
        em: input.em,
        ctx: input.ctx,
        scope,
        id: catalogProductId,
        input: mergeStoreInput(existing, payload),
        origin: 'purchasing:supplier-product-promote',
      })
      action = 'updated'
    } else {
      action = 'skipped'
    }
  }

  const { priceSkipped } = await mergePurchasePrice({
    em: input.em,
    ctx: input.ctx,
    scope,
    product,
    productId: catalogProductId,
  })

  const updated = await input.de.updateOrmEntity({
    entity: PurchasingSupplierProduct,
    where: { id: String(product.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
    apply: (entity) => {
      entity.catalogProductId = catalogProductId
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

  return { catalogProductId, action, priceSkipped }
}
