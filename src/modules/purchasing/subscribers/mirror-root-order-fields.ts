import { z } from 'zod'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PurchasingPurchaseOrder } from '../data/entities'

const logger = createLogger('purchasing').child({ component: 'mirror-root-order-fields' })

/**
 * Mirrors the company order's (根单) 订单描述 / 采购负责人 onto the purchase orders it holds.
 *
 * The root owns both fields — the purchasing forms carry no picker for either, and the detail page
 * reads them back read-only — so the purchase order's columns are a projection the hub keeps in
 * sync. This subscriber is the only writer of that projection: it overwrites whatever is stored
 * with the payload's value, so replaying the event is a no-op rather than a drift.
 *
 * A field that is **absent** from the payload is left alone; only an explicit value (or an explicit
 * `null`, meaning the root cleared it) is written. That keeps an emitter that names one field from
 * blanking the other.
 */
export const metadata = {
  event: 'order_hub.company_order.order_fields_updated',
  persistent: true,
  id: 'purchasing:mirror-root-order-fields',
}

const payloadSchema = z.object({
  /** The company order the event is about; validated for shape, used for the log line only. */
  id: z.string().uuid().optional(),
  tenantId: z.string().min(1).nullable().optional(),
  organizationId: z.string().min(1).nullable().optional(),
  productCategory: z.string().max(64).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  purchaseOrderIds: z.array(z.string().uuid()).default([]),
})

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  /** Trusted scope the bus forwards beside the payload; preferred over the payload's own copy. */
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) {
    logger.warn('Ignoring a malformed order-fields mirror payload', { err: parsed.error })
    return
  }
  const data = parsed.data
  // The bus's own scope wins over the payload's copy: a payload is built by the emitter, while the
  // context scope is what the emit was trusted with. An empty string is "no scope", not a scope.
  const contextTenantId = typeof ctx.tenantId === 'string' && ctx.tenantId.length > 0 ? ctx.tenantId : null
  const contextOrganizationId =
    typeof ctx.organizationId === 'string' && ctx.organizationId.length > 0 ? ctx.organizationId : null
  const tenantId = contextTenantId ?? data.tenantId ?? null
  const organizationId = contextOrganizationId ?? data.organizationId ?? null
  if (!tenantId || !organizationId) {
    logger.warn('Ignoring an order-fields mirror without a tenant/organization scope', { companyOrderId: data.id })
    return
  }
  if (data.purchaseOrderIds.length === 0) return

  let de: DataEngine
  try {
    de = ctx.resolve<DataEngine>('dataEngine')
  } catch (error) {
    logger.error('The data engine is not available; the order-fields mirror was skipped', { err: error })
    return
  }

  for (const purchaseOrderId of data.purchaseOrderIds) {
    try {
      await de.updateOrmEntity({
        entity: PurchasingPurchaseOrder,
        where: { id: purchaseOrderId, tenantId, organizationId },
        apply: (order) => {
          // `undefined` is "the payload did not mention it" — never a write. Only the fields the
          // emitter named are touched, so an event about one field cannot clear the other.
          if (data.productCategory !== undefined) order.productCategory = data.productCategory
          if (data.ownerUserId !== undefined) order.ownerUserId = data.ownerUserId
          if (data.ownerSnapshot !== undefined) order.ownerSnapshot = data.ownerSnapshot
        },
      })
    } catch (error) {
      // One unreachable order must not stop the rest of the set: the mirror is best-effort and a
      // failure here is logged, never thrown back at the emitter.
      logger.error('Failed to mirror the root order fields onto a purchase order', {
        err: error,
        companyOrderId: data.id,
        purchaseOrderId,
      })
    }
  }
}
