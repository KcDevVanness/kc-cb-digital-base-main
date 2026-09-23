# `storage_ops` — attachment storage operations

Operator CLI for the local → object-storage migration of the installed `attachments` module.
Spec: [`.ai/specs/2026-09-23-local-to-s3-storage-migration.md`](../../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md) (Phase 1).
Ops guide: [`docs/deploy/storage.md`](../../../docs/deploy/storage.md).

## Surfaces

| Surface | What it is |
|---|---|
| `index.ts` | `ModuleInfo` (`requires: ['attachments']`) — the module is discoverable, nothing else is declared. |
| `cli.ts` | Five `ModuleCli` commands: `audit`, `migrate`, `verify`, `rollback`, `prune-local`. |
| `lib/paths.ts` | The canonical path contract (pure): canonicality checks, object keys, flip/rollback rewrites, hashing. |
| `lib/manifest.ts` | Append-only JSONL migration state at `storage/.storage-migration/<partition>.jsonl`. |
| `lib/context.ts` | Partition/scope/driver resolution — the only place that builds a driver. |
| `lib/audit.ts` | Read-only drift report and the pure quota-ledger repair plan. |
| `lib/migrate.ts` | preflight → copy → verify → flip, plus rollback and retention pruning. |

**No entity, no API route, no page, no ACL feature, no event, no worker.** The CLI is an operator
tool: it requires shell access to the environment (same precedent as the installed `attachments
delete` command) and never adds an HTTP surface that would need authorization.

## Exit contract

`ModuleCli.run` cannot return a code, so: **success returns normally (exit 0), every refusal throws
(exit 1)** — the dispatcher prints the message and exits non-zero. No `process.exit` call is used, so
container disposal and telemetry flush still run. `audit` throws after printing its report when it
found blocking violations (or informational ones under `--strict`).

## Commands

```bash
yarn mercato storage_ops audit        [--partition <code>] [--json] [--strict]
yarn mercato storage_ops migrate      --partition <code> [--yes] [--dry-run] [--concurrency N] \
                                      [--s3-config <json|@file>] [--sample N] [--all] [--manifest <path>]
yarn mercato storage_ops verify       --partition <code> [--sample N] [--all]
yarn mercato storage_ops rollback     --partition <code> --yes
yarn mercato storage_ops prune-local  --partition <code> [--older-than <days>] [--yes]

# package.json aliases
yarn storage:audit
yarn storage:migrate --partition privateAttachments --yes
```

`--s3-config` is the partition `config_json` payload the flip writes (default `{}`, meaning
"resolve bucket and credentials from the Integration Marketplace for each row's scope"). It accepts
inline JSON or `@path/to/file.json`. A partition-local credential source is
`{"bucket":"…","region":"…","endpoint":"…","forcePathStyle":true,"credentialsEnvPrefix":"MY_S3"}`
— the driver then reads `MY_S3_ACCESS_KEY_ID` / `MY_S3_SECRET_ACCESS_KEY` from the environment.

## Safety model

- **Two drivers at once.** While the partition still points at `local`, the tool reads bytes through
  the local driver and writes through an `s3` driver built from the *intended* partition
  configuration plus the same `integrationCredentialsService` the installed credential enhancer
  uses. Drivers are never hand-assembled without scope: the S3 driver's tenant assertions are inert
  unless the config carries `organizationId`/`tenantId` (constraint C-9).
- **Resolved-driver assertion.** `resolveForPartition` falls back to the local driver for an unknown
  key, so every stage asserts the resolved driver's `key` equals the partition's configured driver
  and refuses otherwise (constraint C-10 keeps the enable flag identical at build and runtime).
- **The flip is set-based.** `migrate` copies any straggler, asserts every live `local` row is
  verified, then rewrites exactly that id set in one transaction — with affected-row counts, the
  matching quota-ledger rows, and the partition row. A row that appears between copy and flip is
  either copied first or aborts the transaction; a count-only check would have flipped it.
- **Read-back instead of conditional put.** The provider answers `PreconditionFailed` when an object
  already exists, so resume reads the object back and skips only when length (and, for sampled rows,
  hash) match. A lost manifest degrades to a safe re-copy.
- **Fail closed.** Preflight refuses on any blocking audit violation, an in-flight reservation, a
  non-canonical path, a missing file, a driver mismatch, an unreachable bucket, or a partition that
  is already migrated. `prune-local` deletes only files whose object reads back with a matching
  length. Rollback refuses to overwrite a differing local file and aborts before rewriting anything
  when an object is unreadable.

## Manifest

`storage/.storage-migration/<partition>.jsonl` (override with `--manifest`), on the same persistent
volume as `storage/attachments`. The header record captures the partition row **verbatim** before
the flip — rollback restores that row rather than guessing `local` + `null`; the per-row records
carry `storage_path`, object key, size, sha256 and state.

## Verification

```bash
# unit (path contract, ledger plan)
npx jest --config jest.config.cjs src/modules/storage_ops

# integration (gated: needs a rehearsal S3 endpoint + the module flag in the RUNNER's env)
docker compose --profile storage-s3 up -d minio
export OM_ENABLE_STORAGE_S3=true                 # constraint C-10: the CLI child regenerates registries
export OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true
export PROBE_S3_ACCESS_KEY_ID=minioadmin PROBE_S3_SECRET_ACCESS_KEY=minioadmin
export STORAGE_OPS_TEST_S3_CONFIG='{"bucket":"om-storage-probe","region":"us-east-1","endpoint":"http://localhost:4666","forcePathStyle":true,"credentialsEnvPrefix":"PROBE_S3"}'
yarn test:integration src/modules/storage_ops
```

The specs (`__integration__/TC-STORAGE-00{1..4}.spec.ts`, gated by `__integration__/meta.ts`) drive
the real CLI against a scratch partition and assert objects, rows, the partition row, the ledger and
byte identity.

## Rollback

`yarn mercato storage_ops rollback --partition <code> --yes` materializes every object at its local
path (skipping byte-identical files, refusing differing ones), then strips the prefix from rows and
their ledger rows and restores the captured partition row in one transaction. After `prune-local`
the same command re-materializes the deleted local files from the bucket.
