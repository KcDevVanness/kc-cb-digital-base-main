import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { derivePaymentState } from '../../purchasing/lib/orderTotals'
import { eventsConfig } from '../events'
import { createReminderNotification, type ResolverContext } from '../subscribers/reminderNotification'

/**
 * 到期提醒 (FLOW-G2) — the three due-date rules, evaluated from the existing ledgers.
 *
 * The rules are written against the **derived** figures the rest of the app already trusts: the
 * payment state comes from `purchasing`'s own `derivePaymentState`, and "shipped" means an
 * allocation exists. Nothing here re-implements a status.
 *
 * Evaluation is a command an operator runs (`yarn mercato finance due-reminders …`), not a hidden
 * timer: this app has no scheduler module enabled, and a reminder that fires from an invisible timer
 * is a reminder nobody can explain. The same function is what a cron entry would call.
 */

const logger = createLogger('finance').child({ component: 'due-reminders' })

const AMOUNT_SCALE = 2

export type DueReminderKind = 'payment_overdue' | 'shipment_overdue' | 'stock_low'

export type DueReminder = {
  kind: DueReminderKind
  /** Stable identity of the condition; the notification layer refreshes instead of duplicating. */
  groupKey: string
  title: string
  body: string
  sourceEntityId: string
}

type OrderRow = {
  id: string
  number: string | null
  business_number: string | null
  status: string
  currency_code: string
  total: string
  expected_ship_at: Date | string | null
  placed_at: Date | string | null
}

type PaymentRow = { order_id: string; stage: string; amount: string }

type AllocationRow = { purchase_order_id: string }

type StockRow = { quantity: string; min_quantity: number | null; sku: string | null; product_id: string | null }

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

export async function evaluateDueReminders(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  options: { today?: string } = {},
): Promise<DueReminder[]> {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const db = em.fork().getConnection()
  const reminders: DueReminder[] = []

  const orders = (await db.execute<OrderRow[]>(
    `select id, number, business_number, status, currency_code, total, expected_ship_at, placed_at
       from purchasing_purchase_orders
      where tenant_id = ? and organization_id = ? and deleted_at is null
        and status not in ('draft', 'cancelled')
        and expected_ship_at is not null
        and expected_ship_at < ?`,
    [scope.tenantId, scope.organizationId, today],
  )) as OrderRow[]

  if (orders.length > 0) {
    const orderIds = orders.map((order) => String(order.id))
    const placeholders = orderIds.map(() => '?').join(', ')
    const [payments, allocations] = await Promise.all([
      db.execute<PaymentRow[]>(
        `select order_id, stage, amount from purchasing_purchase_payments
          where tenant_id = ? and organization_id = ? and order_id in (${placeholders})`,
        [scope.tenantId, scope.organizationId, ...orderIds],
      ) as Promise<PaymentRow[]>,
      db.execute<AllocationRow[]>(
        `select distinct purchase_order_id from cross_border_shipment_allocations
          where tenant_id = ? and organization_id = ? and purchase_order_id in (${placeholders})`,
        [scope.tenantId, scope.organizationId, ...orderIds],
      ) as Promise<AllocationRow[]>,
    ])

    const paymentsByOrder = new Map<string, PaymentRow[]>()
    for (const payment of payments) {
      const key = String(payment.order_id)
      const list = paymentsByOrder.get(key) ?? []
      list.push(payment)
      paymentsByOrder.set(key, list)
    }
    const shippedOrders = new Set(allocations.map((row) => String(row.purchase_order_id)))

    for (const order of orders) {
      const orderId = String(order.id)
      const expected = toIsoDate(order.expected_ship_at)
      const label = order.number ?? order.business_number ?? orderId.slice(0, 8)

      // 逾期未付款: an outstanding balance on an order whose ship date has passed.
      const state = derivePaymentState(String(order.total ?? '0'), paymentsByOrder.get(orderId) ?? [])
      const outstandingUnits = toScaledUnits(state.outstanding, AMOUNT_SCALE)
      if (outstandingUnits > 0n) {
        reminders.push({
          kind: 'payment_overdue',
          groupKey: `payment:${orderId}`,
          title: `逾期未付款 ${label}`,
          body: `应发日 ${expected ?? '—'} 已过，未付 ${toAmountString({ units: outstandingUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE)} ${order.currency_code}（${state.paymentStatus}）`,
          sourceEntityId: orderId,
        })
      }

      // 逾期未发运: still `placed` past its ship date with nothing allocated to a container.
      if (order.status === 'placed' && !shippedOrders.has(orderId)) {
        reminders.push({
          kind: 'shipment_overdue',
          groupKey: `shipment:${orderId}`,
          title: `逾期未发运 ${label}`,
          body: `应发日 ${expected ?? '—'} 已过，采购单仍未分配柜位（状态 ${order.status}）`,
          sourceEntityId: orderId,
        })
      }
    }
  }

  // 库存低于阈值: the threshold is the product's own purchase-tier minimum (its MOQ), because that is
  // the number the business already uses to decide "this is too little to order again".
  const stockRows = (await db.execute<StockRow[]>(
    `select coalesce(sum(b.quantity_on_hand), 0)::text as quantity,
            min(pp.min_quantity) as min_quantity,
            p.sku as sku,
            p.id as product_id
       from wms_inventory_balances b
       join catalog_product_variants v on v.id = b.catalog_variant_id
       join catalog_products p on p.id = v.product_id and p.deleted_at is null
       left join catalog_product_variant_prices pp
              on pp.product_id = p.id
             and pp.price_kind_id = (select k.id
                                       from catalog_price_kinds k
                                      where k.code = 'purchase'
                                        and k.tenant_id = ?
                                        and k.deleted_at is null
                                      limit 1)
             and (pp.ends_at is null or pp.ends_at > now())
      where b.tenant_id = ? and b.organization_id = ? and b.deleted_at is null
        and p.tenant_id = ? and p.organization_id = ?
      group by p.sku, p.id`,
    [scope.tenantId, scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId],
  )) as StockRow[]

  for (const row of stockRows) {
    if (row.min_quantity === null) continue
    const quantityUnits = toScaledUnits(row.quantity, AMOUNT_SCALE)
    const thresholdUnits = BigInt(row.min_quantity) * 10n ** BigInt(AMOUNT_SCALE)
    if (quantityUnits >= thresholdUnits) continue
    const sku = row.sku ?? String(row.product_id ?? '').slice(0, 8)
    reminders.push({
      kind: 'stock_low',
      groupKey: `stock:${row.product_id ?? sku}`,
      title: `库存低于阈值 ${sku}`,
      body: `在手 ${toAmountString({ units: quantityUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE)} 低于采购档起订量 ${row.min_quantity}`,
      sourceEntityId: String(row.product_id ?? sku),
    })
  }

  return reminders
}

/**
 * Emits one typed event per reminder **and** raises the notification for it.
 *
 * The command runs in a process of its own, where the module's subscribers are not mounted, so the
 * event alone would reach nobody: the same call that the subscriber makes is therefore made here
 * through the notification service. Both paths key the notification by the reminder's `groupKey`, so
 * a running app (whose subscriber also fires) refreshes one notification instead of stacking two.
 */
export async function emitDueReminders(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  options: { today?: string; resolver?: ResolverContext } = {},
): Promise<DueReminder[]> {
  const reminders = await evaluateDueReminders(em, scope, options)
  for (const reminder of reminders) {
    await eventsConfig
      .emit(eventIdFor(reminder.kind), {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        kind: reminder.kind,
        groupKey: reminder.groupKey,
        title: reminder.title,
        body: reminder.body,
        sourceEntityId: reminder.sourceEntityId,
      })
      .catch((error) => {
        logger.warn('Failed to emit a due reminder event', { kind: reminder.kind, err: error })
      })
    if (!options.resolver) continue
    await createReminderNotification(
      notificationTypeFor(reminder.kind),
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        groupKey: reminder.groupKey,
        title: reminder.title,
        body: reminder.body,
        sourceEntityId: reminder.sourceEntityId,
      },
      options.resolver,
      REMINDER_LINK,
    )
  }
  logger.info('Due reminders evaluated', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    count: reminders.length,
  })
  return reminders
}

/** Where a reminder points: the payable ledger shows the order, the shipment and the stock behind it. */
export const REMINDER_LINK = '/backend/finance/payables'

function notificationTypeFor(kind: DueReminderKind) {
  switch (kind) {
    case 'payment_overdue':
      return 'finance.reminder.payment_overdue'
    case 'shipment_overdue':
      return 'finance.reminder.shipment_overdue'
    case 'stock_low':
      return 'finance.reminder.stock_low'
  }
}

function eventIdFor(kind: DueReminderKind) {
  switch (kind) {
    case 'payment_overdue':
      return 'finance.reminder.payment_overdue' as const
    case 'shipment_overdue':
      return 'finance.reminder.shipment_overdue' as const
    case 'stock_low':
      return 'finance.reminder.stock_low' as const
  }
}
