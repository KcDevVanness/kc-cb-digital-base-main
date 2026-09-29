import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module so the first operator can configure the RU integration and
 * work the mapping list. `employee` is deliberately left ungranted: whether purchasing or a planner
 * may read the RU planning data is an operational decision, and `ru_sync.run` stays an operator
 * feature either way.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['ru_sync.*'],
    admin: ['ru_sync.*'],
  },
}

export default setup
