import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { FinanceExpense } from '../data/entities'
import { expenseCreateSchema, expenseUpdateSchema } from '../data/validators'
import { assertDictionaryValue, FINANCE_EXPENSE_TYPE_DICTIONARY_KEY } from '../lib/dictionaries'
import { loadChannelRef } from '../lib/peerReads'
import { ensureScope, type Scope } from '../lib/scope'

const EXPENSE_ENTITY_ID = 'finance:finance_expense' as const
const EXPENSE_RESOURCE_KIND = 'finance.expenses' as const

/**
 * The `entity` string is what makes the emitted CRUD event id the declared `finance.expense.*`:
 * the platform composes `<module>.<entity>.<action>`.
 */
export const expenseCrudEvents: CrudEventsConfig<FinanceExpense> = {
  module: 'finance',
  entity: 'expense',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    expenseType: ctx.entity?.expenseType ?? null,
    amount: ctx.entity?.amount ?? null,
    currencyCode: ctx.entity?.currencyCode ?? null,
  }),
}

export const expenseCrudIndexer: CrudIndexerConfig<FinanceExpense> = {
  entityType: EXPENSE_ENTITY_ID,
}

function expenseFilter(scope: Scope, id: string): FilterQuery<FinanceExpense> {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<FinanceExpense>
}

/**
 * A channel reference must resolve inside the caller's organization: an expense booked against a
 * marketplace of another organization is a 404, not a silently accepted dangling id.
 */
async function assertChannelUsable(
  em: EntityManager,
  scope: Scope,
  channelId: string | null | undefined,
): Promise<{ name: string | null } | null> {
  if (!channelId) return null
  const channel = await loadChannelRef(em, { tenantId: scope.tenantId, organizationIds: [scope.organizationId] }, channelId)
  if (!channel) throw notFound('Channel not found in this organization')
  return { name: channel.name }
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

const createExpenseCommand: CommandHandler<Record<string, unknown>, FinanceExpense> = {
  id: 'finance.expenses.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = expenseCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertDictionaryValue(em, scope, FINANCE_EXPENSE_TYPE_DICTIONARY_KEY, parsed.expenseType)
    await assertChannelUsable(em, scope, parsed.channelId)

    const expense = await de.createOrmEntity({
      entity: FinanceExpense,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        expenseType: parsed.expenseType,
        periodStart: toDate(parsed.periodStart),
        periodEnd: toDate(parsed.periodEnd),
        amount: parsed.amount,
        currencyCode: parsed.currencyCode,
        exchangeRate: parsed.exchangeRate ?? null,
        channelId: parsed.channelId ?? null,
        channelSnapshot: parsed.channelSnapshot ?? null,
        partyId: parsed.partyId ?? null,
        partySnapshot: parsed.partySnapshot ?? null,
        attachmentId: parsed.attachmentId ?? null,
        note: parsed.note ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: expense,
      identifiers: { id: String(expense.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: expenseCrudEvents,
      indexer: expenseCrudIndexer,
    })

    return expense
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Record period expense',
    resourceKind: EXPENSE_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), expenseType: result.expenseType, amount: String(result.amount) },
  }),
}

const updateExpenseCommand: CommandHandler<Record<string, unknown>, FinanceExpense> = {
  id: 'finance.expenses.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = expenseUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(FinanceExpense, expenseFilter(scope, parsed.id))
    if (!existing) throw notFound('Expense not found')

    enforceCommandOptimisticLock({
      resourceKind: EXPENSE_RESOURCE_KIND,
      resourceId: String(existing.id),
      current: existing.updatedAt,
      expected: parsed.updatedAt,
      request: ctx.request ?? null,
    })

    await assertDictionaryValue(em, scope, FINANCE_EXPENSE_TYPE_DICTIONARY_KEY, parsed.expenseType)
    await assertChannelUsable(em, scope, parsed.channelId)

    const updated = await de.updateOrmEntity({
      entity: FinanceExpense,
      where: expenseFilter(scope, parsed.id),
      apply: (entity) => {
        entity.expenseType = parsed.expenseType
        entity.periodStart = toDate(parsed.periodStart)
        entity.periodEnd = toDate(parsed.periodEnd)
        entity.amount = parsed.amount
        entity.currencyCode = parsed.currencyCode
        entity.exchangeRate = parsed.exchangeRate ?? null
        entity.channelId = parsed.channelId ?? null
        entity.channelSnapshot = parsed.channelSnapshot ?? null
        entity.partyId = parsed.partyId ?? null
        entity.partySnapshot = parsed.partySnapshot ?? null
        entity.attachmentId = parsed.attachmentId ?? null
        entity.note = parsed.note ?? null
      },
    })
    if (!updated) throw notFound('Expense not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: expenseCrudEvents,
      indexer: expenseCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update period expense',
    resourceKind: EXPENSE_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), expenseType: result.expenseType, amount: String(result.amount) },
  }),
}

const deleteExpenseCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  FinanceExpense
> = {
  id: 'finance.expenses.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Expense id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(FinanceExpense, expenseFilter(scope, id))
    if (!existing) throw notFound('Expense not found')

    const body = (input.body ?? {}) as { updatedAt?: unknown }
    enforceCommandOptimisticLock({
      resourceKind: EXPENSE_RESOURCE_KIND,
      resourceId: String(existing.id),
      current: existing.updatedAt,
      expected: typeof body.updatedAt === 'string' ? body.updatedAt : undefined,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: FinanceExpense,
      where: expenseFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Expense not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: expenseCrudEvents,
      indexer: expenseCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete period expense',
    resourceKind: EXPENSE_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createExpenseCommand)
registerCommand(updateExpenseCommand)
registerCommand(deleteExpenseCommand)

export { createExpenseCommand, updateExpenseCommand, deleteExpenseCommand }
