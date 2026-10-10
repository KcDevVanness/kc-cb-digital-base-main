import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { RuSyncSkuMap } from '../data/entities'
import { skuMapUpdateSchema } from '../data/validators'
import { matchKey } from '../lib/skuNormalize'
import { ensureScope, type Scope } from '../lib/scope'

const SKU_MAP_ENTITY_ID = 'ru_sync:ru_sync_sku_map' as const
const SKU_MAP_RESOURCE_KIND = 'ru_sync.sku-map' as const

export const skuMapCrudEvents: CrudEventsConfig<RuSyncSkuMap> = {
  module: 'ru_sync',
  entity: 'sku_map',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    status: ctx.entity?.status ?? null,
  }),
}

function skuMapFilter(scope: Scope, ruSku: string): FilterQuery<RuSyncSkuMap> {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ruSku,
  } as FilterQuery<RuSyncSkuMap>
}

/**
 * The product a binding points at must exist in the caller's organization. The check reads
 * the installed catalog (`catalog_products`) through raw SQL (no cross-module entity import) and answers 404 for anything
 * else, so a typo cannot create a binding to a product nobody can see.
 */
async function assertProductInScope(em: EntityManager, scope: Scope, productId: string): Promise<void> {
  const rows = (await em.fork().getConnection().execute<Array<{ id: string }>>(
    `select id from catalog_products
      where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null`,
    [productId, scope.tenantId, scope.organizationId],
  )) as Array<{ id: string }>
  if (rows.length === 0) throw notFound('Product not found in this organization')
}

/**
 * Binding or ignoring one RU code.
 *
 * A `mapped` row must name a product of this organization; an `ignored` row must not (an ignored
 * code that still points at a product is a contradiction the list would have to explain away). The
 * row is created when the code is decided for the first time — the pull only ever *suggests*, a
 * human decision is what this command records.
 */
const updateSkuMapCommand: CommandHandler<Record<string, unknown>, RuSyncSkuMap> = {
  id: 'ru_sync.sku-map.update',
  isUndoable: false,
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const parsed = skuMapUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    if (parsed.status === 'mapped') {
      const productId = parsed.productId
      if (!productId) throw badRequest('productId is required when binding a code')
      await assertProductInScope(em, scope, productId)
    }

    const existing = await em.fork().findOne(RuSyncSkuMap, skuMapFilter(scope, parsed.ruSku))
    const record = existing
      ? await de.updateOrmEntity({
          entity: RuSyncSkuMap,
          where: skuMapFilter(scope, parsed.ruSku),
          apply: (entity) => {
            entity.status = parsed.status
            entity.productId = parsed.status === 'mapped' ? parsed.productId ?? null : null
            entity.note = parsed.note ?? null
          },
        })
      : await de.createOrmEntity({
          entity: RuSyncSkuMap,
          data: {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            ruSku: parsed.ruSku,
            productId: parsed.status === 'mapped' ? parsed.productId ?? null : null,
            status: parsed.status,
            note: parsed.note ?? null,
          },
        })
    if (!record) throw notFound('SKU map row not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: { id: String(record.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: skuMapCrudEvents,
    })

    return record
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Decide a RU SKU mapping',
    resourceKind: SKU_MAP_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { ruSku: result.ruSku, status: result.status, matchKey: matchKey(result.ruSku) },
  }),
}

registerCommand(updateSkuMapCommand)

export { updateSkuMapCommand, SKU_MAP_ENTITY_ID }
