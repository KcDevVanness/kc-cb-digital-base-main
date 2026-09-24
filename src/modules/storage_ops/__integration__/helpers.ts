/**
 * Shared fixture plumbing for the storage_ops integration specs.
 *
 * The specs exercise the *operator* surface: a scratch partition, rows seeded directly in the
 * database, files written into the partition root, and the real CLI (`yarn mercato storage_ops …`)
 * run as a child process against the same database and the rehearsal S3 endpoint.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Client } from 'pg'

export const PROJECT_ROOT = process.cwd()
export const REHEARSAL_ORG = '11111111-1111-4111-8111-111111111111'
export const REHEARSAL_TENANT = '22222222-2222-4222-8222-222222222222'
export const REHEARSAL_PARTITION = 'storageOpsRehearsal'

export type S3TestConfig = Record<string, unknown>

export function s3TestConfig(): S3TestConfig {
  const raw = process.env.STORAGE_OPS_TEST_S3_CONFIG
  if (!raw) throw new Error('STORAGE_OPS_TEST_S3_CONFIG is not set — this spec is gated on it (see meta.ts)')
  return JSON.parse(raw) as S3TestConfig
}

export function s3ConfigArgument(): string {
  return JSON.stringify(s3TestConfig())
}

export function s3Client(): S3Client {
  const config = s3TestConfig()
  const prefix = typeof config.credentialsEnvPrefix === 'string' ? config.credentialsEnvPrefix : null
  const accessKeyId = prefix ? process.env[`${prefix}_ACCESS_KEY_ID`] : (config.accessKeyId as string | undefined)
  const secretAccessKey = prefix
    ? process.env[`${prefix}_SECRET_ACCESS_KEY`]
    : (config.secretAccessKey as string | undefined)
  return new S3Client({
    region: (config.region as string) ?? 'us-east-1',
    endpoint: config.endpoint as string,
    forcePathStyle: Boolean(config.forcePathStyle),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  })
}

export function s3Bucket(): string {
  const bucket = s3TestConfig().bucket
  if (typeof bucket !== 'string' || bucket.length === 0) {
    throw new Error('STORAGE_OPS_TEST_S3_CONFIG must carry a "bucket"')
  }
  return bucket
}

export async function listObjects(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const listing = await s3Client().send(new ListObjectsV2Command({ Bucket: s3Bucket(), Prefix: prefix }))
  return (listing.Contents ?? []).map((entry) => ({ key: entry.Key ?? '', size: entry.Size ?? 0 }))
}

export async function readObject(key: string): Promise<Buffer> {
  const response = await s3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
  const chunks: Buffer[] = []
  for await (const chunk of response.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  await s3Client().send(new PutObjectCommand({ Bucket: s3Bucket(), Key: key, Body: bytes }))
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await s3Client().send(
    new DeleteObjectsCommand({ Bucket: s3Bucket(), Delete: { Objects: keys.map((Key) => ({ Key })) } }),
  )
}

/**
 * The slice of `pg`'s client the fixtures use. Typing it structurally avoids the
 * `Cannot use namespace 'Client' as a type` failure that `@types/pg` produces when its class export
 * is referenced in a type position, and keeps the specs' `query<Row>()` type arguments working.
 */
export type PgQueryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>
}

export async function withDb<T>(run: (client: PgQueryable) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set — the integration harness provides it')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await run(client as unknown as PgQueryable)
  } finally {
    await client.end()
  }
}

export async function ensurePartition(
  client: PgQueryable,
  code: string,
  storageDriver = 'local',
  configJson: Record<string, unknown> | null = null,
): Promise<void> {
  await client.query(
    `insert into attachment_partitions (id, code, title, description, storage_driver, config_json, is_public, requires_ocr, ocr_model, created_at, updated_at)
     select gen_random_uuid(), $1, $1, 'storage_ops integration fixture', $2, $3::jsonb, false, false, null, now(), now()
     where not exists (select 1 from attachment_partitions where code = $1)`,
    [code, storageDriver, configJson ? JSON.stringify(configJson) : null],
  )
}

export async function setPartitionDriver(client: PgQueryable, code: string, driver: string): Promise<void> {
  await client.query(`update attachment_partitions set storage_driver = $2, updated_at = now() where code = $1`, [
    code,
    driver,
  ])
}

export type SeededRow = {
  id: string
  storagePath: string
  fileSize: number
}

export async function seedAttachmentRow(
  client: PgQueryable,
  input: {
    partitionCode: string
    storagePath: string
    fileName?: string
    storageDriver?: string
    orgId?: string
    tenantId?: string
    fileSize?: number
  },
): Promise<SeededRow> {
  const fileName = input.fileName ?? path.basename(input.storagePath)
  const fileSize = input.fileSize ?? 0
  const result = await client.query<{ id: string }>(
    `insert into attachments (id, entity_id, record_id, organization_id, tenant_id, partition_code, file_name, mime_type, file_size, storage_driver, storage_path, storage_metadata, url, content, created_at)
     values (gen_random_uuid(), 'storage_ops:rehearsal', 'rehearsal', $1, $2, $3, $4, 'application/octet-stream', $5, $6, $7, null, '/api/attachments/file/rehearsal', null, now())
     returning id`,
    [
      input.orgId ?? REHEARSAL_ORG,
      input.tenantId ?? REHEARSAL_TENANT,
      input.partitionCode,
      fileName,
      fileSize,
      input.storageDriver ?? 'local',
      input.storagePath,
    ],
  )
  return { id: result.rows[0].id, storagePath: input.storagePath, fileSize }
}

export function partitionRoot(partitionCode: string): string {
  return path.join(PROJECT_ROOT, 'storage', 'attachments', partitionCode)
}

export function writePartitionFile(partitionCode: string, storagePath: string, bytes: Buffer): void {
  const absolute = path.join(partitionRoot(partitionCode), storagePath)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
}

export function readPartitionFile(partitionCode: string, storagePath: string): Buffer | null {
  const absolute = path.join(partitionRoot(partitionCode), storagePath)
  return existsSync(absolute) ? readFileSync(absolute) : null
}

export function partitionFileExists(partitionCode: string, storagePath: string): boolean {
  return existsSync(path.join(partitionRoot(partitionCode), storagePath))
}

export type CliResult = { stdout: string; status: number }

/** The CLI prints banners and log lines before its payload; the payload is the last `{`-starting line. */
export function extractJson<T>(stdout: string): T {
  const start = stdout.lastIndexOf('\n{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`no JSON payload in CLI output:\n${stdout.slice(-800)}`)
  try {
    return JSON.parse(stdout.slice(start + 1, end + 1)) as T
  } catch {
    throw new Error(`no parsable JSON payload in CLI output:\n${stdout.slice(-800)}`)
  }
}

export function runStorageOps(args: string[]): CliResult {
  try {
    const stdout = execFileSync('yarn', ['mercato', 'storage_ops', ...args], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
    })
    return { stdout, status: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      status: failure.status ?? 1,
    }
  }
}

export async function cleanupFixture(client: PgQueryable, code: string): Promise<void> {
  await client.query(`delete from attachments where partition_code = $1`, [code])
  await client.query(`delete from attachment_quota_reservations where partition_code = $1`, [code])
  await client.query(`delete from attachment_partitions where code = $1`, [code])
  rmSync(partitionRoot(code), { recursive: true, force: true })
  rmSync(path.join(PROJECT_ROOT, 'storage', '.storage-migration', `${code}.jsonl`), { force: true })
}
