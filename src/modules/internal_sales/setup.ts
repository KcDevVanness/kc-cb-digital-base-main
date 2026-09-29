import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { SALES_TRADE_TYPES, TRADE_TYPE_CHANNEL_CODES, TRADE_TYPE_CHANNEL_NAMES, type SalesTradeType } from './lib/tradeType'

/**
 * Trade types travel on the installed sales **channel** row, so the organization needs the two
 * system channels before any document can be marked.
 *
 * Written here (per module setup) rather than from the document form: a write path must not have to
 * hold `sales.channels.manage` to save a document, and a GET that creates rows would not be safe to
 * retry. `sales_channels_code_unique` on `(organization, tenant, code)` makes the upsert idempotent
 * even if two setup runs race.
 */

export type TradeTypeChannelScope = { tenantId: string; organizationId: string }

export async function ensureTradeTypeChannels(
  em: EntityManager,
  scope: TradeTypeChannelScope,
): Promise<Record<SalesTradeType, string>> {
  const created: Partial<Record<SalesTradeType, string>> = {}
  for (const type of SALES_TRADE_TYPES) {
    const code = TRADE_TYPE_CHANNEL_CODES[type]
    const existing = await em.findOne(SalesChannel, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code,
      deletedAt: null,
    })
    if (existing) {
      created[type] = String(existing.id)
      continue
    }
    const channel = em.create(SalesChannel, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: TRADE_TYPE_CHANNEL_NAMES[type],
      code,
      description:
        type === 'internal'
          ? '系统通道：内部销售（总部 → 分公司）。由 internal_sales 维护，不是市场渠道。'
          : '系统通道：对外销售（分公司 → 当地客户）。由 internal_sales 维护，不是市场渠道。',
      isActive: true,
    } as SalesChannel)
    em.persist(channel)
    created[type] = String(channel.id)
  }
  await em.flush()
  return created as Record<SalesTradeType, string>
}

export const setup: ModuleSetupConfig = {
  /** New organizations get the two channels with their tenant. */
  async onTenantCreated(ctx: { em: EntityManager } & TradeTypeChannelScope): Promise<void> {
    await ensureTradeTypeChannels(ctx.em, ctx)
  },
  /** Existing organizations: `yarn mercato seed:defaults --module internal_sales` (idempotent). */
  async seedDefaults(ctx: { em: EntityManager } & TradeTypeChannelScope): Promise<void> {
    await ensureTradeTypeChannels(ctx.em, ctx)
  },
}

export default setup
