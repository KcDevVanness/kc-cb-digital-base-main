import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * The module ships no demo rows: the supplier master starts empty. `superadmin`/`admin` receive the
 * module's features so the first operator can work without a bootstrap deadlock; `employee` is
 * deliberately left ungranted, because which purchasing capabilities a role needs is an operational
 * decision, not a default this module may make for the app.
 *
 * The 单位 vocabulary this module used to seed moved to `products/setup.ts` on 2026-10-10: after the
 * single-store cutover the unit a product carries **is** catalog's `default_unit`, so the module that
 * writes it owns the list — including the entries catalog's own dictionary has to carry for the
 * write to pass (`products/lib/unitVocabulary.ts`). The library form still reads the same dictionary
 * through `products/lib/unitOptions.ts`; the 订单描述 picker keeps reading the shared
 * `product_category` list that `product_codes` seeds.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['purchasing.*'],
    admin: ['purchasing.*'],
  },
}

export default setup
