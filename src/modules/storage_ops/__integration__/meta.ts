/**
 * Storage-ops integration metadata.
 *
 * These specs drive the operator CLI (`yarn mercato storage_ops …`) against a scratch partition and
 * need a reachable S3-compatible endpoint, so the harness filters them out unless:
 *
 *  - `STORAGE_OPS_TEST_S3_CONFIG` — the `--s3-config` JSON
 *    (bucket/region/endpoint/forcePathStyle/credentialsEnvPrefix), and
 *  - `OM_ENABLE_STORAGE_S3` — the module flag. It must be set in the *spec runner's* environment,
 *    not only in `.env`: the CLI child process regenerates the discovery registries when it detects
 *    a structural change, and a child whose environment lacks the flag regenerates them **without**
 *    `storage_s3` (spec constraint C-10 — the flag must be identical at generate/build time and at
 *    runtime). The `migrate` refusal names that case explicitly.
 *
 * A local MinIO endpoint additionally needs `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true` —
 * see docs/deploy/storage.md §4.
 */
export const dependsOnModules = ['attachments', 'storage_s3']
export const requiredEnvVars = ['STORAGE_OPS_TEST_S3_CONFIG', 'OM_ENABLE_STORAGE_S3']
