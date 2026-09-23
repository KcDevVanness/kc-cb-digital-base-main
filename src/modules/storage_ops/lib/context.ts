/**
 * Container-facing helpers: partition rows, scopes, and the two drivers the migration needs.
 *
 * The migration touches **two** drivers at once while the partition still points at the local one:
 * the source (local) driver it reads bytes from, and the target (`s3`) driver it writes objects to.
 * The target driver is therefore built from the *intended* partition configuration plus the same
 * integration-credentials service the installed credential enhancer uses — never from a hand-made
 * config without scope, which would leave the S3 driver's tenant assertions inert (spec C-9).
 */
import { promises as fs } from 'node:fs'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import type { StorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers'
import type { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { resolvePartitionRoot } from '@open-mercato/core/modules/attachments/lib/storage'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type StorageScope = { tenantId: string; organizationId: string }

export type StorageOpsDeps = {
  em: EntityManager
  factory: StorageDriverFactory
  /** Resolves the `storage_s3` integration credentials for a scope; `null` when none are configured. */
  resolveIntegrationCredentials: (scope: StorageScope) => Promise<Record<string, unknown> | null>
}

/** The scope a row (or a partition) is stored under; the installed routes pass `''` for null. */
export function scopeOf(row: { tenantId?: string | null; organizationId?: string | null }): StorageScope {
  return { tenantId: row.tenantId ?? '', organizationId: row.organizationId ?? '' }
}

export function assertS3Enabled(): void {
  if (!parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {
    throw new Error(
      'storage_ops: OM_ENABLE_STORAGE_S3 is not enabled, so the `s3` driver is not registered. ' +
        'Set it in the environment (and keep it identical at generate/build time and at runtime — spec C-10) and retry.',
    )
  }
}

export async function loadPartition(em: EntityManager, code: string): Promise<AttachmentPartition> {
  const partition = await em.findOne(AttachmentPartition, { code })
  if (!partition) {
    throw new Error(
      `storage_ops: attachment partition "${code}" does not exist. ` +
        'Create it in /backend/config/attachments (or via POST /api/attachments/partitions) first.',
    )
  }
  return partition
}

export function localRootOf(code: string): string {
  return resolvePartitionRoot(code)
}

/** The local driver, asserted to be the local one (never the factory's silent fallback). */
export function localDriverOf(factory: StorageDriverFactory): StorageDriver {
  const driver = factory.resolveForAttachment('local')
  if (driver.key !== 'local') {
    throw new Error(`[internal] storage_ops expected the local driver but resolved "${driver.key}"`)
  }
  return driver
}

/** The driver the partition is configured with, asserted against the partition row. */
export async function partitionDriverOf(
  deps: StorageOpsDeps,
  partition: AttachmentPartition,
  scope?: StorageScope,
): Promise<StorageDriver> {
  const expected = partition.storageDriver ?? 'local'
  const driver = await deps.factory.resolveForPartition(partition.code, scope ?? scopeOf(partition))
  if (driver.key !== expected) {
    throw new Error(
      `storage_ops: partition "${partition.code}" is configured with driver "${expected}" but the factory ` +
        `resolved "${driver.key}". Refusing to continue — with the module off the factory falls back to the ` +
        'local driver, which would read and write local disk with S3-shaped paths.',
    )
  }
  return driver
}

/**
 * A per-scope driver resolver. A partition's rows can belong to different tenants/organizations, and
 * the S3 driver both resolves credentials per scope and asserts the key's scope — so one driver per
 * run would reject another tenant's key (or use the wrong credentials). One memoized driver per
 * `(tenantId, organizationId)` is the correct unit.
 */
export function scopedDriverResolver(
  build: (scope: StorageScope) => Promise<StorageDriver>,
): (row: { tenantId?: string | null; organizationId?: string | null }) => Promise<StorageDriver> {
  const cache = new Map<string, Promise<StorageDriver>>()
  return (row) => {
    const scope = scopeOf(row)
    const cacheKey = `${scope.tenantId}|${scope.organizationId}`
    let pending = cache.get(cacheKey)
    if (!pending) {
      pending = build(scope)
      cache.set(cacheKey, pending)
    }
    return pending
  }
}

/**
 * Builds the `s3` driver for the configuration the flip is about to write.
 * Partition `config_json` wins over marketplace credentials, exactly like the installed enhancer.
 */
export async function targetS3DriverFor(
  deps: StorageOpsDeps,
  partition: AttachmentPartition,
  scope: StorageScope,
  configJson: Record<string, unknown>,
): Promise<StorageDriver> {
  const partitionConfig = { ...(partition.configJson ?? {}), ...configJson }
  const usesOwnCredentials =
    Boolean(partitionConfig.credentialsEnvPrefix) ||
    Boolean(partitionConfig.accessKeyId) ||
    Boolean(partitionConfig.authMode)
  const credentials = usesOwnCredentials ? null : await deps.resolveIntegrationCredentials(scope)
  const config: Record<string, unknown> = {
    ...(credentials ?? {}),
    ...partitionConfig,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }
  const driver = deps.factory.resolveForAttachment('s3', config)
  if (driver.key !== 's3') {
    throw new Error(
      `storage_ops: the "s3" driver is not registered (resolved "${driver.key}"). ` +
        'Enable OM_ENABLE_STORAGE_S3 and regenerate — see docs/deploy/storage.md.',
    )
  }
  return driver
}

export type ProbeResult = { key: string; bytes: number; roundTrip: boolean }

/**
 * Store → read → delete a tiny object, so credentials, endpoint, bucket and the key contract are
 * proven before a single real byte moves.
 */
export async function probeTargetDriver(
  driver: StorageDriver,
  partitionCode: string,
  scope: StorageScope,
): Promise<ProbeResult> {
  const probeName = `.storage-ops-probe-${Date.now()}`
  const prepared = driver.prepareStoragePath?.({
    partitionCode,
    orgId: scope.organizationId,
    tenantId: scope.tenantId,
    fileName: probeName,
  })
  if (!prepared) {
    throw new Error('[internal] storage_ops: the target driver cannot prepare a storage path for the probe')
  }
  const payload = Buffer.from(`storage_ops probe ${new Date().toISOString()}\n`, 'utf8')
  const stored = await driver.store({
    partitionCode,
    orgId: scope.organizationId,
    tenantId: scope.tenantId,
    fileName: probeName,
    buffer: payload,
    storagePath: prepared,
  })
  try {
    const readBack = await driver.read(partitionCode, stored.storagePath)
    return {
      key: stored.storagePath,
      bytes: readBack.buffer.length,
      roundTrip: readBack.buffer.equals(payload),
    }
  } finally {
    await driver.delete(partitionCode, stored.storagePath)
  }
}

/** Absolute path of a stored file inside the partition root (containment is the driver's job). */
export async function absoluteLocalPath(
  driver: StorageDriver,
  partitionCode: string,
  storagePath: string,
): Promise<string> {
  const { filePath } = await driver.toLocalPath(partitionCode, storagePath)
  return filePath
}

export async function localFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

/** Every file under the partition root, as partition-relative slash paths. */
export async function listLocalFiles(root: string): Promise<string[]> {
  const found: string[] = []
  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = `${current}/${entry.name}`
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) found.push(absolute.slice(root.length + 1))
    }
  }
  await walk(root)
  return found.sort()
}

/** All rows of a partition, with the scope each one must be processed under. */
export async function partitionRows(em: EntityManager, partitionCode: string): Promise<Attachment[]> {
  return em.find(Attachment, { partitionCode }, { orderBy: { createdAt: 'ASC' } })
}
