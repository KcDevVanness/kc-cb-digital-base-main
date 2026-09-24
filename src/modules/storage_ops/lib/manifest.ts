/**
 * Append-only migration state for one partition (spec: `.mercato` is gitignored and not on the
 * persistent volume, so the manifest lives under `storage/.storage-migration/`).
 *
 * The file is JSONL: a header record captures the partition row **verbatim** before the flip (so
 * rollback can restore it instead of guessing), then one record per attachment row. Re-running a
 * stage never rewrites history — later records for the same row supersede earlier ones on load.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type MigrationManifestRow = {
  type: 'row'
  id: string
  /** The canonical (pre-flip) stored path. */
  storagePath: string
  /** The object key the bytes were written to. */
  key: string
  size: number
  sha256: string
  state: 'copied' | 'verified'
  updatedAt: string
}

export type CapturedPartitionRow = {
  code: string
  storageDriver: string
  configJson: Record<string, unknown> | null
  isPublic: boolean
  requiresOcr: boolean
  ocrModel: string | null
  tenantId: string | null
  organizationId: string | null
}

export type MigrationManifestHeader = {
  type: 'header'
  version: 1
  partition: string
  /** The partition row exactly as it was before the flip. */
  partitionRow: CapturedPartitionRow
  /** The `config_json` payload the flip intends to write. */
  targetConfigJson: Record<string, unknown>
  createdAt: string
}

export type MigrationManifestRecord = MigrationManifestHeader | MigrationManifestRow

export function defaultManifestPath(partitionCode: string): string {
  return path.join(process.cwd(), 'storage', '.storage-migration', `${partitionCode}.jsonl`)
}

export class MigrationManifest {
  private constructor(
    readonly filePath: string,
    private readonly headerRecord: MigrationManifestHeader | null,
    private readonly rowRecords: Map<string, MigrationManifestRow>,
  ) {}

  static async load(filePath: string): Promise<MigrationManifest> {
    let raw = ''
    try {
      raw = await readFile(filePath, 'utf8')
    } catch {
      return new MigrationManifest(filePath, null, new Map())
    }
    let header: MigrationManifestHeader | null = null
    const rows = new Map<string, MigrationManifestRow>()
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let record: MigrationManifestRecord
      try {
        record = JSON.parse(trimmed) as MigrationManifestRecord
      } catch {
        throw new Error(`[internal] migration manifest is corrupt at ${filePath}: unparsable line`)
      }
      if (record.type === 'header') header = record
      else if (record.type === 'row') rows.set(record.id, record)
    }
    return new MigrationManifest(filePath, header, rows)
  }

  private async append(record: MigrationManifestRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
  }

  get header(): MigrationManifestHeader | null {
    return this.headerRecord
  }

  get rows(): Map<string, MigrationManifestRow> {
    return new Map(this.rowRecords)
  }

  row(id: string): MigrationManifestRow | undefined {
    return this.rowRecords.get(id)
  }

  /** Ids whose bytes were copied *and* read back successfully. */
  verifiedIds(): string[] {
    return [...this.rowRecords.values()].filter((row) => row.state === 'verified').map((row) => row.id)
  }

  async writeHeader(header: MigrationManifestHeader): Promise<void> {
    await this.append(header)
  }

  async recordRow(row: MigrationManifestRow): Promise<void> {
    this.rowRecords.set(row.id, row)
    await this.append(row)
  }
}
