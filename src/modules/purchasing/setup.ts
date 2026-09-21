import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * The module ships no seeds and no demo rows: the supplier master starts empty.
 * `superadmin`/`admin` receive the module's features so the first operator can work
 * without a bootstrap deadlock; `employee` is deliberately left ungranted, because
 * which purchasing capabilities a role needs is an operational decision, not a
 * default this module may make for the app.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['purchasing.*'],
    admin: ['purchasing.*'],
  },
}

export default setup
