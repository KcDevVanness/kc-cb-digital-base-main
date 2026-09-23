import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants. `employee` is deliberately left ungranted:
 * whether an operator may import supplier prices is an operational decision, not a default.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sourcing.*', 'products.items.manage', 'products.prices.manage'],
    admin: ['sourcing.*', 'products.items.manage', 'products.prices.manage'],
  },
}

export default setup
