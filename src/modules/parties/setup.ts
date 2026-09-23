import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * The module ships no seed data: the party master starts empty and the operator writes it (the
 * 2026-09-22 decision was greenfield — no `customers` rows are copied in). `superadmin`/`admin`
 * receive the module's features so the first operator can work without a bootstrap deadlock;
 * `employee` is deliberately left ungranted, because which counterparties a role may see is an
 * operational decision, not a default this module may make for the app.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['parties.*'],
    admin: ['parties.*'],
  },
}

export default setup
