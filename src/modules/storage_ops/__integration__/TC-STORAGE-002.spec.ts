import { expect, test } from '@playwright/test'
import {
  REHEARSAL_ORG,
  REHEARSAL_PARTITION,
  REHEARSAL_TENANT,
  cleanupFixture,
  deleteObjects,
  ensurePartition,
  listObjects,
  runStorageOps,
  s3ConfigArgument,
  seedAttachmentRow,
  withDb,
  writePartitionFile,
} from './helpers'

/**
 * TEST-003 — resume and idempotency. A run whose objects already exist must read them back and
 * skip, never re-store (the provider answers `PreconditionFailed` on a conditional put), and a
 * completed partition must refuse a second `migrate` instead of rewriting anything.
 */

const PARTITION = REHEARSAL_PARTITION
const NAME = '1790144700010_resume.txt'
const CANONICAL = `org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/${NAME}`
const KEY = `${PARTITION}/${CANONICAL}`
const BYTES = Buffer.from('resume fixture\n', 'utf8')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
    await ensurePartition(client, PARTITION)
    writePartitionFile(PARTITION, CANONICAL, BYTES)
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: CANONICAL,
      fileSize: BYTES.length,
    })
  })
})

test.afterAll(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
  })
  await deleteObjects([KEY])
})

test('re-running against existing objects skips the copy and a finished partition refuses', async () => {
  const first = runStorageOps([
    'migrate',
    '--partition',
    PARTITION,
    '--yes',
    '--s3-config',
    s3ConfigArgument(),
  ])
  expect(first.status, first.stdout).toBe(0)
  expect(first.stdout).toMatch(/copy: copied=1 skipped=0/)
  const objectsAfterFirst = await listObjects(`${PARTITION}/`)
  expect(objectsAfterFirst).toHaveLength(1)

  // Roll back, then migrate again: the object is already in the bucket, so the resume path must
  // read it back and skip instead of hitting the provider's conditional put.
  const rollback = runStorageOps(['rollback', '--partition', PARTITION, '--yes'])
  expect(rollback.status, rollback.stdout).toBe(0)

  const second = runStorageOps([
    'migrate',
    '--partition',
    PARTITION,
    '--yes',
    '--s3-config',
    s3ConfigArgument(),
  ])
  expect(second.status, second.stdout).toBe(0)
  expect(second.stdout).toMatch(/copy: copied=0 skipped=1/)
  expect(second.stdout).not.toContain('PreconditionFailed')
  expect(await listObjects(`${PARTITION}/`)).toHaveLength(1)

  // A third run on the finished partition refuses without touching anything.
  const third = runStorageOps(['migrate', '--partition', PARTITION, '--yes', '--s3-config', s3ConfigArgument()])
  expect(third.status).not.toBe(0)
  expect(third.stdout).toContain('already on driver')

  const rows = await withDb((client) =>
    client.query<{ storage_driver: string; storage_path: string }>(
      `select storage_driver, storage_path from attachments where partition_code = $1`,
      [PARTITION],
    ),
  )
  expect(rows.rows).toHaveLength(1)
  expect(rows.rows[0]?.storage_driver).toBe('s3')
  expect(rows.rows[0]?.storage_path).toBe(KEY)
})
