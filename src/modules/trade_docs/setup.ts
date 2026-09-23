import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * The module ships no seeds: contracts and invoices start empty, and which role may sign a
 * contract is an operational decision, not a default this module may take for the app.
 * `superadmin`/`admin` receive the features so the first operator can work without a bootstrap
 * deadlock; `employee` is deliberately left ungranted.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['trade_docs.*'],
    admin: ['trade_docs.*'],
  },
}

export default setup
