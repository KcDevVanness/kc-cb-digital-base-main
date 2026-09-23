/**
 * Parties integration metadata.
 *
 * The specs exercise the app-owned counterparty master through the real HTTP surface plus the
 * Phase 3 option sources it re-pointed (`/api/currency_policy/currencies`), so the owning modules
 * must be present.
 */
export const dependsOnModules = ['parties', 'currency_policy']
