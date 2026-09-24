import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ProductsPrice, ProductsProduct } from '../data/entities'
import { productPricesReplaceSchema, type ProductPriceRowInput } from '../data/validators'
import { assertCurrencyInDictionary } from '../lib/currencyDictionary'
import { ensureScope } from './types'

const ENTITY_ID = 'products:products_price' as const
const RESOURCE_KIND = 'products.product_price' as const

export const productPriceCrudEvents: CrudEventsConfig<ProductsPrice> = {
  module: 'products',
  // Entity name is the event-id segment: `products.prices.updated`.
  entity: 'prices',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<ProductsPrice>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    priceTier: ctx.entity?.priceTier ?? null,
    currencyCode: ctx.entity?.currencyCode ?? null,
  }),
}

export const productPriceCrudIndexer: CrudIndexerConfig<ProductsPrice> = {
  entityType: ENTITY_ID,
}

function rowKey(row: { priceTier: string; currencyCode: string; minQuantity: number }): string {
  return `${row.priceTier}|${row.currencyCode}|${row.minQuantity}`
}

async function loadProduct(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  productId: string,
): Promise<ProductsProduct> {
  const product = await em.fork().findOne(ProductsProduct, {
    id: productId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ProductsProduct>)
  if (!product) throw notFound('Product not found')
  return product
}

/**
 * Replaces a product's whole price set in one command.
 *
 * Rows that disappear from the payload are **deactivated**, never deleted: a contract's line
 * snapshot may reference a tier price that is no longer quoted, and an issued contract must
 * stay explainable afterwards. The upsert key is `(tier, currency, minQuantity)`, so the same
 * product can quote a tier in several currencies and with a quantity ladder.
 *
 * Wrapped in one transaction: a payload with a duplicate key or an unknown currency either
 * lands completely or not at all, and the product's price list is never half-written.
 */
const replacePricesCommand: CommandHandler<Record<string, unknown>, { productId: string; rows: ProductsPrice[] }> = {
  id: 'products.prices.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productPricesReplaceSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await loadProduct(em, scope, parsed.productId)

    const seen = new Set<string>()
    for (const row of parsed.rows) {
      const key = rowKey(row)
      if (seen.has(key)) {
        throw badRequest(`Duplicate price row for ${row.priceTier}/${row.currencyCode}/${row.minQuantity}`)
      }
      seen.add(key)
      await assertCurrencyInDictionary(em, scope, row.currencyCode)
    }

    const product = em.getReference(ProductsProduct, parsed.productId)
    const existing = await em.fork().find(
      ProductsPrice,
      { product: parsed.productId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<ProductsPrice>,
    )
    const existingByKey = new Map<string, ProductsPrice>()
    for (const row of existing) {
      existingByKey.set(
        rowKey({ priceTier: row.priceTier, currencyCode: row.currencyCode, minQuantity: row.minQuantity }),
        row,
      )
    }

    const persisted: ProductsPrice[] = []
    const deactivated: ProductsPrice[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          for (const row of parsed.rows) {
            const key = rowKey(row)
            const current = existingByKey.get(key)
            if (current) {
              persisted.push(
                await de.updateOrmEntity({
                  entity: ProductsPrice,
                  where: { id: String(current.id), tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<ProductsPrice>,
                  apply: (entity) => {
                    entity.unitPrice = row.unitPrice
                    entity.startsAt = toDate(row.startsAt)
                    entity.endsAt = toDate(row.endsAt)
                    entity.isActive = row.isActive
                  },
                }) ?? current,
              )
              existingByKey.delete(key)
              continue
            }
            persisted.push(
              await de.createOrmEntity({
                entity: ProductsPrice,
                data: {
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  product,
                  priceTier: row.priceTier,
                  currencyCode: row.currencyCode,
                  minQuantity: row.minQuantity,
                  unitPrice: row.unitPrice,
                  startsAt: toDate(row.startsAt),
                  endsAt: toDate(row.endsAt),
                  isActive: row.isActive,
                },
              }),
            )
          }
        },
        // Phase two: rows absent from the payload are deactivated in their own flush boundary,
        // so a failure here cannot leave a price quoted after the operator removed it.
        async () => {
          for (const stale of existingByKey.values()) {
            if (!stale.isActive) continue
            const updated = await de.updateOrmEntity({
              entity: ProductsPrice,
              where: { id: String(stale.id), tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<ProductsPrice>,
              apply: (entity) => {
                entity.isActive = false
              },
            })
            if (updated) deactivated.push(updated)
          }
        },
      ],
      { transaction: true, label: 'products.prices.replace' },
    )

    const touched: ProductsPrice[] = [...persisted]
    for (const stale of deactivated) touched.push(stale)

    // One side effect per touched row: the declared event is `products.prices.updated`, and a
    // payload that names the tier/currency is what an open price grid keyed on can react to.
    // Deactivated rows are included so a grid that still shows a removed tier refreshes too.
    for (const row of touched) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: row,
        identifiers: { id: parsed.productId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        syncOrigin: ctx.syncOrigin,
        events: productPriceCrudEvents,
        indexer: productPriceCrudIndexer,
      })
    }

    return { productId: parsed.productId, rows: persisted }
  },
  captureAfter: (_input, result) => ({ productId: result.productId, rowCount: result.rows.length }),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('products.audit.prices.replace', 'Replace product prices'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.productId,
      snapshotAfter: { productId: result.productId, rowCount: result.rows.length },
    }
  },
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Exported for the price list route's `(tier, currency, minQuantity)` grouping. */
export { rowKey as productPriceRowKey }

registerCommand(replacePricesCommand)

export { replacePricesCommand }
export type { ProductPriceRowInput }
