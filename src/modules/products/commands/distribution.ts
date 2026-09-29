import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { badRequest, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ProductsPrice, ProductsProduct, ProductsVariant } from '../data/entities'
import { productDistributeSchema } from '../data/validators'
import {
  buildDistributedPriceData,
  buildDistributedProductData,
  buildDistributedVariantData,
  type DistributeProductsResult,
} from '../lib/distribution'
import { productCrudEvents, productCrudIndexer } from './items'
import { ensureScope } from './types'

/**
 * Distributes products of the **current organization** into other organizations
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`).
 *
 * Idempotency rides on `ProductsProduct.sourceProduct`: a target row linked to a source row is
 * *updated* (whitelist fields + variants upserted by `code`, never deleted), a target row owning the
 * same SKU without that link is reported as `sku_taken` and left untouched, and anything else is
 * *created* — fields, variants and prices — with the link written. Prices are only ever written on
 * creation: after that they belong to the target organization (the branch prices its own market).
 *
 * Security: the source scope comes from the session (`ensureScope`), and every target organization
 * is checked against the command runtime's `organizationIds` (the ACL-expanded writable set,
 * `null` = unrestricted) before anything is written, so an out-of-scope target is a 403 with no
 * partial writes. The same rule the framework applies to a selected organization is therefore
 * applied to each target this command writes into.
 */
const distributeProductsCommand: CommandHandler<Record<string, unknown>, DistributeProductsResult> = {
  id: 'products.items.distribute',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productDistributeSchema.parse(rawInput)
    const source = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const requestedTargets = [...new Set(parsed.organizationIds)]
    const targetOrganizationIds = requestedTargets.filter((id) => id !== source.organizationId)
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

    const sourceWhere: FilterQuery<ProductsProduct> = {
      tenantId: source.tenantId,
      organizationId: source.organizationId,
      deletedAt: null,
    }
    const requestedProductIds = parsed.productIds ? [...new Set(parsed.productIds)] : null
    const sources = await em.fork().find(
      ProductsProduct,
      requestedProductIds ? { ...sourceWhere, id: { $in: requestedProductIds } } : sourceWhere,
      { orderBy: { sku: 'asc' } },
    )
    if (requestedProductIds && sources.length !== requestedProductIds.length) {
      throw notFound('One or more products were not found in this organization')
    }
    const result: DistributeProductsResult = { created: 0, updated: 0, skipped: [] }
    if (sources.length === 0) return result

    const sourceIds = sources.map((row) => String(row.id))
    const variantsBySource = await loadVariantsBySource(em, source, sourceIds)
    const pricesBySource = await loadPricesBySource(em, source, sourceIds)

    for (const targetOrganizationId of targetOrganizationIds) {
      const [copies, skuHolders] = await Promise.all([
        em.fork().find(
          ProductsProduct,
          {
            tenantId: source.tenantId,
            organizationId: targetOrganizationId,
            deletedAt: null,
            sourceProduct: { $in: sourceIds },
          } as FilterQuery<ProductsProduct>,
        ),
        em.fork().find(
          ProductsProduct,
          {
            tenantId: source.tenantId,
            organizationId: targetOrganizationId,
            deletedAt: null,
            sku: { $in: sources.map((row) => row.sku) },
          } as FilterQuery<ProductsProduct>,
        ),
      ])
      const copyBySourceId = new Map(
        copies.map((copy) => [String(copy.sourceProduct?.id ?? copy.sourceProduct), copy]),
      )
      const skuOwnerByCode = new Map(skuHolders.map((row) => [row.sku, row]))

      for (const sourceProduct of sources) {
        const sourceId = String(sourceProduct.id)
        const existingCopy = copyBySourceId.get(sourceId)
        const targetScope = { tenantId: source.tenantId, organizationId: targetOrganizationId }

        if (existingCopy) {
          const copyId = String(existingCopy.id)
          await de
            .updateOrmEntity({
              entity: ProductsProduct,
              where: { id: copyId, tenantId: source.tenantId, organizationId: targetOrganizationId },
              apply: (entity) => {
                Object.assign(entity, buildDistributedProductData(sourceProduct))
              },
            })
            .catch((error: unknown) => {
              if (isSkuRaceError(error)) {
                throw badRequest(
                  `A product with SKU ${sourceProduct.sku} appeared in the target organization while distributing`,
                )
              }
              throw error
            })
          await upsertDistributedVariants(de, em, targetScope, copyId, variantsBySource.get(sourceId) ?? [])
          result.updated += 1
          await emitCrudSideEffects({
            dataEngine: de,
            action: 'updated',
            entity: existingCopy,
            identifiers: { id: copyId, tenantId: source.tenantId, organizationId: targetOrganizationId },
            syncOrigin: ctx.syncOrigin,
            events: productCrudEvents,
            indexer: productCrudIndexer,
          })
          continue
        }

        if (skuOwnerByCode.has(sourceProduct.sku)) {
          result.skipped.push({
            sku: sourceProduct.sku,
            organizationId: targetOrganizationId,
            reason: 'sku_taken',
          })
          continue
        }

        const createdRows: ProductsProduct[] = []
        const variantInputs = variantsBySource.get(sourceId) ?? []
        await withAtomicFlush(
          em,
          [
            async () => {
              const row = await de.createOrmEntity({
                entity: ProductsProduct,
                data: {
                  tenantId: source.tenantId,
                  organizationId: targetOrganizationId,
                  ...buildDistributedProductData(sourceProduct),
                  sourceProduct: em.getReference(ProductsProduct, sourceId),
                },
              })
              createdRows.push(row)
            },
            async () => {
              const created = createdRows[0]
              if (!created) return
              await upsertDistributedVariants(de, em, targetScope, String(created.id), variantInputs)
              await createDistributedPrices(de, em, targetScope, String(created.id), pricesBySource.get(sourceId) ?? [])
            },
          ],
          { transaction: true, label: 'products.items.distribute' },
        ).catch((error: unknown) => {
          if (isSkuRaceError(error)) {
            result.skipped.push({
              sku: sourceProduct.sku,
              organizationId: targetOrganizationId,
              reason: 'sku_taken',
            })
            return
          }
          throw error
        })
        const created = createdRows[0]
        if (!created) continue
        result.created += 1
        await emitCrudSideEffects({
          dataEngine: de,
          action: 'created',
          entity: created,
          identifiers: { id: String(created.id), tenantId: source.tenantId, organizationId: targetOrganizationId },
          syncOrigin: ctx.syncOrigin,
          events: productCrudEvents,
          indexer: productCrudIndexer,
        })
      }
    }

    return result
  },
}

type Scope = { tenantId: string; organizationId: string }

async function loadVariantsBySource(
  em: EntityManager,
  scope: Scope,
  sourceIds: string[],
): Promise<Map<string, ProductsVariant[]>> {
  const rows = await em.fork().find(
    ProductsVariant,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      product: { $in: sourceIds },
    } as FilterQuery<ProductsVariant>,
    { orderBy: { sortOrder: 'asc' } },
  )
  const bySource = new Map<string, ProductsVariant[]>()
  for (const row of rows) {
    const key = String(row.product.id)
    const list = bySource.get(key) ?? []
    list.push(row)
    bySource.set(key, list)
  }
  return bySource
}

async function loadPricesBySource(
  em: EntityManager,
  scope: Scope,
  sourceIds: string[],
): Promise<Map<string, ProductsPrice[]>> {
  const rows = await em.fork().find(
    ProductsPrice,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      product: { $in: sourceIds },
    } as FilterQuery<ProductsPrice>,
    { orderBy: { createdAt: 'asc' } },
  )
  const bySource = new Map<string, ProductsPrice[]>()
  for (const row of rows) {
    const key = String(row.product.id)
    const list = bySource.get(key) ?? []
    list.push(row)
    bySource.set(key, list)
  }
  return bySource
}

/**
 * Variants are upserted **by code** and never deleted: the copy's variant set follows the source
 * for codes it shares, and a variant the target organization added locally stays.
 */
async function upsertDistributedVariants(
  de: DataEngine,
  em: EntityManager,
  scope: Scope,
  productId: string,
  variants: ProductsVariant[],
): Promise<void> {
  if (variants.length === 0) return
  const existing = await em.fork().find(
    ProductsVariant,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      product: productId,
      deletedAt: null,
    } as FilterQuery<ProductsVariant>,
  )
  const existingByCode = new Map(existing.map((row) => [row.code, row]))
  const product = em.getReference(ProductsProduct, productId)
  for (const [index, variant] of variants.entries()) {
    const data = buildDistributedVariantData(variant, index)
    const current = existingByCode.get(variant.code)
    if (current) {
      await de.updateOrmEntity({
        entity: ProductsVariant,
        where: { id: String(current.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
        apply: (entity) => {
          Object.assign(entity, data)
        },
      })
      continue
    }
    await de.createOrmEntity({
      entity: ProductsVariant,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        product,
        ...data,
      },
    })
  }
}

/** Prices are written exactly once, when the copy is created; re-runs never touch them. */
async function createDistributedPrices(
  de: DataEngine,
  em: EntityManager,
  scope: Scope,
  productId: string,
  prices: ProductsPrice[],
): Promise<void> {
  if (prices.length === 0) return
  const product = em.getReference(ProductsProduct, productId)
  for (const price of prices) {
    await de.createOrmEntity({
      entity: ProductsPrice,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        product,
        ...buildDistributedPriceData(price),
      },
    })
  }
}

function isSkuRaceError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? ''
  const message = (error as { message?: string })?.message ?? ''
  const code = (error as { code?: string })?.code ?? ''
  return code === '23505' || name.includes('UniqueConstraint') || /unique/i.test(message)
}

registerCommand(distributeProductsCommand)

export { distributeProductsCommand }
