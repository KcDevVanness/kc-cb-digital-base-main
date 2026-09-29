/**
 * The trusted scope of a hand-written read in this module.
 *
 * `organizationIds` is the directory-resolved set a parent organization sees (never a payload), and
 * the tenant is what the RU cursor rows themselves are keyed by.
 */
export type ReadScope = { tenantId: string; organizationIds: string[] }
