import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants. The module ships no seeds: channels are created by the
 * operator, and platform data only enters through an explicit ingest or import.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['platform_ops.*'],
    admin: ['platform_ops.*'],
  },
}

export default setup
