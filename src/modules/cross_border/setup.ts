import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants. `superadmin`/`admin` receive the module so the first
 * operator can work; `employee` is deliberately left ungranted — warehouse staff get
 * `cross_border.shipments.receive` through their own role, and that is an operational decision.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['cross_border.*'],
    admin: ['cross_border.*'],
  },
}

export default setup
