import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { SourcingImportProfile, SourcingQuote, SourcingQuoteLine } from '../data/entities'
import {
  quoteApproveSchema,
  quoteArchiveSchema,
  quoteCreateSchema,
  quoteParseSchema,
  quoteRemapSchema,
  quoteUpdateSchema,
  type QuoteRemapInput,
} from '../data/validators'
import { assertCurrencyKnown } from '../lib/currencyDictionary'
import { loadSupplierName } from '../lib/purchasingReads'
import type { ColumnMap, DetectedColumnMapping } from '../lib/columnMapping'
import { analyzeSheet, summarizeWorkbook, type SheetAnalysis, type SheetSummary } from '../lib/quoteAnalysis'
import { loadProfileName, readWorkbookForQuote } from '../lib/quoteSource'
import eventsConfig from '../events'
import {
  QUOTE_RESOURCE_KIND,
  assertQuoteEditable,
  countPromotedLines,
  ensureScope,
  isUniqueViolation,
  loadQuote,
  nextQuoteNumber,
  quoteCrudEvents,
  quoteCrudIndexer,
  quoteFilter,
  toLineColumns,
  type SourcingScope,
} from './shared'

/**
 * Quotation commands.
 *
 * `parse` and `remap` are the two halves of one operation: both read the stored workbook back
 * through `attachmentService.readScoped`, run the same detection/mapping/line-building pipeline,
 * and replace the quotation's *staged* lines. They differ only in where the mapping comes from —
 * `parse` uses the saved profile, the standard template or the alias dictionary, `remap` uses the
 * mapping the operator confirmed in the wizard. Because the file itself is the source, a re-parse
 * is deterministic and never needs the operator to upload again.
 */

export type SerializedQuote = {
  id: string
  number: string | null
  supplierId: string | null
  supplierNameSnapshot: string | null
  quoteDate: string | null
  validUntil: string | null
  currencyCode: string
  status: string
  sourceKind: string
  sourceAttachmentId: string | null
  sourceFileName: string | null
  sourceSheetName: string | null
  sourceLayoutSignature: string | null
  headerRowIndex: number | null
  columnMap: Record<string, unknown> | null
  sectionRules: Record<string, unknown> | null
  sourceProfileId: string | null
  lineCount: number
  promotedCount: number
  notes: string | null
  approvedAt: string | null
  tenantId: string
  organizationId: string
  created_at: string | null
  updated_at: string | null
  updatedAt: string | null
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function serializeQuote(entity: SourcingQuote): SerializedQuote {
  return {
    id: String(entity.id),
    number: entity.number ?? null,
    supplierId: entity.supplierId ?? null,
    supplierNameSnapshot: entity.supplierNameSnapshot ?? null,
    quoteDate: toIso(entity.quoteDate)?.slice(0, 10) ?? null,
    validUntil: toIso(entity.validUntil)?.slice(0, 10) ?? null,
    currencyCode: entity.currencyCode,
    status: entity.status,
    sourceKind: entity.sourceKind,
    sourceAttachmentId: entity.sourceAttachmentId ?? null,
    sourceFileName: entity.sourceFileName ?? null,
    sourceSheetName: entity.sourceSheetName ?? null,
    sourceLayoutSignature: entity.sourceLayoutSignature ?? null,
    headerRowIndex: entity.headerRowIndex ?? null,
    columnMap: entity.columnMap ?? null,
    sectionRules: entity.sectionRules ?? null,
    sourceProfileId: entity.sourceProfileId ?? null,
    lineCount: entity.lineCount,
    promotedCount: entity.promotedCount,
    notes: entity.notes ?? null,
    approvedAt: toIso(entity.approvedAt),
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
    created_at: toIso(entity.createdAt),
    updated_at: toIso(entity.updatedAt),
    updatedAt: toIso(entity.updatedAt),
  }
}

/** Everything the wizard needs to render a parsed sheet without another round trip. */
export type QuoteParseOutcome = {
  quote: SerializedQuote
  sheets: SheetSummary[]
  sheetName: string
  headerRowIndex: number
  unitRowIndex: number | null
  headerCells: string[]
  sampleRows: string[][]
  columns: DetectedColumnMapping[]
  duplicateTargets: string[]
  unmappedColumns: number[]
  sections: { rowIndex: number; label: string }[]
  rejectedRows: { rowIndex: number; reason: string; preview?: string }[]
  structureWarnings: string[]
  dataRowCount: number
  lineCount: number
  warnings: string[]
  templateMatched: boolean
  matchedProfileId: string | null
  matchedProfileName: string | null
  layoutSignature: string
  detectedCurrency: string | null
}

function buildOutcome(
  quote: SourcingQuote,
  sheets: SheetSummary[],
  analysis: SheetAnalysis,
  matchedProfileName: string | null = null,
): QuoteParseOutcome {
  return {
    quote: serializeQuote(quote),
    sheets,
    sheetName: analysis.sheetName,
    headerRowIndex: analysis.headerRowIndex,
    unitRowIndex: analysis.unitRowIndex,
    headerCells: analysis.headerCells,
    sampleRows: analysis.sampleRows,
    columns: analysis.columns,
    duplicateTargets: analysis.duplicateTargets,
    unmappedColumns: analysis.unmappedColumns,
    sections: analysis.sections,
    rejectedRows: analysis.rejectedRows,
    structureWarnings: analysis.structureWarnings,
    dataRowCount: analysis.dataRowCount,
    lineCount: analysis.lines.length,
    warnings: analysis.lineWarnings,
    templateMatched: analysis.templateMatched,
    matchedProfileId: analysis.matchedProfileId,
    matchedProfileName,
    layoutSignature: analysis.layoutSignature,
    detectedCurrency: analysis.detectedCurrency,
  }
}

function profileToAnalysisInput(profile: SourcingImportProfile | null) {
  if (!profile) return null
  return {
    id: String(profile.id),
    columnMap: (profile.columnMap ?? {}) as ColumnMap,
    headerRowIndex: profile.headerRowIndex,
    sheetName: profile.sheetName ?? null,
    sectionRules: profile.sectionRules ?? null,
  }
}

/**
 * Replaces the quotation's lines with the ones the analysis produced. Promoted lines are never
 * touched — the caller refuses the operation when any exist, because those lines are the record
 * of what was written into the product master.
 */
async function replaceQuoteLines(
  em: EntityManager,
  scope: SourcingScope,
  quote: SourcingQuote,
  analysis: SheetAnalysis,
): Promise<void> {
  const scoped = em.fork()
  const existing = await scoped.find(SourcingQuoteLine, { quote: String(quote.id) } as FilterQuery<SourcingQuoteLine>)
  for (const line of existing) scoped.remove(line)
  await scoped.flush()

  const insert = em.fork()
  for (const line of analysis.lines) {
    insert.persist(
      insert.create(SourcingQuoteLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        quote,
        ...toLineColumns(line),
      }),
    )
  }
  await insert.flush()
}

async function applySourceMetadata(input: {
  em: EntityManager
  quote: SourcingQuote
  attachmentId: string
  fileName: string
  sheetName: string
  headerRowIndex: number
  columnMap: ColumnMap
  sectionRules: Record<string, unknown>
  layoutSignature: string
  profileId: string | null
  lineCount: number
}): Promise<void> {
  await input.em.fork().nativeUpdate(
    SourcingQuote,
    { id: input.quote.id },
    {
      sourceKind: 'excel_import',
      sourceAttachmentId: input.attachmentId,
      sourceFileName: input.fileName,
      sourceSheetName: input.sheetName,
      sourceLayoutSignature: input.layoutSignature,
      headerRowIndex: input.headerRowIndex,
      columnMap: input.columnMap as unknown as Record<string, unknown>,
      sectionRules: input.sectionRules,
      sourceProfileId: input.profileId,
      lineCount: input.lineCount,
    },
  )
}

function sectionRulesFor(analysis: SheetAnalysis, override?: Record<string, unknown>): Record<string, unknown> {
  return {
    useSections: true,
    categoryFromSection: true,
    detectedCurrency: analysis.detectedCurrency,
    ...(override ?? {}),
  }
}

const createQuoteCommand: CommandHandler<Record<string, unknown>, SourcingQuote> = {
  id: 'sourcing.quotes.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const created = await de.createOrmEntity({
      entity: SourcingQuote,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplierId: parsed.supplierId ?? null,
        supplierNameSnapshot: parsed.supplierNameSnapshot ?? null,
        quoteDate: parsed.quoteDate ? new Date(parsed.quoteDate) : null,
        validUntil: parsed.validUntil ? new Date(parsed.validUntil) : null,
        currencyCode: parsed.currencyCode,
        status: 'draft',
        sourceKind: parsed.sourceKind,
        sourceFileName: parsed.sourceFileName ?? null,
        notes: parsed.notes ?? null,
        createdBy: ctx.auth?.sub ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    return created
  },
}

const updateQuoteCommand: CommandHandler<Record<string, unknown>, SourcingQuote> = {
  id: 'sourcing.quotes.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, parsed.id)
    assertQuoteEditable(quote.status)
    enforceCommandOptimisticLock({
      resourceKind: QUOTE_RESOURCE_KIND,
      resourceId: String(quote.id),
      current: quote.updatedAt,
      request: ctx.request,
    })

    const updated = await de.updateOrmEntity({
      entity: SourcingQuote,
      where: quoteFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.supplierId !== undefined) entity.supplierId = parsed.supplierId ?? null
        if (parsed.supplierNameSnapshot !== undefined) entity.supplierNameSnapshot = parsed.supplierNameSnapshot ?? null
        if (parsed.quoteDate !== undefined) entity.quoteDate = parsed.quoteDate ? new Date(parsed.quoteDate) : null
        if (parsed.validUntil !== undefined) entity.validUntil = parsed.validUntil ? new Date(parsed.validUntil) : null
        if (parsed.currencyCode !== undefined) entity.currencyCode = parsed.currencyCode
        if (parsed.notes !== undefined) entity.notes = parsed.notes ?? null
      },
    })
    if (!updated) throw notFound('Supplier quotation not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    return updated
  },
}

const deleteQuoteCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'sourcing.quotes.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    // The CRUD factory hands the delete command `{ body, query }` rather than a parsed schema,
    // so the id is read through the platform helper that understands both shapes.
    const id = requireId(rawInput, 'Quotation id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, id)
    if (quote.status !== 'draft' && quote.status !== 'cancelled') {
      throw new CrudHttpError(422, {
        error: 'Only a draft or cancelled quotation can be deleted; archive an approved one instead',
        code: 'quote_not_deletable',
      })
    }
    enforceCommandOptimisticLock({
      resourceKind: QUOTE_RESOURCE_KIND,
      resourceId: String(quote.id),
      current: quote.updatedAt,
      request: ctx.request,
    })

    const removed = await de.deleteOrmEntity({ entity: SourcingQuote, where: quoteFilter(scope, id) })
    if (!removed) throw notFound('Supplier quotation not found')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: quote,
      identifiers: { id: String(quote.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    return { id: String(quote.id) }
  },
}

const parseQuoteCommand: CommandHandler<Record<string, unknown>, QuoteParseOutcome> = {
  id: 'sourcing.quotes.parse',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteParseSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, parsed.quoteId)
    assertQuoteEditable(quote.status)
    if ((await countPromotedLines(em, String(quote.id))) > 0) {
      throw new CrudHttpError(409, {
        error: 'This quotation already has promoted lines; re-parsing would break their link to the product master',
        code: 'quote_lines_promoted',
      })
    }

    const workbook = await readWorkbookForQuote({
      container: ctx.container,
      auth: ctx.auth,
      quote,
      attachmentId: parsed.attachmentId,
    })
    const sheets = summarizeWorkbook(workbook)

    const initial = analyzeSheet({ workbook, sheetName: parsed.sheetName })
    if (!initial.ok) {
      throw new CrudHttpError(422, {
        error: initial.reason === 'sheet_not_found' ? 'The worksheet was not found in the workbook' : 'No header row could be detected in this worksheet',
        code: initial.reason,
      })
    }

    const profile = parsed.profileId
      ? await em.fork().findOne(SourcingImportProfile, {
          id: parsed.profileId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        } as FilterQuery<SourcingImportProfile>)
      : await em.fork().findOne(SourcingImportProfile, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          layoutSignature: initial.analysis.layoutSignature,
        } as FilterQuery<SourcingImportProfile>)

    const analysisResult = profile
      ? analyzeSheet({
          workbook,
          sheetName: parsed.sheetName ?? profile.sheetName ?? undefined,
          headerRowIndex: parsed.headerRowIndex,
          profile: profileToAnalysisInput(profile),
        })
      : analyzeSheet({ workbook, sheetName: parsed.sheetName, headerRowIndex: parsed.headerRowIndex })
    if (!analysisResult.ok) {
      throw new CrudHttpError(422, {
        error: 'No header row could be detected in this worksheet',
        code: analysisResult.reason,
      })
    }
    const analysis = analysisResult.analysis

    await replaceQuoteLines(em, scope, quote, analysis)
    await applySourceMetadata({
      em,
      quote,
      attachmentId: parsed.attachmentId,
      fileName: quote.sourceFileName ?? 'workbook',
      sheetName: analysis.sheetName,
      headerRowIndex: analysis.headerRowIndex,
      columnMap: analysis.columnMap,
      sectionRules: sectionRulesFor(analysis),
      layoutSignature: analysis.layoutSignature,
      profileId: analysis.matchedProfileId,
      lineCount: analysis.lines.length,
    })
    if (profile) {
      await em
        .fork()
        .nativeUpdate(SourcingImportProfile, { id: profile.id }, { usageCount: profile.usageCount + 1, lastUsedAt: new Date() })
    }

    const refreshed = await loadQuote(em, scope, String(quote.id))

    // The header write above goes through `nativeUpdate`, so the CRUD side effects are emitted
    // explicitly: the route declares this entity's indexer, and a declared indexer must be
    // discharged or the platform warns that the query index kept stale values.
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: refreshed,
      identifiers: { id: String(refreshed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    await eventsConfig.emit('sourcing.quote.updated', {
      id: String(refreshed.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      lineCount: analysis.lines.length,
    })
    return buildOutcome(refreshed, sheets, analysis, await loadProfileName(em, scope, analysis.matchedProfileId))
  },
}

const remapQuoteCommand: CommandHandler<Record<string, unknown>, QuoteParseOutcome> = {
  id: 'sourcing.quotes.remap',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed: QuoteRemapInput = quoteRemapSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, parsed.quoteId)
    assertQuoteEditable(quote.status)
    if ((await countPromotedLines(em, String(quote.id))) > 0) {
      throw new CrudHttpError(409, {
        error: 'This quotation already has promoted lines; re-mapping would break their link to the product master',
        code: 'quote_lines_promoted',
      })
    }
    if (!quote.sourceAttachmentId) {
      throw new CrudHttpError(422, { error: 'Upload a workbook before mapping its columns', code: 'attachment_missing' })
    }

    const workbook = await readWorkbookForQuote({
      container: ctx.container,
      auth: ctx.auth,
      quote,
      attachmentId: quote.sourceAttachmentId,
    })
    const sheets = summarizeWorkbook(workbook)
    const analysisResult = analyzeSheet({
      workbook,
      sheetName: parsed.sheetName,
      headerRowIndex: parsed.headerRowIndex,
      profile: {
        id: '',
        columnMap: parsed.columnMap as ColumnMap,
        headerRowIndex: parsed.headerRowIndex,
        sheetName: parsed.sheetName,
        sectionRules: parsed.sectionRules ?? null,
      },
    })
    if (!analysisResult.ok) {
      throw new CrudHttpError(422, {
        error: 'The chosen header row cannot be used for this worksheet',
        code: analysisResult.reason,
      })
    }
    const analysis = analysisResult.analysis

    let savedProfileId: string | null = null
    if (parsed.saveProfile) {
      savedProfileId = await upsertProfile(em, scope, {
        quote,
        name: parsed.profileName ?? `${quote.sourceFileName ?? 'quotation'} · ${analysis.sheetName}`,
        analysis,
        columnMap: parsed.columnMap as ColumnMap,
        sectionRules: parsed.sectionRules ?? null,
      })
    }

    await replaceQuoteLines(em, scope, quote, analysis)
    await applySourceMetadata({
      em,
      quote,
      attachmentId: quote.sourceAttachmentId,
      fileName: quote.sourceFileName ?? 'workbook',
      sheetName: analysis.sheetName,
      headerRowIndex: analysis.headerRowIndex,
      columnMap: analysis.columnMap,
      sectionRules: sectionRulesFor(analysis, parsed.sectionRules),
      layoutSignature: analysis.layoutSignature,
      profileId: savedProfileId ?? quote.sourceProfileId ?? null,
      lineCount: analysis.lines.length,
    })

    const refreshed = await loadQuote(em, scope, String(quote.id))

    // The header write above goes through `nativeUpdate`, so the CRUD side effects are emitted
    // explicitly: the route declares this entity's indexer, and a declared indexer must be
    // discharged or the platform warns that the query index kept stale values.
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: refreshed,
      identifiers: { id: String(refreshed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    await eventsConfig.emit('sourcing.quote.updated', {
      id: String(refreshed.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      lineCount: analysis.lines.length,
    })
    const outcome = buildOutcome(refreshed, sheets, analysis, await loadProfileName(em, scope, savedProfileId))
    return savedProfileId ? { ...outcome, matchedProfileId: savedProfileId } : outcome
  },
}

/** Saves (or refreshes) the mapping profile for a layout signature. */
async function upsertProfile(
  em: EntityManager,
  scope: SourcingScope,
  input: {
    quote: SourcingQuote
    name: string
    analysis: SheetAnalysis
    columnMap: ColumnMap
    sectionRules: Record<string, unknown> | null
  },
): Promise<string> {
  const scoped = em.fork()
  const existing = await scoped.findOne(SourcingImportProfile, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    layoutSignature: input.analysis.layoutSignature,
  } as FilterQuery<SourcingImportProfile>)
  const columnMap = input.columnMap as unknown as Record<string, unknown>
  if (existing) {
    await scoped.nativeUpdate(
      SourcingImportProfile,
      { id: existing.id },
      {
        name: input.name,
        sheetName: input.analysis.sheetName,
        headerRowIndex: input.analysis.headerRowIndex,
        columnMap,
        sectionRules: input.sectionRules,
        supplierId: input.quote.supplierId ?? null,
        lastUsedAt: new Date(),
      },
    )
    return String(existing.id)
  }
  const created = scoped.create(SourcingImportProfile, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name: input.name,
    supplierId: input.quote.supplierId ?? null,
    layoutSignature: input.analysis.layoutSignature,
    sheetName: input.analysis.sheetName,
    headerRowIndex: input.analysis.headerRowIndex,
    columnMap,
    sectionRules: input.sectionRules,
    fieldOptions: null,
    builtIn: false,
    usageCount: 0,
    lastUsedAt: new Date(),
  })
  scoped.persist(created)
  try {
    await scoped.flush()
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await em.fork().findOne(SourcingImportProfile, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        layoutSignature: input.analysis.layoutSignature,
      } as FilterQuery<SourcingImportProfile>)
      if (raced) return String(raced.id)
    }
    throw error
  }
  return String(created.id)
}

const approveQuoteCommand: CommandHandler<Record<string, unknown>, SerializedQuote> = {
  id: 'sourcing.quotes.approve',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteApproveSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, parsed.id)
    if (quote.status !== 'draft') {
      throw new CrudHttpError(409, { error: 'Only a draft quotation can be approved', code: 'quote_not_draft' })
    }
    enforceCommandOptimisticLock({
      resourceKind: QUOTE_RESOURCE_KIND,
      resourceId: String(quote.id),
      current: quote.updatedAt,
      request: ctx.request,
    })

    const readyLines = await em.fork().count(SourcingQuoteLine, {
      quote: String(quote.id),
      rowStatus: 'ready',
      selected: true,
    } as FilterQuery<SourcingQuoteLine>)
    if (readyLines === 0) {
      throw new CrudHttpError(422, {
        error: 'Select at least one ready line before approving the quotation',
        code: 'no_ready_lines',
      })
    }
    await assertCurrencyKnown(em, scope, quote.currencyCode)

    const supplierSnapshot = quote.supplierNameSnapshot ?? (await loadSupplierName(em, scope, quote.supplierId))
    const updated = await de.updateOrmEntity({
      entity: SourcingQuote,
      where: quoteFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = 'approved'
        entity.approvedAt = new Date()
        entity.number = entity.number ?? `SQ-PENDING-${String(entity.id).slice(0, 8)}`
        if (supplierSnapshot) entity.supplierNameSnapshot = supplierSnapshot
      },
    })
    if (!updated) throw notFound('Supplier quotation not found')

    if (!updated.number || updated.number.startsWith('SQ-PENDING-')) {
      updated.number = await nextQuoteNumber(em, scope)
      await em.fork().nativeUpdate(SourcingQuote, { id: updated.id }, { number: updated.number })
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    await eventsConfig.emit('sourcing.quote.approved', {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      number: updated.number ?? null,
    })
    return serializeQuote(updated)
  },
}

const archiveQuoteCommand: CommandHandler<Record<string, unknown>, SerializedQuote> = {
  id: 'sourcing.quotes.archive',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = quoteArchiveSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const quote = await loadQuote(em, scope, parsed.id)
    if (quote.status === 'archived') return serializeQuote(quote)
    if (quote.status === 'draft') {
      throw new CrudHttpError(409, { error: 'A draft quotation is deleted, not archived', code: 'quote_not_approved' })
    }
    enforceCommandOptimisticLock({
      resourceKind: QUOTE_RESOURCE_KIND,
      resourceId: String(quote.id),
      current: quote.updatedAt,
      request: ctx.request,
    })
    const updated = await de.updateOrmEntity({
      entity: SourcingQuote,
      where: quoteFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = 'archived'
      },
    })
    if (!updated) throw notFound('Supplier quotation not found')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: quoteCrudEvents,
      indexer: quoteCrudIndexer,
    })
    await eventsConfig.emit('sourcing.quote.archived', {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return serializeQuote(updated)
  },
}

registerCommand(createQuoteCommand)
registerCommand(updateQuoteCommand)
registerCommand(deleteQuoteCommand)
registerCommand(parseQuoteCommand)
registerCommand(remapQuoteCommand)
registerCommand(approveQuoteCommand)
registerCommand(archiveQuoteCommand)

export {
  createQuoteCommand,
  updateQuoteCommand,
  deleteQuoteCommand,
  parseQuoteCommand,
  remapQuoteCommand,
  approveQuoteCommand,
  archiveQuoteCommand,
}
