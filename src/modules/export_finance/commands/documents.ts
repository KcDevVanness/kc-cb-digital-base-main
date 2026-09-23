import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { ExportFinanceCollection, ExportFinanceCollectionDocument, ExportFinanceRefund, ExportFinanceRefundDocument } from '../data/entities'
import {
  collectionDocumentCreateSchema,
  collectionDocumentUpdateSchema,
  refundDocumentCreateSchema,
  refundDocumentUpdateSchema,
} from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'

const COLLECTION_DOCUMENT_ENTITY_ID = 'export_finance:export_finance_collection_document' as const
const REFUND_DOCUMENT_ENTITY_ID = 'export_finance:export_finance_refund_document' as const
const COLLECTION_DOCUMENT_RESOURCE_KIND = 'export_finance.collection_document' as const
const REFUND_DOCUMENT_RESOURCE_KIND = 'export_finance.refund_document' as const

/**
 * One row is one file. The two document families are structurally identical and differ only in
 * their owner record and their document-type enum, so they share this module's shape — but each
 * keeps its own entity, event pair and route, because they hang on different anchors.
 */

export const collectionDocumentCrudEvents: CrudEventsConfig<ExportFinanceCollectionDocument> = {
  module: 'export_finance',
  entity: 'collection-documents',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    docType: ctx.entity?.docType ?? null,
  }),
}

export const collectionDocumentCrudIndexer: CrudIndexerConfig<ExportFinanceCollectionDocument> = {
  entityType: COLLECTION_DOCUMENT_ENTITY_ID,
}

export const refundDocumentCrudEvents: CrudEventsConfig<ExportFinanceRefundDocument> = {
  module: 'export_finance',
  entity: 'refund-documents',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    docType: ctx.entity?.docType ?? null,
  }),
}

export const refundDocumentCrudIndexer: CrudIndexerConfig<ExportFinanceRefundDocument> = {
  entityType: REFUND_DOCUMENT_ENTITY_ID,
}

function collectionDocumentFilter(scope: Scope, id: string): FilterQuery<ExportFinanceCollectionDocument> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ExportFinanceCollectionDocument>
}

function refundDocumentFilter(scope: Scope, id: string): FilterQuery<ExportFinanceRefundDocument> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ExportFinanceRefundDocument>
}

/**
 * The owner record is loaded scoped first: a document may only hang on a collection/refund the
 * caller can actually see, which keeps a guessed id from becoming a cross-organization write.
 */
async function loadScopedCollection(
  em: EntityManager,
  scope: Scope,
  collectionId: string,
): Promise<ExportFinanceCollection> {
  const collection = await em.fork().findOne(ExportFinanceCollection, {
    id: collectionId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ExportFinanceCollection>)
  if (!collection) throw notFound('Collection record not found')
  return collection
}

async function loadScopedRefund(
  em: EntityManager,
  scope: Scope,
  refundId: string,
): Promise<ExportFinanceRefund> {
  const refund = await em.fork().findOne(ExportFinanceRefund, {
    id: refundId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ExportFinanceRefund>)
  if (!refund) throw notFound('Tax refund record not found')
  return refund
}

const createCollectionDocumentCommand: CommandHandler<Record<string, unknown>, ExportFinanceCollectionDocument> = {
  id: 'export_finance.collection-documents.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = collectionDocumentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const collection = await loadScopedCollection(em, scope, parsed.collectionId)

    const document = await de.createOrmEntity({
      entity: ExportFinanceCollectionDocument,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        collection,
        docType: parsed.docType,
        issuedAt: parsed.issuedAt ? new Date(parsed.issuedAt) : null,
        attachmentId: parsed.attachmentId ?? null,
        note: parsed.note ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: document,
      identifiers: { id: String(document.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: collectionDocumentCrudEvents,
      indexer: collectionDocumentCrudIndexer,
    })

    return document
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create collection document',
    resourceKind: COLLECTION_DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), docType: result.docType },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing collection document id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: ExportFinanceCollectionDocument,
      where: collectionDocumentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: collectionDocumentCrudEvents,
      indexer: collectionDocumentCrudIndexer,
    })
  },
}

const updateCollectionDocumentCommand: CommandHandler<Record<string, unknown>, ExportFinanceCollectionDocument> = {
  id: 'export_finance.collection-documents.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = collectionDocumentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(
      ExportFinanceCollectionDocument,
      collectionDocumentFilter(scope, parsed.id),
    )
    if (!existing) throw notFound('Collection document not found')

    const updated = await de.updateOrmEntity({
      entity: ExportFinanceCollectionDocument,
      where: collectionDocumentFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.docType !== undefined) entity.docType = parsed.docType
        if (parsed.issuedAt !== undefined) entity.issuedAt = parsed.issuedAt ? new Date(parsed.issuedAt) : null
        if (parsed.attachmentId !== undefined) entity.attachmentId = parsed.attachmentId
        if (parsed.note !== undefined) entity.note = parsed.note
      },
    })
    if (!updated) throw notFound('Collection document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: collectionDocumentCrudEvents,
      indexer: collectionDocumentCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update collection document',
    resourceKind: COLLECTION_DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

const deleteCollectionDocumentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  ExportFinanceCollectionDocument
> = {
  id: 'export_finance.collection-documents.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Collection document id required')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const removed = await de.deleteOrmEntity({
      entity: ExportFinanceCollectionDocument,
      where: collectionDocumentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Collection document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: collectionDocumentCrudEvents,
      indexer: collectionDocumentCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete collection document',
    resourceKind: COLLECTION_DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

const createRefundDocumentCommand: CommandHandler<Record<string, unknown>, ExportFinanceRefundDocument> = {
  id: 'export_finance.refund-documents.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = refundDocumentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const refund = await loadScopedRefund(em, scope, parsed.refundId)

    const document = await de.createOrmEntity({
      entity: ExportFinanceRefundDocument,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        refund,
        docType: parsed.docType,
        issuedAt: parsed.issuedAt ? new Date(parsed.issuedAt) : null,
        attachmentId: parsed.attachmentId ?? null,
        note: parsed.note ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: document,
      identifiers: { id: String(document.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: refundDocumentCrudEvents,
      indexer: refundDocumentCrudIndexer,
    })

    return document
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create refund document',
    resourceKind: REFUND_DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), docType: result.docType },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing refund document id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: ExportFinanceRefundDocument,
      where: refundDocumentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: refundDocumentCrudEvents,
      indexer: refundDocumentCrudIndexer,
    })
  },
}

const updateRefundDocumentCommand: CommandHandler<Record<string, unknown>, ExportFinanceRefundDocument> = {
  id: 'export_finance.refund-documents.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = refundDocumentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(ExportFinanceRefundDocument, refundDocumentFilter(scope, parsed.id))
    if (!existing) throw notFound('Refund document not found')

    const updated = await de.updateOrmEntity({
      entity: ExportFinanceRefundDocument,
      where: refundDocumentFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.docType !== undefined) entity.docType = parsed.docType
        if (parsed.issuedAt !== undefined) entity.issuedAt = parsed.issuedAt ? new Date(parsed.issuedAt) : null
        if (parsed.attachmentId !== undefined) entity.attachmentId = parsed.attachmentId
        if (parsed.note !== undefined) entity.note = parsed.note
      },
    })
    if (!updated) throw notFound('Refund document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: refundDocumentCrudEvents,
      indexer: refundDocumentCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update refund document',
    resourceKind: REFUND_DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

const deleteRefundDocumentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  ExportFinanceRefundDocument
> = {
  id: 'export_finance.refund-documents.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Refund document id required')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const removed = await de.deleteOrmEntity({
      entity: ExportFinanceRefundDocument,
      where: refundDocumentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Refund document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: refundDocumentCrudEvents,
      indexer: refundDocumentCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete refund document',
    resourceKind: REFUND_DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createCollectionDocumentCommand)
registerCommand(updateCollectionDocumentCommand)
registerCommand(deleteCollectionDocumentCommand)
registerCommand(createRefundDocumentCommand)
registerCommand(updateRefundDocumentCommand)
registerCommand(deleteRefundDocumentCommand)

export {
  createCollectionDocumentCommand,
  updateCollectionDocumentCommand,
  deleteCollectionDocumentCommand,
  createRefundDocumentCommand,
  updateRefundDocumentCommand,
  deleteRefundDocumentCommand,
}
