import { createHash } from 'node:crypto'

/**
 * Canonical attachment path contract (spec constraints C-1 / C-9).
 *
 * Every helper here is pure: the migration tool must be able to decide what a path *is* without a
 * database, a driver or a network round trip, so the same rules can run in unit tests and in
 * `audit`'s report path.
 */

const SCOPE_SEGMENT_PREFIX = { org: 'org_', tenant: 'tenant_' } as const

/** Reasons a stored path cannot be migrated mechanically. */
export type PathProblem =
  | 'empty'
  | 'absolute'
  | 'traversal'
  | 'backslash'
  | 'already-prefixed'
  | 'missing-scope-segments'

export const PATH_PROBLEM_MESSAGES: Record<PathProblem, string> = {
  empty: 'the stored path is empty',
  absolute: 'the stored path starts with "/" and would resolve outside the partition root',
  traversal: 'the stored path contains a "." or ".." segment',
  backslash: 'the stored path contains a Windows separator',
  'already-prefixed': 'the stored path already starts with the partition code',
  'missing-scope-segments':
    'the stored path has no org_<id>/tenant_<id> segment pair, so the S3 driver would reject it',
}

function segmentsOf(storagePath: string): string[] {
  return String(storagePath ?? '')
    .split('/')
    .filter((segment) => segment.length > 0)
}

/** True when the segment pair `org_*` + `tenant_*` appears (the driver asserts the same shape). */
export function hasScopeSegments(storagePath: string): boolean {
  const segments = segmentsOf(storagePath)
  return segments.some(
    (segment, index) =>
      segment.startsWith(SCOPE_SEGMENT_PREFIX.org) &&
      segments[index + 1]?.startsWith(SCOPE_SEGMENT_PREFIX.tenant) === true,
  )
}

/**
 * Returns the reason a stored path is not canonical for `partitionCode`, or `null` when it is.
 *
 * Canonical means: relative, no traversal, no backslash, scope-segmented, and **not** already
 * carrying the partition prefix (a local row's path never does; the prefix is inserted at flip).
 */
export function canonicalPathProblem(storagePath: string, partitionCode: string): PathProblem | null {
  const value = String(storagePath ?? '')
  if (value.trim().length === 0) return 'empty'
  if (value.startsWith('/')) return 'absolute'
  if (value.includes('\\')) return 'backslash'
  const segments = segmentsOf(value)
  if (segments.some((segment) => segment === '.' || segment === '..')) return 'traversal'
  if (segments[0] === partitionCode) return 'already-prefixed'
  if (!hasScopeSegments(value)) return 'missing-scope-segments'
  return null
}

/** The object key the S3 driver stores for a canonical path: `[pathPrefix]<partition>/<path>`. */
export function objectKeyFor(
  partitionCode: string,
  storagePath: string,
  pathPrefix?: string | null,
): string {
  const prefix = (pathPrefix ?? '').replace(/^\/+/, '')
  const normalizedPrefix = prefix.length > 0 && !prefix.endsWith('/') ? `${prefix}/` : prefix
  return `${normalizedPrefix}${partitionCode}/${stripLeadingSlashes(storagePath)}`
}

/** The flip rewrite: `partition_code || '/' || storage_path`. */
export function withPartitionPrefix(partitionCode: string, storagePath: string): string {
  const stripped = stripLeadingSlashes(storagePath)
  return stripped.startsWith(`${partitionCode}/`) ? stripped : `${partitionCode}/${stripped}`
}

/** The rollback rewrite: strip one leading `<partition>/` segment. */
export function withoutPartitionPrefix(partitionCode: string, storagePath: string): string {
  const stripped = stripLeadingSlashes(storagePath)
  return stripped.startsWith(`${partitionCode}/`) ? stripped.slice(partitionCode.length + 1) : stripped
}

function stripLeadingSlashes(value: string): string {
  return String(value ?? '').replace(/^\/+/, '')
}

/**
 * Local mirror of the S3 driver's key assertions, so a mismatch fails before any network call.
 * Mirrors `storage-s3/lib/s3-driver.ts` `assertPartitionScoped` + `assertKeyScoped`.
 */
export function objectKeyProblem(
  partitionCode: string,
  key: string,
  pathPrefix?: string | null,
): string | null {
  const prefix = (pathPrefix ?? '').replace(/^\/+/, '')
  const withoutPrefix =
    prefix.length > 0 && key.startsWith(prefix)
      ? key.slice(prefix.length).replace(/^\/+/, '')
      : key.replace(/^\/+/, '')
  const firstSegment = withoutPrefix.split('/').filter(Boolean)[0]
  if (firstSegment !== partitionCode) {
    return `[internal] S3 key is not scoped to the requested partition (key="${key}")`
  }
  if (!hasScopeSegments(key)) {
    return `[internal] S3 key is not scoped to the active tenant (key="${key}")`
  }
  return null
}

/** sha256 of a buffer, as recorded in the migration manifest. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
