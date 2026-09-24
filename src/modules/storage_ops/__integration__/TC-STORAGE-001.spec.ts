import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  REHEARSAL_ORG,
  REHEARSAL_PARTITION,
  REHEARSAL_TENANT,
  cleanupFixture,
  deleteObjects,
  ensurePartition,
  listObjects,
  partitionFileExists,
  readObject,
  readPartitionFile,
  runStorageOps,
  s3ConfigArgument,
  seedAttachmentRow,
  withDb,
  writePartitionFile,
} from './helpers'

/**
 * TEST-002 / TEST-011 — the happy path of `storage_ops migrate`, driven through the real CLI:
 * preflight probes the target driver with a scoped key, the bytes land under
 * `[pathPrefix]<partition>/org_<orgId>/tenant_<tenantId>/…`, the flip rewrites rows and the
 * partition row, and the object bytes equal the local file.
 */

const PARTITION = REHEARSAL_PARTITION
const FIXTURES = [
  { name: '1790144700001_alpha.txt', bytes: Buffer.from('rehearsal alpha\n', 'utf8') },
  { name: '1790144700002_big.bin', bytes: randomBytes(1_200_000) },
  { name: '1790144700003_gamma.json', bytes: Buffer.from('{"kind":"rehearsal"}\n', 'utf8') },
]

const canonical = (name: string) => `org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/${name}`
const objectKey = (name: string) => `${PARTITION}/${canonical(name)}`

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
    await ensurePartition(client, PARTITION)
    for (const fixture of FIXTURES) {
      writePartitionFile(PARTITION, canonical(fixture.name), fixture.bytes)
      await seedAttachmentRow(client, {
        partitionCode: PARTITION,
        storagePath: canonical(fixture.name),
        fileSize: fixture.bytes.length,
      })
    }
  })
})

test.afterAll(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
  })
  await deleteObjects(FIXTURES.map((fixture) => objectKey(fixture.name)))
})

test('migrates a local partition to object storage and keeps the bytes identical', async () => {
  const result = runStorageOps([
    'migrate',
    '--partition',
    PARTITION,
    '--yes',
    '--sample',
    '3',
    '--s3-config',
    s3ConfigArgument(),
  ])

  expect(result.status, result.stdout).toBe(0)
  expect(result.stdout).toContain('probe:')
  expect(result.stdout).toContain('roundTrip=true')
  expect(result.stdout).toContain(`probe: key=${PARTITION}/org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/`)
  expect(result.stdout).toMatch(/copy: copied=3 skipped=0/)
  expect(result.stdout).toMatch(/verify: checked=3 hashed=3 mismatches=0/)
  expect(result.stdout).toMatch(/flip: rows=3 ledgerRows=0 stragglers=0 orphanObjects=0/)

  const rows = await withDb((client) =>
    client.query<{ storage_driver: string; storage_path: string }>(
      `select storage_driver, storage_path from attachments where partition_code = $1 order by storage_path`,
      [PARTITION],
    ),
  )
  expect(rows.rows).toHaveLength(3)
  for (const row of rows.rows) {
    expect(row.storage_driver).toBe('s3')
    expect(row.storage_path.startsWith(`${PARTITION}/org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/`)).toBe(true)
  }

  const partition = await withDb((client) =>
    client.query<{ storage_driver: string; config_json: Record<string, unknown> | null }>(
      `select storage_driver, config_json from attachment_partitions where code = $1`,
      [PARTITION],
    ),
  )
  expect(partition.rows[0]?.storage_driver).toBe('s3')
  expect(partition.rows[0]?.config_json).toMatchObject({ bucket: expect.any(String) })

  // The local copies are retained until prune, so rollback stays cheap.
  for (const fixture of FIXTURES) expect(partitionFileExists(PARTITION, canonical(fixture.name))).toBe(true)

  const objects = await listObjects(`${PARTITION}/`)
  expect(objects).toHaveLength(3)
  const bigName = '1790144700002_big.bin'
  const objectBytes = await readObject(objectKey(bigName))
  const localBytes = readPartitionFile(PARTITION, canonical(bigName)) ?? Buffer.alloc(0)
  expect(createHash('sha256').update(objectBytes).digest('hex')).toBe(
    createHash('sha256').update(localBytes).digest('hex'),
  )
})
