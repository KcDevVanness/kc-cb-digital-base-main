/**
 * Read-only drift report for one partition (spec REQ-002).
 *
 * Blocking violations stop a migration; informational ones (orphan files, ledger rows that are not
 * duplicates of an attachment row) are counted and reported but never fail the command unless
 * `--strict` is passed. Nothing here writes.
 */
import { AttachmentPartition, AttachmentQuotaReservation } from '@open-mercato/core/modules/attachments/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { StorageOpsDeps } from './context'
import {
  absoluteLocalPath,
  listLocalFiles,
  loadPartition,
  localDriverOf,
  localRootOf,
  localFileExists,
  partitionRows,
} from './context'
import { PATH_PROBLEM_MESSAGES, canonicalPathProblem, withoutPartitionPrefix } from './paths'

export type AuditSeverity = 'blocking' | 'info'

export type AuditViolation = {
  severity: AuditSeverity
  kind: string
  id?: string
  path?: string
  detail: string
}

export type LedgerRowLike = {
  id: string
  status: string
  storageDriver: string
  storagePath: string
}

export type LedgerPlan = {
  duplicateCommittedIds: string[]
  orphanCommittedIds: string[]
  nonTerminalIds: string[]
}

export type PartitionAudit = {
  partition: string
  configuredDriver: string
  rows: number
  bytes: number
  localFiles: number
  orphanFiles: string[]
  ledger: LedgerPlan & { rows: number }
  violations: AuditViolation[]
  blocking: number
  informational: number
}

/** The composite the quota ledger is keyed by (`tenant`, `driver`, `path` in the installed schema). */
export function ledgerKey(storageDriver: string, storagePath: string): string {
  return `${storageDriver}\u0000${storagePath}`
}

export function planLedgerRepair(attachmentKeys: Set<string>, ledgerRows: LedgerRowLike[]): LedgerPlan {
  const plan: LedgerPlan = { duplicateCommittedIds: [], orphanCommittedIds: [], nonTerminalIds: [] }
  for (const row of ledgerRows) {
    if (row.status !== 'committed') {
      plan.nonTerminalIds.push(row.id)
      continue
    }
    if (attachmentKeys.has(ledgerKey(row.storageDriver, row.storagePath))) {
      plan.duplicateCommittedIds.push(row.id)
    } else {
      plan.orphanCommittedIds.push(row.id)
    }
  }
  return plan
}

export async function auditPartition(
  deps: StorageOpsDeps,
  partitionCode: string,
): Promise<PartitionAudit> {
  const partition = await loadPartition(deps.em, partitionCode)
  const configuredDriver = partition.storageDriver ?? 'local'
  const rows = await partitionRows(deps.em, partitionCode)
  const localDriver = localDriverOf(deps.factory)
  const violations: AuditViolation[] = []
  const rowPaths = new Set<string>()
  let bytes = 0

  for (const row of rows) {
    bytes += row.fileSize ?? 0
    const problem = canonicalPathProblem(row.storagePath, partitionCode)
    if (row.storageDriver === 'local') {
      if (problem) {
        violations.push({
          severity: 'blocking',
          kind: 'path',
          id: row.id,
          path: row.storagePath,
          detail: `${PATH_PROBLEM_MESSAGES[problem]} — the flip rewrite (\`partition_code || '/' || storage_path\`) is only safe for canonical paths`,
        })
        continue
      }
      rowPaths.add(row.storagePath)
    } else if (row.storageDriver === 's3') {
      // A migrated row carries the object key: `<partition>/<canonical path>`. The local copy (if it
      // is still retained for rollback) sits at the stripped path, which is what orphan detection
      // must compare against.
      const stripped = withoutPartitionPrefix(partitionCode, row.storagePath)
      const strippedProblem =
        stripped === row.storagePath ? 'missing-scope-segments' : canonicalPathProblem(stripped, partitionCode)
      if (strippedProblem) {
        violations.push({
          severity: 'blocking',
          kind: 'path',
          id: row.id,
          path: row.storagePath,
          detail: `a migrated row's storage_path must be \`${partitionCode}/<canonical path>\`; ${PATH_PROBLEM_MESSAGES[strippedProblem]}`,
        })
        continue
      }
      rowPaths.add(stripped)
    } else {
      violations.push({
        severity: 'blocking',
        kind: 'unsupported-driver',
        id: row.id,
        path: row.storagePath,
        detail: `row storage_driver="${row.storageDriver}" is neither "local" nor "s3"; after a flip it resolves through the partition driver and would 404`,
      })
      continue
    }
    if (row.storageDriver !== configuredDriver) {
      violations.push({
        severity: 'blocking',
        kind: 'driver-mismatch',
        id: row.id,
        path: row.storagePath,
        detail: `row storage_driver="${row.storageDriver}" differs from the partition's "${configuredDriver}"; the read path resolves by partition, so this row would be read by the wrong driver`,
      })
    }
    const localPath = row.storageDriver === 's3' ? withoutPartitionPrefix(partitionCode, row.storagePath) : row.storagePath
    const filePath = await absoluteLocalPath(localDriver, partitionCode, localPath)
    const exists = await localFileExists(filePath)
    if (!exists && configuredDriver === 'local') {
      violations.push({
        severity: 'blocking',
        kind: 'missing-file',
        id: row.id,
        path: row.storagePath,
        detail: `no file at ${filePath} — the bytes this row points at cannot be copied`,
      })
    }
    if (!exists && configuredDriver !== 'local') {
      violations.push({
        severity: 'info',
        kind: 'local-file-absent',
        id: row.id,
        path: row.storagePath,
        detail: `the local copy is gone (already pruned or never on this host): ${filePath}`,
      })
    }
  }

  const localFiles = await listLocalFiles(localRootOf(partitionCode))
  const orphanFiles = localFiles.filter((relative) => !rowPaths.has(relative))

  const ledgerRows = await deps.em.find(AttachmentQuotaReservation, { partitionCode })
  const attachmentKeys = new Set(
    rows
      .filter((row) => canonicalPathProblem(row.storagePath, partitionCode) === null)
      .map((row) => ledgerKey(row.storageDriver, row.storagePath)),
  )
  const ledgerPlan = planLedgerRepair(
    attachmentKeys,
    ledgerRows.map((row) => ({
      id: row.id,
      status: row.status,
      storageDriver: row.storageDriver,
      storagePath: row.storagePath,
    })),
  )

  if (ledgerPlan.duplicateCommittedIds.length > 0) {
    violations.push({
      severity: 'blocking',
      kind: 'ledger-duplicate',
      detail:
        `${ledgerPlan.duplicateCommittedIds.length} committed quota-ledger row(s) duplicate an attachment row and are counted twice in ` +
        'tenant usage; `migrate` repairs them in preflight (the installed core never cleans them up on its own)',
    })
  }
  if (ledgerPlan.nonTerminalIds.length > 0) {
    violations.push({
      severity: 'blocking',
      kind: 'ledger-in-flight',
      detail:
        `${ledgerPlan.nonTerminalIds.length} reservation(s) are still in flight for this partition; their recovery jobs resolve the ` +
        'partition driver after a flip and would violate the S3 key contract — drain or let them expire first',
    })
  }
  if (ledgerPlan.orphanCommittedIds.length > 0) {
    violations.push({
      severity: 'info',
      kind: 'ledger-orphan',
      detail: `${ledgerPlan.orphanCommittedIds.length} committed ledger row(s) have no matching attachment row (they still count toward usage)`,
    })
  }
  if (orphanFiles.length > 0) {
    violations.push({
      severity: 'info',
      kind: 'orphan-file',
      detail: `${orphanFiles.length} file(s) under ${localRootOf(partitionCode)} have no referencing attachment row and are never copied`,
    })
  }

  return {
    partition: partitionCode,
    configuredDriver,
    rows: rows.length,
    bytes,
    localFiles: localFiles.length,
    orphanFiles,
    ledger: { ...ledgerPlan, rows: ledgerRows.length },
    violations,
    blocking: violations.filter((entry) => entry.severity === 'blocking').length,
    informational: violations.filter((entry) => entry.severity === 'info').length,
  }
}

export async function auditAllPartitions(
  em: EntityManager,
  deps: StorageOpsDeps,
): Promise<PartitionAudit[]> {
  // The partition table is the only record the tool reads unscoped, like the driver factory does.
  const partitions = await em.find(AttachmentPartition, {}, { orderBy: { code: 'ASC' } })
  const audits: PartitionAudit[] = []
  for (const partition of partitions) audits.push(await auditPartition(deps, partition.code))
  return audits
}

export function auditExitCode(audits: PartitionAudit[], strict: boolean): number {
  const blocking = audits.reduce((total, audit) => total + audit.blocking, 0)
  if (blocking > 0) return 1
  if (strict) {
    const informational = audits.reduce((total, audit) => total + audit.informational, 0)
    if (informational > 0) return 1
  }
  return 0
}

export function renderAudit(audits: PartitionAudit[], options: { orphans?: boolean } = {}): string {
  const lines: string[] = []
  for (const audit of audits) {
    lines.push(
      `partition ${audit.partition}: driver=${audit.configuredDriver} rows=${audit.rows} bytes=${audit.bytes} localFiles=${audit.localFiles} ` +
        `blocking=${audit.blocking} info=${audit.informational} orphans=${audit.orphanFiles.length} ledger(rows=${audit.ledger.rows}, duplicates=${audit.ledger.duplicateCommittedIds.length}, inFlight=${audit.ledger.nonTerminalIds.length}, orphanCommitted=${audit.ledger.orphanCommittedIds.length})`,
    )
    for (const violation of audit.violations) {
      const where = violation.path ? ` ${violation.path}` : ''
      const id = violation.id ? ` [${violation.id}]` : ''
      lines.push(`  ${violation.severity === 'blocking' ? '✖' : '·'} ${violation.kind}${id}${where} — ${violation.detail}`)
    }
    if (audit.orphanFiles.length > 0) {
      // `--orphans` lists every path — that is the acknowledgement step C-7 asks for before a window.
      const shown = options.orphans ? audit.orphanFiles : audit.orphanFiles.slice(0, 10)
      for (const orphan of shown) lines.push(`  · orphan ${orphan}`)
      const hidden = audit.orphanFiles.length - shown.length
      if (hidden > 0) lines.push(`  · … ${hidden} more orphan file(s) — rerun with --orphans to list them all`)
    }
  }
  return lines.join('\n')
}
