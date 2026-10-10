import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module's features so the first operator can work
 * without a bootstrap deadlock; `employee` is deliberately left ungranted, because
 * which product capabilities a role needs is an operational decision.
 *
 * The five product-line seeds are gone with the app-owned taxonomy: the product families were rows
 * of a table this module no longer owns, and a category is now a catalog category created by hand
 * when the business wants one. Nothing is seeded for a new organization, so setup has no write of
 * its own and is safe to re-run by construction.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['products.*'],
    admin: ['products.*'],
  },
}

export default setup
