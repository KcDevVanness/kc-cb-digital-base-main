/**
 * The migration state machine: preflight → copy → verify → flip, plus rollback and retention
 * pruning (spec REQ-003 … REQ-010).
 *
 * Two invariants drive every design choice here:
 *  - the read path resolves the driver by **partition**, so a flip must never touch a row whose
 *    bytes were not copied and verified first (the flip updates an explicit id set and asserts it);
 *  - the installed `StorageDriver` seam has no stat/HEAD, so "does the object exist and match?" is
 *    answered by reading it back — the cost is one full pass over the partition's bytes.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AttachmentQuotaReservation } from '@open-mercato/core/modules/attachments/data/entities'
import type { StorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { auditPartition, ledgerKey, planLedgerRepair } from './audit'
import type { StorageOpsDeps, StorageScope } from './context'
import {
  absoluteLocalPath,
  assertS3Enabled,
  loadPartition,
  localDriverOf,
  localFileExists,
  partitionDriverOf,
  partitionRows,
  probeTargetDriver,
  scopedDriverResolver,
  scopeOf,
  targetS3DriverFor,
} from './context'
import type { CapturedPartitionRow, MigrationManifestHeader } from './manifest'
import { MigrationManifest, defaultManifestPath } from './manifest'
import { canonicalPathProblem, objectKeyFor, objectKeyProblem, sha256, withoutPartitionPrefix } from './paths'

type StorageOpsDatabase = {
  attachments: { id: string; partition_code: string; storage_driver: string; storage_path: string }
  attachment_partitions: { code: string; storage_driver: string; config_json: unknown; updated_at: Date }
  attachment_quota_reservations: {
    id: string
    tenant_id: string
    storage_driver: string
    storage_path: string
    status: string
    updated_at: Date
  }
}

export type MigrateOptions = {
  partition: string
  concurrency: number
  dryRun: boolean
  yes: boolean
  s3Config: Record<string, unknown>
  manifestPath?: string
  sample: number
  all: boolean
  olderThanDays?: number
}

export type PreflightPlan = {
  partition: string
  rows: number
  bytes: number
  keys: string[]
  scope: StorageScope | null
  probe: { key: string; bytes: number; roundTrip: boolean } | null
  duplicatesRemoved: number
  manifestPath: string
  partitionRow: CapturedPartitionRow
  headerWritten: boolean
}

export type CopySummary = { copied: number; skipped: number; bytes: number }

export type VerifySummary = { checked: number; hashed: number; mismatches: string[] }

export type FlipSummary = { rows: number; ledgerRows: number; stragglers: number; orphanObjects: string[] }

export type PruneSummary = { deleted: number; skipped: number }

function capturePartitionRow(partition: {
  code: string
  storageDriver?: string
  configJson?: Record<string, unknown> | null
  isPublic?: boolean
  requiresOcr?: boolean
  ocrModel?: string | null
  tenantId?: string | null
  organizationId?: string | null
}): CapturedPartitionRow {
  return {
    code: partition.code,
    storageDriver: partition.storageDriver ?? 'local',
    configJson: partition.configJson ?? null,
    isPublic: partition.isPublic ?? false,
    requiresOcr: partition.requiresOcr ?? false,
    ocrModel: partition.ocrModel ?? null,
    tenantId: partition.tenantId ?? null,
    organizationId: partition.organizationId ?? null,
  }
}

function pathPrefixOf(s3Config: Record<string, unknown>): string | null {
  const value = s3Config.pathPrefix
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function manifestPathFor(options: MigrateOptions): string {
  return options.manifestPath ?? defaultManifestPath(options.partition)
}

/**
 * Preflight (REQ-003/REQ-007): asserts the module is on, the partition exists and resolves to its
 * configured driver, the drift report is clean, the target driver answers a scoped round trip, and
 * the ledger holds no duplicates or in-flight reservations. Repairs the duplicates (count printed)
 * and captures the partition row verbatim into the manifest — unless `--dry-run`, which writes
 * nothing at all.
 */
export async function runPreflight(
  deps: StorageOpsDeps,
  options: MigrateOptions,
): Promise<PreflightPlan> {
  assertS3Enabled()
  const partition = await loadPartition(deps.em, options.partition)
  const audit = await auditPartition(deps, options.partition)
  if (audit.blocking > 0) {
    throw new Error(
      `storage_ops: ${audit.blocking} blocking violation(s) in partition "${options.partition}" — ` +
        'run `storage_ops audit` for the itemized report and fix them before migrating',
    )
  }
  if ((partition.storageDriver ?? 'local') !== 'local') {
    throw new Error(
      `storage_ops: partition "${options.partition}" is already on driver "${partition.storageDriver}". ` +
        '`migrate` moves a partition from local to s3; use `verify` for an s3 partition and `rollback` to move it back.',
    )
  }

  const rows = await partitionRows(deps.em, options.partition)
  const prefix = pathPrefixOf(options.s3Config)
  const keys: string[] = []
  let bytes = 0
  for (const row of rows) {
    const problem = canonicalPathProblem(row.storagePath, options.partition)
    if (problem) {
      throw new Error(`storage_ops: row ${row.id} has a non-canonical storage_path (${problem}): ${row.storagePath}`)
    }
    const key = objectKeyFor(options.partition, row.storagePath, prefix)
    const keyProblem = objectKeyProblem(options.partition, key, prefix)
    if (keyProblem) throw new Error(`storage_ops: ${keyProblem}`)
    keys.push(key)
    bytes += row.fileSize ?? 0
  }

  const scope: StorageScope | null =
    rows.length > 0 ? scopeOf(rows[0]) : partition.tenantId || partition.organizationId ? scopeOf(partition) : null
  let probe: PreflightPlan['probe'] = null
  if (scope) {
    const targetDriver = await targetS3DriverFor(deps, partition, scope, options.s3Config)
    probe = await probeTargetDriver(targetDriver, options.partition, scope)
    if (!probe.roundTrip) {
      throw new Error('storage_ops: the target driver failed its store→read round trip; check credentials, bucket and endpoint')
    }
  }

  const manifest = await MigrationManifest.load(manifestPathFor(options))
  const partitionRow = capturePartitionRow(partition)
  let headerWritten = manifest.header !== null
  let duplicatesRemoved = 0

  if (!options.dryRun) {
    if (!options.yes) {
      throw new Error('storage_ops: `migrate` writes objects and rows; pass --yes to confirm (or --dry-run to preview)')
    }
    duplicatesRemoved = await removeDuplicateLedgerRows(deps.em, options.partition)
    if (!manifest.header) {
      const header: MigrationManifestHeader = {
        type: 'header',
        version: 1,
        partition: options.partition,
        partitionRow,
        targetConfigJson: options.s3Config,
        createdAt: new Date().toISOString(),
      }
      await manifest.writeHeader(header)
      headerWritten = true
    }
  }

  return {
    partition: options.partition,
    rows: rows.length,
    bytes,
    keys,
    scope,
    probe,
    duplicatesRemoved,
    manifestPath: manifestPathFor(options),
    partitionRow,
    headerWritten,
  }
}

async function removeDuplicateLedgerRows(em: EntityManager, partitionCode: string): Promise<number> {
  const rows = await partitionRows(em, partitionCode)
  const ledgerRows = await em.find(AttachmentQuotaReservation, { partitionCode })
  const attachmentKeys = new Set(rows.map((row) => ledgerKey(row.storageDriver, row.storagePath)))
  const plan = planLedgerRepair(
    attachmentKeys,
    ledgerRows.map((row) => ({
      id: row.id,
      status: row.status,
      storageDriver: row.storageDriver,
      storagePath: row.storagePath,
    })),
  )
  if (plan.duplicateCommittedIds.length === 0) return 0
  const db = em.getKysely<StorageOpsDatabase>()
  const result = await db
    .deleteFrom('attachment_quota_reservations')
    .where('id', 'in', plan.duplicateCommittedIds)
    .where('status', '=', 'committed')
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0)
}

/**
 * Copy (REQ-003): streamed per row through the installed drivers — read via the local driver, write
 * via the target `s3` driver. Resume reads the object back before re-storing, so correctness never
 * depends on the provider's conditional put.
 */
export async function runCopy(
  deps: StorageOpsDeps,
  options: MigrateOptions,
  only?: string[],
): Promise<CopySummary> {
  const partition = await loadPartition(deps.em, options.partition)
  const rows = (await partitionRows(deps.em, options.partition)).filter(
    (row) => (only ? only.includes(row.id) : true) && row.storageDriver === 'local',
  )
  const localDriver = localDriverOf(deps.factory)
  const manifest = await MigrationManifest.load(manifestPathFor(options))
  const prefix = pathPrefixOf(options.s3Config)
  const driverFor = scopedDriverResolver((scope) => targetS3DriverFor(deps, partition, scope, options.s3Config))
  let copied = 0
  let skipped = 0
  let bytes = 0

  await mapWithConcurrency(rows, options.concurrency, async (row) => {
    const problem = canonicalPathProblem(row.storagePath, options.partition)
    if (problem) throw new Error(`storage_ops: row ${row.id} has a non-canonical storage_path (${problem})`)
    const scope = scopeOf(row)
    const driver = await driverFor(row)
    const key = objectKeyFor(options.partition, row.storagePath, prefix)
    const recorded = manifest.row(row.id)
    if (recorded?.state === 'verified' && recorded.key === key) {
      const existing = await readObject(driver, options.partition, key)
      if (existing && existing.length === row.fileSize) {
        skipped += 1
        return
      }
    }
    const { buffer } = await localDriver.read(options.partition, row.storagePath)
    const hash = sha256(buffer)
    try {
      await driver.store({
        partitionCode: options.partition,
        orgId: scope.organizationId,
        tenantId: scope.tenantId,
        fileName: path.basename(row.storagePath),
        buffer,
        storagePath: key,
      })
    } catch (error) {
      const present = await readObject(driver, options.partition, key)
      const explained = present !== null && present.length === buffer.length && sha256(present) === hash
      if (!explained) throw error
    }
    const readBack = await readObject(driver, options.partition, key)
    if (!readBack || readBack.length !== buffer.length || sha256(readBack) !== hash) {
      throw new Error(`storage_ops: read-back mismatch for ${key} — refusing to record the row as copied`)
    }
    await manifest.recordRow({
      type: 'row',
      id: row.id,
      storagePath: row.storagePath,
      key,
      size: buffer.length,
      sha256: hash,
      state: 'verified',
      updatedAt: new Date().toISOString(),
    })
    copied += 1
    bytes += buffer.length
  })

  return { copied, skipped, bytes }
}

async function readObject(driver: StorageDriver, partitionCode: string, key: string): Promise<Buffer | null> {
  try {
    const result = await driver.read(partitionCode, key)
    return result.buffer
  } catch {
    return null
  }
}

/**
 * Verify (REQ-003): every object is read back and its length compared with the row's `file_size`;
 * `--sample N` additionally hashes N rows against their local file, `--all` hashes everything.
 */
export async function runVerify(
  deps: StorageOpsDeps,
  options: MigrateOptions,
  driverFor: (row: { tenantId?: string | null; organizationId?: string | null }) => Promise<StorageDriver>,
): Promise<VerifySummary> {
  const prefix = pathPrefixOf(options.s3Config)
  const rows = await partitionRows(deps.em, options.partition)
  const localDriver = localDriverOf(deps.factory)
  const mismatches: string[] = []
  let checked = 0
  let hashed = 0

  const hashTargets = new Set(
    options.all ? rows.map((row) => row.id) : rows.slice(0, Math.max(0, options.sample)).map((row) => row.id),
  )

  await mapWithConcurrency(rows, options.concurrency, async (row) => {
    // Pre-flip rows carry the canonical path (the key adds the partition segment); post-flip rows
    // already carry the object key.
    const key =
      row.storageDriver === 's3' ? row.storagePath : objectKeyFor(options.partition, row.storagePath, prefix)
    const driver = await driverFor(row)
    const object = await readObject(driver, options.partition, key)
    checked += 1
    if (!object) {
      mismatches.push(`${key}: object is missing or unreadable`)
      return
    }
    if (object.length !== row.fileSize) {
      mismatches.push(`${key}: object is ${object.length} bytes, row says ${row.fileSize}`)
      return
    }
    if (hashTargets.has(row.id)) {
      hashed += 1
      const localPath = await absoluteLocalPath(
        localDriver,
        options.partition,
        withoutPartitionPrefix(options.partition, key),
      )
      const localBytes = await fs.readFile(localPath).catch(() => null)
      if (localBytes && sha256(localBytes) !== sha256(object)) {
        mismatches.push(`${key}: object hash differs from the local file`)
      }
    }
  })

  return { checked, hashed, mismatches }
}

/**
 * Flip (REQ-004): copies any straggler first, asserts every live `local` row is verified, then runs
 * one transaction over rows + ledger + partition row and asserts the affected counts.
 */
export async function runFlip(
  deps: StorageOpsDeps,
  options: MigrateOptions,
): Promise<FlipSummary> {
  const manifest = await MigrationManifest.load(manifestPathFor(options))
  if (!manifest.header) {
    throw new Error(
      `storage_ops: no migration manifest at ${manifestPathFor(options)} — run preflight (or the full \`migrate\`) first; ` +
        'the manifest holds the pre-flip partition row that rollback restores.',
    )
  }
  const rows = (await partitionRows(deps.em, options.partition)).filter((row) => row.storageDriver === 'local')
  const verified = new Set(manifest.verifiedIds())
  const stragglers = rows.filter((row) => !verified.has(row.id)).map((row) => row.id)
  let stragglerCount = 0
  if (stragglers.length > 0) {
    const summary = await runCopy(deps, options, stragglers)
    stragglerCount = summary.copied
    const refreshed = await MigrationManifest.load(manifestPathFor(options))
    const stillMissing = stragglers.filter((id) => refreshed.row(id)?.state !== 'verified')
    if (stillMissing.length > 0) {
      throw new Error(
        `storage_ops: ${stillMissing.length} row(s) could not be copied and verified (${stillMissing.join(', ')}) — ` +
          'the flip is aborted and nothing was rewritten',
      )
    }
  }

  const ids = rows.map((row) => row.id)
  const orphans = [...verified].filter((id) => !ids.includes(id))
  const em = deps.em
  const summary = await em.transactional(async (tx) => {
    const db = tx.getKysely<StorageOpsDatabase>()
    const updated = await db
      .updateTable('attachments')
      .set({
        storage_path: sql`partition_code || '/' || storage_path`,
        storage_driver: 's3',
      })
      .where('id', 'in', ids)
      .where('storage_driver', '=', 'local')
      .executeTakeFirst()
    const affected = Number(updated.numUpdatedRows ?? 0)
    if (affected !== ids.length) {
      throw new Error(
        `storage_ops: the flip rewrote ${affected} row(s) but the verified set has ${ids.length} — aborting the transaction ` +
          '(a row changed between the copy and the flip)',
      )
    }

    const ledger = await db
      .updateTable('attachment_quota_reservations')
      .set({
        storage_driver: 's3',
        storage_path: sql`${options.partition} || '/' || storage_path`.$castTo<string>(),
        updated_at: new Date(),
      })
      .where('storage_driver', '=', 'local')
      .where(
        'storage_path',
        'in',
        rows.map((row) => row.storagePath),
      )
      .executeTakeFirst()

    await db
      .updateTable('attachment_partitions')
      .set({
        storage_driver: 's3',
        config_json: options.s3Config,
        updated_at: new Date(),
      })
      .where('code', '=', options.partition)
      .execute()

    const remaining = await db
      .selectFrom('attachments')
      .select(sql<number>`count(*)`.as('count'))
      .where('partition_code', '=', options.partition)
      .where('storage_driver', '=', 'local')
      .executeTakeFirst()
    if (Number(remaining?.count ?? 0) !== 0) {
      throw new Error('storage_ops: rows with driver "local" remain after the flip — aborting the transaction')
    }

    return { rows: affected, ledgerRows: Number(ledger.numUpdatedRows ?? 0), stragglers: stragglerCount }
  })

  return { ...summary, stragglers: stragglerCount, orphanObjects: orphans }
}

/**
 * Rollback (REQ-005): materialize every object at its local path (skipping byte-identical files),
 * then one transaction strips the prefix from rows and ledger and restores the captured partition
 * row verbatim. Fails closed on an unreadable object or a conflicting local file.
 */
export async function runRollback(
  deps: StorageOpsDeps,
  options: MigrateOptions,
): Promise<{ rows: number; ledgerRows: number; restored: number; skipped: number }> {
  const partition = await loadPartition(deps.em, options.partition)
  if ((partition.storageDriver ?? 'local') !== 's3') {
    throw new Error(`storage_ops: partition "${options.partition}" is not on the "s3" driver; nothing to roll back`)
  }
  const manifest = await MigrationManifest.load(manifestPathFor(options))
  if (!manifest.header) {
    throw new Error(
      `storage_ops: no migration manifest at ${manifestPathFor(options)} — rollback restores the partition row from the ` +
        'manifest header, so it cannot run without it',
    )
  }
  const rows = (await partitionRows(deps.em, options.partition)).filter((row) => row.storageDriver === 's3')
  const localDriver = localDriverOf(deps.factory)
  const driverFor = scopedDriverResolver((scope) => partitionDriverOf(deps, partition, scope))
  let restored = 0
  let skipped = 0

  await mapWithConcurrency(rows, options.concurrency, async (row) => {
    const key = row.storagePath
    const stripped = withoutPartitionPrefix(options.partition, key)
    if (stripped === key) {
      throw new Error(`storage_ops: row ${row.id} path "${key}" does not carry the partition prefix — refusing to guess`)
    }
    const object = await readObject(await driverFor(row), options.partition, key)
    if (!object) {
      throw new Error(`storage_ops: object ${key} is unreadable — rollback aborted before rewriting anything`)
    }
    const localPath = await absoluteLocalPath(localDriver, options.partition, stripped)
    if (await localFileExists(localPath)) {
      const localBytes = await fs.readFile(localPath)
      if (sha256(localBytes) === sha256(object)) {
        skipped += 1
        return
      }
      throw new Error(
        `storage_ops: ${localPath} already exists with different content — refusing to overwrite; resolve it manually`,
      )
    }
    await localDriver.store({
      partitionCode: options.partition,
      orgId: row.organizationId ?? null,
      tenantId: row.tenantId ?? null,
      fileName: path.basename(stripped),
      buffer: object,
      storagePath: stripped,
    })
    restored += 1
  })

  const ids = rows.map((row) => row.id)
  const em = deps.em
  const summary = await em.transactional(async (tx) => {
    const db = tx.getKysely<StorageOpsDatabase>()
    const updated = await db
      .updateTable('attachments')
      .set({
        storage_path: sql`regexp_replace(storage_path, '^' || partition_code || '/', '')`,
        storage_driver: 'local',
      })
      .where('id', 'in', ids)
      .where('storage_driver', '=', 's3')
      .executeTakeFirst()
    const ledger = await db
      .updateTable('attachment_quota_reservations')
      .set({
        storage_driver: 'local',
        storage_path: sql`regexp_replace(storage_path, '^' || ${options.partition} || '/', '')`.$castTo<string>(),
        updated_at: new Date(),
      })
      .where('storage_driver', '=', 's3')
      .where(
        'storage_path',
        'in',
        rows.map((row) => row.storagePath),
      )
      .executeTakeFirst()

    const captured = manifest.header?.partitionRow
    await db
      .updateTable('attachment_partitions')
      .set({
        storage_driver: captured?.storageDriver ?? 'local',
        config_json: captured?.configJson ?? null,
        updated_at: new Date(),
      })
      .where('code', '=', options.partition)
      .execute()

    const remaining = await db
      .selectFrom('attachments')
      .select(sql<number>`count(*)`.as('count'))
      .where('partition_code', '=', options.partition)
      .where('storage_driver', '=', 's3')
      .executeTakeFirst()
    if (Number(remaining?.count ?? 0) !== 0) {
      throw new Error('storage_ops: rows with driver "s3" remain after the rollback — aborting the transaction')
    }

    return { rows: Number(updated.numUpdatedRows ?? 0), ledgerRows: Number(ledger.numUpdatedRows ?? 0) }
  })

  return { ...summary, restored, skipped }
}

/**
 * Retention (REQ-010): delete local files whose object reads back with a matching length. Dry-run
 * by default; `--older-than <days>` limits it to files untouched for that long.
 */
export async function runPruneLocal(
  deps: StorageOpsDeps,
  options: MigrateOptions,
): Promise<PruneSummary> {
  const partition = await loadPartition(deps.em, options.partition)
  if ((partition.storageDriver ?? 'local') !== 's3') {
    throw new Error(`storage_ops: partition "${options.partition}" is not on the "s3" driver; there is nothing to prune`)
  }
  const rows = (await partitionRows(deps.em, options.partition)).filter((row) => row.storageDriver === 's3')
  const localDriver = localDriverOf(deps.factory)
  const driverFor = scopedDriverResolver((scope) => partitionDriverOf(deps, partition, scope))
  const cutoff =
    typeof options.olderThanDays === 'number' && Number.isFinite(options.olderThanDays)
      ? Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000
      : null
  let deleted = 0
  let skipped = 0

  for (const row of rows) {
    const object = await readObject(await driverFor(row), options.partition, row.storagePath)
    if (!object || object.length !== row.fileSize) {
      throw new Error(
        `storage_ops: object ${row.storagePath} is missing or does not match the row's size — refusing to delete anything ` +
          '(prune only removes files whose bytes are provably in the bucket)',
      )
    }
    const stripped = withoutPartitionPrefix(options.partition, row.storagePath)
    const localPath = await absoluteLocalPath(localDriver, options.partition, stripped)
    if (!(await localFileExists(localPath))) {
      skipped += 1
      continue
    }
    if (cutoff !== null) {
      const stats = await fs.stat(localPath)
      if (stats.mtimeMs > cutoff) {
        skipped += 1
        continue
      }
    }
    if (options.dryRun || !options.yes) {
      console.log(`  would delete ${localPath}`)
      skipped += 1
      continue
    }
    if (localDriver.deleteStrict) await localDriver.deleteStrict(options.partition, stripped)
    else await localDriver.delete(options.partition, stripped)
    deleted += 1
  }

  return { deleted, skipped }
}

/** The one-command path: preflight → copy → verify → flip (REQ-003/REQ-004). */
export async function runMigrate(
  deps: StorageOpsDeps,
  options: MigrateOptions,
): Promise<{ preflight: PreflightPlan; copy: CopySummary; verify: VerifySummary; flip: FlipSummary | null }> {
  const preflight = await runPreflight(deps, options)
  console.log(
    `preflight: partition=${preflight.partition} rows=${preflight.rows} bytes=${preflight.bytes} ` +
      `duplicateLedgerRowsRemoved=${preflight.duplicatesRemoved} manifest=${preflight.manifestPath}`,
  )
  if (preflight.probe) {
    console.log(`probe: key=${preflight.probe.key} bytes=${preflight.probe.bytes} roundTrip=${preflight.probe.roundTrip}`)
  }
  if (options.dryRun) {
    for (const key of preflight.keys.slice(0, 5)) console.log(`  would write ${key}`)
    if (preflight.keys.length > 5) console.log(`  … ${preflight.keys.length - 5} more object(s)`)
    console.log('dry-run: nothing was written')
    return { preflight, copy: { copied: 0, skipped: 0, bytes: 0 }, verify: { checked: 0, hashed: 0, mismatches: [] }, flip: null }
  }

  const copy = await runCopy(deps, options)
  console.log(`copy: copied=${copy.copied} skipped=${copy.skipped} bytes=${copy.bytes}`)

  const partition = await loadPartition(deps.em, options.partition)
  const verify = await runVerify(
    deps,
    { ...options },
    scopedDriverResolver((scope) => targetS3DriverFor(deps, partition, scope, options.s3Config)),
  )
  console.log(`verify: checked=${verify.checked} hashed=${verify.hashed} mismatches=${verify.mismatches.length}`)
  if (verify.mismatches.length > 0) {
    throw new Error(`storage_ops: verification failed:\n  ${verify.mismatches.join('\n  ')}`)
  }

  const flip = await runFlip(deps, options)
  console.log(
    `flip: rows=${flip.rows} ledgerRows=${flip.ledgerRows} stragglers=${flip.stragglers} orphanObjects=${flip.orphanObjects.length}`,
  )
  return { preflight, copy, verify, flip }
}
