import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ProductCodeRule } from '../data/entities'
import {
  productCodeRuleCreateSchema,
  productCodeRuleUpdateSchema,
  type ProductCodeRuleCreateInput,
  type ProductCodeRuleUpdateInput,
} from '../data/validators'
import { loadCodeDictionaries } from '../lib/dictionaryValues'
import { readSegments, validateRuleShape, type CodeRuleShape } from '../lib/ruleModel'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'

/**
 * The rule commands.
 *
 * A rule is configuration that *produces identity*: every code issued under it is permanent, so the
 * write path validates the rule's worst case before it is stored (a rule that can emit an illegal or
 * over-long code is refused here, not at generation time, when numbers are already in flight).
 */

const RULE_ENTITY_ID = 'product_codes:product_code_rule' as const
const RESOURCE_KIND = 'product_codes.rule' as const

export type Scope = { tenantId: string; organizationId: string }

export function ensureScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw badRequest('Tenant context is required')
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}

export function ruleFilter(scope: Scope, id: string): FilterQuery<ProductCodeRule> {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<ProductCodeRule>
}

export async function loadRule(em: EntityManager, scope: Scope, id: string): Promise<ProductCodeRule> {
  const rule = await em.fork().findOne(ProductCodeRule, ruleFilter(scope, id))
  if (!rule) throw notFound('Code rule not found')
  return rule
}

export type SerializedRule = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  mode: string
  segments: Record<string, unknown>[]
  separator: string
  serialLength: number
  serialScope: string
  enforce: string
  isActive: boolean
}

export function serializeRule(rule: ProductCodeRule): SerializedRule {
  return {
    id: String(rule.id),
    tenantId: rule.tenantId,
    organizationId: rule.organizationId,
    name: rule.name,
    mode: rule.mode,
    segments: rule.segments,
    separator: rule.separator,
    serialLength: rule.serialLength,
    serialScope: rule.serialScope,
    enforce: rule.enforce,
    isActive: rule.isActive === true,
  }
}

export const ruleCrudEvents: CrudEventsConfig<ProductCodeRule> = {
  module: 'product_codes',
  entity: 'product_code_rule',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<ProductCodeRule>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    name: ctx.entity?.name ?? null,
    mode: ctx.entity?.mode ?? null,
    isActive: ctx.entity?.isActive ?? null,
  }),
}

export const ruleCrudIndexer: CrudIndexerConfig<ProductCodeRule> = { entityType: RULE_ENTITY_ID }

/**
 * Refuses a rule whose segments cannot be read, or whose worst case breaks the product SKU contract.
 *
 * The dictionary values are read from the organization's own code lists: a rule is only as safe as
 * the values it will actually be asked to format.
 */
async function assertRuleIsBuildable(
  em: EntityManager,
  scope: Scope,
  input: { segments: ProductCodeRuleCreateInput['segments']; separator: string; serialLength: number },
): Promise<void> {
  const segments = readSegments(input.segments)
  if (!segments) throw badRequest('A rule needs at least one readable segment')
  const shape: CodeRuleShape = { segments, separator: input.separator, serialLength: input.serialLength }
  const { values } = await loadCodeDictionaries(em, scope)
  const problem = validateRuleShape(shape, values)
  if (problem) {
    throw new CrudHttpError(422, {
      error: `The rule cannot produce a valid product code: ${problem}`,
      code: problem,
    })
  }
}

async function assertNameAvailable(
  em: EntityManager,
  scope: Scope,
  name: string,
  exceptId?: string,
): Promise<void> {
  // Soft-deleted rows keep their name: a rule's name is what the ledger rows and the audit trail
  // refer to, so reusing it would make two different rules look like one.
  const existing = await em.fork().findOne(ProductCodeRule, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name,
  } as FilterQuery<ProductCodeRule>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict(`A code rule named ${name} already exists in this organization`)
  }
}

const createRuleCommand = registerCommand({
  id: 'product_codes.rules.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productCodeRuleCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertNameAvailable(em, scope, parsed.name)
    await assertRuleIsBuildable(em, scope, parsed)

    const created = await de.createOrmEntity({
      entity: ProductCodeRule,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: parsed.name,
        mode: parsed.mode,
        segments: parsed.segments as Record<string, unknown>[],
        separator: parsed.separator,
        serialLength: parsed.serialLength,
        serialScope: parsed.serialScope,
        enforce: parsed.enforce,
        isActive: parsed.isActive,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
    })
    return created
  },
})

const updateRuleCommand = registerCommand({
  id: 'product_codes.rules.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = productCodeRuleUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(ProductCodeRule, ruleFilter(scope, parsed.id))
    return current ? { before: serializeRule(current) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed: ProductCodeRuleUpdateInput = productCodeRuleUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const current = await loadRule(em, scope, parsed.id)

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    const next = {
      segments: parsed.segments ?? (current.segments as ProductCodeRuleCreateInput['segments']),
      separator: parsed.separator ?? current.separator,
      serialLength: parsed.serialLength ?? current.serialLength,
    }
    if (parsed.name !== undefined) await assertNameAvailable(em, scope, parsed.name, String(current.id))
    await assertRuleIsBuildable(em, scope, next)

    const updated = await de.updateOrmEntity<ProductCodeRule>({
      entity: ProductCodeRule,
      where: ruleFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.name !== undefined) entity.name = parsed.name
        if (parsed.mode !== undefined) entity.mode = parsed.mode
        if (parsed.segments !== undefined) entity.segments = parsed.segments as Record<string, unknown>[]
        if (parsed.separator !== undefined) entity.separator = parsed.separator
        if (parsed.serialLength !== undefined) entity.serialLength = parsed.serialLength
        if (parsed.serialScope !== undefined) entity.serialScope = parsed.serialScope
        if (parsed.enforce !== undefined) entity.enforce = parsed.enforce
        if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
      },
    })
    if (!updated) throw notFound('Code rule not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
    })
    return updated
  },
  captureAfter: (_input, result) => serializeRule(result as ProductCodeRule),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedRule | undefined
    const after = serializeRule(result as ProductCodeRule)
    return {
      actionLabel: translate('product_codes.audit.rule.update', 'Update code rule'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['name', 'mode', 'segments', 'separator', 'serialLength', 'serialScope', 'enforce', 'isActive'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedRule }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedRule | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous code-rule snapshot for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity<ProductCodeRule>({
      entity: ProductCodeRule,
      where: ruleFilter(scope, before.id),
      apply: (entity) => {
        entity.name = before.name
        entity.mode = before.mode
        entity.segments = before.segments
        entity.separator = before.separator
        entity.serialLength = before.serialLength
        entity.serialScope = before.serialScope
        entity.enforce = before.enforce
        entity.isActive = before.isActive
      },
    })
    if (!restored) throw notFound('Code rule not found')
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: restored,
      identifiers: { id: String(restored.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
    })
  },
})

const deleteRuleCommand = registerCommand({
  id: 'product_codes.rules.delete',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = productCodeRuleUpdateSchema.pick({ id: true }).parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(ProductCodeRule, ruleFilter(scope, parsed.id))
    return current ? { before: serializeRule(current) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = productCodeRuleUpdateSchema.pick({ id: true }).parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const rule = await loadRule(em, scope, parsed.id)

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(rule.id),
      current: rule.updatedAt,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({ entity: ProductCodeRule, where: ruleFilter(scope, parsed.id) })
    if (!removed) throw notFound('Code rule not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: rule,
      identifiers: { id: String(rule.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
    })
    return { id: String(rule.id) }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedRule }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedRule | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous code-rule snapshot for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const em = ctx.container.resolve('em') as EntityManager
    // A soft delete is undone by clearing the timestamp on the same row: the ledger's rule_id
    // references survive, which a re-insert with a new id would break.
    await withAtomicFlush(
      em,
      [
        async () => {
          await em
            .fork()
            .nativeUpdate(
              ProductCodeRule,
              { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<ProductCodeRule>,
              { deletedAt: null },
            )
        },
      ],
      { transaction: true, label: 'product_codes.rules.delete.undo' },
    )
    const restored = await em.fork().findOne(ProductCodeRule, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<ProductCodeRule>)
    if (!restored) throw notFound('Code rule not found')
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restored,
      identifiers: { id: String(restored.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
    })
  },
})

export const ruleCommands = [createRuleCommand, updateRuleCommand, deleteRuleCommand]
