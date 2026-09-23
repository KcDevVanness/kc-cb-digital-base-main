import { expect, test } from '@playwright/test'
import {
  REHEARSAL_ORG,
  REHEARSAL_PARTITION,
  REHEARSAL_TENANT,
  cleanupFixture,
  deleteObjects,
  ensurePartition,
  partitionFileExists,
  putObject,
  readPartitionFile,
  runStorageOps,
  s3ConfigArgument,
  seedAttachmentRow,
  withDb,
  writePartitionFile,
} from './helpers'

/**
 * TEST-004 / TEST-010 — rollback restores the pre-flip partition row verbatim, brings back rows
 * written **after** the cutover, and makes the quota ledger follow its attachment rows in both
 * directions. The retention path is covered too: after `prune-local` the local files are gone and a
 * rollback re-materializes them from the bucket.
 *
 * Each test seeds its own fixture, so the two scenarios cannot leak state into each other.
 */

const PARTITION = REHEARSAL_PARTITION
const MIGRATED_NAME = '1790144700020_migrated.txt'
const POST_CUTOVER_NAME = '1790144700021_post.txt'
const MIGRATED_CANONICAL = `org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/${MIGRATED_NAME}`
const POST_CANONICAL = `org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/${POST_CUTOVER_NAME}`
const MIGRATED_KEY = `${PARTITION}/${MIGRATED_CANONICAL}`
const POST_KEY = `${PARTITION}/${POST_CANONICAL}`
const MIGRATED_BYTES = Buffer.from('migrated before the cutover\n', 'utf8')
const POST_BYTES = Buffer.from('uploaded while the partition was on s3\n', 'utf8')

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
    await ensurePartition(client, PARTITION)
    writePartitionFile(PARTITION, MIGRATED_CANONICAL, MIGRATED_BYTES)
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: MIGRATED_CANONICAL,
      fileSize: MIGRATED_BYTES.length,
    })
  })
})

test.afterAll(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
  })
  await deleteObjects([MIGRATED_KEY, POST_KEY])
})

test('rolls back a migrated partition, including rows written after the cutover', async () => {
  const migrate = runStorageOps(['migrate', '--partition', PARTITION, '--yes', '--s3-config', s3ConfigArgument()])
  expect(migrate.status, migrate.stdout).toBe(0)

  // A row written while the partition already served from object storage: its bytes live only in
  // the bucket, and a ledger row records the migrated path.
  await withDb(async (client) => {
    await putObject(POST_KEY, POST_BYTES)
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: POST_KEY,
      storageDriver: 's3',
      fileSize: POST_BYTES.length,
    })
    await client.query(
      `insert into attachment_quota_reservations (id, tenant_id, organization_id, reserved_bytes, actual_bytes, status, source, storage_driver, partition_code, storage_path, lease_token, upload_token_hash, expires_at, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, $3, $3, 'committed', 'storage_ops_test', 's3', $4, $5, gen_random_uuid(), null, null, now(), now())`,
      [REHEARSAL_TENANT, REHEARSAL_ORG, POST_BYTES.length, PARTITION, POST_KEY],
    )
  })

  const rollback = runStorageOps(['rollback', '--partition', PARTITION, '--yes'])
  expect(rollback.status, rollback.stdout).toBe(0)
  expect(rollback.stdout).toMatch(/rows=2/)
  expect(rollback.stdout).toMatch(/restoredFiles=1/)
  expect(rollback.stdout).toMatch(/alreadyPresent=1/)

  const rows = await withDb((client) =>
    client.query<{ storage_driver: string; storage_path: string }>(
      `select storage_driver, storage_path from attachments where partition_code = $1`,
      [PARTITION],
    ),
  )
  expect(rows.rows.map((row) => row.storage_driver)).toEqual(['local', 'local'])
  expect(rows.rows.map((row) => row.storage_path).sort()).toEqual([MIGRATED_CANONICAL, POST_CANONICAL].sort())

  // The partition row is restored verbatim from the manifest header (it had no config_json).
  const partition = await withDb((client) =>
    client.query<{ storage_driver: string; config_json: unknown }>(
      `select storage_driver, config_json from attachment_partitions where code = $1`,
      [PARTITION],
    ),
  )
  expect(partition.rows[0]?.storage_driver).toBe('local')
  expect(partition.rows[0]?.config_json).toBeNull()

  // The ledger row followed its attachment row back to the local driver and the stripped path.
  const ledger = await withDb((client) =>
    client.query<{ storage_driver: string; storage_path: string }>(
      `select storage_driver, storage_path from attachment_quota_reservations where partition_code = $1`,
      [PARTITION],
    ),
  )
  expect(ledger.rows).toHaveLength(1)
  expect(ledger.rows[0]?.storage_driver).toBe('local')
  expect(ledger.rows[0]?.storage_path).toBe(POST_CANONICAL)

  // Both files are on disk with the right bytes (the post-cutover one was re-materialized).
  expect(readPartitionFile(PARTITION, MIGRATED_CANONICAL)?.toString()).toBe(MIGRATED_BYTES.toString())
  expect(readPartitionFile(PARTITION, POST_CANONICAL)?.toString()).toBe(POST_BYTES.toString())
})

test('prune-local deletes only files whose bytes are in the bucket, and rollback re-materializes them', async () => {
  const migrate = runStorageOps(['migrate', '--partition', PARTITION, '--yes', '--s3-config', s3ConfigArgument()])
  expect(migrate.status, migrate.stdout).toBe(0)
  expect(partitionFileExists(PARTITION, MIGRATED_CANONICAL)).toBe(true)

  const dryRun = runStorageOps(['prune-local', '--partition', PARTITION])
  expect(dryRun.status, dryRun.stdout).toBe(0)
  expect(dryRun.stdout).toContain('would delete')
  expect(partitionFileExists(PARTITION, MIGRATED_CANONICAL)).toBe(true)

  const prune = runStorageOps(['prune-local', '--partition', PARTITION, '--yes'])
  expect(prune.status, prune.stdout).toBe(0)
  expect(prune.stdout).toMatch(/deleted=1 skipped=0/)
  expect(partitionFileExists(PARTITION, MIGRATED_CANONICAL)).toBe(false)

  const rollback = runStorageOps(['rollback', '--partition', PARTITION, '--yes'])
  expect(rollback.status, rollback.stdout).toBe(0)
  expect(rollback.stdout).toMatch(/restoredFiles=1/)
  expect(readPartitionFile(PARTITION, MIGRATED_CANONICAL)?.toString()).toBe(MIGRATED_BYTES.toString())
})
