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
import { TradeDocsContract, TradeDocsContractLine, TradeDocsInvoice, TradeDocsInvoiceLine } from '../data/entities'
import {
  invoiceAttachSchema,
  invoiceCreateSchema,
  invoiceTransitionSchema,
  invoiceUpdateSchema,
  type InvoiceLineInput,
} from '../data/validators'
import { ensureScope, invoiceFilter, loadContract, loadInvoice, type TradeDocsScope } from '../lib/scope'
import { recomputeContractHead } from '../lib/contractRecalc'
import { productSnapshotPayload, readProductSnapshots } from '../lib/currencyScale'
import { sumAmounts } from '../lib/money'
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
  direction: string
  status: string
  counterpartyKind: string
  counterpartyId: string | null
  contractId: string | null
  currencyCode: string
  subtotal: string
  total: string
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
    direction: entity.direction,
    status: entity.status,
    counterpartyKind: entity.counterpartyKind,
    counterpartyId: entity.counterpartyId ? String(entity.counterpartyId) : null,
    contractId: contractIdFrom(entity.contract),
    currencyCode: entity.currencyCode,
    subtotal: entity.subtotal,
    total: entity.total,
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
        contractLine: line.contractLineId ? em.getReference(TradeDocsContractLine, line.contractLineId) : undefined,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()
}

/** Invoice totals are the sums of the printed line amounts — never of `quantity × unitPrice`. */
function invoiceTotals(lines: Array<{ amount: string }>): { subtotal: string; total: string } {
  const total = sumAmounts(lines.map((line) => line.amount))
  return { subtotal: total, total }
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
  const totals = invoiceTotals(lines)
  invoice.subtotal = totals.subtotal
  invoice.total = totals.total
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
    const totals = invoiceTotals(lines)

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
        ['number', 'direction', 'counterpartyKind', 'contractId', 'currencyCode', 'issuedAt', 'notes'],
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
 * `confirm` puts the invoice's printed amounts into the financial caliber of every contract line
 * it is bound to; `void` releases them again. Both recompute the contract head in the same
 * transaction, so a reader can never see a confirmed invoice with an unrecomputed contract.
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

    const updated = await de.updateOrmEntity({
      entity: TradeDocsInvoice,
      where: invoiceFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = transition.to
        if (parsed.reason) {
          entity.notes = `${entity.notes ? `${entity.notes}\n` : ''}${parsed.action}: ${parsed.reason}`
        }
      },
    })
    if (!updated) throw notFound('Invoice not found')

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
registerCommand(transitionInvoiceCommand)
registerCommand(attachInvoiceCommand)

export {
  createInvoiceCommand,
  updateInvoiceCommand,
  deleteInvoiceCommand,
  transitionInvoiceCommand,
  attachInvoiceCommand,
}
export type { SerializedInvoice }
