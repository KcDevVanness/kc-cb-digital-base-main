import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PurchasingSupplierProduct, PurchasingSupplierProductPrice } from '../data/entities'
import { supplierProductPricesReplaceSchema } from '../data/validators'
import { assertCurrencyInDictionary } from '../lib/currencyDictionary'
import { supplierProductPriceRowKey } from '../lib/priceKinds'
import {
  SUPPLIER_PRODUCT_PRICE_RESOURCE_KIND,
  ensureScope,
  loadSupplierProduct,
  supplierProductPriceCrudEvents,
  supplierProductPriceCrudIndexer,
} from './shared'

/**
 * `purchasing.supplier-products.replace-prices` — the library item's whole price list in one write.
 *
 * Mirrors `products.prices.replace` so the two price lists behave the same way:
 *
 * 1. **The payload is the complete desired state.** A row that disappears is deactivated (never
 *    deleted), so a purchase order line's snapshot still explains where its price came from.
 * 2. **The upsert key is `(kind, currency, minQuantity)`**, which is what makes a re-submit
 *    idempotent — the form never has to carry row ids it could get wrong.
 * 3. **Currencies must exist in the currency dictionary**, so a price row the UI can never render
 *    cannot be stored.
 *
 * Deliberately **no optimistic lock**: the payload is the whole set, so the last submitted list
 * wins instead of rejecting one of two edits with a version the operator cannot resolve — the same
 * decision the product master's price route documents.
 */
const replaceSupplierProductPricesCommand: CommandHandler<
  Record<string, unknown>,
  { supplierProductId: string; rows: PurchasingSupplierProductPrice[] }
> = {
  id: 'purchasing.supplier-products.replace-prices',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductPricesReplaceSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await loadSupplierProduct(em, scope, parsed.supplierProductId)

    const seen = new Set<string>()
    for (const row of parsed.rows) {
      const key = supplierProductPriceRowKey(row)
      if (seen.has(key)) {
        throw badRequest(`Duplicate price row for ${row.priceKind}/${row.currencyCode}/${row.minQuantity}`)
      }
      seen.add(key)
      await assertCurrencyInDictionary(em, scope, row.currencyCode)
    }

    const existing = await em.fork().find(
      PurchasingSupplierProductPrice,
      {
        supplierProduct: parsed.supplierProductId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PurchasingSupplierProductPrice>,
    )
    const existingByKey = new Map<string, PurchasingSupplierProductPrice>()
    for (const row of existing) {
      existingByKey.set(
        supplierProductPriceRowKey({
          priceKind: row.priceKind,
          currencyCode: row.currencyCode,
          minQuantity: row.minQuantity,
        }),
        row,
      )
    }

    const itemReference = em.getReference(PurchasingSupplierProduct, parsed.supplierProductId)
    const persisted: PurchasingSupplierProductPrice[] = []
    const deactivated: PurchasingSupplierProductPrice[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          for (const row of parsed.rows) {
            const key = supplierProductPriceRowKey(row)
            const current = existingByKey.get(key)
            if (current) {
              persisted.push(
                (await de.updateOrmEntity({
                  entity: PurchasingSupplierProductPrice,
                  where: {
                    id: String(current.id),
                    tenantId: scope.tenantId,
                    organizationId: scope.organizationId,
                  } as FilterQuery<PurchasingSupplierProductPrice>,
                  apply: (entity) => {
                    entity.unitPrice = row.unitPrice
                    entity.isActive = row.isActive
                  },
                })) ?? current,
              )
              existingByKey.delete(key)
              continue
            }
            persisted.push(
              await de.createOrmEntity({
                entity: PurchasingSupplierProductPrice,
                data: {
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  supplierProduct: itemReference,
                  priceKind: row.priceKind,
                  currencyCode: row.currencyCode,
                  minQuantity: row.minQuantity,
                  unitPrice: row.unitPrice,
                  isActive: row.isActive,
                },
              }),
            )
          }
        },
        // Second boundary: rows absent from the payload are deactivated in their own flush, so a
        // failure here cannot leave a price quoted after the operator removed it.
        async () => {
          for (const stale of existingByKey.values()) {
            if (!stale.isActive) continue
            const updated = await de.updateOrmEntity({
              entity: PurchasingSupplierProductPrice,
              where: {
                id: String(stale.id),
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
              } as FilterQuery<PurchasingSupplierProductPrice>,
              apply: (entity) => {
                entity.isActive = false
              },
            })
            if (updated) deactivated.push(updated)
          }
        },
      ],
      { transaction: true, label: 'purchasing.supplier-products.replace-prices' },
    )

    // One emission per touched row, deactivations included: a grid still showing a removed price
    // has to refresh, and the payload names the item/kind/currency rather than an amount.
    for (const row of [...persisted, ...deactivated]) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: row,
        identifiers: {
          id: parsed.supplierProductId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        syncOrigin: ctx.syncOrigin,
        events: supplierProductPriceCrudEvents,
        indexer: supplierProductPriceCrudIndexer,
      })
    }

    return { supplierProductId: parsed.supplierProductId, rows: persisted }
  },
  captureAfter: (_input, result) => ({ supplierProductId: result.supplierProductId, rowCount: result.rows.length }),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.prices.replace', 'Replace supplier product prices'),
      resourceKind: SUPPLIER_PRODUCT_PRICE_RESOURCE_KIND,
      resourceId: result.supplierProductId,
      snapshotAfter: { supplierProductId: result.supplierProductId, rowCount: result.rows.length },
    }
  },
}

registerCommand(replaceSupplierProductPricesCommand)

export { replaceSupplierProductPricesCommand }
