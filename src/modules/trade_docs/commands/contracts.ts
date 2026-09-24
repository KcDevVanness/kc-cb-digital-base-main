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
import { TradeDocsContract, TradeDocsContractLine } from '../data/entities'
import {
  contractAttachSchema,
  contractCreateSchema,
  contractDocumentSchema,
  contractTransitionSchema,
  contractUpdateSchema,
  type ContractLineInput,
} from '../data/validators'
import { contractFilter, ensureScope, loadContract, type TradeDocsScope } from '../lib/scope'
import { recomputeContractHead } from '../lib/contractRecalc'
import { productSnapshotPayload, readProductSnapshots } from '../lib/currencyScale'
import { buildContractSheet, CONTRACT_TEMPLATE_ID } from '../lib/contractTemplate'
import { eventsConfig } from '../events'

const ENTITY_ID = 'trade_docs:trade_docs_contract' as const
const RESOURCE_KIND = 'trade_docs.contract' as const

const ALLOWED_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  issue: { from: ['draft'], to: 'issued' },
  sign: { from: ['issued'], to: 'signed' },
  close: { from: ['signed'], to: 'closed' },
  cancel: { from: ['draft', 'issued'], to: 'cancelled' },
}

const TRANSITION_EVENT_IDS = {
  issue: 'trade_docs.contract.issued',
  sign: 'trade_docs.contract.signed',
  close: 'trade_docs.contract.closed',
  cancel: 'trade_docs.contract.cancelled',
} as const

type SerializedContract = {
  id: string
  number: string | null
  direction: string
  status: string
  counterpartyKind: string
  counterpartyId: string | null
  counterpartySnapshot: Record<string, unknown> | null
  ourPartySnapshot: Record<string, unknown> | null
  priceTier: string | null
  currencyCode: string
  exchangeRate: string | null
  sourceKind: string | null
  sourceId: string | null
  sourceSnapshot: Record<string, unknown> | null
  contractTotal: string
  financeTotal: string
  differenceTotal: string
  signedAt: string | null
  deliveryDate: string | null
  paymentTerms: string | null
  shippingMethod: string | null
  destination: string | null
  marks: string | null
  notes: string | null
  tenantId: string
  organizationId: string
}

function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function serializeContract(entity: TradeDocsContract): SerializedContract {
  return {
    id: String(entity.id),
    number: entity.number ?? null,
    direction: entity.direction,
    status: entity.status,
    counterpartyKind: entity.counterpartyKind,
    counterpartyId: entity.counterpartyId ? String(entity.counterpartyId) : null,
    counterpartySnapshot: entity.counterpartySnapshot ?? null,
    ourPartySnapshot: entity.ourPartySnapshot ?? null,
    priceTier: entity.priceTier ?? null,
    currencyCode: entity.currencyCode,
    exchangeRate: entity.exchangeRate ?? null,
    sourceKind: entity.sourceKind ?? null,
    sourceId: entity.sourceId ? String(entity.sourceId) : null,
    sourceSnapshot: entity.sourceSnapshot ?? null,
    contractTotal: entity.contractTotal,
    financeTotal: entity.financeTotal,
    differenceTotal: entity.differenceTotal,
    signedAt: toDateOnly(entity.signedAt),
    deliveryDate: toDateOnly(entity.deliveryDate),
    paymentTerms: entity.paymentTerms ?? null,
    shippingMethod: entity.shippingMethod ?? null,
    destination: entity.destination ?? null,
    marks: entity.marks ?? null,
    notes: entity.notes ?? null,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

export const contractCrudEvents: CrudEventsConfig<TradeDocsContract> = {
  module: 'trade_docs',
  entity: 'contract',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<TradeDocsContract>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    status: ctx.entity?.status ?? null,
    number: ctx.entity?.number ?? null,
    direction: ctx.entity?.direction ?? null,
  }),
}

export const contractCrudIndexer: CrudIndexerConfig<TradeDocsContract> = {
  entityType: ENTITY_ID,
}

type ResolvedContractLine = {
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
  note: string | null
}

/**
 * Freezes each line's product data.
 *
 * A reference to a product must resolve *inside the caller's organization*: a line pointing at
 * another organization's product would print data the operator cannot open. A line without a
 * product id is a free-text line (allowed, e.g. freight), and then a name is mandatory — an
 * unnamed line cannot be printed.
 */
async function resolveContractLines(
  em: EntityManager,
  scope: TradeDocsScope,
  lines: ContractLineInput[],
): Promise<ResolvedContractLine[]> {
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
      note: line.note ?? null,
    }
  })
}

/**
 * Lines are replaced as a set: the contract is the aggregate root, line numbers are assigned
 * 1..n by the command, and the head's totals are recomputed from the rows in the same
 * transaction. Mirrors how the purchasing module rewrites order lines.
 */
async function persistContractLines(
  em: EntityManager,
  scope: TradeDocsScope,
  contract: TradeDocsContract,
  lines: ResolvedContractLine[],
): Promise<void> {
  await em.nativeDelete(TradeDocsContractLine, {
    contract: contract.id,
  } as FilterQuery<TradeDocsContractLine>)
  const now = new Date()
  for (const line of lines) {
    em.persist(
      em.create(TradeDocsContractLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        contract,
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
        note: line.note,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()
}

/**
 * Per-organization, per-direction contract number, assigned at `issue`.
 *
 * The unique constraint on `(tenant, organization, number)` is the real guarantee — this only
 * picks the next value, so two concurrent issues can collide and the loser gets a 409 it can
 * retry with a fresh number. That is why `issue` first writes a `PENDING` placeholder and only
 * then resolves the number: the row is visible in the sequence read.
 */
async function nextContractNumber(
  em: EntityManager,
  scope: TradeDocsScope,
  direction: string,
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `${direction === 'sales' ? 'SC' : 'PC'}-${year}-`
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('trade_docs_contracts')
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

const createContractCommand: CommandHandler<Record<string, unknown>, TradeDocsContract> = {
  id: 'trade_docs.contracts.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = contractCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const lines = await resolveContractLines(em, scope, parsed.lines)
    let contract!: TradeDocsContract

    await withAtomicFlush(
      em,
      [
        async () => {
          contract = await de.createOrmEntity({
            entity: TradeDocsContract,
            data: {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              direction: parsed.direction,
              status: 'draft',
              counterpartyKind: parsed.counterpartyKind,
              counterpartyId: parsed.counterpartyId ?? null,
              counterpartySnapshot: parsed.counterpartySnapshot,
              ourPartySnapshot: parsed.ourPartySnapshot,
              priceTier: parsed.priceTier ?? null,
              currencyCode: parsed.currencyCode,
              exchangeRate: parsed.exchangeRate,
              sourceKind: parsed.sourceKind ?? null,
              sourceId: parsed.sourceId ?? null,
              sourceSnapshot: parsed.sourceSnapshot,
              signedAt: parsed.signedAt ? new Date(parsed.signedAt) : null,
              deliveryDate: parsed.deliveryDate ? new Date(parsed.deliveryDate) : null,
              paymentTerms: parsed.paymentTerms,
              shippingMethod: parsed.shippingMethod,
              destination: parsed.destination,
              marks: parsed.marks,
              notes: parsed.notes,
            },
          })
          await persistContractLines(em, scope, contract, lines)
        },
        // Second phase, same transaction: the lines are flushed before the head totals are
        // computed, so the two calibers always describe the rows that were just written.
        async () => {
          await recomputeContractHead(em, scope, String(contract.id))
        },
      ],
      { transaction: true, label: 'trade_docs.contracts.create' },
    )

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: contract,
      identifiers: { id: String(contract.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: contractCrudEvents,
      indexer: contractCrudIndexer,
    })

    return contract
  },
  captureAfter: (_input, result) => serializeContract(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeContract(result)
    return {
      actionLabel: translate('trade_docs.audit.contracts.create', 'Create contract'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedContract }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedContract | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing contract id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: TradeDocsContract,
      where: contractFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: contractCrudEvents,
      indexer: contractCrudIndexer,
    })
  },
}

const updateContractCommand: CommandHandler<Record<string, unknown>, TradeDocsContract> = {
  id: 'trade_docs.contracts.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = contractUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const contract = await loadContract(em, scope, parsed.id)
    if (contract.status !== 'draft') {
      throw conflict('Only a draft contract can be edited; cancel or reissue it instead')
    }

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(contract.id),
      current: contract.updatedAt,
      request: ctx.request ?? null,
    })

    const lines = parsed.lines ? await resolveContractLines(em, scope, parsed.lines) : null

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: TradeDocsContract,
            where: contractFilter(scope, parsed.id),
            apply: (entity) => {
              if (parsed.direction !== undefined) entity.direction = parsed.direction
              if (parsed.counterpartyKind !== undefined) entity.counterpartyKind = parsed.counterpartyKind
              if (parsed.counterpartyId !== undefined) entity.counterpartyId = parsed.counterpartyId
              if (parsed.counterpartySnapshot !== undefined) entity.counterpartySnapshot = parsed.counterpartySnapshot
              if (parsed.ourPartySnapshot !== undefined) entity.ourPartySnapshot = parsed.ourPartySnapshot
              if (parsed.priceTier !== undefined) entity.priceTier = parsed.priceTier
              if (parsed.currencyCode !== undefined) entity.currencyCode = parsed.currencyCode
              if (parsed.exchangeRate !== undefined) entity.exchangeRate = parsed.exchangeRate
              if (parsed.sourceKind !== undefined) entity.sourceKind = parsed.sourceKind
              if (parsed.sourceId !== undefined) entity.sourceId = parsed.sourceId
              if (parsed.sourceSnapshot !== undefined) entity.sourceSnapshot = parsed.sourceSnapshot
              if (parsed.signedAt !== undefined) entity.signedAt = parsed.signedAt ? new Date(parsed.signedAt) : null
              if (parsed.deliveryDate !== undefined) entity.deliveryDate = parsed.deliveryDate ? new Date(parsed.deliveryDate) : null
              if (parsed.paymentTerms !== undefined) entity.paymentTerms = parsed.paymentTerms
              if (parsed.shippingMethod !== undefined) entity.shippingMethod = parsed.shippingMethod
              if (parsed.destination !== undefined) entity.destination = parsed.destination
              if (parsed.marks !== undefined) entity.marks = parsed.marks
              if (parsed.notes !== undefined) entity.notes = parsed.notes
            },
          })
          if (lines) {
            const target = await em.findOneOrFail(TradeDocsContract, contractFilter(scope, parsed.id))
            await persistContractLines(em, scope, target, lines)
          }
        },
        async () => {
          await recomputeContractHead(em, scope, parsed.id)
        },
      ],
      { transaction: true, label: 'trade_docs.contracts.update' },
    )

    const updated = await loadContract(em, scope, parsed.id)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: contractCrudEvents,
      indexer: contractCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => serializeContract(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedContract | undefined
    const after = serializeContract(result)
    return {
      actionLabel: translate('trade_docs.audit.contracts.update', 'Update contract'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['direction', 'counterpartyKind', 'priceTier', 'currencyCode', 'deliveryDate', 'paymentTerms', 'shippingMethod', 'destination', 'marks', 'notes'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
}

const deleteContractCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  TradeDocsContract
> = {
  id: 'trade_docs.contracts.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Contract id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const contract = await loadContract(em, scope, id)
    if (contract.status !== 'draft' && contract.status !== 'cancelled') {
      throw conflict('Only a draft or cancelled contract can be deleted')
    }

    const removed = await de.deleteOrmEntity({
      entity: TradeDocsContract,
      where: contractFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Contract not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: contractCrudEvents,
      indexer: contractCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => serializeContract(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeContract(result)
    return {
      actionLabel: translate('trade_docs.audit.contracts.delete', 'Delete contract'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

/**
 * Status transitions share one command surface so the allowed-transition table is the only place
 * that decides what is legal — a route or a UI button can never widen it. `cancel` demands a
 * reason, which is appended to the contract's notes (there is no separate reason column, matching
 * the purchasing module's convention).
 */
const transitionContractCommand: CommandHandler<Record<string, unknown>, TradeDocsContract> = {
  id: 'trade_docs.contracts.transition',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = contractTransitionSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const contract = await loadContract(em, scope, parsed.id)
    const transition = ALLOWED_TRANSITIONS[parsed.action]
    if (!transition) throw badRequest(`Unknown transition: ${parsed.action}`)
    if (!transition.from.includes(contract.status)) {
      throw new CrudHttpError(422, {
        error: `Cannot ${parsed.action} a contract in status ${contract.status}`,
      })
    }
    if (parsed.action === 'cancel' && !parsed.reason) {
      throw badRequest('A cancellation reason is required')
    }

    const lineCount = await em.fork().count(TradeDocsContractLine, {
      contract: contract.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<TradeDocsContractLine>)
    if (parsed.action === 'issue' && lineCount === 0) {
      throw new CrudHttpError(422, { error: 'A contract without lines cannot be issued' })
    }

    const now = new Date()
    let updated = await de.updateOrmEntity({
      entity: TradeDocsContract,
      where: contractFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = transition.to
        if (transition.to === 'issued') {
          // Placeholder first: the sequence is read from rows that are actually visible.
          entity.number = entity.number ?? `PENDING-${String(entity.id).slice(0, 8)}`
        }
        if (transition.to === 'signed') entity.signedAt = entity.signedAt ?? now
        if (parsed.reason) {
          entity.notes = `${entity.notes ? `${entity.notes}\n` : ''}${parsed.action}: ${parsed.reason}`
        }
      },
    })
    if (!updated) throw notFound('Contract not found')

    if (transition.to === 'issued' && (!updated.number || updated.number.startsWith('PENDING-'))) {
      try {
        updated.number = await nextContractNumber(em, scope, updated.direction)
        await em.fork().nativeUpdate(TradeDocsContract, { id: updated.id }, { number: updated.number })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Another contract took that number; retry the transition')
        }
        throw error
      }
    }

    await eventsConfig.emit(TRANSITION_EVENT_IDS[parsed.action], {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: updated.status,
      number: updated.number ?? null,
      direction: updated.direction,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id), status: result.status, number: result.number ?? null }),
  buildLog: async ({ result }) => ({
    actionLabel: `Contract ${result.status}`,
    resourceKind: RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status, number: result.number ?? null },
  }),
}

/**
 * Renders the contract to XLSX and stores it as an attachment on the contract.
 *
 * The document is **archived**, not generated on every download: a signed contract is a legal
 * record, and re-rendering it later would let an edited product name or a changed template rewrite
 * what the parties signed. Regenerating writes a new file and moves the pointer, so the previous
 * file stays in storage.
 *
 * The layout comes from `lib/contractTemplate.ts`; the platform's dependency-free `buildXlsx`
 * writes it, and amounts go in as numbers so the total cells sum in Excel.
 */
const generateContractDocumentCommand: CommandHandler<
  Record<string, unknown>,
  { attachmentId: string; fileName: string }
> = {
  id: 'trade_docs.contracts.generate-document',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = contractDocumentSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const contract = await loadContract(em, scope, parsed.id)
    if (contract.status === 'draft') {
      throw new CrudHttpError(422, { error: 'Issue the contract before generating its document' })
    }
    if (contract.status === 'cancelled') {
      throw new CrudHttpError(422, { error: 'A cancelled contract has no document to generate' })
    }

    const lines = await em.fork().find(
      TradeDocsContractLine,
      { contract: contract.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { orderBy: { lineNumber: 'ASC' } },
    )

    // The document's labels follow the generating operator's locale (the file is archived right
    // after, so the language is frozen with it). See `lib/contractTemplate.ts`.
    const { t } = await resolveTranslations()
    const sheet = buildContractSheet({
      number: contract.number ?? null,
      direction: contract.direction,
      status: contract.status,
      currencyCode: contract.currencyCode,
      priceTier: contract.priceTier ?? null,
      signedAt: toDateOnly(contract.signedAt),
      deliveryDate: toDateOnly(contract.deliveryDate),
      paymentTerms: contract.paymentTerms ?? null,
      shippingMethod: contract.shippingMethod ?? null,
      destination: contract.destination ?? null,
      marks: contract.marks ?? null,
      notes: contract.notes ?? null,
      counterparty: contract.counterpartySnapshot ?? null,
      ourParty: contract.ourPartySnapshot ?? null,
      contractTotal: contract.contractTotal,
      financeTotal: contract.financeTotal,
      differenceTotal: contract.differenceTotal,
      lines: lines.map((line) => ({
        lineNumber: line.lineNumber,
        name: line.name ?? null,
        sku: line.sku ?? null,
        model: line.model ?? null,
        spec: line.spec ?? null,
        unit: line.unit ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        contractAmount: line.contractAmount,
        note: line.note ?? null,
      })),
    }, t)

    const buffer = buildXlsx(sheet)
    const fileName = `${contract.number ?? 'contract'}.xlsx`
    const created = await createAttachmentFromBuffer({
      em,
      dataEngine: de,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      entityId: ENTITY_ID,
      recordId: String(contract.id),
      fileName,
      mimeType: XLSX_CONTENT_TYPE,
      buffer,
    })

    const updated = await de.updateOrmEntity({
      entity: TradeDocsContract,
      where: contractFilter(scope, parsed.id),
      apply: (entity) => {
        entity.generatedAttachmentId = created.id
        entity.generatedAt = new Date()
      },
    })
    if (!updated) throw notFound('Contract not found')

    await eventsConfig.emit('trade_docs.contract.document.generated', {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      attachmentId: created.id,
      templateId: CONTRACT_TEMPLATE_ID,
    })

    return { attachmentId: created.id, fileName: created.fileName }
  },
  captureAfter: (_input, result) => ({ attachmentId: result.attachmentId }),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('trade_docs.audit.contracts.generateDocument', 'Generate contract document'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.attachmentId,
      snapshotAfter: { attachmentId: result.attachmentId, fileName: result.fileName },
    }
  },
}

/**
 * Binds the counterparty-signed/stamped scan to the contract.
 *
 * The upload itself happens against `/api/attachments` (the platform's multipart route); this
 * command only records the pointer and verifies the attachment exists inside the caller's scope.
 * Rebinding is idempotent — a retry after a failed upload simply replaces the previous pointer —
 * and `attachmentId: null` unbinds it. The generated XLSX keeps `generated_attachment_id`, so the
 * two pointers are independent: regenerating the document never drops the signed scan.
 */
const attachContractCommand: CommandHandler<Record<string, unknown>, TradeDocsContract> = {
  id: 'trade_docs.contracts.attach',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = contractAttachSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const contract = await loadContract(em, scope, parsed.id)
    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(contract.id),
      current: contract.updatedAt,
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
      entity: TradeDocsContract,
      where: contractFilter(scope, parsed.id),
      apply: (entity) => {
        entity.attachmentId = parsed.attachmentId
      },
    })
    if (!updated) throw notFound('Contract not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: contractCrudEvents,
      indexer: contractCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Bind contract attachment',
    resourceKind: RESOURCE_KIND,
    resourceId: String(result.id),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createContractCommand)
registerCommand(updateContractCommand)
registerCommand(deleteContractCommand)
registerCommand(transitionContractCommand)
registerCommand(generateContractDocumentCommand)
registerCommand(attachContractCommand)

export {
  createContractCommand,
  updateContractCommand,
  deleteContractCommand,
  transitionContractCommand,
  generateContractDocumentCommand,
  attachContractCommand,
}
export type { SerializedContract }
