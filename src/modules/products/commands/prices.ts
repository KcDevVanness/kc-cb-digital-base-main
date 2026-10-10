import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getStoreProduct, listStorePrices, replaceStorePrices, type StorePrice } from '../lib/store'
import { productPricesReplaceSchema } from '../data/validators'
import { assertCurrencyInDictionary } from '../lib/currencyDictionary'
import { ensureScope } from './types'

/**
 * The three-tier price set of a product.
 *
 * Prices are catalog price rows (price kind × currency × minimum quantity, attached to the product)
 * written through `catalog.prices.*` by `lib/store.ts`. Replacing the set is the only write: a row
 * that disappears from the payload is **closed**, never deleted, so a contract snapshot that quoted
 * the old tier stays explainable.
 */

const RESOURCE_KIND = 'products.product_price' as const

const replacePricesCommand: CommandHandler<Record<string, unknown>, { productId: string; rows: StorePrice[] }> = {
  id: 'products.prices.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productPricesReplaceSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const product = await getStoreProduct({ em, scope, id: parsed.productId })
    if (!product) throw notFound('Product not found')

    const seen = new Set<string>()
    for (const row of parsed.rows) {
      const key = `${row.tier}|${row.currencyCode}|${row.minQuantity}`
      if (seen.has(key)) {
        throw badRequest(`Duplicate price row for ${row.tier}/${row.currencyCode}/${row.minQuantity}`)
      }
      seen.add(key)
      await assertCurrencyInDictionary(em, scope, row.currencyCode)
    }

    await replaceStorePrices({
      em,
      ctx,
      scope,
      productId: parsed.productId,
      rows: parsed.rows.map((row) => ({
        tier: row.tier,
        currencyCode: row.currencyCode,
        minQuantity: row.minQuantity,
        unitPrice: row.unitPrice,
        startsAt: row.startsAt ?? null,
        endsAt: row.endsAt ?? null,
        isActive: row.isActive,
      })),
      origin: 'products.prices.replace',
    })

    return { productId: parsed.productId, rows: await listStorePrices({ em, scope, productId: parsed.productId }) }
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

registerCommand(replacePricesCommand)

export { replacePricesCommand }
