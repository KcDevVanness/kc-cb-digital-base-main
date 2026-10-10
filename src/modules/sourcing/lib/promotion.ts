import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MAX_PRICE_ROWS, changedProductFields, mergePriceRows } from '../../products/lib/supplierMapping'
import {
  createStoreProduct,
  findStoreProductBySku,
  listStorePrices,
  replaceStorePrices,
  updateStoreProduct,
  type StoreDimensions,
  type StorePrice,
  type StorePriceInput,
  type StoreProduct,
  type StoreProductInput,
} from '../../products/lib/store'
import { SourcingQuote, SourcingQuoteLine } from '../data/entities'
import { desiredPriceRow, quoteLineToProductFields } from './productMapping'
import { findDeletedProductIdBySku } from './productsReads'

/**
 * Promotes quotation lines into the product store.
 *
 * Every write goes through the store (`products/lib/store.ts`), which forwards it to the catalog
 * commands, because that is where the product's events, query-index entries, audit rows and
 * validation live; a direct insert would skip all four. Three rules make the operation safe to run
 * twice and safe to run partially:
 *
 * 1. **Per-line isolation** — a line that fails (a SKU owned by a deleted product, a command error)
 *    is recorded as failed and marked `invalid` on its own row; the remaining lines still promote.
 *    Nothing is retried automatically.
 * 2. **Idempotency** — a line that already carries `catalog_product_id` is skipped, and a product
 *    whose price row already matches is not written again, so a second run reports `skipped`.
 * 3. **Non-destructive updates** — only non-empty, changed values are merged onto the product's
 *    current store values, and the price write submits the product's whole three-tier set so the
 *    `internal` and `export` tiers survive (the store closes rows missing from the payload).
 *
 * Promotion also feeds the supplier's product library with the same line, so the "what does this
 * supplier sell us?" list is a by-product of the workflow the buyer already runs instead of a
 * second list to maintain by hand. A library failure never rolls back a product write.
 */

const logger = createLogger('sourcing').child({ component: 'promotion' })

export type PromotionLineFailure = { lineId: string; lineNumber: number; message: string }

export type PromotionResult = {
  created: number
  updated: number
  skipped: number
  failed: PromotionLineFailure[]
}

export type CommandBusLike = {
  execute: <TInput = unknown, TResult = unknown>(
    commandId: string,
    options: { input: TInput; ctx: CommandRuntimeContext },
  ) => Promise<{ result: TResult }>
}

export async function promoteQuoteLines(input: {
  ctx: CommandRuntimeContext
  scope: { tenantId: string; organizationId: string }
  quote: SourcingQuote
  lineIds?: string[]
  force?: boolean
}): Promise<PromotionResult> {
  const em = input.ctx.container.resolve('em') as EntityManager
  const commandBus = input.ctx.container.resolve('commandBus') as unknown as CommandBusLike
  const quoteId = String(input.quote.id)

  const allLines = await em.fork().find(SourcingQuoteLine, {
    quote: quoteId,
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
  } as FilterQuery<SourcingQuoteLine>)
  const wanted = input.lineIds && input.lineIds.length > 0 ? new Set(input.lineIds) : null
  const lines = allLines
    .filter((line) => (wanted ? wanted.has(String(line.id)) : line.selected && line.rowStatus !== 'skipped'))
    .sort((left, right) => left.lineNumber - right.lineNumber)

  // The store strips the optimistic-lock header from the context before it forwards a write to
  // catalog, so it can take the request context unchanged. The supplier-library command does not,
  // and the header on this request belongs to the quotation, so that call gets a request-free context.
  const libraryContext: CommandRuntimeContext = { ...input.ctx, request: undefined, syncOrigin: 'sourcing:promote-library' }
  const result: PromotionResult = { created: 0, updated: 0, skipped: 0, failed: [] }

  for (const line of lines) {
    const lineId = String(line.id)
    if (!line.derivedSku || line.derivedSku.trim().length === 0) {
      await markLineFailed(em, line, 'Line has no SKU yet')
      result.failed.push({ lineId, lineNumber: line.lineNumber, message: 'Line has no SKU yet' })
      continue
    }
    if (line.rowStatus === 'promoted' && !input.force) {
      result.skipped += 1
      continue
    }

    try {
      const fields = quoteLineToProductFields(line)
      const existing = await findStoreProductBySku({ em, scope: input.scope, sku: line.derivedSku })
      let productId: string
      let priceId: string | null = null

      if (!existing) {
        const deletedProductId = await findDeletedProductIdBySku(em, input.scope, line.derivedSku)
        if (deletedProductId) {
          throw new Error(`SKU ${line.derivedSku} belongs to a deleted product; rename the line's SKU to promote it`)
        }
        if (!fields.name) throw new Error('Line has no product name')
        const created = await createStoreProduct({
          em,
          ctx: input.ctx,
          scope: input.scope,
          input: {
            sku: line.derivedSku,
            name: fields.name,
            specSummary: fields.specSummary,
            hsCode: fields.hsCode,
            unit: fields.unit ?? 'PCS',
            netWeight: fields.netWeight,
            grossWeight: fields.grossWeight,
            volume: fields.volume,
            // The line's `inner_packing` record is the same `{length,width,height,unit}` shape the
            // store models as `StoreDimensions`; the cast re-labels it, nothing is reinterpreted.
            dimensions: fields.dimensions as StoreDimensions | null,
            cartonQuantity: fields.cartonQuantity,
            status: 'active',
          },
          origin: 'sourcing:promote',
        })
        productId = created.id
        result.created += 1
      } else {
        productId = existing.id
        const payload = changedProductFields(existing, fields)
        if (Object.keys(payload).length > 0) {
          await updateStoreProduct({
            em,
            ctx: input.ctx,
            scope: input.scope,
            id: productId,
            input: mergeStoreInput(existing, payload),
            origin: 'sourcing:promote',
          })
          result.updated += 1
        } else {
          result.skipped += 1
        }
      }

      const existingPrices = await listStorePrices({ em, scope: input.scope, productId })
      const desired = desiredPriceRow(line, input.quote.currencyCode)
      const merged = mergePriceRows(existingPrices, desired)
      if (merged.rows.length > MAX_PRICE_ROWS) {
        throw new Error(`Product ${line.derivedSku} already has ${merged.rows.length} price rows; the price set cannot exceed ${MAX_PRICE_ROWS}`)
      }
      let priceRows = existingPrices
      if (merged.changed) {
        await replaceStorePrices({
          em,
          ctx: input.ctx,
          scope: input.scope,
          productId,
          // `mergePriceRows` emits exactly the store's price-input shape (tier, currency, minimum
          // quantity, unit price, dates, active flag) — the cast re-labels that documented contract.
          rows: merged.rows as StorePriceInput[],
          origin: 'sourcing:promote',
        })
        priceRows = await listStorePrices({ em, scope: input.scope, productId })
      }
      priceId = desiredPriceId(priceRows, desired)

      await em.fork().nativeUpdate(
        SourcingQuoteLine,
        { id: line.id },
        { rowStatus: 'promoted', catalogProductId: productId, promotedPriceId: priceId, promotedAt: new Date() },
      )

      // The library is `purchasing`'s record, so the promotion feeds it through that module's
      // command (`purchasing.supplier-products.import-from-quote`), which re-reads the line it was
      // just given and upserts the row — including the store link, which is why nothing but the
      // line id has to travel. A failure here must not undo a product write that already landed:
      // the line stays promoted and the reason is reported on its own row, so the operator can
      // repair one import instead of re-running the promotion. A quotation without a supplier
      // simply has no library to feed; that is not a failure.
      if (input.quote.supplierId) {
        try {
          await commandBus.execute('purchasing.supplier-products.import-from-quote', {
            input: { quoteId, lineIds: [String(line.id)] },
            ctx: libraryContext,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Supplier library update failed'
          logger.warn('promotion.library_failed', { quoteId, lineId, lineNumber: line.lineNumber, message })
          result.failed.push({ lineId, lineNumber: line.lineNumber, message })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Promotion failed'
      logger.warn('promotion.line_failed', { quoteId, lineId, lineNumber: line.lineNumber, message })
      await markLineFailed(em, line, message)
      result.failed.push({ lineId, lineNumber: line.lineNumber, message })
    }
  }

  const promotedCount = await em.fork().count(SourcingQuoteLine, { quote: quoteId, rowStatus: 'promoted' } as FilterQuery<SourcingQuoteLine>)
  await em.fork().nativeUpdate(SourcingQuote, { id: input.quote.id }, { promotedCount })

  return result
}

/**
 * The store writes the full native + custom payload on every update, so an update must carry the
 * current value of every field the line does not change; `changedProductFields` alone would blank
 * them. Its keys are the master's own field names, so they overlay the current values directly.
 */
function mergeStoreInput(current: StoreProduct, changed: Record<string, unknown>): StoreProductInput {
  const merged: StoreProductInput = {
    sku: current.sku,
    name: current.name,
    nameEn: current.nameEn,
    brand: current.brand,
    series: current.series,
    manufacturerModel: current.manufacturerModel,
    specSummary: current.specSummary,
    barcode: current.barcode,
    unit: current.unit,
    hsCode: current.hsCode,
    cnCode: current.cnCode,
    countryOfOriginCode: current.countryOfOriginCode,
    netWeight: current.netWeight,
    grossWeight: current.grossWeight,
    volume: current.volume,
    dimensions: current.dimensions,
    cartonQuantity: current.cartonQuantity,
    batteryCapacityMah: current.batteryCapacityMah,
    batteryWh: current.batteryWh,
    containsLithiumBattery: current.containsLithiumBattery,
    certifications: current.certifications,
    status: current.status,
    notes: current.notes,
    sourceProductId: current.sourceProductId,
  }
  return Object.assign(merged, changed)
}

/** The id of the active price row matching the promotion's `tier × currency × minimum quantity` key. */
function desiredPriceId(
  prices: readonly StorePrice[],
  desired: { tier: string; currencyCode: string; minQuantity: number },
): string | null {
  const row = prices.find(
    (price) =>
      price.tier === desired.tier &&
      price.currencyCode === desired.currencyCode &&
      price.minQuantity === desired.minQuantity &&
      price.isActive,
  )
  return row?.id ?? null
}

async function markLineFailed(em: EntityManager, line: SourcingQuoteLine, message: string): Promise<void> {
  const warnings = Array.isArray(line.warnings) ? line.warnings : []
  const nextWarnings = warnings.includes('promotion_failed') ? warnings : [...warnings, 'promotion_failed']
  await em
    .fork()
    .nativeUpdate(SourcingQuoteLine, { id: line.id }, { rowStatus: 'invalid', warnings: nextWarnings, selected: false })
  logger.warn('promotion.line_marked_invalid', { lineId: String(line.id), message })
}
