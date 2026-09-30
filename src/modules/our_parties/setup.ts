import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * The module ships no seed data: which organizations this deployment trades as — and their
 * registered addresses and bank accounts — is business data the operator writes once. `superadmin`
 * and `admin` receive the features so the first operator can work without a bootstrap deadlock;
 * `employee` is deliberately left ungranted.
 *
 * Consumers: `trade_docs` (contract/PI/CI/发票 的「我方主体」回填) reads profiles through
 * `our_parties.view`, so deployment roles that own those forms need this feature — the role matrix
 * lives in `docs/dev/multi-company-org-model.md`.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['our_parties.*'],
    admin: ['our_parties.*'],
  },
}

export default setup
