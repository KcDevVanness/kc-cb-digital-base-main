import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { COLLECTION_OVERDUE_DAYS, REFUND_OVERDUE_DAYS } from './fileRules'
import { loadContainerFiles } from './containerFileProjection'
import { loadOrderFiles } from './orderFileProjection'
import { notificationTypes } from '../notifications'
import { eventsConfig, type ExportFinanceEventId } from '../events'

/**
 * 逾期提醒 — the two overdue conditions of the money ledgers, turned into notifications.
 *
 * The conditions are **not re-derived here**: both lists are read with `filters.overdue: true`, the
 * same flag the 逾期清单, the 档案 columns and the CSV read, so a reminder can only ever be raised
 * for a row those surfaces already call late (threshold in `fileRules.ts`, boundary exclusive).
 *
 * Evaluation is a command an operator (or their cron) runs — `yarn mercato export-finance
 * overdue-reminders` — following the deployment's existing reminder convention (PRD Q6), because a
 * reminder nobody can explain is worse than no reminder. The `groupKey` carries the resource and the
 * day it became late, so re-running refreshes one notification per condition instead of stacking a
 * copy every time.
 */

const logger = createLogger('export_finance').child({ component: 'overdue-reminders' })

/** How many rows one evaluation reads per list. A cron run covers the oldest first; see the note below. */
export const OVERDUE_SCAN_LIMIT = 500

export type OverdueReminderKind = 'collection_overdue' | 'refund_overdue'

/**
 * One reminder as **facts**, never as a sentence: the wording lives in the notification type's
 * dictionary keys (`export_finance.notifications.*`), so the same reminder reads correctly in every
 * language instead of carrying a hard-coded phrase.
 */
export type OverdueReminder = {
  kind: OverdueReminderKind
  /** Stable identity of the condition: resource + the day it became late. */
  groupKey: string
  /** The document the reminder is about (its number, or its id when the number is blank). */
  subject: string
  /** Whole days since the goods arrived — the number the reader actually reacts to. */
  days: number
  /** The money's own status word, passed through (the dictionary renders it). */
  status: string
  /** The document the reminder is about (a purchase order or a shipment). */
  sourceEntityId: string
}

type OrderFact = {
  purchaseOrderId: string
  number: string | null
  businessNumber: string | null
  receivedAt: string | null
  collectionStatus: string
  collectionOverdue: boolean
}

type ContainerFact = {
  shipmentId: string
  shipmentNumber: string | null
  receivedAt: string | null
  taxRefundStatus: string
  refundOverdue: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whole days a timestamp is in the past; `null` when it is missing or unparsable (never a guess).
 *
 * A reminder only exists for a row the rule already called late, and that rule needs a readable
 * arrival date, so the `null` branch never fires in practice — it stays because returning a
 * fabricated `0` for an unreadable date is the one thing a reminder must not do.
 */
function daysWaited(receivedAt: string | null, now: number): number | null {
  if (!receivedAt) return null
  const value = Date.parse(receivedAt)
  if (!Number.isFinite(value)) return null
  const days = Math.floor((now - value) / DAY_MS)
  return days >= 0 ? days : null
}

/**
 * The day a row *became* late — `receivedAt` plus the rule's own threshold — as `YYYY-MM-DD`.
 *
 * This is the idempotency key's date part. It is derived rather than "today" so a cron that runs at
 * 00:05 and one that runs at 23:55 on the same late row produce the same key, and a later day does
 * not produce a second notification for a condition that was already told.
 */
export function becameLateOn(receivedAt: string | null, thresholdDays: number): string | null {
  if (!receivedAt) return null
  const value = Date.parse(receivedAt)
  if (!Number.isFinite(value)) return null
  return new Date(value + thresholdDays * DAY_MS).toISOString().slice(0, 10)
}

/** Builds the reminder set from the two already-filtered lists. Pure, so the keys are unit-testable. */
export function buildOverdueReminders(
  input: { orders: OrderFact[]; containers: ContainerFact[] },
  now: number,
): OverdueReminder[] {
  const reminders: OverdueReminder[] = []

  for (const order of input.orders) {
    if (!order.collectionOverdue) continue
    const days = daysWaited(order.receivedAt, now)
    const lateOn = becameLateOn(order.receivedAt, COLLECTION_OVERDUE_DAYS)
    if (days === null || !lateOn) continue
    reminders.push({
      kind: 'collection_overdue',
      groupKey: `collection_overdue:${order.purchaseOrderId}:${lateOn}`,
      subject: order.businessNumber ?? order.number ?? order.purchaseOrderId,
      days,
      status: order.collectionStatus,
      sourceEntityId: order.purchaseOrderId,
    })
  }

  for (const container of input.containers) {
    if (!container.refundOverdue) continue
    const days = daysWaited(container.receivedAt, now)
    const lateOn = becameLateOn(container.receivedAt, REFUND_OVERDUE_DAYS)
    if (days === null || !lateOn) continue
    reminders.push({
      kind: 'refund_overdue',
      groupKey: `refund_overdue:${container.shipmentId}:${lateOn}`,
      subject: container.shipmentNumber ?? container.shipmentId,
      days,
      status: container.taxRefundStatus,
      sourceEntityId: container.shipmentId,
    })
  }

  return reminders
}

export type OverdueReminderScope = { tenantId: string; organizationId: string }

/**
 * Reads the two overdue lists and returns the reminders they imply. Read-only: nothing is written
 * until `emitOverdueReminders` runs, so a dry-run print is this function's caller printing its
 * result.
 */
export async function evaluateOverdueReminders(
  em: EntityManager,
  scope: OverdueReminderScope,
  options: { today?: Date } = {},
): Promise<OverdueReminder[]> {
  const now = (options.today ?? new Date()).getTime()
  const [orders, containers] = await Promise.all([
    loadOrderFiles(em, {
      tenantId: scope.tenantId,
      organizationIds: [scope.organizationId],
      filters: { overdue: true },
      page: 1,
      pageSize: OVERDUE_SCAN_LIMIT,
      sortField: 'placed_at',
      sortDir: 'desc',
    }),
    loadContainerFiles(em, {
      tenantId: scope.tenantId,
      organizationIds: [scope.organizationId],
      filters: { overdue: true },
      page: 1,
      pageSize: OVERDUE_SCAN_LIMIT,
      sortField: 'departed_at',
      sortDir: 'desc',
    }),
  ])

  // The scan is capped, and a capped scan must say so: a silent cut would look like "nothing left".
  if (orders.total > orders.items.length || containers.total > containers.items.length) {
    logger.warn('Overdue reminder scan hit its per-list cap; the rest waits for the next run', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      orderTotal: orders.total,
      containerTotal: containers.total,
      cap: OVERDUE_SCAN_LIMIT,
    })
  }

  return buildOverdueReminders(
    {
      orders: orders.items.map((order) => ({
        purchaseOrderId: order.purchaseOrderId,
        number: order.number,
        businessNumber: order.businessNumber,
        receivedAt: order.receivedAt,
        collectionStatus: order.collectionStatus,
        collectionOverdue: order.collectionOverdue,
      })),
      containers: containers.items.map((container) => ({
        shipmentId: container.shipmentId,
        shipmentNumber: container.shipmentNumber,
        receivedAt: container.receivedAt,
        taxRefundStatus: container.taxRefundStatus,
        refundOverdue: container.refundOverdue,
      })),
    },
    now,
  )
}

export type OverdueReminderResolver = { resolve: <T = unknown>(name: string) => T }

const LINK_HREF = '/backend/export-finance/overdue'

function notificationTypeFor(kind: OverdueReminderKind): string {
  return kind === 'collection_overdue'
    ? 'export_finance.reminder.collection_overdue'
    : 'export_finance.reminder.refund_overdue'
}

/**
 * Raises one notification per reminder (and emits the matching event).
 *
 * The notification layer is the platform's: `createForFeature` resolves the recipients from the
 * view feature, and the type's own definition decides the wording and the channel, so this function
 * only names the condition, the resource and the link.
 */
export async function emitOverdueReminders(
  em: EntityManager,
  scope: OverdueReminderScope,
  options: { today?: Date; resolver?: OverdueReminderResolver } = {},
): Promise<OverdueReminder[]> {
  const reminders = await evaluateOverdueReminders(em, scope, options)

  for (const reminder of reminders) {
    const type = notificationTypeFor(reminder.kind)
    const requiredFeature = reminder.kind === 'collection_overdue'
      ? 'export_finance.orders.view'
      : 'export_finance.cabinets.view'

    await eventsConfig
      .emit(type as ExportFinanceEventId, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        kind: reminder.kind,
        groupKey: reminder.groupKey,
        title: reminder.subject,
        sourceEntityId: reminder.sourceEntityId,
      })
      .catch((error) => {
        logger.warn('Failed to emit an overdue reminder event', { kind: reminder.kind, err: error })
      })

    if (!options.resolver) continue
    try {
      const typeDef = notificationTypes.find((candidate) => candidate.type === type)
      if (!typeDef) continue
      const notificationService = resolveNotificationService(options.resolver)
      const input = buildFeatureNotificationFromType(typeDef, {
        requiredFeature,
        titleVariables: { title: reminder.subject },
        bodyVariables: { days: String(reminder.days), status: reminder.status },
        sourceEntityType: 'export_finance:reminder',
        groupKey: reminder.groupKey,
        linkHref: LINK_HREF,
      })
      await notificationService.createForFeature(input, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    } catch (error) {
      logger.error('Failed to raise an overdue reminder', { type, err: error })
    }
  }

  logger.info('Overdue reminders evaluated', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    count: reminders.length,
  })
  return reminders
}
