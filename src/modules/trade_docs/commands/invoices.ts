import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TradeDocsContract, TradeDocsContractLine, TradeDocsDocument, TradeDocsDocumentLine, TradeDocsInvoice, TradeDocsInvoiceLine } from '../data/entities'
import {
  invoiceAttachSchema,
  invoiceCopySchema,
  invoiceCreateSchema,
  invoiceTransitionSchema,
  invoiceUpdateSchema,
  type InvoiceLineInput,
} from '../data/validators'
import { invalidateInvoiceCaches } from '../lib/cacheInvalidation'
import { ensureScope, invoiceFilter, loadContract, loadDocument, loadInvoice, type TradeDocsScope } from '../lib/scope'
import { recomputeContractHead } from '../lib/contractRecalc'
import { productSnapshotPayload, readProductSnapshots } from '../lib/productSnapshots'
import { computeInvoiceLineTax, computeInvoiceTotals } from '../lib/invoiceTax'
import { eventsConfig } from '../events'

const ENTITY_ID = 'trade_docs:trade_docs_invoice' as const
const RESOURCE_KIND = 'trade_docs.invoice' as const

const ALLOWED_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  confirm: { from: ['draft'], to: 'confirmed' },
  void: { from: ['confirmed'], to: 'void' },
}

const TRANSITION_EVENT_IDS = {
  confirm: 'trade_docs.invoice.confirmed',
  void: 'trade_docs.invoice.voided',
} as const

export const invoiceCrudEvents: CrudEventsConfig<TradeDocsInvoice> = {
  module: 'trade_docs',
  entity: 'invoice',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<TradeDocsInvoice>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    status: ctx.entity?.status ?? null,
    number: ctx.entity?.number ?? null,
    direction: ctx.entity?.direction ?? null,
  }),
}

export const invoiceCrudIndexer: CrudIndexerConfig<TradeDocsInvoice> = {
  entityType: ENTITY_ID,
}

type SerializedInvoice = {
  id: string
  number: string | null
  invoiceKind: string | null
  ourNumber: string | null
  direction: string
  status: string
  counterpartyKind: string
  counterpartyId: string | null
  contractId: string | null
  currencyCode: string
  subtotal: string
  total: string
  taxTotal: string
  grossTotal: string
  issuedAt: string | null
  attachmentId: string | null
  notes: string | null
  tenantId: string
  organizationId: string
}

function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function contractIdFrom(value: TradeDocsInvoice['contract']): string | null {
  if (!value) return null
  return typeof value === 'object' && 'id' in value ? String(value.id) : String(value)
}

function serializeInvoice(entity: TradeDocsInvoice): SerializedInvoice {
  return {
    id: String(entity.id),
    number: entity.number ?? null,
    invoiceKind: entity.invoiceKind ?? null,
    ourNumber: entity.ourNumber ?? null,
    direction: entity.direction,
    status: entity.status,
    counterpartyKind: entity.counterpartyKind,
    counterpartyId: entity.counterpartyId ? String(entity.counterpartyId) : null,
    contractId: contractIdFrom(entity.contract),
    currencyCode: entity.currencyCode,
    subtotal: entity.subtotal,
    total: entity.total,
    taxTotal: entity.taxTotal,
    grossTotal: entity.grossTotal,
    issuedAt: toDateOnly(entity.issuedAt),
    attachmentId: entity.attachmentId ? String(entity.attachmentId) : null,
    notes: entity.notes ?? null,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

type ResolvedInvoiceLine = {
  lineNumber: number
  productId: string | null
  productSnapshot: Record<string, unknown> | null
  description: string
  sku: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  amount: string
  taxRate: string
  priceIncludesTax: boolean
  taxAmount: string
  contractLineId: string | null
}

/**
 * Resolves product snapshots and validates contract-line bindings.
 *
 * A bound contract line must belong to the invoice's own contract and to the caller's
 * organization: a binding that pointed elsewhere would move money on a contract the operator is
 * not looking at, which is exactly the failure the invoice-authoritative caliber would amplify.
 */
async function resolveInvoiceLines(
  em: EntityManager,
  scope: TradeDocsScope,
  invoiceContractId: string | null,
  lines: InvoiceLineInput[],
): Promise<ResolvedInvoiceLine[]> {
  const productIds = lines
    .map((line) => line.productId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const snapshots = await readProductSnapshots(em, scope, productIds)

  const contractLineIds = Array.from(
    new Set(
      lines
        .map((line) => line.contractLineId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const contractIdsByLine = new Map<string, string>()
  if (contractLineIds.length > 0) {
    if (!invoiceContractId) {
      throw badRequest('Binding an invoice line to a contract line requires the invoice to name its contract')
    }
    const rows = (await (em.fork().getKysely<any>())
      .selectFrom('trade_docs_contract_lines')
      .select(['id', 'contract_id'])
      .where('id', 'in', contractLineIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .execute()) as Array<{ id: string; contract_id: string }>
    for (const row of rows) contractIdsByLine.set(String(row.id), String(row.contract_id))
    for (const lineId of contractLineIds) {
      const owner = contractIdsByLine.get(lineId)
      if (!owner) throw badRequest(`Contract line not found in this organization: ${lineId}`)
      if (owner !== invoiceContractId) {
        throw badRequest('A bound contract line must belong to the invoice’s own contract')
      }
    }
  }

  return lines.map((line, index) => {
    const snapshot = line.productId ? snapshots.get(line.productId) : undefined
    const description = (line.description ?? snapshot?.name ?? '').trim()
    if (!description) {
      throw badRequest(`Line ${index + 1} needs a product or a description`)
    }
    return {
      lineNumber: index + 1,
      productId: line.productId ?? null,
      productSnapshot: line.productSnapshot ?? (snapshot ? productSnapshotPayload(snapshot) : null),
      description,
      sku: line.sku ?? snapshot?.sku ?? null,
      unit: line.unit ?? snapshot?.unit ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      taxRate: line.taxRate,
      priceIncludesTax: line.priceIncludesTax,
      taxAmount: computeInvoiceLineTax({ amount: line.amount, taxRate: line.taxRate, priceIncludesTax: line.priceIncludesTax }).taxAmount,
      contractLineId: line.contractLineId ?? null,
    }
  })
}

async function persistInvoiceLines(
  em: EntityManager,
  scope: TradeDocsScope,
  invoice: TradeDocsInvoice,
  lines: ResolvedInvoiceLine[],
): Promise<void> {
  await em.nativeDelete(TradeDocsInvoiceLine, {
    invoice: invoice.id,
  } as FilterQuery<TradeDocsInvoiceLine>)
  const now = new Date()
  for (const line of lines) {
    em.persist(
      em.create(TradeDocsInvoiceLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        invoice,
        lineNumber: line.lineNumber,
        productId: line.productId,
        productSnapshot: line.productSnapshot,
        description: line.description,
        sku: line.sku,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        taxRate: line.taxRate,
        priceIncludesTax: line.priceIncludesTax,
        taxAmount: line.taxAmount,
        contractLine: line.contractLineId ? em.getReference(TradeDocsContractLine, line.contractLineId) : undefined,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()
}

/** Applies the invoice totals to the row it owns. */
async function applyInvoiceTotals(
  em: EntityManager,
  scope: TradeDocsScope,
  invoice: TradeDocsInvoice,
): Promise<void> {
  const lines = await em.find(TradeDocsInvoiceLine, {
    invoice: invoice.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as FilterQuery<TradeDocsInvoiceLine>)
  const totals = computeInvoiceTotals(lines)
  invoice.subtotal = totals.subtotal
  invoice.total = totals.total
  invoice.taxTotal = totals.taxTotal
  invoice.grossTotal = totals.grossTotal
  await em.flush()
}

async function assertContractVisible(
  em: EntityManager,
  scope: TradeDocsScope,
  contractId: string | null | undefined,
): Promise<void> {
  if (!contractId) return
  await loadContract(em, scope, contractId)
}

const createInvoiceCommand: CommandHandler<Record<string, unknown>, TradeDocsInvoice> = {
  id: 'trade_docs.invoices.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = invoiceCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const contractId = parsed.contractId ?? null
    await assertContractVisible(em, scope, contractId)
    const lines = await resolveInvoiceLines(em, scope, contractId, parsed.lines)
    const totals = computeInvoiceTotals(lines)

    let invoice!: TradeDocsInvoice
    await withAtomicFlush(
      em,
      [
        async () => {
          invoice = await de.createOrmEntity({
            entity: TradeDocsInvoice,
            data: {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              number: parsed.number,
              invoiceKind: parsed.invoiceKind ?? null,
              direction: parsed.direction,
              status: 'draft',
              counterpartyKind: parsed.counterpartyKind,
              counterpartyId: parsed.counterpartyId ?? null,
              counterpartySnapshot: parsed.counterpartySnapshot,
              contract: contractId ? em.getReference(TradeDocsContract, contractId) : null,
              sourceKind: parsed.sourceKind ?? null,
              sourceId: parsed.sourceId ?? null,
              sourceSnapshot: parsed.sourceSnapshot,
              currencyCode: parsed.currencyCode,
              subtotal: totals.subtotal,
              total: totals.total,
              taxTotal: totals.taxTotal,
              grossTotal: totals.grossTotal,
              issuedAt: parsed.issuedAt ? new Date(parsed.issuedAt) : null,
              notes: parsed.notes,
            },
          })
          await persistInvoiceLines(em, scope, invoice, lines)
        },
      ],
      { transaction: true, label: 'trade_docs.invoices.create' },
    )

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: invoice,
      identifiers: { id: String(invoice.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: invoiceCrudEvents,
      indexer: invoiceCrudIndexer,
    })
    await invalidateInvoiceCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(invoice.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'created',
    )

    return invoice
  },
  captureAfter: (_input, result) => serializeInvoice(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeInvoice(result)
    return {
      actionLabel: translate('trade_docs.audit.invoices.create', 'Create invoice'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedInvoice }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedInvoice | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing invoice id for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await de.deleteOrmEntity({
      entity: TradeDocsInvoice,
      where: invoiceFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (snapshot?.contractId) await recomputeContractHead(em, scope, snapshot.contractId)
    const removed = await em.fork().findOne(TradeDocsInvoice, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<TradeDocsInvoice>)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: invoiceCrudEvents,
      indexer: invoiceCrudIndexer,
    })
    await invalidateInvoiceCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      'deleted',
    )
  },
}

const updateInvoiceCommand: CommandHandler<Record<string, unknown>, TradeDocsInvoice> = {
  id: 'trade_docs.invoices.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = invoiceUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const invoice = await loadInvoice(em, scope, parsed.id)
    if (invoice.status !== 'draft') {
      throw conflict('Only a draft invoice can be edited')
    }

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(invoice.id),
      current: invoice.updatedAt,
      request: ctx.request ?? null,
    })

    const previousContractId = contractIdFrom(invoice.contract)
    const contractId = parsed.contractId === undefined ? previousContractId : parsed.contractId
    await assertContractVisible(em, scope, contractId)
    const lines = parsed.lines ? await resolveInvoiceLines(em, scope, contractId ?? null, parsed.lines) : null

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: TradeDocsInvoice,
            where: invoiceFilter(scope, parsed.id),
            apply: (entity) => {
              if (parsed.number !== undefined) entity.number = parsed.number
              if (parsed.invoiceKind !== undefined) entity.invoiceKind = parsed.invoiceKind
              if (parsed.direction !== undefined) entity.direction = parsed.direction
              if (parsed.counterpartyKind !== undefined) entity.counterpartyKind = parsed.counterpartyKind
              if (parsed.counterpartyId !== undefined) entity.counterpartyId = parsed.counterpartyId
              if (parsed.counterpartySnapshot !== undefined) entity.counterpartySnapshot = parsed.counterpartySnapshot
              if (parsed.contractId !== undefined) {
                entity.contract = parsed.contractId ? em.getReference(TradeDocsContract, parsed.contractId) : null
              }
              if (parsed.sourceKind !== undefined) entity.sourceKind = parsed.sourceKind
              if (parsed.sourceId !== undefined) entity.sourceId = parsed.sourceId
              if (parsed.sourceSnapshot !== undefined) entity.sourceSnapshot = parsed.sourceSnapshot
              if (parsed.currencyCode !== undefined) entity.currencyCode = parsed.currencyCode
              if (parsed.issuedAt !== undefined) entity.issuedAt = parsed.issuedAt ? new Date(parsed.issuedAt) : null
              if (parsed.notes !== undefined) entity.notes = parsed.notes
            },
          })
          if (lines) {
            const target = await em.findOneOrFail(TradeDocsInvoice, invoiceFilter(scope, parsed.id))
            await persistInvoiceLines(em, scope, target, lines)
          }
        },
        async () => {
          const target = await em.findOneOrFail(TradeDocsInvoice, invoiceFilter(scope, parsed.id))
          await applyInvoiceTotals(em, scope, target)
        },
      ],
      { transaction: true, label: 'trade_docs.invoices.update' },
    )

    // A draft invoice has no influence on any contract head, but a *moved* draft invoice must not
    // leave a stale binding pointing at the old contract's lines: both heads are recomputed so the
    // derived columns always describe the current rows.
    for (const candidate of new Set([previousContractId, contractId].filter((id): id is string => !!id))) {
      await recomputeContractHead(em, scope, candidate)
    }

    const updated = await loadInvoice(em, scope, parsed.id)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: invoiceCrudEvents,
      indexer: invoiceCrudIndexer,
    })
    await invalidateInvoiceCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return updated
  },
  captureAfter: (_input, result) => serializeInvoice(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedInvoice | undefined
    const after = serializeInvoice(result)
    return {
      actionLabel: translate('trade_docs.audit.invoices.update', 'Update invoice'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['number', 'invoiceKind', 'direction', 'counterpartyKind', 'contractId', 'currencyCode', 'issuedAt', 'notes'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
}

const deleteInvoiceCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  TradeDocsInvoice
> = {
  id: 'trade_docs.invoices.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Invoice id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const invoice = await loadInvoice(em, scope, id)
    if (invoice.status === 'confirmed') {
      throw conflict('A confirmed invoice must be voided before it can be deleted')
    }
    const contractId = contractIdFrom(invoice.contract)

    const removed = await de.deleteOrmEntity({
      entity: TradeDocsInvoice,
      where: invoiceFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Invoice not found')
    if (contractId) await recomputeContractHead(em, scope, contractId)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: invoiceCrudEvents,
      indexer: invoiceCrudIndexer,
    })
    await invalidateInvoiceCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'deleted',
    )

    return removed
  },
  captureAfter: (_input, result) => serializeInvoice(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeInvoice(result)
    return {
      actionLabel: translate('trade_docs.audit.invoices.delete', 'Delete invoice'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

/**
 * The next `TI-<year>-<4 digits>` slot for this organization.
 *
 * Reads the highest number that is actually **visible** (the caller writes a `PENDING` placeholder
 * before this runs), so two concurrent confirms may pick the same value — the unique index
 * `trade_docs_invoices_our_number_uniq` is the real guarantee and the loser gets a 409 it can
 * retry with a fresh number.
 */
async function nextInvoiceNumber(em: EntityManager, scope: TradeDocsScope): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `TI-${year}-`
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('trade_docs_invoices')
    .select('our_number')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('our_number', 'like', `${prefix}%`)
    .orderBy('our_number', 'desc')
    .limit(1)
    .execute()) as Array<{ our_number: string | null }>
  const last = rows[0]?.our_number ?? null
  const lastSequence = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'UniqueConstraintViolationException'
  )
}

/**
 * One-shot copy of a PI/CI (a `trade_docs_documents` row) into a draft tax invoice — the
 * "从上一张单据复制" step from the commercial invoice. The invoice owns no trade-term/party columns of
 * its own beyond the counterparty, so only the counterparty (kind/id/snapshot) and the currency
 * carry over; the document's lines are mapped onto invoice lines and the operator sets the VAT rate
 * afterwards, because a commercial invoice carries none.
 *
 * `contract`/`contractLine` are deliberately untouched: an invoice must never inherit a binding that
 * would move money on a contract the operator did not choose.
 */
const copyInvoiceFromCommand: CommandHandler<Record<string, unknown>, { id: string; lineCount: number }> = {
  id: 'trade_docs.invoices.copy-from',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = invoiceCopySchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const invoice = await loadInvoice(em, scope, parsed.id)
    if (invoice.status !== 'draft') {
      throw conflict('Only a draft invoice can be edited')
    }
    const source = await loadDocument(em, scope, parsed.sourceDocumentId)

    const sourceLines = await em.find(TradeDocsDocumentLine, {
      document: source.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<TradeDocsDocumentLine>)

    const sourceSnapshotHead = {
      kind: 'trade_document',
      id: String(source.id),
      number: source.number ?? null,
      documentKind: source.kind,
    }
    const resolved: ResolvedInvoiceLine[] = sourceLines
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line, index) => {
        const taxRate = '0'
        const priceIncludesTax = true
        return {
          lineNumber: index + 1,
          productId: line.productId ?? null,
          productSnapshot: line.productSnapshot ?? null,
          description: line.name?.trim() || line.sku || '',
          sku: line.sku ?? null,
          unit: line.unit ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          taxRate,
          priceIncludesTax,
          taxAmount: computeInvoiceLineTax({ amount: line.amount, taxRate, priceIncludesTax }).taxAmount,
          contractLineId: null,
        }
      })

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: TradeDocsInvoice,
            where: invoiceFilter(scope, parsed.id),
            apply: (entity) => {
              entity.counterpartyKind = source.counterpartyKind
              entity.counterpartyId = source.counterpartyId ?? null
              entity.counterpartySnapshot = source.counterpartySnapshot ?? null
              entity.currencyCode = source.currencyCode
              entity.sourceKind = 'trade_document'
              entity.sourceId = String(source.id)
              entity.sourceSnapshot = sourceSnapshotHead
            },
          })
          const target = await em.findOneOrFail(TradeDocsInvoice, invoiceFilter(scope, parsed.id))
          await persistInvoiceLines(em, scope, target, resolved)
        },
        async () => {
          const target = await em.findOneOrFail(TradeDocsInvoice, invoiceFilter(scope, parsed.id))
          await applyInvoiceTotals(em, scope, target)
        },
      ],
      { transaction: true, label: 'trade_docs.invoices.copy-from' },
    )

    const updated = await loadInvoice(em, scope, parsed.id)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: invoiceCrudEvents,
      indexer: invoiceCrudIndexer,
    })
    await invalidateInvoiceCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return { id: String(updated.id), lineCount: resolved.length }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('trade_docs.audit.invoices.copy', 'Copy invoice from a trade document'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.id,
      metadata: { lineCount: result.lineCount },
    }
  },
}

/**
 * `confirm` puts the invoice's printed amounts into the financial caliber of every contract line
 * it is bound to; `void` releases them again. Both recompute the contract head in the same
 * transaction, so a reader can never see a confirmed invoice with an unrecomputed contract.
 *
 * `confirm` also assigns our own `TI-<year>-<4 digits>` number — but only to an **outbound**
 * invoice that carries an `invoiceKind`. Inbound invoices, kind-less historical rows and every
 * other status keep `ourNumber` null.
 */
const transitionInvoiceCommand: CommandHandler<Record<string, unknown>, TradeDocsInvoice> = {
  id: 'trade_docs.invoices.transition',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = invoiceTransitionSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const invoice = await loadInvoice(em, scope, parsed.id)
    const transition = ALLOWED_TRANSITIONS[parsed.action]
    if (!transition) throw badRequest(`Unknown transition: ${parsed.action}`)
    if (!transition.from.includes(invoice.status)) {
      throw new CrudHttpError(422, {
        error: `Cannot ${parsed.action} an invoice in status ${invoice.status}`,
      })
    }

    const lineCount = await em.fork().count(TradeDocsInvoiceLine, {
      invoice: invoice.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<TradeDocsInvoiceLine>)
    if (parsed.action === 'confirm' && lineCount === 0) {
      throw new CrudHttpError(422, { error: 'An invoice without lines cannot be confirmed' })
    }

    const contractId = contractIdFrom(invoice.contract)

    const shouldAssignNumber =
      parsed.action === 'confirm' &&
      invoice.direction === 'outbound' &&
      !!invoice.invoiceKind &&
      !invoice.ourNumber

    const updated = await de.updateOrmEntity({
      entity: TradeDocsInvoice,
      where: invoiceFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = transition.to
        if (shouldAssignNumber) {
          // Placeholder first: the sequence read only sees numbers that are already committed.
          entity.ourNumber = entity.ourNumber ?? `PENDING-${String(entity.id).slice(0, 8)}`
        }
        if (parsed.reason) {
          entity.notes = `${entity.notes ? `${entity.notes}\n` : ''}${parsed.action}: ${parsed.reason}`
        }
      },
    })
    if (!updated) throw notFound('Invoice not found')

    if (shouldAssignNumber && (!updated.ourNumber || updated.ourNumber.startsWith('PENDING-'))) {
      try {
        updated.ourNumber = await nextInvoiceNumber(em, scope)
        await em.fork().nativeUpdate(TradeDocsInvoice, { id: updated.id }, { ourNumber: updated.ourNumber })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Another invoice took that number; retry the transition')
        }
        throw error
      }
    }

    if (contractId) await recomputeContractHead(em, scope, contractId)

    await eventsConfig.emit(TRANSITION_EVENT_IDS[parsed.action], {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: updated.status,
      contractId,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id), status: result.status }),
  buildLog: async ({ result }) => ({
    actionLabel: `Invoice ${result.status}`,
    resourceKind: RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status },
  }),
}

/**
 * Binds an archived file to the invoice.
 *
 * The upload itself happens against `/api/attachments` (the platform's multipart route); this
 * command only records the pointer and verifies the attachment exists inside the caller's scope.
 * Rebinding is idempotent — a retry after a failed upload simply replaces the previous pointer.
 */
const attachInvoiceCommand: CommandHandler<Record<string, unknown>, TradeDocsInvoice> = {
  id: 'trade_docs.invoices.attach',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = invoiceAttachSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const invoice = await loadInvoice(em, scope, parsed.id)
    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(invoice.id),
      current: invoice.updatedAt,
      request: ctx.request ?? null,
    })

    if (parsed.attachmentId) {
      const rows = (await (em.fork().getKysely<any>())
        .selectFrom('attachments')
        .select(['id'])
        .where('id', '=', parsed.attachmentId)
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .execute()) as Array<{ id: string }>
      if (rows.length === 0) throw badRequest('Attachment not found in this organization')
    }

    const updated = await de.updateOrmEntity({
      entity: TradeDocsInvoice,
      where: invoiceFilter(scope, parsed.id),
      apply: (entity) => {
        entity.attachmentId = parsed.attachmentId
      },
    })
    if (!updated) throw notFound('Invoice not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: invoiceCrudEvents,
      indexer: invoiceCrudIndexer,
    })
    await invalidateInvoiceCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )
    await eventsConfig.emit('trade_docs.invoice.attached', {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      attachmentId: parsed.attachmentId,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Bind invoice attachment',
    resourceKind: RESOURCE_KIND,
    resourceId: String(result.id),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createInvoiceCommand)
registerCommand(updateInvoiceCommand)
registerCommand(deleteInvoiceCommand)
registerCommand(copyInvoiceFromCommand)
registerCommand(transitionInvoiceCommand)
registerCommand(attachInvoiceCommand)

export {
  createInvoiceCommand,
  updateInvoiceCommand,
  deleteInvoiceCommand,
  copyInvoiceFromCommand,
  transitionInvoiceCommand,
  attachInvoiceCommand,
}
export type { SerializedInvoice }
