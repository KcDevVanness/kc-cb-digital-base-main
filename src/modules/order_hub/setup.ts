import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants: the workbench is the cross-module order overview, so
 * `superadmin`/`admin` get it by default and `employee` does not — the tenant decides whether an
 * operator should see every order kind on one screen.
 *
 * Existing tenants are granted through `yarn mercato auth sync-role-acls`.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['order_hub.view', 'order_hub.manage'],
    admin: ['order_hub.view', 'order_hub.manage'],
  },
}

export default setup
