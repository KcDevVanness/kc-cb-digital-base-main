import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, forbidden, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  createStoreProduct,
  getStoreProduct,
  listStorePrices,
  listStoreProducts,
  updateStoreProduct,
  type StoreProduct,
  type StoreProductInput,
  type StoreVariantInput,
} from '../lib/store'
import { productDistributeSchema } from '../data/validators'
import { ensureScope } from './types'

/**
 * Distributes products of the **current organization** into other organizations
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`).
 *
 * A distributed copy is a catalog product of the target organization, like the source is a catalog
 * product of this one: fields and variants are copied, the provenance is frozen in the copy's
 * `sourceProductId`, and prices ride along exactly once (the branch prices its own market).
 * Idempotency rides on that provenance — a target product with the same SKU whose `sourceProductId`
 * names the source is *updated* (whitelist fields + SKU-matched variants, target-local SKUs kept), a
 * target product owning the SKU without that provenance is reported as `sku_taken` and left
 * untouched, and anything else is *created*.
 *
 * Security: the source scope comes from the session (`ensureScope`), and every target organization
 * is checked against the command runtime's `organizationIds` (the ACL-expanded writable set,
 * `null` = unrestricted) before anything is written, so an out-of-scope target is a 403 with no
 * partial writes.
 */

type Scope = { tenantId: string; organizationId: string }

const PAGE_SIZE = 200

export type DistributeProductsResult = {
  created: number
  updated: number
  skipped: Array<{ sku: string; organizationId: string; reason: 'sku_taken' }>
}

/** The catalog write payload that carries a source product's fields onto its copy. */
function copyInput(source: StoreProduct): StoreProductInput {
  return {
    sku: source.sku,
    name: source.name,
    nameEn: source.nameEn,
    brand: source.brand,
    series: source.series,
    manufacturerModel: source.manufacturerModel,
    specSummary: source.specSummary,
    barcode: source.barcode,
    unit: source.unit,
    hsCode: source.hsCode,
    cnCode: source.cnCode,
    countryOfOriginCode: source.countryOfOriginCode,
    netWeight: source.netWeight,
    grossWeight: source.grossWeight,
    volume: source.volume,
    dimensions: source.dimensions,
    cartonQuantity: source.cartonQuantity,
    batteryCapacityMah: source.batteryCapacityMah,
    batteryWh: source.batteryWh,
    containsLithiumBattery: source.containsLithiumBattery,
    certifications: source.certifications,
    status: source.status,
    notes: source.notes,
    // The copy points at the product it was copied from — the marker a re-run matches on.
    sourceProductId: source.id,
  }
}

/** The source's variant set on the store's input vocabulary; a new copy gets its own row ids. */
function sourceVariantInputs(source: StoreProduct): StoreVariantInput[] {
  return source.variants.map((variant) => ({
    sku: variant.sku,
    name: variant.name,
    barcode: variant.barcode,
    isDefault: variant.isDefault,
    isActive: variant.isActive,
  }))
}

/**
 * The copy's variant set after a re-run: rows are matched by SKU (catalog's variant code), so a
 * source row updates the copy's row of the same code and a new source code is added. A SKU the
 * target organization added locally survives, which is why every existing row is named in the
 * submitted set — the store's replace semantics delete the rows a payload does not name.
 *
 * Non-default rows come first: the store writes the set in order, and the catalog default marker is
 * unique per product, so a row that is about to lose the marker must release it before its
 * replacement claims it.
 */
function mergeVariantInputs(source: StoreProduct, copy: StoreProduct): StoreVariantInput[] {
  const sourceHasDefault = source.variants.some((variant) => variant.isDefault)
  const leftovers = new Map(copy.variants.map((variant) => [variant.sku, variant]))
  const rows: StoreVariantInput[] = source.variants.map((variant) => {
    const existing = leftovers.get(variant.sku)
    if (existing) leftovers.delete(variant.sku)
    return {
      id: existing?.id ?? null,
      sku: variant.sku,
      name: variant.name,
      barcode: variant.barcode,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
    }
  })
  for (const leftover of leftovers.values()) {
    rows.push({
      id: leftover.id,
      sku: leftover.sku,
      name: leftover.name,
      barcode: leftover.barcode,
      isDefault: sourceHasDefault ? false : leftover.isDefault,
      isActive: leftover.isActive,
    })
  }
  return rows.sort((left, right) => Number(left.isDefault ?? false) - Number(right.isDefault ?? false))
}

/**
 * Every product of one organization the store read model exposes, page by page.
 *
 * `listStoreProducts` caps one page at 200 rows, so "every product of the source organization" —
 * the default distribution set — has to walk the pages rather than take the first one.
 */
async function loadAllProducts(em: EntityManager, scope: Scope, options: { skus?: string[] } = {}): Promise<StoreProduct[]> {
  const products: StoreProduct[] = []
  let page = 1
  for (;;) {
    const { items, total } = await listStoreProducts({
      em,
      scope,
      status: 'all',
      skus: options.skus,
      page,
      pageSize: PAGE_SIZE,
    })
    products.push(...items)
    if (items.length === 0 || products.length >= total) return products
    page += 1
  }
}

const distributeProductsCommand: CommandHandler<Record<string, unknown>, DistributeProductsResult> = {
  id: 'products.items.distribute',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productDistributeSchema.parse(rawInput)
    const source = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const targetOrganizationIds = [...new Set(parsed.organizationIds)].filter((id) => id !== source.organizationId)
    if (targetOrganizationIds.length === 0) {
      throw badRequest('Select at least one target organization other than the current one')
    }
    const writable = ctx.organizationIds
    if (Array.isArray(writable)) {
      const writableIds = new Set(writable)
      if (targetOrganizationIds.some((id) => !writableIds.has(id))) {
        throw forbidden('Cannot distribute products outside your organization scope')
      }
    } else {
      // An unrestricted actor (no ACL organization list) may name any organization; the target must
      // still exist in **this tenant**, or a copy would be written with a dangling organization id.
      const organizations = await em.fork().find(
        Organization,
        {
          id: { $in: targetOrganizationIds },
          tenant: source.tenantId,
          deletedAt: null,
        } as FilterQuery<Organization>,
      )
      if (organizations.length !== targetOrganizationIds.length) {
        throw forbidden('Cannot distribute products into an organization that does not belong to this tenant')
      }
    }

    const requestedProductIds = parsed.productIds ? [...new Set(parsed.productIds)] : null
    const sources = requestedProductIds
      ? (await Promise.all(requestedProductIds.map((id) => getStoreProduct({ em, scope: source, id })))).filter(
          (product): product is StoreProduct => product !== null,
        )
      : await loadAllProducts(em, source)
    if (requestedProductIds && sources.length !== requestedProductIds.length) {
      throw notFound('One or more products were not found in this organization')
    }

    const result: DistributeProductsResult = { created: 0, updated: 0, skipped: [] }
    if (sources.length === 0) return result

    const sourceIds = new Set(sources.map((product) => product.id))
    for (const targetOrganizationId of targetOrganizationIds) {
      const targetScope: Scope = { tenantId: source.tenantId, organizationId: targetOrganizationId }
      const holders = await loadAllProducts(em, targetScope, { skus: sources.map((product) => product.sku) })
      const copyBySourceId = new Map<string, StoreProduct>()
      const skuHolder = new Map<string, StoreProduct>()
      for (const holder of holders) {
        skuHolder.set(holder.sku, holder)
        if (holder.sourceProductId && sourceIds.has(holder.sourceProductId)) {
          copyBySourceId.set(holder.sourceProductId, holder)
        }
      }

      for (const sourceProduct of sources) {
        const copy = copyBySourceId.get(sourceProduct.id)
        if (copy) {
          await updateStoreProduct({
            em,
            ctx,
            scope: targetScope,
            id: copy.id,
            input: copyInput(sourceProduct),
            variants: mergeVariantInputs(sourceProduct, copy),
            // Prices are deliberately absent: re-running a distribution never rewrites the branch's
            // own price list.
            origin: 'products.items.distribute:update',
          })
          result.updated += 1
          continue
        }

        if (skuHolder.has(sourceProduct.sku)) {
          result.skipped.push({ sku: sourceProduct.sku, organizationId: targetOrganizationId, reason: 'sku_taken' })
          continue
        }

        const prices = await listStorePrices({ em, scope: source, productId: sourceProduct.id })
        try {
          await createStoreProduct({
            em,
            ctx,
            scope: targetScope,
            input: copyInput(sourceProduct),
            variants: sourceVariantInputs(sourceProduct),
            prices,
            origin: 'products.items.distribute:create',
          })
        } catch (error) {
          // A SKU the target organization acquired between the read and the write is the one failure
          // reported per row instead of aborting the whole request.
          if (isCrudHttpError(error) && error.status === 409) {
            result.skipped.push({ sku: sourceProduct.sku, organizationId: targetOrganizationId, reason: 'sku_taken' })
            continue
          }
          throw error
        }
        result.created += 1
      }
    }

    return result
  },
}

registerCommand(distributeProductsCommand)

export { distributeProductsCommand }
