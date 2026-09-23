import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { STORED_AMOUNT_SCALE, toAmountString } from '../../trade_docs/lib/money'
import { ExportFinanceRefund } from '../data/entities'
import { refundSaveSchema } from '../data/validators'
import { loadShipmentRef } from '../lib/peerReads'
import { ensureScope, type Scope } from '../lib/scope'

const REFUND_ENTITY_ID = 'export_finance:export_finance_refund' as const
const REFUND_RESOURCE_KIND = 'export_finance.refund' as const

/**
 * The `entity` string is what makes the emitted CRUD event id the declared
 * `export_finance.refunds.updated`: the platform composes `<module>.<entity>.<action>`.
 */
export const refundCrudEvents: CrudEventsConfig<ExportFinanceRefund> = {
  module: 'export_finance',
  entity: 'refunds',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    taxRefundStatus: ctx.entity?.taxRefundStatus ?? null,
  }),
}

export const refundCrudIndexer: CrudIndexerConfig<ExportFinanceRefund> = {
  entityType: REFUND_ENTITY_ID,
}

function refundFilter(scope: Scope, id: string): FilterQuery<ExportFinanceRefund> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ExportFinanceRefund>
}

/** The entered two-decimal amount widened to the `numeric(18,4)` column, via the money engine. */
function toStoredAmount(value: string | null): string | null {
  if (value === null) return null
  const parsed = parseExactDecimal(value)
  if (!parsed) return null
  return toAmountString(parsed, STORED_AMOUNT_SCALE)
}

/**
 * 出口退税档案 upsert, keyed by the container (shipment).
 *
 * One record per `(tenant, organization, shipment_id)` — the unique constraint is the real
 * guarantee. Before writing, the shipment is read scoped: a refund record must not exist for a
 * container the caller cannot see, nor for a cancelled one (the declaration is withdrawn), so
 * both cases answer 409 instead of creating an orphan figure.
 *
 * The per-order figures are **not** written here: they are derived at read time from this
 * amount, so a container whose order mix changes keeps one authoritative total.
 */
const saveRefundCommand: CommandHandler<Record<string, unknown>, ExportFinanceRefund> = {
  id: 'export_finance.refunds.save',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = refundSaveSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const shipment = await loadShipmentRef(em, scope, parsed.shipmentId)
    if (!shipment || shipment.status === 'cancelled') {
      throw conflict(`Shipment ${parsed.shipmentId} is not available for a tax refund record`)
    }

    const existing = await em.fork().findOne(ExportFinanceRefund, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      shipmentId: parsed.shipmentId,
      deletedAt: null,
    } as FilterQuery<ExportFinanceRefund>)

    if (existing) {
      enforceCommandOptimisticLock({
        resourceKind: REFUND_RESOURCE_KIND,
        resourceId: String(existing.id),
        current: existing.updatedAt,
        expected: parsed.updatedAt,
        request: ctx.request ?? null,
      })
    }

    const fields = {
      shipmentNumber: parsed.shipmentNumber ?? shipment.number ?? existing?.shipmentNumber ?? null,
      currencyCode: parsed.currencyCode,
      taxRefundStatus: parsed.taxRefundStatus,
      taxRefundAmount: toStoredAmount(parsed.taxRefundAmount),
      taxRefundNote: parsed.taxRefundNote ?? null,
    }

    const record = existing
      ? await de.updateOrmEntity({
          entity: ExportFinanceRefund,
          where: refundFilter(scope, String(existing.id)),
          apply: (entity) => {
            entity.shipmentNumber = fields.shipmentNumber
            entity.currencyCode = fields.currencyCode
            entity.taxRefundStatus = fields.taxRefundStatus
            entity.taxRefundAmount = fields.taxRefundAmount
            entity.taxRefundNote = fields.taxRefundNote
          },
        })
      : await de.createOrmEntity({
          entity: ExportFinanceRefund,
          data: {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            shipmentId: parsed.shipmentId,
            shipmentNumber: fields.shipmentNumber,
            currencyCode: fields.currencyCode,
            taxRefundStatus: fields.taxRefundStatus,
            taxRefundAmount: fields.taxRefundAmount,
            taxRefundNote: fields.taxRefundNote,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
    if (!record) throw notFound('Tax refund record not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: { id: String(record.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: refundCrudEvents,
      indexer: refundCrudIndexer,
    })

    return record
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Save tax refund record',
    resourceKind: REFUND_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), taxRefundStatus: result.taxRefundStatus },
  }),
}

registerCommand(saveRefundCommand)

export { saveRefundCommand }
