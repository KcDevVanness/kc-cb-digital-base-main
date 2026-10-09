import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { conflict, CrudHttpError, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CompanyOrder, CompanyOrderDocument } from '../data/entities'
import {
  COMPANY_ORDER_DOCUMENT_ATTACHMENT_CODE,
  companyOrderDocumentAttachSchema,
  companyOrderDocumentDeleteSchema,
} from '../data/validators'
import { ownerRequired, resolveCompanyOrderAccess } from '../lib/collaborators'
import { invalidateCompanyOrderLinkCaches } from '../lib/cacheInvalidation'
import { eventsConfig } from '../events'
import { ensureCompanyOrderScope } from './companyOrders'

/**
 * The installed `attachments` entity id every document-slot file is filed under. The file never
 * moves out of the installed table; this module only records which 35-column slot it belongs to.
 */
export const COMPANY_ORDER_DOCUMENT_ENTITY_ID = 'order_hub:company_order_document' as const

/** The immutable facts frozen onto a slot row, captured for the undo log. */
type CompanyOrderDocumentSnapshot = {
  id: string
  companyOrderId: string
  tenantId: string
  organizationId: string
  slot: string
  attachmentId: string
  fileName: string
  createdAt: string
}

function serializeDocument(row: CompanyOrderDocument): CompanyOrderDocumentSnapshot {
  return {
    id: String(row.id),
    companyOrderId: String(row.companyOrder.id),
    tenantId: String(row.tenantId),
    organizationId: String(row.organizationId),
    slot: row.slot,
    attachmentId: String(row.attachmentId),
    fileName: row.fileName,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
  }
}

/**
 * Registers one stored attachment into a named document slot (REQ-021).
 *
 * The file itself was uploaded through the installed `POST /api/attachments` with
 * `entityId = 'order_hub:company_order_document'` and `recordId = <the slot row id the caller chose>`;
 * this command only writes the *mapping* row. It is **owner-only** (a collaborator sees the root but
 * never changes its documents), and it fails closed with 422 when the attachment is not a document
 * file of this tenant carrying exactly the expected record id. The `(companyOrder, slot,
 * attachmentId)` unique key turns a repeated registration into a 409.
 *
 * Undoable: the inverse simply drops the row it created (the attachment is left to the caller, which
 * owns the separate delete through the installed route).
 */
const attachCompanyOrderDocumentCommand: CommandHandler<Record<string, unknown>, CompanyOrderDocument> = {
  id: 'order_hub.orders.documents.attach',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = companyOrderDocumentAttachSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    // Owner-only, like every other write that adds a child to the root: a collaborating organization
    // may see the root but never file documents into it (403 with the named owner-required code); an
    // outsider gets the plain not-found (no existence leak).
    const access = await resolveCompanyOrderAccess(em, scope, parsed.companyOrderId)
    if (!access) throw notFound('Company order not found')
    if (access.side !== 'owner') throw ownerRequired()
    const companyOrder = access.order

    // The registration must name a document-entity attachment of *this* tenant whose record id is the
    // slot row id the caller pre-generated — anything else is a foreign/unrelated file (422).
    const attachment = await em.fork().findOne(Attachment, {
      id: parsed.attachmentId,
      tenantId: scope.tenantId,
    })
    if (
      !attachment ||
      attachment.entityId !== COMPANY_ORDER_DOCUMENT_ENTITY_ID ||
      String(attachment.recordId) !== parsed.id
    ) {
      throw new CrudHttpError(422, {
        error: 'The attachment is not a document slot file of this tenant',
        code: COMPANY_ORDER_DOCUMENT_ATTACHMENT_CODE,
      })
    }

    let created: CompanyOrderDocument | null = null
    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            created = em.create(CompanyOrderDocument, {
              id: parsed.id,
              tenantId: scope.tenantId,
              // The slot row belongs to the **owner** organization of the root (a collaborator's id
              // would mis-scope every later read).
              organizationId: String(companyOrder.organizationId),
              companyOrder,
              slot: parsed.slot,
              attachmentId: parsed.attachmentId,
              fileName: attachment.fileName,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            em.persist(created)
          },
        ],
        { transaction: true, label: 'order_hub.orders.documents.attach' },
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This file is already registered for the slot')
      throw error
    }
    const document = created as CompanyOrderDocument | null
    if (!document) throw new Error('[internal] attach produced no document row')

    const identifiers = {
      id: String(companyOrder.id),
      tenantId: scope.tenantId,
      organizationId: String(companyOrder.organizationId),
    }
    await eventsConfig.emit('order_hub.company_order.documents.updated', {
      ...identifiers,
      slot: parsed.slot,
      documentId: parsed.id,
      count: 1,
    })
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-document-attached',
    )

    return document
  },
  captureAfter: (_input, result) => serializeDocument(result),
  buildLog: async ({ result }) => {
    const after = serializeDocument(result)
    return {
      actionLabel: 'Attach company order document',
      resourceKind: 'order_hub.company_order.document',
      resourceId: after.companyOrderId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<UndoPayload<CompanyOrderDocumentSnapshot>>(logEntry)
    const after = payload?.after
    if (!after?.id) throw new Error('[internal] Missing document snapshot for undo')
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    await em.nativeDelete(CompanyOrderDocument, {
      id: after.id,
      tenantId: scope.tenantId,
    } as FilterQuery<CompanyOrderDocument>)
    const identifiers = {
      id: after.companyOrderId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
    }
    await eventsConfig.emit('order_hub.company_order.documents.updated', {
      ...identifiers,
      slot: after.slot,
      documentId: after.id,
      count: 0,
    })
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-document-attach-undone',
    )
  },
}

/**
 * Detaches one slot row (REQ-021).
 *
 * Owner-only, like attach: a collaborator may read the slot list but never delete from it, and an
 * outsider sees the plain not-found. The row is hard-deleted (the table has no soft-delete column);
 * the caller deletes the underlying stored file separately through the installed
 * `DELETE /api/attachments`, so a failed file delete can only leave an orphan the slot list no
 * longer references.
 *
 * Undoable: the inverse re-inserts the row exactly as it was frozen.
 */
const detachCompanyOrderDocumentCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'order_hub.orders.documents.detach',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = companyOrderDocumentDeleteSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const row = await em.fork().findOne(CompanyOrderDocument, {
      id: parsed.id,
      tenantId: scope.tenantId,
    } as FilterQuery<CompanyOrderDocument>)
    if (!row) return { before: null }
    return { before: serializeDocument(row) }
  },
  async execute(rawInput, ctx) {
    const parsed = companyOrderDocumentDeleteSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const row = await em.fork().findOne(CompanyOrderDocument, {
      id: parsed.id,
      tenantId: scope.tenantId,
    } as FilterQuery<CompanyOrderDocument>)
    if (!row) throw notFound('Document slot not found')

    const rootId = String(row.companyOrder.id)
    const access = await resolveCompanyOrderAccess(em, scope, rootId)
    if (!access) throw notFound('Company order not found')
    if (access.side !== 'owner') throw ownerRequired()

    const removed = await em.nativeDelete(CompanyOrderDocument, {
      id: parsed.id,
      tenantId: scope.tenantId,
    } as FilterQuery<CompanyOrderDocument>)
    if (!removed) throw notFound('Document slot not found')

    const identifiers = {
      id: rootId,
      tenantId: scope.tenantId,
      organizationId: String(row.organizationId),
    }
    await eventsConfig.emit('order_hub.company_order.documents.updated', {
      ...identifiers,
      slot: row.slot,
      documentId: parsed.id,
      count: 0,
    })
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-document-detached',
    )

    return { id: parsed.id }
  },
  captureAfter: (_input, result) => ({ id: result.id }),
  buildLog: async ({ result, snapshots }) => {
    const before = (snapshots?.before as CompanyOrderDocumentSnapshot | null) ?? null
    return {
      actionLabel: 'Detach company order document',
      resourceKind: 'order_hub.company_order.document',
      resourceId: before?.companyOrderId ?? result.id,
      tenantId: before?.tenantId,
      organizationId: before?.organizationId,
      snapshotBefore: before,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<UndoPayload<CompanyOrderDocumentSnapshot>>(logEntry)
    const before = payload?.before
    if (!before?.id) throw new Error('[internal] Missing document snapshot for undo')
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    await withAtomicFlush(
      em,
      [
        async () => {
          const row = em.create(CompanyOrderDocument, {
            id: before.id,
            tenantId: before.tenantId,
            organizationId: before.organizationId,
            companyOrder: em.getReference(CompanyOrder, before.companyOrderId),
            slot: before.slot,
            attachmentId: before.attachmentId,
            fileName: before.fileName,
            createdAt: before.createdAt ? new Date(before.createdAt) : new Date(),
            updatedAt: new Date(),
          })
          em.persist(row)
        },
      ],
      { transaction: true, label: 'order_hub.orders.documents.detach.undo' },
    )
    const identifiers = {
      id: before.companyOrderId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    }
    await eventsConfig.emit('order_hub.company_order.documents.updated', {
      ...identifiers,
      slot: before.slot,
      documentId: before.id,
      count: 1,
    })
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-document-detach-undone',
    )
  },
}

registerCommand(attachCompanyOrderDocumentCommand)
registerCommand(detachCompanyOrderDocumentCommand)

export { attachCompanyOrderDocumentCommand, detachCompanyOrderDocumentCommand }
