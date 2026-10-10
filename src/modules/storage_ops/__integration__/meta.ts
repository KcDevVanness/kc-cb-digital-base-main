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
 *
 * The shape matters: the installed discovery extractor
 * (`@open-mercato/cli/lib/testing/integration-discovery`) scans for object-property syntax, taking
 * the first `name: [` it finds in the file. An `export const requiredEnvVars = [...]` (equals sign)
 * is read as an empty requirement list and the gate silently disappears — a metadata file no one
 * can parse is worse than no metadata, because it reads as configured. Keep these lists as
 * properties of `integrationMeta`, the shape the installed package's own meta files use, and keep
 * the property name out of any comment above it so the scanner finds the real list.
 */
export const integrationMeta = {
  dependsOnModules: ['attachments', 'storage_s3'],
  requiredEnvVars: ['STORAGE_OPS_TEST_S3_CONFIG', 'OM_ENABLE_STORAGE_S3'],
}
