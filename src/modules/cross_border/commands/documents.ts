import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrossBorderExportDocument, CrossBorderShipment } from '../data/entities'
import { documentCreateSchema, documentUpdateSchema } from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'
import { eventsConfig } from '../events'

const DOCUMENT_ENTITY_ID = 'cross_border:cross_border_export_document' as const
const DOCUMENT_RESOURCE_KIND = 'cross_border.export_document' as const

export const documentCrudEvents: CrudEventsConfig<CrossBorderExportDocument> = {
  module: 'cross_border',
  entity: 'export_document',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    docType: ctx.entity?.docType ?? null,
  }),
}

export const documentCrudIndexer: CrudIndexerConfig<CrossBorderExportDocument> = {
  entityType: DOCUMENT_ENTITY_ID,
}

function documentFilter(scope: Scope, id: string): FilterQuery<CrossBorderExportDocument> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<CrossBorderExportDocument>
}

/**
 * The shipment is loaded scoped first: a document may only be attached to a consignment the
 * caller can actually see, which keeps a guessed shipment id from becoming a cross-organization
 * write.
 */
async function loadScopedShipment(
  em: EntityManager,
  scope: Scope,
  shipmentId: string,
): Promise<CrossBorderShipment> {
  const shipment = await em.fork().findOne(CrossBorderShipment, {
    id: shipmentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<CrossBorderShipment>)
  if (!shipment) throw notFound('Shipment not found')
  return shipment
}

const createDocumentCommand: CommandHandler<Record<string, unknown>, CrossBorderExportDocument> = {
  id: 'cross_border.documents.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = documentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const shipment = await loadScopedShipment(em, scope, parsed.shipmentId)

    const document = await de.createOrmEntity({
      entity: CrossBorderExportDocument,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        shipment,
        purchaseOrderId: parsed.purchaseOrderId ?? null,
        docType: parsed.docType,
        documentNumber: parsed.documentNumber ?? null,
        issuedAt: parsed.issuedAt ? new Date(parsed.issuedAt) : null,
        attachmentId: parsed.attachmentId ?? null,
        note: parsed.note ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: document,
      identifiers: { id: String(document.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })

    return document
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create export document',
    resourceKind: DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), docType: result.docType },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing export document id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: CrossBorderExportDocument,
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
  },
}

const updateDocumentCommand: CommandHandler<Record<string, unknown>, CrossBorderExportDocument> = {
  id: 'cross_border.documents.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = documentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(CrossBorderExportDocument, documentFilter(scope, parsed.id))
    if (!existing) throw notFound('Export document not found')

    const updated = await de.updateOrmEntity({
      entity: CrossBorderExportDocument,
      where: documentFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.docType !== undefined) entity.docType = parsed.docType
        if (parsed.documentNumber !== undefined) entity.documentNumber = parsed.documentNumber
        if (parsed.issuedAt !== undefined) entity.issuedAt = parsed.issuedAt ? new Date(parsed.issuedAt) : null
        if (parsed.purchaseOrderId !== undefined) entity.purchaseOrderId = parsed.purchaseOrderId
        if (parsed.attachmentId !== undefined) entity.attachmentId = parsed.attachmentId
        if (parsed.note !== undefined) entity.note = parsed.note
      },
    })
    if (!updated) throw notFound('Export document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update export document',
    resourceKind: DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

const deleteDocumentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  CrossBorderExportDocument
> = {
  id: 'cross_border.documents.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Export document id required')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const removed = await de.deleteOrmEntity({
      entity: CrossBorderExportDocument,
      where: documentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Export document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: documentCrudEvents,
      indexer: documentCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete export document',
    resourceKind: DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createDocumentCommand)
registerCommand(updateDocumentCommand)
registerCommand(deleteDocumentCommand)

export { createDocumentCommand, updateDocumentCommand, deleteDocumentCommand }

/** Kept for the events registry: document lifecycle events are declared in `../events`. */
export const documentEventIds = eventsConfig
