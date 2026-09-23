import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module's features so the first operator can work without a
 * bootstrap deadlock; `employee` is deliberately left ungranted, because whether a warehouse or
 * purchasing role may read collection and tax-refund figures is an operational decision this
 * module must not make on the tenant's behalf. `yarn mercato auth sync-role-acls` applies the
 * defaults to organizations that already exist.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['export_finance.*'],
    admin: ['export_finance.*'],
  },
}

export default setup
