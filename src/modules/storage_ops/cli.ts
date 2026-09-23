import { readFile } from 'node:fs/promises'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { auditAllPartitions, auditExitCode, auditPartition, renderAudit } from './lib/audit'
import type { StorageOpsDeps, StorageScope } from './lib/context'
import { loadPartition, partitionDriverOf, scopedDriverResolver } from './lib/context'
import type { MigrateOptions } from './lib/migrate'
import { manifestPathFor, runMigrate, runPruneLocal, runRollback, runVerify } from './lib/migrate'

/**
 * Operator CLI for the local → object-storage migration (spec:
 * `.ai/specs/2026-09-23-local-to-s3-storage-migration.md`, Phase 1).
 *
 * Exit contract: a command returns normally for success (exit 0) and **throws** for every refusal
 * (exit 1) — `ModuleCli.run` cannot return a code and the dispatcher turns a throw into exit 1.
 * No `process.exit` call, so container disposal and telemetry flush still run.
 */

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part || !part.startsWith('--')) continue
    const [rawKey, rawValue] = part.replace(/^--/, '').split('=')
    const key = rawKey.trim()
    if (!key) continue
    if (rawValue !== undefined) {
      args[key] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function requirePartition(args: ParsedArgs): string {
  const value = args.partition
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('storage_ops: --partition <code> is required')
  }
  return value.trim()
}

function numberArg(args: ParsedArgs, key: string, fallback: number): number {
  const value = args[key]
  if (typeof value !== 'string') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function readS3Config(args: ParsedArgs): Promise<Record<string, unknown>> {
  const value = args['s3-config']
  if (typeof value !== 'string' || value.trim().length === 0) return {}
  const raw = value.startsWith('@') ? await readFileText(value.slice(1)) : value
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`storage_ops: --s3-config is not valid JSON: ${raw.slice(0, 120)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('storage_ops: --s3-config must be a JSON object (for example {"bucket":"my-bucket"})')
  }
  return parsed as Record<string, unknown>
}

async function readFileText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

async function buildDeps(): Promise<StorageOpsDeps> {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const factory = container.resolve<StorageDriverFactory>('storageDriverFactory')
  const resolveIntegrationCredentials = async (scope: StorageScope) => {
    try {
      const service = container.resolve<{
        resolve: (integrationId: string, scope: StorageScope) => Promise<Record<string, unknown> | null>
      }>('integrationCredentialsService')
      return await service.resolve('storage_s3', scope)
    } catch {
      // `integrations` disabled or no credentials configured: the partition config / env prefix wins.
      return null
    }
  }
  return { em, factory, resolveIntegrationCredentials }
}

async function optionsFrom(args: ParsedArgs, partition: string): Promise<MigrateOptions> {
  return {
    partition,
    concurrency: numberArg(args, 'concurrency', 4),
    dryRun: args['dry-run'] === true,
    yes: args.yes === true,
    s3Config: await readS3Config(args),
    manifestPath: typeof args.manifest === 'string' ? args.manifest : undefined,
    sample: numberArg(args, 'sample', 10),
    all: args.all === true,
    olderThanDays: typeof args['older-than'] === 'string' ? Number(args['older-than']) : undefined,
  }
}

const auditCommand: ModuleCli = {
  command: 'audit',
  async run(rest) {
    const args = parseArgs(rest)
    const deps = await buildDeps()
    const partition = typeof args.partition === 'string' ? args.partition.trim() : ''
    const audits = partition ? [await auditPartition(deps, partition)] : await auditAllPartitions(deps.em, deps)
    const strict = args.strict === true
    if (args.json === true) {
      console.log(JSON.stringify({ audits }, null, 2))
    } else {
      console.log(renderAudit(audits))
    }
    const exitCode = auditExitCode(audits, strict)
    if (exitCode !== 0) {
      const blocking = audits.reduce((total, audit) => total + audit.blocking, 0)
      throw new Error(
        blocking > 0
          ? `storage_ops audit: ${blocking} blocking violation(s) — see the report above`
          : 'storage_ops audit: informational violations only, but --strict was passed',
      )
    }
    console.log('audit: clean (no blocking violations)')
  },
}

const migrateCommand: ModuleCli = {
  command: 'migrate',
  async run(rest) {
    const args = parseArgs(rest)
    const partition = requirePartition(args)
    const options = await optionsFrom(args, partition)
    const deps = await buildDeps()
    const result = await runMigrate(deps, options)
    if (options.dryRun) {
      console.log(`migrate: dry-run complete for partition "${partition}"`)
      return
    }
    console.log(
      `migrate: partition "${partition}" now serves from object storage ` +
        `(${result.flip?.rows ?? 0} row(s)); local files are retained for rollback — see docs/deploy/storage.md`,
    )
  },
}

const verifyCommand: ModuleCli = {
  command: 'verify',
  async run(rest) {
    const args = parseArgs(rest)
    const partition = requirePartition(args)
    const options = await optionsFrom(args, partition)
    const deps = await buildDeps()
    const partitionRow = await loadPartition(deps.em, partition)
    const summary = await runVerify(
      deps,
      options,
      scopedDriverResolver((scope) => partitionDriverOf(deps, partitionRow, scope)),
    )
    console.log(
      `verify: partition=${partition} checked=${summary.checked} hashed=${summary.hashed} ` +
        `mismatches=${summary.mismatches.length} manifest=${manifestPathFor(options)}`,
    )
    if (summary.mismatches.length > 0) {
      throw new Error(`storage_ops verify: mismatches found:\n  ${summary.mismatches.join('\n  ')}`)
    }
  },
}

const rollbackCommand: ModuleCli = {
  command: 'rollback',
  async run(rest) {
    const args = parseArgs(rest)
    const partition = requirePartition(args)
    const options = await optionsFrom(args, partition)
    if (!options.yes) throw new Error('storage_ops: rollback rewrites rows and files; pass --yes to confirm')
    const deps = await buildDeps()
    const summary = await runRollback(deps, options)
    console.log(
      `rollback: partition=${partition} rows=${summary.rows} ledgerRows=${summary.ledgerRows} ` +
        `restoredFiles=${summary.restored} alreadyPresent=${summary.skipped}`,
    )
  },
}

const pruneLocalCommand: ModuleCli = {
  command: 'prune-local',
  async run(rest) {
    const args = parseArgs(rest)
    const partition = requirePartition(args)
    const options = await optionsFrom(args, partition)
    const deps = await buildDeps()
    const summary = await runPruneLocal(deps, options)
    console.log(
      `prune-local: partition=${partition} deleted=${summary.deleted} skipped=${summary.skipped}` +
        (options.dryRun || !options.yes ? ' (dry-run — pass --yes to delete)' : ''),
    )
  },
}

const commands: ModuleCli[] = [auditCommand, migrateCommand, verifyCommand, rollbackCommand, pruneLocalCommand]

export default commands
