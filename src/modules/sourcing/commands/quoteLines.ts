import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { buildOptimisticLockConflictBody, enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { SourcingQuote, SourcingQuoteLine } from '../data/entities'
import { quoteLineCreateSchema, quoteLinesBatchUpdateSchema } from '../data/validators'
import { resolveLineStatus } from '../lib/quoteLines'
import eventsConfig from '../events'
import {
  QUOTE_LINE_RESOURCE_KIND,
  ensureScope,
  lineFilter,
  loadQuote,
  loadQuoteLine,
  quoteLineCrudEvents,
  quoteLineCrudIndexer,
  assertQuoteEditable,
} from './shared'

/**
 * Quotation line commands.
 *
 * The aggregate root is the quotation, so lines are never edited through the CRUD factory: the
 * header holds the status that decides whether an edit is allowed at all (`draft` only), and the
 * review grid saves many rows in one request. Each saved row carries the `updatedAt` it was
 * rendered with, which this command passes to the optimistic-lock helper as the typed `expected`
 * token; conflicts are collected across the batch and reported together so a stale tab cannot
 * overwrite a colleague's review silently.
 */

async function nextLineNumber(em: EntityManager, quoteId: string): Promise<number> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('sourcing_quote_lines')
    .select(({ fn }) => fn.max('line_number').as('max_line'))
    .where('quote_id', '=', quoteId)
    .execute()) as Array<{ max_line: number | string | null }>
  const current = rows[0]?.max_line ?? null
  const parsed = current === null ? 0 : Number(current)
  return Number.isFinite(parsed) ? parsed + 1 : 1
}

async function refreshQuoteCounters(em: EntityManager, quoteId: string): Promise<void> {
  const scoped = em.fork()
  const total = await scoped.count(SourcingQuoteLine, { quote: quoteId } as FilterQuery<SourcingQuoteLine>)
  const promoted = await scoped.count(SourcingQuoteLine, { quote: quoteId, rowStatus: 'promoted' } as FilterQuery<SourcingQuoteLine>)
  await scoped.nativeUpdate(SourcingQuote, { id: quoteId }, { lineCount: total, promotedCount: promoted })
}

const createQuoteLineCommand: CommandHandler<Record<string, unknown>, SourcingQuoteLine> = {
  id: 'sourcing.quote-lines.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteLineCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, parsed.quoteId)
    assertQuoteEditable(quote.status)

    const lineNumber = await nextLineNumber(em, String(quote.id))
    const statusLine = {
      productName: parsed.productName ?? null,
      itemNo: parsed.itemNo ?? null,
      derivedSku: parsed.derivedSku ?? null,
    }
    const created = await de.createOrmEntity({
      entity: SourcingQuoteLine,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        quote,
        lineNumber,
        sectionLabel: parsed.sectionLabel ?? null,
        itemNo: statusLine.itemNo,
        productName: statusLine.productName,
        variantLabel: null,
        derivedSku: statusLine.derivedSku,
        hsCode: parsed.hsCode ?? null,
        description: parsed.description ?? null,
        unit: parsed.unit,
        unitCost: parsed.unitCost ?? null,
        currencyCode: null,
        suggestedRsp: parsed.suggestedRsp ?? null,
        moqRaw: parsed.moqRaw ?? null,
        moqQuantity: parsed.moqQuantity ?? null,
        cartonQuantity: parsed.cartonQuantity ?? null,
        cartons: parsed.cartons ?? null,
        unitNetWeight: parsed.unitNetWeight ?? null,
        cartonGrossWeight: parsed.cartonGrossWeight ?? null,
        cartonNetWeight: parsed.cartonNetWeight ?? null,
        innerPacking: parsed.innerPacking ?? null,
        outerPacking: parsed.outerPacking ?? null,
        cartonVolume: parsed.cartonVolume ?? null,
        raw: null,
        warnings: [],
        rowStatus: resolveLineStatus(statusLine),
        selected: parsed.selected,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteLineCrudEvents,
      indexer: quoteLineCrudIndexer,
    })
    await refreshQuoteCounters(em, String(quote.id))
    return created
  },
}

const deleteQuoteLineCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'sourcing.quote-lines.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    // The CRUD factory hands the delete command `{ body, query }` rather than a parsed schema.
    const id = requireId(rawInput, 'Quotation line id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const line = await loadQuoteLine(em, scope, id)
    if (!line) throw notFound('Quotation line not found')
    const quote = await loadQuote(em, scope, String(line.quote.id))
    assertQuoteEditable(quote.status)
    if (line.rowStatus === 'promoted') {
      throw new CrudHttpError(409, {
        error: 'A promoted line cannot be deleted; it is the record of what was written to the product master',
        code: 'line_already_promoted',
      })
    }

    const removed = await de.deleteOrmEntity({
      entity: SourcingQuoteLine,
      where: lineFilter(scope, id),
      // Lines are rows of a draft document, not records with history: a hard delete is what the
      // operator means by removing a row they do not want, and `sourcing_quote_lines` has no
      // `deleted_at` column to hide behind.
      soft: false,
    })
    if (!removed) throw notFound('Quotation line not found')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: line,
      identifiers: { id: String(line.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteLineCrudEvents,
      indexer: quoteLineCrudIndexer,
    })
    await refreshQuoteCounters(em, String(line.quote.id))
    return { id: String(line.id) }
  },
}

export type QuoteLinesBatchUpdateResult = {
  updated: number
  conflicts: Array<{ id: string; currentUpdatedAt: string | null; expectedUpdatedAt: string }>
}

/**
 * Saves what the operator changed in the review grid in one request.
 *
 * Every row is version-checked before anything is written, so a conflicting row fails the whole
 * batch instead of half-applying a review. The 409 body is the platform's optimistic-lock shape
 * (`code: 'optimistic_lock_conflict'` + the two timestamps), which is what
 * `surfaceRecordConflict` recognizes and renders as the shared conflict bar; the per-row list
 * rides along in `conflicts` for callers that want to highlight exactly which rows moved.
 */
const updateQuoteLinesBatchCommand: CommandHandler<Record<string, unknown>, QuoteLinesBatchUpdateResult> = {
  id: 'sourcing.quote-lines.update-batch',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteLinesBatchUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const quote = await loadQuote(em, scope, parsed.quoteId)
    assertQuoteEditable(quote.status)

    const loaded: Array<{ row: (typeof parsed.rows)[number]; entity: SourcingQuoteLine }> = []
    const conflicts: QuoteLinesBatchUpdateResult['conflicts'] = []
    for (const row of parsed.rows) {
      const entity = await loadQuoteLine(em, scope, row.id)
      if (!entity || String(entity.quote.id) !== parsed.quoteId) continue
      try {
        enforceCommandOptimisticLock({
          resourceKind: QUOTE_LINE_RESOURCE_KIND,
          resourceId: String(entity.id),
          current: entity.updatedAt,
          expected: row.updatedAt,
        })
      } catch (error) {
        if (error instanceof CrudHttpError && error.status === 409) {
          conflicts.push({ id: String(entity.id), currentUpdatedAt: entity.updatedAt?.toISOString() ?? null, expectedUpdatedAt: row.updatedAt })
          continue
        }
        throw error
      }
      loaded.push({ row, entity })
    }
    if (conflicts.length > 0) {
      const first = conflicts[0]
      if (first.currentUpdatedAt && first.expectedUpdatedAt) {
        throw new CrudHttpError(409, {
          ...buildOptimisticLockConflictBody(first.currentUpdatedAt, first.expectedUpdatedAt),
          conflicts,
        })
      }
      throw new CrudHttpError(409, {
        error: 'Some lines were changed by someone else; reload them and try again',
        code: 'quote_line_conflict',
        conflicts,
      })
    }

    const scoped = em.fork()
    for (const { row, entity } of loaded) {
      const managed = await scoped.findOne(SourcingQuoteLine, lineFilter(scope, row.id))
      if (!managed) continue
      if (row.selected !== undefined) managed.selected = row.selected
      if (row.derivedSku !== undefined) managed.derivedSku = row.derivedSku ?? null
      if (row.productName !== undefined) managed.productName = row.productName ?? null
      if (row.moqQuantity !== undefined) managed.moqQuantity = row.moqQuantity ?? null
      if (row.unitCost !== undefined) managed.unitCost = row.unitCost ?? null
      if (row.sectionLabel !== undefined) managed.sectionLabel = row.sectionLabel ?? null
      managed.rowStatus = resolveLineStatus({
        productName: managed.productName ?? null,
        itemNo: managed.itemNo ?? null,
        derivedSku: managed.derivedSku ?? null,
      })
    }
    await scoped.flush()

    await eventsConfig.emit('sourcing.quote_line.updated', {
      quoteId: parsed.quoteId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      updated: loaded.length,
    })
    return { updated: loaded.length, conflicts: [] }
  },
}

registerCommand(createQuoteLineCommand)
registerCommand(deleteQuoteLineCommand)
registerCommand(updateQuoteLinesBatchCommand)

export {
  createQuoteLineCommand,
  deleteQuoteLineCommand,
  updateQuoteLinesBatchCommand,
  refreshQuoteCounters,
}
