import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants: the cockpit is an executive read, so `superadmin`/`admin`
 * get it and `employee` does not — a wide default would hand cost and margin figures to every
 * operator, which is the tenant's decision, not this module's.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['boss_cockpit.*'],
    admin: ['boss_cockpit.*'],
  },
}

export default setup
