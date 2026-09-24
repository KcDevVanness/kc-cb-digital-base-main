import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { PlatformOpsChannel } from '../data/entities'
import { channelCreateSchema, channelUpdateSchema } from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'

const CHANNEL_ENTITY_ID = 'platform_ops:platform_ops_channel' as const
const CHANNEL_RESOURCE_KIND = 'platform_ops.channel' as const

export const channelCrudEvents: CrudEventsConfig<PlatformOpsChannel> = {
  module: 'platform_ops',
  entity: 'channel',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    code: ctx.entity?.code ?? null,
  }),
}

export const channelCrudIndexer: CrudIndexerConfig<PlatformOpsChannel> = {
  entityType: CHANNEL_ENTITY_ID,
}

function channelFilter(scope: Scope, id: string): FilterQuery<PlatformOpsChannel> {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<PlatformOpsChannel>
}

/**
 * `code` is unique per organization and the constraint does not exclude soft-deleted rows, so the
 * check looks at deleted channels too: the caller gets a readable 409 instead of a driver error,
 * and reusing a deleted code requires choosing another one.
 */
async function assertCodeAvailable(
  em: EntityManager,
  scope: Scope,
  code: string,
  exceptId?: string,
): Promise<void> {
  const existing = await em.fork().findOne(PlatformOpsChannel, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code,
  } as FilterQuery<PlatformOpsChannel>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict('A channel with this code already exists in this organization')
  }
}

const createChannelCommand: CommandHandler<Record<string, unknown>, PlatformOpsChannel> = {
  id: 'platform_ops.channels.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = channelCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertCodeAvailable(em, scope, parsed.code)

    const channel = await de.createOrmEntity({
      entity: PlatformOpsChannel,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: parsed.name,
        code: parsed.code,
        platform: parsed.platform,
        externalAccountId: parsed.externalAccountId ?? null,
        currencyCode: parsed.currencyCode,
        isActive: parsed.isActive ?? true,
        notes: parsed.notes ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: channel,
      identifiers: { id: String(channel.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: channelCrudEvents,
      indexer: channelCrudIndexer,
    })

    return channel
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create platform channel',
    resourceKind: CHANNEL_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), code: result.code },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing channel id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: PlatformOpsChannel,
      where: channelFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: channelCrudEvents,
      indexer: channelCrudIndexer,
    })
  },
}

const updateChannelCommand: CommandHandler<Record<string, unknown>, PlatformOpsChannel> = {
  id: 'platform_ops.channels.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = channelUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(PlatformOpsChannel, channelFilter(scope, parsed.id))
    if (!existing) throw notFound('Channel not found')
    if (parsed.code !== undefined && parsed.code !== existing.code) {
      await assertCodeAvailable(em, scope, parsed.code, String(existing.id))
    }

    const updated = await de.updateOrmEntity({
      entity: PlatformOpsChannel,
      where: channelFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.name !== undefined) entity.name = parsed.name
        if (parsed.code !== undefined) entity.code = parsed.code
        if (parsed.platform !== undefined) entity.platform = parsed.platform
        if (parsed.externalAccountId !== undefined) entity.externalAccountId = parsed.externalAccountId
        if (parsed.currencyCode !== undefined) entity.currencyCode = parsed.currencyCode
        if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
        if (parsed.notes !== undefined) entity.notes = parsed.notes
      },
    })
    if (!updated) throw notFound('Channel not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: channelCrudEvents,
      indexer: channelCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update platform channel',
    resourceKind: CHANNEL_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), code: result.code },
  }),
}

const deleteChannelCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  PlatformOpsChannel
> = {
  id: 'platform_ops.channels.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Channel id required')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const removed = await de.deleteOrmEntity({
      entity: PlatformOpsChannel,
      where: channelFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Channel not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: channelCrudEvents,
      indexer: channelCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete platform channel',
    resourceKind: CHANNEL_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createChannelCommand)
registerCommand(updateChannelCommand)
registerCommand(deleteChannelCommand)

export { createChannelCommand, updateChannelCommand, deleteChannelCommand }
