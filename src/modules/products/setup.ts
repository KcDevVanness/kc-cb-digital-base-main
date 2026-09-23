import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ProductsType } from './data/entities'

/**
 * Product lines every organization starts with (purchased and self-made goods share them). Seed is
 * insert-only and idempotent:
 * re-running `yarn mercato seed:defaults --module products` never duplicates a row and
 * never rewrites an operator's edits (name, sort order, active flag stay theirs).
 */
export const PRODUCT_TYPE_SEEDS = [
  { code: 'fountain', name: '智能饮水机', nameEn: 'Smart Fountain', sortOrder: 10 },
  { code: 'feeder', name: '智能喂食器', nameEn: 'Smart Feeder', sortOrder: 20 },
  { code: 'litter_box', name: '智能猫砂盆', nameEn: 'Smart Litter Box', sortOrder: 30 },
  { code: 'camera', name: '智能摄像头', nameEn: 'Smart Camera', sortOrder: 40 },
  { code: 'accessory', name: '配件耗材', nameEn: 'Accessories & Consumables', sortOrder: 50 },
] as const

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module's features so the first operator can work
 * without a bootstrap deadlock; `employee` is deliberately left ungranted, because
 * which product capabilities a role needs is an operational decision.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['products.*'],
    admin: ['products.*'],
  },
  async seedDefaults(ctx) {
    const em = ctx.em
    for (const seed of PRODUCT_TYPE_SEEDS) {
      const existing = await em.findOne(ProductsType, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        code: seed.code,
      })
      if (existing) continue
      em.persist(
        em.create(ProductsType, {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          code: seed.code,
          name: seed.name,
          nameEn: seed.nameEn,
          sortOrder: seed.sortOrder,
          isActive: true,
        }),
      )
    }
    await em.flush()
  },
}

export default setup
