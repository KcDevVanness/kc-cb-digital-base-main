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
import { createAttachmentFromBuffer } from '@open-mercato/core/modules/attachments/lib/createFromBuffer'
import { buildXlsx, XLSX_CONTENT_TYPE } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
import { TradeDocsDocument, TradeDocsDocumentLine, TradeDocsOrderDocument } from '../data/entities'
import {
  documentAggregateSchema,
  documentAttachSchema,
  documentCopySchema,
  documentCreateSchema,
  documentDocumentSchema,
  documentLinesReplaceSchema,
  documentTransitionSchema,
  documentUpdateSchema,
  COUNTERPARTY_KIND_BY_DIRECTION,
  type DocumentLineInput,
} from '../data/validators'
import {
  resolveCounterpartyKind,
  assertCounterpartyReference,
} from '../lib/counterpartyRefs'
import {
  readShipmentPurchaseAllocations,
  readShipmentSalesAllocations,
} from '../../cross_border/lib/shipmentSalesReads'
import { invalidateDocumentCaches } from '../lib/cacheInvalidation'
import { documentFilter, ensureScope, loadDocument, resolveContractLink, type TradeDocsScope } from '../lib/scope'
import { loadSalesOrderRef } from '../lib/orderDocumentReads'
import { productSnapshotPayload, readProductSnapshots } from '../lib/productSnapshots'
import { computeLineAmounts, sumAmounts } from '../lib/money'
import { buildDocumentSheet, DOCUMENT_TEMPLATE_IDS } from '../lib/documentTemplate'
import { eventsConfig } from '../events'

const ENTITY_ID = 'trade_docs:trade_docs_documents' as const
const RESOURCE_KIND = 'trade_docs.document' as const

/**
 * PI and CI share one state machine: a draft is the working copy, `issue` freezes it and assigns
 * our own number, and `void` retires it. Nothing edits an issued document — a correction is a new
 * document, which is what the business does on paper too.
 */
const ALLOWED_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  issue: { from: ['draft'], to: 'issued' },
  void: { from: ['draft', 'issued'], to: 'void' },
}

const TRANSITION_EVENT_IDS = {
  issue: 'trade_docs.document.issued',
  void: 'trade_docs.document.voided',
} as const

export type SerializedDocument = {
  id: string
  kind: string
  direction: string
  number: string | null
  status: string
  counterpartyKind: string
  counterpartyId: string | null
  counterpartySnapshot: Record<string, unknown> | null
  ourPartySnapshot: Record<string, unknown> | null
  consigneeSnapshot: Record<string, unknown> | null
  notifyPartySnapshot: Record<string, unknown> | null
  currencyCode: string
  exchangeRate: string | null
  subtotal: string
  total: string
  paymentTerms: string | null
  incoterms: string | null
  validUntil: string | null
  deliveryDate: string | null
  sourceKind: string | null
  sourceId: string | null
  sourceSnapshot: Record<string, unknown> | null
  contractId: string | null
  contractSnapshot: Record<string, unknown> | null
  issuedAt: string | null
  generatedAttachmentId: string | null
  generatedAt: string | null
  attachmentId: string | null
  notes: string | null
  tenantId: string
  organizationId: string
}

function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function toIsoTimestamp(value: Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function serializeDocument(entity: TradeDocsDocument): SerializedDocument {
  return {
    id: String(entity.id),
    kind: entity.kind,
    direction: entity.direction,
    number: entity.number ?? null,
    status: entity.status,
    counterpartyKind: entity.counterpartyKind,
    counterpartyId: entity.counterpartyId ? String(entity.counterpartyId) : null,
    counterpartySnapshot: entity.counterpartySnapshot ?? null,
    ourPartySnapshot: entity.ourPartySnapshot ?? null,
    consigneeSnapshot: entity.consigneeSnapshot ?? null,
    notifyPartySnapshot: entity.notifyPartySnapshot ?? null,
    currencyCode: entity.currencyCode,
    exchangeRate: entity.exchangeRate ?? null,
    subtotal: entity.subtotal,
    total: entity.total,
    paymentTerms: entity.paymentTerms ?? null,
    incoterms: entity.incoterms ?? null,
    validUntil: toDateOnly(entity.validUntil),
    deliveryDate: toDateOnly(entity.deliveryDate),
    sourceKind: entity.sourceKind ?? null,
    sourceId: entity.sourceId ? String(entity.sourceId) : null,
    sourceSnapshot: entity.sourceSnapshot ?? null,
    contractId: entity.contractId ? String(entity.contractId) : null,
    contractSnapshot: entity.contractSnapshot ?? null,
    issuedAt: toDateOnly(entity.issuedAt),
    generatedAttachmentId: entity.generatedAttachmentId ? String(entity.generatedAttachmentId) : null,
    generatedAt: toIsoTimestamp(entity.generatedAt),
    attachmentId: entity.attachmentId ? String(entity.attachmentId) : null,
    notes: entity.notes ?? null,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

export const documentCrudEvents: CrudEventsConfig<TradeDocsDocument> = {
  module: 'trade_docs',
  entity: 'document',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<TradeDocsDocument>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    kind: ctx.entity?.kind ?? null,
    status: ctx.entity?.status ?? null,
    number: ctx.entity?.number ?? null,
    direction: ctx.entity?.direction ?? null,
  }),
}

export const documentCrudIndexer: CrudIndexerConfig<TradeDocsDocument> = {
  entityType: ENTITY_ID,
}

type ResolvedDocumentLine = {
  lineNumber: number
  productId: string | null
  productSnapshot: Record<string, unknown> | null
  name: string
  sku: string | null
  model: string | null
  spec: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  amount: string
  sourceSnapshot: Record<string, unknown> | null
  note: string | null
}

/**
 * Freezes each line the same way contracts do, with one document-specific rule: the amount defaults
 * to `HALF_UP(quantity × unitPrice, 2)`, but an explicitly supplied amount wins — a commercial
 * invoice often carries a rounded or freight-adjusted figure that does not survive a
 * multiplication.
 */
async function resolveDocumentLines(
  em: EntityManager,
  scope: TradeDocsScope,
  lines: DocumentLineInput[],
): Promise<ResolvedDocumentLine[]> {
  const productIds = lines
    .map((line) => line.productId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const snapshots = await readProductSnapshots(em, scope, productIds)

  return lines.map((line, index) => {
    const snapshot = line.productId ? snapshots.get(line.productId) : undefined
    const name = (line.name ?? snapshot?.name ?? '').trim()
    if (!name) {
      throw badRequest(`Line ${index + 1} needs a product or a name`)
    }
    const computed = computeLineAmounts({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })
    return {
      lineNumber: index + 1,
      productId: line.productId ?? null,
      productSnapshot: line.productSnapshot ?? (snapshot ? productSnapshotPayload(snapshot) : null),
      name,
      sku: line.sku ?? snapshot?.sku ?? null,
      model: line.model ?? snapshot?.model ?? null,
      spec: line.spec ?? snapshot?.spec ?? null,
      unit: line.unit ?? snapshot?.unit ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount ?? computed.financeAmount,
      sourceSnapshot: line.sourceSnapshot ?? null,
      note: line.note ?? null,
    }
  })
}

async function persistDocumentLines(
  em: EntityManager,
  scope: TradeDocsScope,
  document: TradeDocsDocument,
  lines: ResolvedDocumentLine[],
): Promise<void> {
  await em.nativeDelete(TradeDocsDocumentLine, {
    document: document.id,
  } as FilterQuery<TradeDocsDocumentLine>)
  const now = new Date()
  for (const line of lines) {
    em.persist(
      em.create(TradeDocsDocumentLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        document,
        lineNumber: line.lineNumber,
        productId: line.productId,
        productSnapshot: line.productSnapshot,
        name: line.name,
        sku: line.sku,
        model: line.model,
        spec: line.spec,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        sourceSnapshot: line.sourceSnapshot,
        note: line.note,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()
}

/**
 * The only writer of `subtotal` / `total`: every command that touches a line runs it inside its own
 * transaction, so a document can never carry a stale head amount. Lines are always read through the
 * caller's `EntityManager` (a fork owns a separate unit of work and nothing would flush it).
 */
export async function recomputeDocumentHead(
  em: EntityManager,
  scope: TradeDocsScope,
  documentId: string,
): Promise<void> {
  const document = await em.findOne(TradeDocsDocument, documentFilter(scope, documentId))
  if (!document) throw notFound('Document not found')
  const lines = await em.find(TradeDocsDocumentLine, {
    document: document.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as FilterQuery<TradeDocsDocumentLine>)
  const total = sumAmounts(lines.map((line) => line.amount))
  document.subtotal = total
  document.total = total
  await em.flush()
}

/**
 * Per-organization, per-kind number, assigned at `issue` — a draft consumes no sequence slot.
 *
 * The unique constraint on `(tenant, organization, number)` is the real guarantee: this only picks
 * the next value, so two concurrent issues can collide and the loser gets a 409 it can retry with a
 * fresh number. That is why `issue` first writes a `PENDING` placeholder and only then resolves the
 * number — the row has to be visible in the sequence read.
 */
async function nextDocumentNumber(
  em: EntityManager,
  scope: TradeDocsScope,
  kind: string,
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `${kind === 'commercial' ? 'CI' : 'PI'}-${year}-`
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('trade_docs_documents')
    .select('number')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('number', 'like', `${prefix}%`)
    .orderBy('number', 'desc')
    .limit(1)
    .execute()) as Array<{ number: string | null }>
  const last = rows[0]?.number ?? null
  const lastSequence = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'UniqueConstraintViolationException'
  )
}

const createDocumentCommand: CommandHandler<Record<string, unknown>, TradeDocsDocument> = {
  id: 'trade_docs.documents.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = documentCreateSchema.parse(rawInput)
    if (parsed.kind === 'commercial' && parsed.direction !== 'sales') {
      throw badRequest('A commercial invoice is always issued on the sales side')
    }
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const counterpartyKind = resolveCounterpartyKind(
      parsed.direction,
      parsed.counterpartyKind,
      COUNTERPARTY_KIND_BY_DIRECTION,
    )
    await assertCounterpartyReference(em, scope, counterpartyKind, parsed.counterpartyId ?? null)
    const contractLink = await resolveContractLink(em, scope, parsed.contractId)
    // `?orderKind=&orderId=` on the create page: the link is written in the same transaction as the
    // document, so the order hub's Documents block sees it without a second call. An order the
    // caller cannot see fails the create instead of being silently dropped — the number would
    // otherwise never show up under the order it was raised for.
    const orderLink = parsed.orderKind && parsed.orderId
      ? await loadSalesOrderRef(em, scope, parsed.orderId)
      : null
    if (parsed.orderKind && parsed.orderId && !orderLink) {
      throw new CrudHttpError(422, {
        error: 'order_document_link_order_not_found',
        orderId: parsed.orderId,
      })
    }

    const lines = await resolveDocumentLines(em, scope, parsed.lines)
    let document!: TradeDocsDocument

    await withAtomicFlush(
      em,
      [
        async () => {
          document = await de.createOrmEntity({
            entity: TradeDocsDocument,
            data: {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              kind: parsed.kind,
              direction: parsed.direction,
              status: 'draft',
              counterpartyKind,
              counterpartyId: parsed.counterpartyId ?? null,
              counterpartySnapshot: parsed.counterpartySnapshot,
              ourPartySnapshot: parsed.ourPartySnapshot,
              consigneeSnapshot: parsed.consigneeSnapshot,
              notifyPartySnapshot: parsed.notifyPartySnapshot,
              currencyCode: parsed.currencyCode,
              exchangeRate: parsed.exchangeRate,
              paymentTerms: parsed.paymentTerms,
              incoterms: parsed.incoterms,
              validUntil: parsed.validUntil ? new Date(parsed.validUntil) : null,
              deliveryDate: parsed.deliveryDate ? new Date(parsed.deliveryDate) : null,
              sourceKind: parsed.sourceKind ?? null,
              sourceId: parsed.sourceId ?? null,
              sourceSnapshot: parsed.sourceSnapshot,
              contractId: contractLink.contractId,
              contractSnapshot: contractLink.contractSnapshot,
              notes: parsed.notes,
            },
          })
          await persistDocumentLines(em, scope, document, lines)
        },
        async () => {
          await recomputeDocumentHead(em, scope, String(document.id))
        },
        async () => {
          // The frozen snapshot is written after the head recompute so it carries the created
          // document's own totals rather than the zero placeholders the entity started with.
          if (!orderLink || !parsed.orderKind) return
          em.persist(
            em.create(TradeDocsOrderDocument, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              orderKind: parsed.orderKind,
              orderId: orderLink.id,
              orderNumber: orderLink.number,
              documentKind: parsed.kind,
              documentId: String(document.id),
              documentNumber: document.number ?? null,
              documentSnapshot: {
                kind: parsed.kind,
                number: document.number ?? null,
                status: document.status,
                total: document.total,
                currencyCode: document.currencyCode,
                issuedAt: document.issuedAt ? new Date(document.issuedAt).toISOString() : null,
              },
            }),
          )
        },
      ],
      { transaction: true, label: 'trade_docs.documents.create' },
    )

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: document,
      identifiers: { id: String(document.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(document.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'created',
    )

    return document
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeDocument(result)
    return {
      actionLabel: translate('trade_docs.audit.documents.create', 'Create trade document'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedDocument }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedDocument | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing document id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: TradeDocsDocument,
      where: documentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      'deleted',
    )
  },
}

const updateDocumentCommand: CommandHandler<Record<string, unknown>, TradeDocsDocument> = {
  id: 'trade_docs.documents.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.id)
    if (document.status !== 'draft') {
      throw conflict('Only a draft document can be edited; void it and issue a new one instead')
    }
    if (parsed.kind !== undefined && parsed.kind !== document.kind) {
      throw badRequest('A document cannot change its kind')
    }

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(document.id),
      current: document.updatedAt,
      request: ctx.request ?? null,
    })

    const mergedDirection = parsed.direction ?? document.direction
    // The create-time rule must survive an edit: flipping a commercial invoice to the purchase side
    // would leave an export document on the wrong half of the ledger.
    if (document.kind === 'commercial' && mergedDirection !== 'sales') {
      throw badRequest('A commercial invoice is always issued on the sales side')
    }
    const counterpartyKind = resolveCounterpartyKind(
      mergedDirection,
      parsed.counterpartyKind,
      COUNTERPARTY_KIND_BY_DIRECTION,
    )
    await assertCounterpartyReference(
      em,
      scope,
      counterpartyKind,
      parsed.counterpartyId !== undefined ? parsed.counterpartyId : document.counterpartyId ?? null,
    )

    const currencyCode = parsed.currencyCode ?? document.currencyCode
    const contractLink = parsed.contractId !== undefined
      ? await resolveContractLink(em, scope, parsed.contractId)
      : null
    const lines = parsed.lines
      ? await resolveDocumentLines(em, scope, parsed.lines)
      : null

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: TradeDocsDocument,
            where: documentFilter(scope, parsed.id),
            apply: (entity) => {
              if (parsed.direction !== undefined) entity.direction = parsed.direction
              // The kind is derived, so an update heals a row stored before the rule existed.
              entity.counterpartyKind = counterpartyKind
              if (parsed.counterpartyId !== undefined) entity.counterpartyId = parsed.counterpartyId
              if (parsed.counterpartySnapshot !== undefined) entity.counterpartySnapshot = parsed.counterpartySnapshot
              if (parsed.ourPartySnapshot !== undefined) entity.ourPartySnapshot = parsed.ourPartySnapshot
              if (parsed.consigneeSnapshot !== undefined) entity.consigneeSnapshot = parsed.consigneeSnapshot
              if (parsed.notifyPartySnapshot !== undefined) entity.notifyPartySnapshot = parsed.notifyPartySnapshot
              if (parsed.currencyCode !== undefined) entity.currencyCode = parsed.currencyCode
              if (parsed.exchangeRate !== undefined) entity.exchangeRate = parsed.exchangeRate
              if (parsed.paymentTerms !== undefined) entity.paymentTerms = parsed.paymentTerms
              if (parsed.incoterms !== undefined) entity.incoterms = parsed.incoterms
              if (parsed.validUntil !== undefined) entity.validUntil = parsed.validUntil ? new Date(parsed.validUntil) : null
              if (parsed.deliveryDate !== undefined) entity.deliveryDate = parsed.deliveryDate ? new Date(parsed.deliveryDate) : null
              if (parsed.sourceKind !== undefined) entity.sourceKind = parsed.sourceKind
              if (parsed.sourceId !== undefined) entity.sourceId = parsed.sourceId
              if (parsed.sourceSnapshot !== undefined) entity.sourceSnapshot = parsed.sourceSnapshot
              if (contractLink) {
                entity.contractId = contractLink.contractId
                entity.contractSnapshot = contractLink.contractSnapshot
              }
              if (parsed.notes !== undefined) entity.notes = parsed.notes
            },
          })
          if (lines) {
            const target = await em.findOneOrFail(TradeDocsDocument, documentFilter(scope, parsed.id))
            await persistDocumentLines(em, scope, target, lines)
          }
        },
        async () => {
          await recomputeDocumentHead(em, scope, parsed.id)
        },
      ],
      { transaction: true, label: 'trade_docs.documents.update' },
    )

    const updated = await loadDocument(em, scope, parsed.id)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return updated
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedDocument | undefined
    const after = serializeDocument(result)
    return {
      actionLabel: translate('trade_docs.audit.documents.update', 'Update trade document'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['direction', 'counterpartyKind', 'currencyCode', 'paymentTerms', 'incoterms', 'validUntil', 'deliveryDate', 'notes'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
}

const deleteDocumentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  TradeDocsDocument
> = {
  id: 'trade_docs.documents.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Document id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, id)
    if (document.status === 'issued') {
      throw conflict('An issued document cannot be deleted; void it instead')
    }

    // The link has no foreign key (it is polymorphic), so nothing cascades: the rows pointing at
    // this document go first, and a document that still exists afterwards is simply unlinked —
    // recoverable from the order hub's dialog, unlike a link to a document that is gone.
    await em.nativeDelete(TradeDocsOrderDocument, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      documentKind: document.kind,
      documentId: String(document.id),
    } as FilterQuery<TradeDocsOrderDocument>)

    const removed = await de.deleteOrmEntity({
      entity: TradeDocsDocument,
      where: documentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'deleted',
    )

    return removed
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeDocument(result)
    return {
      actionLabel: translate('trade_docs.audit.documents.delete', 'Delete trade document'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

/**
 * Replaces the whole line set of a draft document.
 *
 * The command exists next to `update` because the form's line editor and the row-level API both
 * need a write path that never touches the head — and because the head totals must be recomputed
 * from the rows in the same transaction, which is exactly what this does.
 */
const replaceDocumentLinesCommand: CommandHandler<Record<string, unknown>, TradeDocsDocument> = {
  id: 'trade_docs.documents.lines.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentLinesReplaceSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.documentId)
    if (document.status !== 'draft') {
      throw conflict('Only a draft document can be edited; void it and issue a new one instead')
    }

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(document.id),
      current: document.updatedAt,
      request: ctx.request ?? null,
    })

    const lines = await resolveDocumentLines(em, scope, parsed.lines)

    await withAtomicFlush(
      em,
      [
        async () => {
          const target = await em.findOneOrFail(TradeDocsDocument, documentFilter(scope, parsed.documentId))
          await persistDocumentLines(em, scope, target, lines)
        },
        async () => {
          await recomputeDocumentHead(em, scope, parsed.documentId)
        },
      ],
      { transaction: true, label: 'trade_docs.documents.lines.replace' },
    )

    const updated = await loadDocument(em, scope, parsed.documentId)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return updated
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeDocument(result)
    return {
      actionLabel: translate('trade_docs.audit.documents.lines.replace', 'Replace trade document lines'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

/**
 * Reads a non-empty string out of a frozen product snapshot; null when absent or blank.
 */
function snapshotString(snapshot: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!snapshot) return null
  const value = snapshot[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Rolls a shipment's allocations up into a draft CI's lines.
 *
 * The copy is deliberately one-shot: the lines are written from the allocation rows as they exist
 * at this moment (each line keeps a `sourceSnapshot` naming the allocation it came from and the
 * values it was copied with), and nothing here subscribes to a later change of the shipment —
 * rerunning simply replaces the whole set, exactly like the line editor does. The sales side wins;
 * when a shipment has no sales allocations yet (a pre-customs CI) the purchase allocations are used
 * instead.
 */
const aggregateDocumentLinesCommand: CommandHandler<Record<string, unknown>, { id: string; lineCount: number }> = {
  id: 'trade_docs.documents.aggregate-lines',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentAggregateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.id)
    if (document.kind !== 'commercial') {
      throw badRequest('Only a commercial invoice can be aggregated from a shipment')
    }
    if (document.status !== 'draft') {
      throw conflict('Only a draft document can be edited; void it and issue a new one instead')
    }
    const sourceId = parsed.sourceId ?? (document.sourceId ? String(document.sourceId) : null)
    if (!sourceId) {
      throw badRequest('A source shipment is required to aggregate its allocations')
    }

    const copiedAt = new Date().toISOString()
    const salesRows = await readShipmentSalesAllocations(em, scope, sourceId)

    /**
     * Builds a frozen document line straight from an allocation row.
     *
     * The product master is deliberately NOT re-read here: `catalog_product_id` is the installed
     * catalog bridge, not a `products_products` id, so `readProductSnapshots` would reject it — and
     * the allocation already carries the authoritative display snapshot it was written with. The
     * product name lives under `title` on both sides (purchasing snapshots and the sales
     * `catalog_snapshot`); `name` is accepted as well for older snapshots.
     */
    const buildAllocationLine = (
      index: number,
      row: {
        catalogProductId: string
        productSnapshot: Record<string, unknown> | null
        quantity: string
        unitPrice: string | null
      },
      sourceSnapshot: Record<string, unknown>,
    ): ResolvedDocumentLine => {
      const snapshot = row.productSnapshot
      const unitPrice = row.unitPrice && row.unitPrice.trim().length > 0 ? row.unitPrice : '0'
      const { financeAmount } = computeLineAmounts({ quantity: row.quantity, unitPrice })
      return {
        lineNumber: index + 1,
        productId: row.catalogProductId,
        productSnapshot: snapshot,
        name: snapshotString(snapshot, 'name') ?? snapshotString(snapshot, 'title') ?? '',
        sku: snapshotString(snapshot, 'sku'),
        model: snapshotString(snapshot, 'model'),
        spec: snapshotString(snapshot, 'spec'),
        unit: snapshotString(snapshot, 'unit'),
        quantity: row.quantity,
        unitPrice,
        amount: financeAmount,
        sourceSnapshot,
        note: null,
      }
    }

    const resolved: ResolvedDocumentLine[] =
      salesRows.length > 0
        ? salesRows.map((row, index) =>
            buildAllocationLine(index, row, {
              kind: 'sales_allocation',
              allocationId: row.id,
              salesOrderLineId: row.salesOrderLineId,
              quantity: row.quantity,
              unitPrice: row.unitPrice,
              copiedAt,
              overridden: {},
            }),
          )
        : (await readShipmentPurchaseAllocations(em, scope, sourceId)).map((row, index) =>
            buildAllocationLine(index, { ...row, unitPrice: null }, {
              kind: 'purchase_allocation',
              allocationId: row.id,
              purchaseOrderLineId: row.purchaseOrderLineId,
              quantity: row.quantity,
              unitPrice: null,
              copiedAt,
              overridden: {},
            }),
          )

    await withAtomicFlush(
      em,
      [
        async () => {
          const target = await em.findOneOrFail(TradeDocsDocument, documentFilter(scope, parsed.id))
          await persistDocumentLines(em, scope, target, resolved)
        },
        async () => {
          await recomputeDocumentHead(em, scope, parsed.id)
        },
      ],
      { transaction: true, label: 'trade_docs.documents.aggregate-lines' },
    )

    const updated = await loadDocument(em, scope, parsed.id)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return { id: String(updated.id), lineCount: resolved.length }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('trade_docs.audit.documents.aggregate', 'Aggregate commercial invoice lines from a shipment'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.id,
      metadata: { lineCount: result.lineCount },
    }
  },
}

/**
 * One-shot copy of another document's head + lines into a draft document — the "从上一张单据复制"
 * flow a CI is normally started from. Only the target has to be a draft; the source may be issued,
 * because copying an issued proforma into a fresh commercial invoice is exactly the point.
 *
 * The copy is frozen at write time: each copied line carries a `sourceSnapshot` pointing back at
 * the document/line it came from, and the head records `sourceKind`/`sourceId`/`sourceSnapshot`.
 * Nothing links the two documents afterwards — either side can be edited freely, and running the
 * copy again simply replaces the target's lines (no duplicates).
 */
const copyDocumentFromCommand: CommandHandler<Record<string, unknown>, { id: string; lineCount: number }> = {
  id: 'trade_docs.documents.copy-from',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentCopySchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.id)
    if (document.status !== 'draft') {
      throw conflict('Only a draft document can be edited; void it and issue a new one instead')
    }
    const source = await loadDocument(em, scope, parsed.sourceDocumentId)
    /**
     * The copied counterparty must agree with the **target's** direction — copying a sales-side
     * document into a purchase-side one would store a pair the update validator rejects on the next
     * edit. The lines and trade terms still copy; the target keeps its own counterparty instead.
     */
    const targetCounterpartyKind = resolveCounterpartyKind(
      document.direction,
      undefined,
      COUNTERPARTY_KIND_BY_DIRECTION,
    )
    const copyCounterparty = source.counterpartyKind === targetCounterpartyKind
    if (copyCounterparty && source.counterpartyId) {
      await assertCounterpartyReference(em, scope, targetCounterpartyKind, source.counterpartyId)
    }

    const sourceLines = await em.find(TradeDocsDocumentLine, {
      document: source.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<TradeDocsDocumentLine>)

    const copiedAt = new Date().toISOString()
    const sourceSnapshotHead = {
      kind: 'trade_document',
      id: String(source.id),
      number: source.number ?? null,
      documentKind: source.kind,
    }
    const resolved: ResolvedDocumentLine[] = sourceLines
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line, index) => ({
        lineNumber: index + 1,
        productId: line.productId ?? null,
        productSnapshot: line.productSnapshot ?? null,
        name: line.name ?? '',
        sku: line.sku ?? null,
        model: line.model ?? null,
        spec: line.spec ?? null,
        unit: line.unit ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        sourceSnapshot: {
          kind: 'trade_document',
          documentId: String(source.id),
          number: source.number ?? null,
          lineNumber: line.lineNumber,
          copiedAt,
        },
        note: line.note ?? null,
      }))

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: TradeDocsDocument,
            where: documentFilter(scope, parsed.id),
            apply: (entity) => {
              // Derived, and only overwritten when the source agrees with the target's direction.
              entity.counterpartyKind = targetCounterpartyKind
              if (copyCounterparty) {
                entity.counterpartyId = source.counterpartyId ?? null
                entity.counterpartySnapshot = source.counterpartySnapshot ?? null
              }
              entity.ourPartySnapshot = source.ourPartySnapshot ?? null
              entity.consigneeSnapshot = source.consigneeSnapshot ?? null
              entity.notifyPartySnapshot = source.notifyPartySnapshot ?? null
              entity.currencyCode = source.currencyCode
              entity.exchangeRate = source.exchangeRate ?? null
              entity.paymentTerms = source.paymentTerms ?? null
              entity.incoterms = source.incoterms ?? null
              entity.sourceKind = 'trade_document'
              entity.sourceId = String(source.id)
              entity.sourceSnapshot = sourceSnapshotHead
            },
          })
          const target = await em.findOneOrFail(TradeDocsDocument, documentFilter(scope, parsed.id))
          await persistDocumentLines(em, scope, target, resolved)
        },
        async () => {
          await recomputeDocumentHead(em, scope, parsed.id)
        },
      ],
      { transaction: true, label: 'trade_docs.documents.copy-from' },
    )

    const updated = await loadDocument(em, scope, parsed.id)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return { id: String(updated.id), lineCount: resolved.length }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('trade_docs.audit.documents.copy', 'Copy trade document from another document'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.id,
      metadata: { lineCount: result.lineCount },
    }
  },
}

/**
 * Status transitions share one command surface so the allowed-transition table is the only place
 * that decides what is legal — a route or a UI button can never widen it. `issue` is also where our
 * own number is assigned (PI-/CI-<year>-<4 digits>, per organization and kind).
 */
const transitionDocumentCommand: CommandHandler<Record<string, unknown>, TradeDocsDocument> = {
  id: 'trade_docs.documents.transition',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentTransitionSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.id)
    const transition = ALLOWED_TRANSITIONS[parsed.action]
    if (!transition) throw badRequest(`Unknown transition: ${parsed.action}`)
    if (!transition.from.includes(document.status)) {
      throw conflict(`Cannot ${parsed.action} a document in status ${document.status}`)
    }
    if (parsed.action === 'void' && !parsed.reason) {
      throw badRequest('A void reason is required')
    }

    const lineCount = await em.fork().count(TradeDocsDocumentLine, {
      document: document.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<TradeDocsDocumentLine>)
    if (parsed.action === 'issue' && lineCount === 0) {
      throw badRequest('A document without lines cannot be issued')
    }

    const now = new Date()
    let updated = await de.updateOrmEntity({
      entity: TradeDocsDocument,
      where: documentFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = transition.to
        if (transition.to === 'issued') {
          // Placeholder first: the sequence is read from rows that are actually visible.
          entity.number = entity.number ?? `PENDING-${String(entity.id).slice(0, 8)}`
          entity.issuedAt = entity.issuedAt ?? now
        }
        if (parsed.reason) {
          entity.notes = `${entity.notes ? `${entity.notes}\n` : ''}${parsed.action}: ${parsed.reason}`
        }
      },
    })
    if (!updated) throw notFound('Document not found')

    if (transition.to === 'issued' && (!updated.number || updated.number.startsWith('PENDING-'))) {
      try {
        updated.number = await nextDocumentNumber(em, scope, updated.kind)
        await em.fork().nativeUpdate(TradeDocsDocument, { id: updated.id }, { number: updated.number })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Another document took that number; retry the transition')
        }
        throw error
      }
    }

    await eventsConfig.emit(TRANSITION_EVENT_IDS[parsed.action], {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: updated.kind,
      status: updated.status,
      number: updated.number ?? null,
      direction: updated.direction,
    })

    return updated
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeDocument(result)
    return {
      actionLabel: translate('trade_docs.audit.documents.transition', 'Change trade document status'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

/**
 * Renders the document as XLSX and archives it, exactly like the contract document: the file is a
 * record, not a view, so regenerating writes a new attachment and moves the pointer (the previous
 * file stays in storage). The uploaded replacement lives in its own column and is never touched.
 */
const generateDocumentCommand: CommandHandler<
  Record<string, unknown>,
  { attachmentId: string; fileName: string }
> = {
  id: 'trade_docs.documents.generate-document',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentDocumentSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.id)
    if (document.status === 'draft') {
      throw conflict('Issue the document before generating it')
    }

    const lines = await em.fork().find(
      TradeDocsDocumentLine,
      {
        document: document.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<TradeDocsDocumentLine>,
      { orderBy: { lineNumber: 'ASC' } },
    )

    const { t } = await resolveTranslations()
    const sheet = buildDocumentSheet(
      {
        kind: document.kind,
        number: document.number ?? null,
        direction: document.direction,
        issuedAt: toDateOnly(document.issuedAt),
        validUntil: toDateOnly(document.validUntil),
        deliveryDate: toDateOnly(document.deliveryDate),
        currencyCode: document.currencyCode,
        incoterms: document.incoterms ?? null,
        paymentTerms: document.paymentTerms ?? null,
        notes: document.notes ?? null,
        ourParty: document.ourPartySnapshot ?? null,
        counterparty: document.counterpartySnapshot ?? null,
        consignee: document.consigneeSnapshot ?? null,
        notifyParty: document.notifyPartySnapshot ?? null,
        total: document.total,
        lines: lines.map((line) => ({
          lineNumber: line.lineNumber,
          name: line.name ?? null,
          sku: line.sku ?? null,
          model: line.model ?? null,
          spec: line.spec ?? null,
          unit: line.unit ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          note: line.note ?? null,
        })),
      },
      t,
    )

    const buffer = buildXlsx(sheet)
    const fileName = `${document.number ?? (document.kind === 'commercial' ? 'CI' : 'PI')}.xlsx`
    const created = await createAttachmentFromBuffer({
      em,
      dataEngine: de,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      entityId: ENTITY_ID,
      recordId: String(document.id),
      fileName,
      mimeType: XLSX_CONTENT_TYPE,
      buffer,
    })

    const updated = await de.updateOrmEntity({
      entity: TradeDocsDocument,
      where: documentFilter(scope, parsed.id),
      apply: (entity) => {
        entity.generatedAttachmentId = created.id
        entity.generatedAt = new Date()
      },
    })
    if (!updated) throw notFound('Document not found')

    await eventsConfig.emit('trade_docs.document.document.generated', {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      attachmentId: created.id,
      templateId: DOCUMENT_TEMPLATE_IDS[document.kind === 'commercial' ? 'commercial' : 'proforma'],
    })

    return { attachmentId: created.id, fileName: created.fileName }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('trade_docs.audit.documents.generate', 'Generate trade document file'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.attachmentId,
      metadata: { attachmentId: result.attachmentId, fileName: result.fileName },
    }
  },
}

/**
 * Binds the file that supersedes our render — the stamped/returned scan or the customs copy.
 * Independent of `generatedAttachmentId`, and cleared with an explicit null.
 */
const attachDocumentCommand: CommandHandler<Record<string, unknown>, TradeDocsDocument> = {
  id: 'trade_docs.documents.attach',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentAttachSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const document = await loadDocument(em, scope, parsed.id)

    const updated = await de.updateOrmEntity({
      entity: TradeDocsDocument,
      where: documentFilter(scope, parsed.id),
      apply: (entity) => {
        entity.attachmentId = parsed.attachmentId
      },
    })
    if (!updated) throw notFound('Document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })
    await invalidateDocumentCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'updated',
    )

    return updated
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeDocument(result)
    return {
      actionLabel: translate('trade_docs.audit.documents.attach', 'Bind trade document file'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

registerCommand(createDocumentCommand)
registerCommand(updateDocumentCommand)
registerCommand(deleteDocumentCommand)
registerCommand(replaceDocumentLinesCommand)
registerCommand(aggregateDocumentLinesCommand)
registerCommand(copyDocumentFromCommand)
registerCommand(transitionDocumentCommand)
registerCommand(generateDocumentCommand)
registerCommand(attachDocumentCommand)

export {
  createDocumentCommand,
  updateDocumentCommand,
  deleteDocumentCommand,
  replaceDocumentLinesCommand,
  aggregateDocumentLinesCommand,
  copyDocumentFromCommand,
  transitionDocumentCommand,
  generateDocumentCommand,
  attachDocumentCommand,
  nextDocumentNumber,
}
