import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { ExportFinanceCollection } from '../data/entities'
import { collectionSaveSchema } from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'

const COLLECTION_ENTITY_ID = 'export_finance:export_finance_collection' as const
const COLLECTION_RESOURCE_KIND = 'export_finance.collection' as const

/**
 * The `entity` string is what makes the emitted CRUD event id the declared
 * `export_finance.collections.updated`: the platform composes `<module>.<entity>.<action>`.
 */
export const collectionCrudEvents: CrudEventsConfig<ExportFinanceCollection> = {
  module: 'export_finance',
  entity: 'collections',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    collectionStatus: ctx.entity?.collectionStatus ?? null,
  }),
}

export const collectionCrudIndexer: CrudIndexerConfig<ExportFinanceCollection> = {
  entityType: COLLECTION_ENTITY_ID,
}

function collectionFilter(scope: Scope, id: string): FilterQuery<ExportFinanceCollection> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ExportFinanceCollection>
}

/**
 * 收汇档案 upsert, keyed by the purchase order.
 *
 * One record per `(tenant, organization, purchase_order_id)` — the unique constraint is the real
 * guarantee, this command only reuses the row it finds. The expected version of an existing
 * record is taken from the payload's `updatedAt` (falling back to the platform's optimistic-lock
 * header), so a second editor saving over someone else's newer change gets the standard 409
 * instead of silently overwriting it.
 *
 * The payload's `purchaseOrderNumber` and `currencyCode` are display snapshots sent by the
 * client: the command never reads the `purchasing` tables.
 */
const saveCollectionCommand: CommandHandler<Record<string, unknown>, ExportFinanceCollection> = {
  id: 'export_finance.collections.save',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = collectionSaveSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(ExportFinanceCollection, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      purchaseOrderId: parsed.purchaseOrderId,
      deletedAt: null,
    } as FilterQuery<ExportFinanceCollection>)

    if (existing) {
      enforceCommandOptimisticLock({
        resourceKind: COLLECTION_RESOURCE_KIND,
        resourceId: String(existing.id),
        current: existing.updatedAt,
        expected: parsed.updatedAt,
        request: ctx.request ?? null,
      })
    }

    const fields = {
      purchaseOrderNumber: parsed.purchaseOrderNumber ?? existing?.purchaseOrderNumber ?? null,
      currencyCode: parsed.currencyCode,
      collectionStatus: parsed.collectionStatus,
    }

    const record = existing
      ? await de.updateOrmEntity({
          entity: ExportFinanceCollection,
          where: collectionFilter(scope, String(existing.id)),
          apply: (entity) => {
            entity.purchaseOrderNumber = fields.purchaseOrderNumber
            entity.currencyCode = fields.currencyCode
            entity.collectionStatus = fields.collectionStatus
          },
        })
      : await de.createOrmEntity({
          entity: ExportFinanceCollection,
          data: {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            purchaseOrderId: parsed.purchaseOrderId,
            purchaseOrderNumber: fields.purchaseOrderNumber,
            currencyCode: fields.currencyCode,
            collectionStatus: fields.collectionStatus,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
    if (!record) throw notFound('Collection record not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: { id: String(record.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: collectionCrudEvents,
      indexer: collectionCrudIndexer,
    })

    return record
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Save collection record',
    resourceKind: COLLECTION_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), collectionStatus: result.collectionStatus },
  }),
}

registerCommand(saveCollectionCommand)

export { saveCollectionCommand }
