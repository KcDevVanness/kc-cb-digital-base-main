import { expect, test } from '@playwright/test'
import {
  REHEARSAL_ORG,
  REHEARSAL_PARTITION,
  REHEARSAL_TENANT,
  cleanupFixture,
  deleteObjects,
  ensurePartition,
  extractJson,
  listObjects,
  runStorageOps,
  s3ConfigArgument,
  seedAttachmentRow,
  withDb,
  writePartitionFile,
} from './helpers'

/**
 * TEST-006 / TEST-009 / TEST-007 — the gates that keep a bad migration out: `audit` itemizes
 * blocking violations and exits non-zero, an in-flight reservation refuses the window, and a
 * multi-tenant partition writes each tenant's bytes under its own scope prefix.
 */

const PARTITION = REHEARSAL_PARTITION
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'

type AuditPayload = {
  audits: Array<{
    partition: string
    blocking: number
    informational: number
    violations: Array<{ severity: string; kind: string; path?: string }>
  }>
}

const canonical = (name: string, org = REHEARSAL_ORG, tenant = REHEARSAL_TENANT) => `org_${org}/tenant_${tenant}/${name}`

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
    await ensurePartition(client, PARTITION)
  })
  // Objects are not part of the DB fixture: clear them too, so a test that asserts an empty bucket
  // cannot inherit the previous test's keys.
  const existing = await listObjects(`${PARTITION}/`)
  await deleteObjects(existing.map((entry) => entry.key))
})

test.afterAll(async () => {
  await withDb(async (client) => {
    await cleanupFixture(client, PARTITION)
  })
  const objects = await listObjects(`${PARTITION}/`)
  await deleteObjects(objects.map((entry) => entry.key))
})

test('audit itemizes blocking violations and exits non-zero', async () => {
  await withDb(async (client) => {
    // A row whose file is missing, an absolute path, a legacy driver and two orphan files.
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: canonical('missing.txt'),
      fileSize: 10,
    })
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: '/absolute/path.txt',
      fileSize: 10,
    })
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: 'public/uploads/legacy.pdf',
      storageDriver: 'legacyPublic',
      fileSize: 10,
    })
    writePartitionFile(PARTITION, canonical('orphan.txt'), Buffer.from('orphan\n', 'utf8'))
    writePartitionFile(PARTITION, canonical('orphan-two.txt'), Buffer.from('orphan two\n', 'utf8'))
  })

  const result = runStorageOps(['audit', '--partition', PARTITION, '--json'])
  expect(result.status).toBe(1)
  const payload = extractJson<AuditPayload>(result.stdout)
  const audit = payload.audits.find((entry) => entry.partition === PARTITION)
  expect(audit).toBeDefined()
  const kinds = (audit?.violations ?? []).map((violation) => violation.kind)
  expect(kinds).toContain('missing-file')
  expect(kinds).toContain('path')
  expect(kinds).toContain('unsupported-driver')
  expect(kinds).toContain('orphan-file')
  expect((audit?.blocking ?? 0)).toBeGreaterThan(0)

  // `--orphans` is the acknowledgement step C-7 asks for: every orphan path, not the capped list.
  const withOrphans = runStorageOps(['audit', '--partition', PARTITION, '--orphans'])
  expect(withOrphans.status).toBe(1)
  expect(withOrphans.stdout).toContain(`orphan ${canonical('orphan.txt')}`)
  expect(withOrphans.stdout).toContain(`orphan ${canonical('orphan-two.txt')}`)
})

test('preflight repairs duplicate ledger rows instead of refusing the migration', async () => {
  await withDb(async (client) => {
    const path = canonical('duplicate-ledger.txt')
    writePartitionFile(PARTITION, path, Buffer.from('dup\n', 'utf8'))
    await seedAttachmentRow(client, { partitionCode: PARTITION, storagePath: path, fileSize: 4 })
    await client.query(
      `insert into attachment_quota_reservations (id, tenant_id, organization_id, reserved_bytes, actual_bytes, status, source, storage_driver, partition_code, storage_path, lease_token, upload_token_hash, expires_at, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 4, 4, 'committed', 'storage_ops_test', 'local', $3, $4, gen_random_uuid(), null, null, now(), now())`,
      [REHEARSAL_TENANT, REHEARSAL_ORG, PARTITION, path],
    )
  })

  const result = runStorageOps(['migrate', '--partition', PARTITION, '--yes', '--s3-config', s3ConfigArgument()])
  expect(result.status, result.stdout).toBe(0)
  expect(result.stdout).toMatch(/duplicateLedgerRowsRemoved=1/)

  const ledger = await withDb((client) =>
    client.query<{ count: string }>(
      `select count(*)::text as count from attachment_quota_reservations where partition_code = $1 and status = 'committed'`,
      [PARTITION],
    ),
  )
  expect(ledger.rows[0]?.count).toBe('0')
})

test('verify refuses while the partition is still on the local driver', async () => {
  await withDb(async (client) => {
    const path = canonical('verify-guard.txt')
    writePartitionFile(PARTITION, path, Buffer.from('guard\n', 'utf8'))
    await seedAttachmentRow(client, { partitionCode: PARTITION, storagePath: path, fileSize: 6 })
  })

  const result = runStorageOps(['verify', '--partition', PARTITION])
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('verify` checks a partition that already serves from object storage')
})

test('an in-flight quota reservation refuses the migration window', async () => {
  await withDb(async (client) => {
    const path = canonical('in-flight.txt')
    writePartitionFile(PARTITION, path, Buffer.from('in flight\n', 'utf8'))
    await seedAttachmentRow(client, { partitionCode: PARTITION, storagePath: path, fileSize: 10 })
    await client.query(
      `insert into attachment_quota_reservations (id, tenant_id, organization_id, reserved_bytes, actual_bytes, status, source, storage_driver, partition_code, storage_path, lease_token, upload_token_hash, expires_at, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 10, null, 'reserved', 'storage_ops_test', 'local', $3, $4, gen_random_uuid(), null, now() + interval '5 minutes', now(), now())`,
      [REHEARSAL_TENANT, REHEARSAL_ORG, PARTITION, path],
    )
  })

  const result = runStorageOps(['migrate', '--partition', PARTITION, '--yes', '--s3-config', s3ConfigArgument()])
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('blocking violation')

  const rows = await withDb((client) =>
    client.query<{ storage_driver: string }>(
      `select storage_driver from attachments where partition_code = $1`,
      [PARTITION],
    ),
  )
  expect(rows.rows.map((row) => row.storage_driver)).toEqual(['local'])
  expect(await listObjects(`${PARTITION}/`)).toHaveLength(0)
})

test('two tenants keep their bytes under their own scope prefix', async () => {
  const first = canonical('tenant-a.txt')
  const second = canonical('tenant-b.txt', OTHER_ORG, OTHER_TENANT)
  await withDb(async (client) => {
    writePartitionFile(PARTITION, first, Buffer.from('a\n', 'utf8'))
    writePartitionFile(PARTITION, second, Buffer.from('b\n', 'utf8'))
    await seedAttachmentRow(client, { partitionCode: PARTITION, storagePath: first, fileSize: 2 })
    await seedAttachmentRow(client, {
      partitionCode: PARTITION,
      storagePath: second,
      fileSize: 2,
      orgId: OTHER_ORG,
      tenantId: OTHER_TENANT,
    })
  })

  const result = runStorageOps(['migrate', '--partition', PARTITION, '--yes', '--s3-config', s3ConfigArgument()])
  expect(result.status, result.stdout).toBe(0)

  const objects = await listObjects(`${PARTITION}/`)
  const keys = objects.map((entry) => entry.key).sort()
  expect(keys).toEqual([`${PARTITION}/${first}`, `${PARTITION}/${second}`].sort())
  expect(keys[0]).toContain(`org_${REHEARSAL_ORG}/tenant_${REHEARSAL_TENANT}/`)
  expect(keys[1]).toContain(`org_${OTHER_ORG}/tenant_${OTHER_TENANT}/`)

  const rows = await withDb((client) =>
    client.query<{ organization_id: string; storage_path: string; storage_driver: string }>(
      `select organization_id, storage_path, storage_driver from attachments where partition_code = $1`,
      [PARTITION],
    ),
  )
  for (const row of rows.rows) {
    expect(row.storage_driver).toBe('s3')
    expect(row.storage_path).toContain(`org_${row.organization_id}/`)
  }
})
