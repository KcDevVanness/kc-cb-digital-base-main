import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MAX_PRICE_ROWS, changedProductFields, mergePriceRows } from '../../products/lib/supplierMapping'
import { SourcingQuote, SourcingQuoteLine } from '../data/entities'
import { categoryCodeFromSection, desiredPriceRow, quoteLineToProductFields } from './productMapping'
import { findCategoryByCode, findProductBySku, loadProductPrices } from './productsReads'

/**
 * Promotes quotation lines into the product master.
 *
 * Every write goes through the products module's commands, because that is where the product's
 * events, query-index entries, audit rows and validation live; a direct insert would skip all
 * four. Three rules make the operation safe to run twice and safe to run partially:
 *
 * 1. **Per-line isolation** — a line that fails (soft-deleted SKU, unknown category, command
 *    error) is recorded as failed and marked `invalid` on its own row; the remaining lines still
 *    promote. Nothing is retried automatically.
 * 2. **Idempotency** — a line that already carries `promoted_product_id` is skipped, and a product
 *    whose price row already matches is not written again, so a second run reports `skipped`.
 * 3. **Non-destructive updates** — only non-empty, changed values reach `products.items.update`,
 *    and the price write submits the product's whole price set so the `internal` and `export`
 *    tiers survive (`products.prices.replace` deactivates rows missing from the payload).
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

  // The products commands read the optimistic-lock version from the request headers; the header on
  // this request belongs to the quotation, so it must not be forwarded to a product write.
  // The products and purchasing commands read the optimistic-lock version from the request
  // headers; the header on this request belongs to the promotion itself, so it must not be
  // forwarded to a write in another module.
  const productContext: CommandRuntimeContext = { ...input.ctx, request: undefined, syncOrigin: 'sourcing:promote' }
  const libraryContext: CommandRuntimeContext = { ...input.ctx, request: undefined, syncOrigin: 'sourcing:promote-library' }
  const categoryCache = new Map<string, string | null>()
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
      const categoryId = await resolveCategoryId({
        em,
        scope: input.scope,
        label: line.sectionLabel,
        ctx: productContext,
        commandBus,
        cache: categoryCache,
      })
      const fields = quoteLineToProductFields(line)
      const existing = await findProductBySku(em, input.scope, line.derivedSku)
      let productId: string
      let priceId: string | null = null

      if (existing && existing.deletedAt) {
        throw new Error(`SKU ${line.derivedSku} belongs to a deleted product; rename the line's SKU to promote it`)
      }

      if (!existing) {
        if (!fields.name) throw new Error('Line has no product name')
        const created = await commandBus.execute<Record<string, unknown>, { id: string }>('products.items.create', {
          input: {
            sku: line.derivedSku,
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
            categoryId,
            status: 'active',
          },
          ctx: productContext,
        })
        productId = String(created.result.id)
        result.created += 1
      } else {
        productId = existing.id
        const payload = changedProductFields(existing, fields)
        if (categoryId && categoryId !== existing.categoryId) payload.categoryId = categoryId
        if (Object.keys(payload).length > 0) {
          await commandBus.execute('products.items.update', {
            input: { id: productId, ...payload },
            ctx: productContext,
          })
          result.updated += 1
        } else {
          result.skipped += 1
        }
      }

      const existingPrices = await loadProductPrices(em, input.scope, productId)
      const desired = desiredPriceRow(line, input.quote.currencyCode)
      const merged = mergePriceRows(existingPrices, desired)
      if (merged.rows.length > MAX_PRICE_ROWS) {
        throw new Error(`Product ${line.derivedSku} already has ${merged.rows.length} price rows; the price set cannot exceed ${MAX_PRICE_ROWS}`)
      }
      if (merged.changed) {
        await commandBus.execute('products.prices.replace', {
          input: { productId, rows: merged.rows },
          ctx: productContext,
        })
        const written = merged.rows.find((row) => row.priceTier === 'purchase' && row.currencyCode === desired.currencyCode)
        priceId = typeof written?.id === 'string' ? written.id : null
      } else if (existingPrices.length > 0) {
        priceId = existingPrices.find((row) => row.priceTier === 'purchase' && row.currencyCode === desired.currencyCode)?.id ?? null
      }

      await em.fork().nativeUpdate(
        SourcingQuoteLine,
        { id: line.id },
        { rowStatus: 'promoted', promotedProductId: productId, promotedPriceId: priceId, promotedAt: new Date() },
      )

      // The library is `purchasing`'s record, so the promotion feeds it through that module's
      // command (`purchasing.supplier-products.import-from-quote`), which re-reads the line it was
      // just given and upserts the row — including the master link, which is why nothing but the
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

async function markLineFailed(em: EntityManager, line: SourcingQuoteLine, message: string): Promise<void> {
  const warnings = Array.isArray(line.warnings) ? line.warnings : []
  const nextWarnings = warnings.includes('promotion_failed') ? warnings : [...warnings, 'promotion_failed']
  await em
    .fork()
    .nativeUpdate(SourcingQuoteLine, { id: line.id }, { rowStatus: 'invalid', warnings: nextWarnings, selected: false })
  logger.warn('promotion.line_marked_invalid', { lineId: String(line.id), message })
}

/** Finds or creates the top-level product category a section banner maps to. */
async function resolveCategoryId(input: {
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
  label: string | null | undefined
  ctx: CommandRuntimeContext
  commandBus: CommandBusLike
  cache: Map<string, string | null>
}): Promise<string | null> {
  const code = categoryCodeFromSection(input.label)
  if (!code) return null
  if (input.cache.has(code)) return input.cache.get(code) ?? null
  const existing = await findCategoryByCode(input.em, input.scope, code)
  if (existing) {
    input.cache.set(code, existing.id)
    return existing.id
  }
  const created = await input.commandBus.execute<Record<string, unknown>, { id: string }>('products.categories.create', {
    input: { code, name: (input.label ?? code).trim().slice(0, 200), sortOrder: 0, isActive: true },
    ctx: input.ctx,
  })
  const id = String(created.result.id)
  input.cache.set(code, id)
  return id
}
