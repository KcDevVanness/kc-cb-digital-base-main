# Local attachment storage → S3-compatible object storage: pre-migration constraints and one-command migration

**Date**: 2026-09-23
**Status**: Draft — **Phase 0 and Phase 1 shipped 2026-09-23** (`storage_s3` installed, wired, credentialed-by-config and probed; `storage_ops` shipped with `audit` / `migrate` / `verify` / `rollback` / `prune-local`, rehearsed end-to-end against MinIO and covered by unit + integration tests; both live partitions still `storage_driver='local'`); Phase 2 (the production cutover) awaits the go-ahead

> Owner intent (2026-09-23): keep uploading to the local driver now, move to cloud object storage later, and make that later move as cheap as possible. Two-handed preparation: everything installable, configurable, constrainable or rehearsable **before** the cutover is done now; the cutover itself becomes one reversible command.
>
> Evidence base (read-only, no application code changed): `@open-mercato/core@0.8.0` attachments driver/partition/quota source, the published `@open-mercato/storage-s3@0.8.0` tarball (installed in Phase 0, after which the probe re-verified its facts in-tree), the live dev database (`kc_cb_base_min`), and `storage/attachments/` on disk.
>
> Review: an independent fresh-context review of the previous revision produced 12 findings (1 Critical, 5 High, 5 Medium, 1 Low). All are resolved in this revision; the substantive changes are the flip's set-equality assertion, the C-1…C-8 enumeration, contract-honest copy/verify (the installed `StorageDriver` seam has no stat/HEAD/list), the captured-and-restored partition row, ledger rules in both directions, the audit exit contract, and the CLI exit-code mechanism.
>
> **As shipped, Phase 0 (2026-09-23).** `@open-mercato/storage-s3@0.8.0` is installed and pinned; `src/modules.ts` registers `storage_s3` behind `OM_ENABLE_STORAGE_S3` (set to `true` in `.env` and `.env.example`); the generated registries, DI registrar, routes, worker (`storage-s3-quota-recovery`) and CLI are live; both partitions still read `storage_driver='local'`; an upload through `/api/attachments` still lands at `storage/attachments/privateAttachments/org_*/tenant_*/…` and downloads byte-identically. Three deltas against the plan as written: (1) the rehearsal endpoint is **MinIO**, not LocalStack — `localstack/localstack:latest` now refuses to start without a paid `LOCALSTACK_AUTH_TOKEN` (exit 55), so the `storage-s3` profile in all three compose files was swapped to `quay.io/minio/minio`; (2) the probe evidence is recorded in `docs/deploy/storage.md` §5 (the module README is a Phase 1 artifact), and (3) the probe produced two new constraints, C-9 and C-10.
>
> **As shipped, Phase 1 (2026-09-23).** `storage_ops` ships as `src/modules/storage_ops/**` — `index.ts`, `cli.ts`, `lib/{paths,manifest,context,audit,migrate}.ts`, a module README, two Jest suites (13 tests) and four gated Playwright specs (7 tests). `src/modules.ts` registers it unconditionally (an operator tool that only acts when invoked) and `package.json` gains `storage:audit` / `storage:migrate` aliases. Verified by a full rehearsal against MinIO (migrate → verify → refuse-re-migrate → prune → rollback) plus the integration suite. Four deltas against the plan as written: (1) a fifth lib file, `lib/context.ts`, owns partition/scope/driver resolution; (2) **drivers are resolved per row scope**, not once per run — one driver would reject another tenant's key, and the two-tenant case is now TEST-007; (3) the flip asserts `live ⊆ verified` and reports extra verified ids as orphan objects rather than demanding strict set equality (a row deleted during the window leaves a harmless orphan object, while an uncopied live row still aborts); (4) `rollback` **re-materializes** pruned local files from the bucket instead of refusing — AC-007 and the Phase 3 exit gate were updated to match.

## TLDR

Production attachments keep using the `local` driver while the app also gets: the `storage_s3` provider installed, enabled and credentialed but inert; a canonical `storage_path` contract enforced by an audit command; a clean quota ledger; and an app-owned `storage_ops` module whose `migrate --partition <code>` runs preflight → copy → verify → flip and whose `rollback` reverses it. The eventual cutover becomes a config-level event inside a short maintenance window, with the byte copy already done and the reverse path already rehearsed.

## Problem Statement

Everything below is verified fact, not risk speculation.

1. **The read path resolves the driver by partition, never by row.** `StorageDriverFactory.resolveForPartition(partitionCode)` (`node_modules/@open-mercato/core/src/modules/attachments/lib/drivers/driverFactory.ts:74-93`) is what every read, download, delete, OCR/text-extraction and quota-recovery path calls (`api/route.ts:435`, `api/file/[id]/route.ts:73`, `lib/attachment-service.ts:381`, `lib/scoped-upload-service.ts:145`, `workers/quota-recovery.ts:54`, and app-side `src/modules/trade_docs/api/contracts/[id]/document/route.ts:78`). `attachments.storage_driver` is only a write-time snapshot (`api/route.ts:553`). Consequence: flipping a partition's driver instantly changes how **every historical row** in it is read.
2. **The factory silently falls back to the local driver for an unknown driver key** (`driverFactory.ts:69`, `default` branch) **and for a missing partition row** (`:76`). If a partition is configured `s3` while `storage_s3` is not enabled, reads and writes go to local disk with S3-shaped paths — a silent, data-losing split brain. Any tool that touches a partition must assert the resolved driver's `key` matches the configured driver.
3. **The two drivers disagree on the stored path shape.** Local: root `resolvePartitionRoot(code)` = `ATTACHMENTS_PARTITION_<CODE>_ROOT` when set, else `<cwd>/storage/attachments/<partitionCode>` (`lib/storage.ts:7-14`), and the stored path is `org_<orgId>/tenant_<tenantId>/<ts>_<rand>_<name>` (`lib/drivers/localDriver.ts`). S3: the stored path **and** the object key are `[pathPrefix]<partitionCode>/org_<orgId>/tenant_<tenantId>/<file>` (`storage-s3/lib/s3-driver.ts` `prepareStoragePath`), and the driver hard-asserts that the first key segment equals the partition code and that the key carries `org_*`/`tenant_*` scope segments (`assertPartitionScoped`, `assertKeyScoped`, `storage-s3/lib/key-scope.ts`). A flip without a data migration makes every historical row unreadable (`[internal] S3 key is not scoped to the requested partition`, or a missing object), not merely slower.
4. **No migration tooling exists.** Core's `attachments` CLI has exactly one command, `delete` (`core/src/modules/attachments/cli.ts`; `.ai/guides/modules/attachments/cli-commands.md`). `storage_s3` ships only `configure-from-env` and `help`. Nothing copies bytes or rewrites paths.
5. **The quota ledger double-counts and nothing self-heals it.** Usage = `sum(attachments.file_size)` + `sum(attachment_quota_reservations)` per tenant (`lib/quota-service.ts:149-159`; the ledger term counts `actual_bytes` for `committed`, `reserved_bytes` otherwise). The only code that removes a committed row duplicating an attachment row is `reconcileStandaloneObjects` (`lib/quota-service.ts:347+`), and **it has no caller anywhere in the installed core** — so the repair this spec plans is the only cleanup path, and it cannot be deferred.
6. **The local store is already drifting.** Live dev DB: 149 attachment rows / 290 MB, all `privateAttachments`, all `local`. Disk: 446 files / 942 MB — 201 orphan files inside `privateAttachments/` with no referencing row, plus 96 files in `productsMedia/` for which the table has no row at all. A migration must key off rows, and the orphans are a decision the operator makes once.
7. **The provider is not installed.** `node_modules/@open-mercato/storage-s3` is absent, `package.json` carries no such dependency, `src/modules.ts` does not register `storage_s3`; `.env:212-217` and `.env:860-899` are template text, not wired configuration. Installing a dependency, regenerating discovery and rebuilding an image is the slowest, riskiest step of a cutover and must not sit on the cutover's critical path.
8. **The platform already supports the target state.** `attachment_partitions.storage_driver` accepts `local | s3` (`api/openapi.ts:104`), the backend partition page exposes the S3 driver behind `OM_ENABLE_STORAGE_S3` (`backend/config/attachments/page.tsx:10`, `components/AttachmentPartitionSettings.tsx:75-77`), and this deployment has `DEMO_MODE=false` (`.env:181`) so partition settings are editable. The installed partition write path (`api/partitions/route.ts:191-196`) updates `storageDriver`/`configJson` with a direct `em` write — no command bus, no event — which is the precedent this tool's flip mirrors.
9. **The driver seam is small.** `StorageDriver` (`lib/drivers/types.ts`) exposes only `key`, `prepareStoragePath?`, `store`, `read`, `delete`, `deleteStrict?`, `toLocalPath` — **no stat/HEAD/exists/list**. Any existence, size or reachability check the migration needs must be expressed through `store`/`read`/`toLocalPath`, and its cost is a real byte transfer.
10. **A module CLI cannot return an exit code.** The dispatcher awaits `cmd.run(rest)`, prints a timing line and returns `0`; only a thrown error becomes `1` (`node_modules/@open-mercato/cli/src/mercato.ts:2699-2715`, `shared/src/modules/registry.ts` `ModuleCli.run: Promise<void> | void`, `cli/src/bin.ts:120-122`). Deliberate refusals must therefore throw, and a bespoke multi-code convention would be unenforceable.

## Overview and Success Measures

- **Primary outcome:** the eventual cutover is one command inside a maintenance window of minutes, with byte-level verification and a rehearsed reverse path; no business module changes at cutover time.
- **Leading indicators:** `storage_ops audit` reports zero blocking violations on the live DB before the window (orphans are counted and acknowledged, not blocking); the MinIO rehearsal completes `migrate` → `verify` → `rollback` → `migrate` twice with byte-identical downloads; the Phase 0 provider probe records the object-key formula and the store/read/delete round trip from the installed package.
- **Baseline (2026-09-23, measured):** 149 rows / 290 MB on the local driver in `privateAttachments`; 446 files / 942 MB on disk; 297 orphan files; `storage_s3` not installed; no migration tooling.
- **Market / product reference:** `django-storages`, Rails ActiveStorage and Shrine all treat the storage backend as a swappable adapter and leave byte migration to an operator tool (`ActiveStorage::Blob#migrate`, `rclone`/`aws s3 sync` semantics: resumable, idempotent, verify-after-copy). Adopted: adapter swap as a config flip, manifest-driven resumable copy, verify-then-flip. Rejected: dual-write/dual-read compatibility layers (hot-path code, more failure modes than a short window) and content-addressed re-keying (would force a second migration and break the platform's partition/scope key contract).

## Goals

- **REQ-001** — `storage_s3` is installed, registered in `src/modules.ts`, and credentialed, while both partitions keep `storage_driver='local'` and no upload/read behavior changes.
- **REQ-002** — `storage_ops audit` reproducibly reports, per partition: canonical-path violations, `storage_driver` mismatch against the partition, rows whose driver is neither `local` nor `s3`, files referenced by a row but missing on disk, orphan file counts, duplicate `committed` ledger rows, ledger rows with no matching attachment row, and non-terminal reservations; it exits non-zero when a **blocking** violation exists (orphans are informational unless `--strict`).
- **REQ-003** — `storage_ops migrate --partition <code>` performs preflight → copy → verify → flip in one command; `--dry-run` prints the plan and writes nothing; an interrupted run resumes from its manifest; a completed run re-invoked is a no-op.
- **REQ-004** — the flip rewrites exactly the verified row-id set (`attachments.storage_path` / `storage_driver`), the matching ledger rows, and the partition's `storage_driver` / `config_json` in a single database transaction, asserting set equality rather than count equality, so no reader observes a half-migrated state and no uncopied row is ever rewritten.
- **REQ-005** — `storage_ops rollback --partition <code>` restores the partition row **verbatim from the pre-flip snapshot** (driver and `config_json`), strips the prefix from every migrated row (including rows written after the cutover), rewrites the matching ledger rows, and is safe when the original local files are still present.
- **REQ-006** — every command emits a structured summary (rows, bytes, objects, skipped, failed) and appends to a manifest file; a failed gate exits non-zero and does not advance the migration state. Exit codes are exactly `0` success and `1` failure (thrown error), matching the dispatcher.
- **REQ-007** — the tool resolves the storage driver per attachment row's own `(tenantId, organizationId)`, aborts when the resolved driver's `key` does not equal the partition's configured driver, and aborts when the partition row is missing.
- **REQ-008** — no schema change anywhere: the installed `attachments`, `attachment_partitions` and `attachment_quota_reservations` tables are rewritten as **data** only; no CHECK constraint, no new column, no new entity.
- **REQ-009** — the constraints C-1…C-8, the frozen bucket layout, the persistent-volume requirement and the migrate/rollback runbook are recorded in `docs/deploy/` and in the module README in the same change that ships the tool.
- **REQ-010** — `storage_ops prune-local --partition <code>` deletes local files that are provably migrated (object read back with a matching length) and is dry-run by default, requiring `--yes` to act.

## Non-goals

- A zero-downtime cutover, dual-write, or a compatibility read layer (D4).
- Any database constraint on the installed `attachments` table (D3).
- Migrating, deleting or rewriting orphan files automatically: `audit` reports them, deletion stays an explicit operator decision.
- Cross-bucket or cross-cloud moves, bucket lifecycle policies, CDN/edge configuration, and public-bucket exposure (reads continue to go through the application).
- Any change to business modules: every app module keeps uploading through `/api/attachments` unchanged.
- A storage-usage reporting UI, quotas beyond the installed mechanism, and OCR/thumbnail behavior changes.
- Making `s3` the default driver for new partitions: the operator chooses per partition.

## Pre-migration Constraints (C-1…C-8)

These are the conditions that make the later cutover mechanical. C-1…C-3 are asserted by `audit`/`preflight`; C-4…C-8 are recorded in `docs/deploy/storage.md` in Phase 0.

| # | Constraint | Why it matters at cutover | Enforcement |
|---|---|---|---|
| C-1 | Every `attachments.storage_path` is **relative, partition-relative, `org_*`/`tenant_*`-segmented**, never absolute, never already carrying the partition prefix | The cutover rewrite is exactly `partition_code \|\| '/' \|\| storage_path`; any other shape needs per-row judgement | `audit` (blocking violation); uploads are already written this way by the local driver |
| C-2 | Every row in a partition has `storage_driver` equal to the partition's driver; no third value (`legacyPublic`) survives inside a partition that will be migrated | The flip's `WHERE storage_driver='local'` would leave such rows unreachable after the flip | `audit`/`preflight` (blocking violation, with the operator decision recorded in the manifest) |
| C-3 | No non-terminal `attachment_quota_reservations` row for the partition, and no `committed` row duplicating an attachment row, at window time | Recovery jobs created before the flip resolve the S3 driver afterwards and would violate its key contract; duplicates inflate usage permanently (Problem 5) | `preflight` refuses non-terminal rows and repairs duplicates (count printed) |
| C-4 | Bucket layout frozen before the first byte: one bucket per environment, empty `pathPrefix`; the object-key formula re-verified against the installed package | S3 keys are permanent; changing them later is a second migration | Phase 0 probe records the formula; `preflight` refuses a mismatch |
| C-5 | `storage/attachments` lives on a persistent volume, the partition root is only moved via `ATTACHMENTS_PARTITION_<CODE>_ROOT`, and migration state lives on the same volume | A container-local store loses files on redeploy and makes migration impossible; a lost manifest silently degrades resume to a re-copy | `docs/deploy/storage.md`; the manifest defaults to `storage/.storage-migration/<partition>.jsonl` |
| C-6 | All attachment bytes keep flowing through `/api/attachments` (no module writes its own files) | Keeps one migration surface instead of N | Already true for every app module; re-checked in `audit` |
| C-7 | Disk == table: missing files are fatal; orphan files are reconciled or explicitly acknowledged before the window | Preflight can then treat any mismatch as an error instead of a judgement call | `audit` (missing files blocking, orphans informational) |
| C-8 | Upload cap, tenant quota, proxy body limits and the SSRF policy are known and documented (`OM_ATTACHMENT_MAX_UPLOAD_MB` 25 MB, `OM_ATTACHMENT_TENANT_QUOTA_MB` 512 MB, `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS` only for self-hosted endpoints) | S3 does not change them, but a proxy limit or an endpoint rejected by SSRF protection surfaces during rehearsal | `docs/deploy/storage.md` |
| C-9 | Every tool that touches S3 resolves its driver through `resolveForPartition(partitionCode, scope)`; a hand-built driver config is forbidden | **Phase 0 probe finding:** the S3 driver's tenant-scope assertions are inert unless the driver config carries `organizationId`/`tenantId` — a config built without them accepts a key with no `org_*`/`tenant_*` segments, silently bypassing the isolation check. Only the module's credential enhancer (on the `resolveForPartition` path) injects them | `preflight` asserts the resolved driver key and scope; Phase 1 tests cover it (TEST-007/TEST-011) |
| C-10 | `OM_ENABLE_STORAGE_S3` is identical at **generate/build time and at runtime** | **Phase 0 finding:** module *loading* comes from the generated registry that `yarn generate` / `yarn build` baked in, while `/backend/config/attachments` gates its S3 option on the **request-time** `process.env`. Build true + runtime false = driver registered, UI hides S3 (benign); build false + runtime true = UI offers S3 while no `s3` driver is registered → the factory's silent local fallback. Production images carry no `.env` (`docs/deploy/runtime.md:26`), so the flag must be injected by the deployment environment | `preflight` asserts the resolved driver key, which catches the dangerous direction; `docs/deploy/storage.md` records the rule |

## Proposed Solution

One app-owned module, `storage_ops`, that owns a CLI and no entity, no HTTP route, no page and no ACL feature (the installed `attachments` CLI sets the precedent for an ungated operator command). It resolves `storageDriverFactory` and `em` from `createRequestContainer()` — the same container the app boots with — so the driver it exercises is byte-for-byte the one production uploads will use, including per-scope credential resolution.

**Command surface (the "one command" is `migrate`):**

```
yarn mercato storage_ops audit       [--partition <code>] [--orphans] [--strict] [--json]
yarn mercato storage_ops migrate     --partition <code> [--concurrency N] [--s3-config <json|@file>] [--dry-run] [--yes]
yarn mercato storage_ops verify      --partition <code> [--sample N] [--all]
yarn mercato storage_ops rollback    --partition <code> [--yes]
yarn mercato storage_ops prune-local --partition <code> [--older-than <days>] [--yes]
```

`package.json` gains one alias so the common path is one short command: `storage:migrate` → `yarn mercato storage_ops migrate`.

**Migration state machine (per partition, recorded in `storage/.storage-migration/<partition>.jsonl`; `--manifest <path>` overrides):**

| Stage | Does | Refuses when |
|---|---|---|
| `preflight` | asserts `OM_ENABLE_STORAGE_S3`; loads the partition row and **captures it verbatim into the manifest header**; asserts the resolved driver `key === partition.storage_driver` and that the partition exists; probes the S3 driver with a scoped round trip (`store` → `read` → `delete` at `<partition>/org_<orgId>/tenant_<tenantId>/.storage-ops-probe`); counts rows/files/objects; computes local paths via `resolvePartitionRoot(code)`; deletes duplicate `committed` ledger rows (count printed); prints the plan including the exact SQL shape and the `config_json` it would write | driver-key mismatch, missing partition, a blocking violation from `audit`, a non-terminal reservation for the partition, a row whose driver is not `local`, rows already migrated mixed with unmigrated ones |
| `copy` | for each row: reads the bytes through the **local** driver (`read(code, storage_path)`), then `store()`s them through the **S3** driver with `storagePath` = `[pathPrefix]<partition>/<storage_path>`; bounded concurrency; records `{size, sha256, key}` in the manifest. Resume skips a row whose object reads back with a matching length (and hash for the sampled rows) — correctness never depends on a conditional-put header | a read-back mismatch, or a store failure that a read-back cannot explain |
| `verify` | reads every object back and compares its length with the row's `file_size` and the manifest's recorded size (one full pass over the partition's bytes — 290 MB today; `--sample N` (default 10) additionally compares sha256 against the local file; `--all` hashes everything) | any length or hash mismatch |
| `flip` | (1) re-lists the partition's `local` rows and copies+verifies any row missing from the manifest; (2) asserts the verified row-id set **equals** the live `local` row-id set; (3) one transaction: `UPDATE attachments … WHERE id = ANY(:ids)` with an affected-rows assertion, the matching ledger rewrite, and the partition row update; (4) asserts no `local` row remains in the partition | set mismatch, affected-rows mismatch, any remaining `local` row (transaction rolled back, nothing changed) |
| `rollback` | for each migrated row: reads the object and materializes it at the local path (skipping a byte-identical existing file); then one transaction stripping the prefix from rows **and** their ledger rows and restoring the captured partition row verbatim | any object missing for a row, or local files already pruned |

**Design decisions and alternatives**

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| D1 (Q1) Install + credential `storage_s3` now; partitions stay `local` | The dependency install, `yarn generate`, image rebuild and credential wiring are the slowest cutover steps; the driver registers at import time, so the later flip needs no deploy | Install at cutover | Compresses install + credentials + copy + flip into one window |
| D2 (Q2) App-owned `storage_ops` module CLI + a `package.json` alias | `createRequestContainer` supplies EM, DI and marketplace-credential decryption; runs inside the deployed image; precedent `src/modules/currency_policy/cli.ts` | Standalone `scripts/*.mjs` | No container → no encrypted credentials, no DI-resolved driver factory, no in-image execution |
| D3 (Q3) Audit command + documented constraints; no schema change | Zero risk to installed tables; re-runnable in a deploy hook; mirrors the installed partitions route, which also writes `storageDriver`/`configJson` with a direct `em` write | DB `CHECK` constraint on `attachments` | Touches an installed module's table, needs its own migration and rollback plan |
| D4 (Q4) Short maintenance window; flip inside one transaction | Bytes are already copied, so the window covers only the flip; readers never see a half state | Dual-read compatibility layer | Hot-path code and new failure modes to avoid a minutes-long window |
| D5 (Q5) One bucket per environment, empty `pathPrefix` | Shortest keys, simplest copy/verify/rollback, no prefix stripping | Shared bucket with per-environment prefix | Keys become permanent with a prefix that must be frozen and stripped in every path |
| D6 The cutover rewrite is a prefix insert keyed by the verified id set; local files are never deleted by `migrate` | One statement with a verifiable set equality; keeping the source makes rollback cheap and re-runs safe | `WHERE storage_driver='local'` with a count check | Count equality is not set equality: a delete+insert during the window passes the count check and flips an uncopied row |
| D7 Driver resolved per row scope | The S3 credential enhancer is scope-aware (`storage-s3/di.ts:38-67`), so different tenants may use different credentials — and the Phase 0 probe proved the driver's scope assertions only fire when the config carries `organizationId`/`tenantId` (C-9), so the scoped resolution path is also what enforces tenant isolation | One driver instance for the whole run | Wrong credentials for multi-tenant deployments, and a silently unscoped driver |
| D8 No cache or event work at flip | The thumbnail cache is backend-independent (`core/.../lib/thumbnailCache.ts:9-17` → `storage/.cache/thumbnails/<partition>/<attachmentId>/<key>`) and keyed by attachment id, not path | Invalidate thumbnails on flip | Unnecessary work and a needless failure mode |
| D9 Ledger repair happens in `preflight`, not at flip | The repair is an operator-visible, count-printed step; the usage baseline is defined after it | Repair inside the flip transaction | Hides a data repair inside the irreversible step |
| D10 CLI output is English console text, no i18n catalogs | Matches the installed `attachments` CLI and the app-owned `currency_policy` CLI; console output is not a rendered UI surface | i18n catalogs for CLI strings | No user-facing UI surface exists; would add unused catalogs |
| D11 Manifest on the persistent volume (`storage/.storage-migration/`), not `.mercato/` | `.gitignore:64` ignores `.mercato/*`, which is not the volume C-5 requires; a lost manifest would silently degrade resume to a re-copy | Keep it under `.mercato/` | Resume state would not survive a redeploy |
| D12 Exit codes are `0` success / `1` failure, produced by throwing | `ModuleCli.run` returns `void`; the dispatcher returns `0` after a normal return and `1` after a throw (`mercato.ts:2699-2715`) | A bespoke `2` for usage errors | Unenforceable through the dispatcher; would need `process.exit`, which skips disposal and telemetry flush |
| D13 No parallel S3 config surface: `--s3-config <json\|@file>`, default `{}` | The partition's `config_json` is the one configuration surface; the default `{}` means "resolve credentials and bucket from the Integration Marketplace for the row's scope" | Per-field `--s3-bucket/--s3-region/…` flags | A second configuration surface that drifts from the settings page |
| D14 Verification cost is explicit: one full read pass, sampling for hashes | The seam has no HEAD/stat, so existence and size require `read()`; honesty about the cost beats an unavailable optimization | Assume an S3 HEAD exists | Not part of the installed contract |
| D15 Integration specs are gated by `__integration__/meta.ts` | `discoverIntegrationSpecFiles` filters specs by `dependsOnModules` / `requiredEnvVars` / `requiredAnyEnvVars` before Playwright sees them (the convention used by `parties`, `purchasing`, `scope_guards`) | A printed skip reason inside the spec | Parallel invention of a mechanism the repo already owns |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Partition | A named attachment bucket class (`privateAttachments`, `productsMedia`) with one storage driver | `attachment_partitions` row | Unknown code or missing row → command aborts, nothing written |
| Canonical `storage_path` | Relative, partition-relative, `org_*`/`tenant_*`-segmented path with no leading slash and no partition prefix (C-1) | `attachments.storage_path` (local driver convention) | Blocking violation in `audit`; `migrate` refuses to run |
| Object key | `[pathPrefix]<partitionCode>/<canonical storage_path>`; first segment must equal the partition code | `storage-s3/lib/s3-driver.ts` assertions | Driver throws; `verify` fails the run |
| Blocking violation | Canonical-path violation, driver mismatch, row driver outside `local`/`s3`, missing file, duplicate committed ledger row, non-terminal reservation | `audit` / `preflight` | `audit` exits 1; `migrate` refuses |
| Orphan file | A file under `resolvePartitionRoot(code)` with no referencing `attachments` row | Disk vs table comparison | Counted by `audit`; informational unless `--strict`; never auto-deleted |
| Manifest | Append-only JSONL of per-row migration state (`pending`/`copied`/`verified`) plus the captured partition row, enabling resume | `storage/.storage-migration/<partition>.jsonl` | Unreadable/mismatched manifest → restart from `pending`, never from a partial claim |
| Flip | The transactional switch of path prefix, row driver, matching ledger rows and the partition row, keyed by the verified id set | One DB transaction | Set mismatch or remaining `local` rows → rollback the transaction, no state change |
| Ledger row | `attachment_quota_reservations` entry counted in tenant usage | `lib/quota-service.ts` | Duplicate `committed` rows inflate usage until repaired; non-terminal rows block the window |
| Maintenance window | The interval in which the flip runs, with the app stopped or read-only | Operator runbook | Any concurrent write during the window is detected by the flip's set-equality assertion |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Operator / developer (shell access to the app image or a workstation with the app's `.env`) | run `audit`, `migrate`, `verify`, `rollback`, `prune-local` | per row: the row's own `(tenantId, organizationId)`; the command never widens it | none — the CLI has no HTTP surface and no ACL feature (precedent: installed `attachments delete` CLI) |
| Business user (browser) | unchanged | unchanged | unchanged — no new route, page or feature |

- `tenantId` / `organizationId` are taken from each `attachments` row, never from an argument; a command never invents or widens scope.
- The only cross-scope read is the partition row itself (`attachment_partitions`), which the installed driver factory also reads unscoped.
- No system-scope (`organizationId: null`) operation is introduced.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Storage driver resolution and byte I/O | reuse | installed `attachments` | `StorageDriverFactory.resolveForPartition()` from the DI container | One read/write contract for the app and the tool; no parallel S3 client |
| S3 provider (driver, credentials, health, quota recovery) | reuse | installed package `@open-mercato/storage-s3` | module import-time registration + DI credential enhancer | Installed capability; the app writes no driver code |
| Attachment rows, partitions, quota ledger | reuse | installed `attachments` | direct ORM access inside the CLI's own transaction, mirroring `api/partitions/route.ts:191-196` | Data rewrite, not schema change |
| Partition settings (driver + `config_json`) | reuse | installed `attachments` | `attachment_partitions` row update using the settings-page payload shape | Same data the settings page writes |
| Orphan/ledger auditing and the migrate/rollback state machine | **app-own** | new `storage_ops` | CLI only | Nothing installed does it |
| MinIO S3 rehearsal environment | reuse | `docker-compose.yml` `storage-s3` profile | `docker compose --profile storage-s3 up -d` | Already in the repo |
| Upload limits and tenant quota | reuse | installed `attachments` env (`OM_ATTACHMENT_MAX_UPLOAD_MB`, `OM_ATTACHMENT_TENANT_QUOTA_MB`) | documented, not changed | Unchanged by the migration |

Installed records that remain the source of truth: `attachments` (bytes pointer + metadata), `attachment_partitions` (driver config), `attachment_quota_reservations` (usage ledger). `storage_ops` owns no table and stores only its local manifest.

## Architecture and Data Flow

```text
operator shell
  -> yarn mercato storage_ops <command>            (ModuleCli, src/modules/storage_ops/cli.ts)
     -> createRequestContainer()                   (DI: em, storageDriverFactory, integration credentials)
        -> StorageDriverFactory.resolveForPartition(partitionCode, { tenantId, organizationId })
           -> local driver  (resolvePartitionRoot(code)/<canonical path>)
           -> s3 driver     (bucket + [pathPrefix]<partition>/<canonical path>)   [P2 onward]
        -> em.transactional(...)                   (flip / rollback: rows + ledger + partition row atomically)
        -> storage/.storage-migration/<partition>.jsonl   (resumable state + captured partition row)
```

- **Module boundaries:** `storage_ops` owns migration/audit state and nothing else; it never reads attachment bytes outside the installed driver contract and never writes business records.
- **Extension points:** none used — the tool is an operator CLI; the installed `attachments` module is consumed as a library (driver factory, entities) exactly as `src/modules/trade_docs/api/contracts/[id]/document/route.ts:78` already does.
- **Alternatives considered:** a `scripts/*.mjs` runner (no container), a bespoke S3 client inside the app (duplicates the installed provider and its scope assertions), and an HTTP/admin surface for migration (would need ACL features, a UI and CSRF/auth handling for a once-per-environment operation).
- **Compatibility:** no installed API, table, event, page or driver contract changes; `attachments.url` is `buildAttachmentFileUrl(attachmentId)` = `/api/attachments/file/<id>` (`api/route.ts:566`), driver-independent, so stored notification links and page links keep working.

## User Journeys

### Journey J-001 — Rehearse the migration (MinIO, no production data)

1. Operator runs `docker compose --profile storage-s3 up -d`, points the integration credentials at MinIO, and creates a scratch partition (e.g. `migrationRehearsal`) on the local driver.
2. Uploads a handful of files through the app UI so rows and files exist; runs `yarn mercato storage_ops audit --partition migrationRehearsal`.
3. Runs `migrate --partition migrationRehearsal --yes`; the command copies, verifies, flips and prints the summary; a download from the UI returns the same file.
4. Runs `rollback --partition migrationRehearsal --yes`, then `migrate` again — both directions must be repeatable without manual cleanup.
5. Failure path: with the bucket name wrong, `preflight` fails before any write and the partition is untouched.

### Journey J-002 — Cut over `privateAttachments` in production

1. Operator confirms `audit` reports zero blocking violations for the partition (orphans acknowledged separately) and takes a database snapshot plus a copy of `storage/attachments/privateAttachments`.
2. Stops the app (or puts it in read-only) and runs `yarn mercato storage_ops migrate --partition privateAttachments --yes`.
3. `preflight` prints rows/bytes/objects, repairs duplicate ledger rows and captures the partition row; `copy` reports progress; `verify` reads every object back; `flip` commits one transaction and prints the rewritten row count.
4. App restarts; a spot-check download of an old file and a fresh upload both work; the new row's `storage_path` carries the partition prefix and `storage_driver='s3'`.
5. Failure path: any failed gate leaves the partition on `local` with local files intact; the operator re-runs after fixing the cause.

### Journey J-003 — Roll back after the cutover

1. Operator runs `yarn mercato storage_ops rollback --partition privateAttachments --yes`.
2. The command materializes every object at its local path (skipping files that are already byte-identical), then flips the rows, their ledger rows and the partition row back in one transaction, restoring the pre-flip `config_json` verbatim.
3. Files uploaded **after** the cutover are brought back to disk in the same run; the app serves them locally again.
4. Failure path: an object missing for a row aborts the run before the flip; the partition stays on `s3` and nothing is lost.

### Journey J-004 — Drift detection before the cutover

1. Operator (or a deploy hook) runs `yarn mercato storage_ops audit --json`; the command reports blocking violations, orphan counts, ledger anomalies and non-terminal reservations.
2. Exit code 0 means the later cutover stays mechanical; non-zero names the exact rows/paths to fix.
3. Orphan cleanup remains a separate, explicit operator decision informed by the report.

## UI and Interaction Contracts

N/A — this spec adds no page, form, table, widget or menu; its only surface is an operator CLI. The affected existing UI surface is unchanged: uploads continue through `/api/attachments` and downloads through `/api/attachments/file/<id>` / `/api/attachments/image/<id>`, and the installed partition settings page (`/backend/config/attachments`) keeps being the way to change a partition's driver and S3 config. Phase 1's oracle for the written `config_json` is that this page renders the same values.

## Data Models

N/A — no new entity, column, index or migration. The command rewrites data in three installed tables; the exact statements live in **Rollout, Migration, and Rollback**:

| Table (installed) | Column touched | Rewrite | Invariant |
|---|---|---|---|
| `attachments` | `storage_path` | `partition_code \|\| '/' \|\| storage_path` for the verified id set (forward) / prefix stripped (rollback) | Result always starts with the partition code and keeps `org_*`/`tenant_*` segments |
| `attachments` | `storage_driver` | `'local'` → `'s3'` (forward) / reverse | Always equals the partition's driver |
| `attachment_partitions` | `storage_driver`, `config_json` | set from `--s3-config` (default `{}`) / restored verbatim from the manifest's pre-flip snapshot | Rollback never guesses `local` + `null` |
| `attachment_quota_reservations` | `storage_driver`, `storage_path` | rows referencing a migrated path are rewritten in the same transaction as the flip, and back on rollback | Usage (`sum(attachments.file_size) + ledger`) unchanged by the rewrite; duplicates removed only in `preflight` |

## API, Command, and Error Contracts

| Command | Args | Preconditions | Effect | Idempotency | Exit |
|---|---|---|---|---|---|
| `storage_ops audit` | `--partition <code>` (all when omitted), `--orphans`, `--strict`, `--json` | none | read-only report | re-runnable | 0 clean, 1 blocking violation (or any violation with `--strict`) |
| `storage_ops migrate` | `--partition <code>` (required), `--concurrency N` (default 4), `--s3-config <json\|@file>` (default `{}`), `--dry-run`, `--yes`, `--manifest <path>` | `OM_ENABLE_STORAGE_S3=true`; partition exists; resolved driver key matches; no blocking violation; no non-terminal reservation; no `local`-mixed state | preflight → copy → verify → flip; writes objects and rows | resumable from the manifest; a completed partition is a no-op | 0 success, 1 gate failure |
| `storage_ops verify` | `--partition <code>`, `--sample N` (default 10), `--all` | partition on `s3` | read-only object length check (+ hashes for the sample) | re-runnable | 0 match, 1 mismatch |
| `storage_ops rollback` | `--partition <code>`, `--yes`, `--manifest <path>` | partition on `s3`; every object readable | objects → local files, then one transaction restoring rows, ledger rows and the captured partition row | re-runnable; skips byte-identical local files | 0 success, 1 gate failure |
| `storage_ops prune-local` | `--partition <code>`, `--older-than <days>`, `--yes` | partition on `s3`; objects verified | deletes local files proven migrated | re-runnable | 0 success (or dry-run), 1 unverified rows found |

- **Exit-code mechanism:** a command cannot return a code (`ModuleCli.run: Promise<void> | void`); the dispatcher returns `0` after a normal return and `1` after a throw (`node_modules/@open-mercato/cli/src/mercato.ts:2699-2715`). Every refusal therefore throws an `Error` whose message names the failing gate; usage errors throw the same way. No `process.exit` call is used, so container disposal and telemetry flush still run.
- `--yes` is required for any destructive stage (`flip` inside `migrate`, `rollback`, `prune-local`); `--dry-run` prints the plan including the exact SQL shape, the object keys and the `config_json` it would write.
- No HTTP route, OpenAPI document, event payload or command-bus handler is added. The added CLI commands and the npm alias are additive under `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` §13 ("MUST NOT rename or remove existing CLI commands or their required flags; MAY add new commands or optional flags freely"); no installed command, flag or env var is renamed or removed.

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — the tool is an offline operator command: it emits no module event, registers no worker or scheduler job, sends no notification, and invalidates no cache (D8). Progress is reported on stdout and in the manifest file. Optional-module behavior: `audit` and `rollback` work without `storage_s3` enabled; `migrate` refuses to run (REQ-007).

## Security, Privacy, and Compliance

- **Authorization:** no HTTP surface, no ACL feature, no role check; the command requires shell access to the environment (the installed `attachments delete` CLI sets the same precedent). No new route means no new authorization gap.
- **Tenant isolation:** every row is processed with its own `(tenantId, organizationId)`; the S3 driver re-asserts that each key carries that scope (`assertKeyScoped`) and that the first segment is the partition code (`assertPartitionScoped`), so a wrong-scope write throws instead of leaking. `audit` and `verify` never read another tenant's bytes.
- **Sensitive data:** credentials are never logged, printed or written to the manifest; the manifest stores paths, sizes, hashes and the partition row (which holds no secrets — S3 credentials live in the integration marketplace, and an env-prefix config stores only the prefix). Buckets stay private — reads continue to be served by the application (`/api/attachments/file/<id>`), so no public object URL is introduced.
- **Abuse and failure modes:** destructive stages require `--yes`; `prune-local` refuses to delete anything whose object is missing or length-mismatched; `preflight` aborts on blocking violations, driver mismatch, missing partition, unreachable/unusable bucket (probe round trip) and a mixed migration state; SSRF protection stays in force — an internal/MinIO endpoint needs the explicit `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true` (`storage-s3/lib/endpoint-safety.ts:172-174`), and the tool never disables it.
- **Retention:** local files are retained after the cutover until the operator runs `prune-local`; nothing in `migrate` deletes bytes.

## Integration Coverage

Integration specs live under `src/modules/storage_ops/__integration__/` and are gated by that folder's `meta.ts` (`dependsOnModules: ['attachments', 'storage_s3']`, plus `requiredAnyEnvVars` for the S3 endpoint/flag), which is how `discoverIntegrationSpecFiles` filters specs before Playwright runs them (D15) — the same convention as `parties`, `purchasing` and `scope_guards`. Unit tests run under `yarn test` (jest).

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit (jest) | pure path fixtures incl. absolute path, `..`, already-prefixed path, `legacyPublic` row, missing `org_*` segment, env-overridden partition root | `objectKeyFor()` / `withPartitionPrefix()` / `withoutPartitionPrefix()` / local-path resolution | each function's output and refusal; no DB | REQ-003, REQ-008 |
| TEST-002 | integration (MinIO) | scratch partition on `local`, 3 rows + 3 files (one > 1 MB), `OM_ENABLE_STORAGE_S3=true` | `migrate --partition <scratch> --yes`, then `GET /api/attachments/file/<id>` | objects readable at `<partition>/<canonical path>` with matching lengths; rows carry the prefix and `storage_driver='s3'`; partition `config_json` equals the written payload and renders on `/backend/config/attachments`; downloaded sha256 equals the local file; a new upload lands in S3 | REQ-003, REQ-004, REQ-007 |
| TEST-003 | integration (MinIO) | same fixture; run interrupted after the first batch, and separately a **delete+insert of a row during the window** | re-run `migrate`; run `migrate` after the concurrent change | resume completes with no duplicate objects; the concurrent scenario aborts the flip with a set-mismatch message and leaves every row on `local`; a third clean run reports already-migrated with zero writes | REQ-003, REQ-004, REQ-006 |
| TEST-004 | integration (MinIO) | migrated partition + one row uploaded **after** the flip | `rollback --yes` | partition row restored verbatim (driver + `config_json`), prefixes stripped, both rows readable locally, byte-identical | REQ-005 |
| TEST-005 | unit | tenant with a duplicate `committed` ledger row, a non-terminal reservation, and a normal row | `preflight` | duplicate removed and count printed, non-terminal reservation refuses the run, usage after repair equals the pre-window baseline minus the printed duplicates | REQ-002, REQ-008 |
| TEST-006 | integration (MinIO) | planted violations: absolute path row, driver mismatch, `legacyPublic` row, orphan file, row without a file | `audit --json`; `audit --strict` | each violation itemized with its path; blocking ones exit 1; orphans alone exit 0 and exit 1 with `--strict`; no writes | REQ-002, REQ-006 |
| TEST-007 | integration (MinIO) | two tenants with distinct scopes and credentials | `migrate` on tenant A's rows only | tenant B's objects and rows untouched; a key lacking tenant B's scope is rejected by the driver | REQ-007 |
| TEST-008 | manual smoke (recorded) | production-like copy of the dev DB + `storage/attachments/` | full `migrate` + `rollback` in a maintenance-window rehearsal | commands, counts and hash samples recorded in the Changelog and the module README | REQ-001, REQ-003, REQ-005 |
| TEST-009 | integration (MinIO) | partition with an in-flight (`reserved`/`storing`) reservation row | `migrate` | refused in `preflight` with the reservation id named; no object and no row written | REQ-002, REQ-003 |
| TEST-010 | integration (MinIO) | migrated partition; a ledger row rewritten by the flip; then `rollback` | query the ledger before/after both directions | ledger rows follow their attachment rows in both directions; usage identical across each rewrite | REQ-004, REQ-005, REQ-008 |
| TEST-011 | integration (MinIO) | S3 driver probe on a fresh partition | `preflight` probe (store → read → delete) | the probe key matches `[pathPrefix]<partition>/org_<orgId>/tenant_<tenantId>/…`; the round trip succeeds; a key without scope segments is rejected | REQ-001, REQ-007 |

## Implementation Phases

Phases are dependency ordered. Only the current phase may enter implementation; parallel work is limited to independent slices inside that phase. Each phase leaves a working app and closes with the repository's broad gate (`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`), plus the integration run named per phase.

### Phase 0 — Install and wire the provider (no behavior change)

- **Depends on:** none
- **Outcome:** the app runs with `storage_s3` enabled and credentialed while every partition still uses the local driver; the later flip needs no dependency install or image rebuild; the object-key formula and the provider's store/read/delete behavior are recorded from the installed package.
- **Why this order / value delivered:** removes the slowest, riskiest step (dependency + discovery regeneration + credentials) from the cutover window, and replaces tarball-derived assumptions with in-tree evidence. Owner approval for the dependency was given 2026-09-23 (Q1).
- **Deliverables:** `@open-mercato/storage-s3@0.8.0` in `package.json`/`yarn.lock` (`yarn mercato module add @open-mercato/storage-s3`); the registration in `src/modules.ts`; `.env` + `.env.example` entries (`OM_ENABLE_STORAGE_S3=true`, credentials via marketplace or `OM_INTEGRATION_STORAGE_S3_*`, one bucket per environment, empty `pathPrefix`); `yarn generate` output; the **provider probe** (a scratch partition + MinIO, recording the produced key, a store/read/delete round trip, the behavior of a second store of the same key, and the rejection of an unscoped key) written into the module README; `docs/deploy/storage.md` with C-1…C-8, the frozen layout and the persistent-volume requirement; a row in `docs/deploy/README.md`.
- **Independent slices / estimated commits:** (a) dependency + registration + env, (b) provider probe, (c) deploy docs.
- **Requirements closed:** REQ-001, REQ-009 (partial)
- **Tests:** TEST-011 (probe assertions) — the remaining oracle is the unchanged-behavior check in the exit gate.
- **Validation:** the broad gate; `yarn test:integration` with `docker compose --profile storage-s3 up -d` for the probe.
- **Exit gate:** app boots with the flag on; `/backend/config/attachments` offers the S3 driver; both partitions still report `local`; a real upload writes under `storage/attachments/privateAttachments/org_*/tenant_*/` and its row reads `storage_driver='local'`; `/api/attachments/file/<id>` still serves it; the probe results are recorded.

### Phase 1 — `storage_ops`: audit, pure path logic, rehearsal

- **Depends on:** Phase 0 exit gate
- **Outcome:** an operator can see the drift and rehearse the whole migration against MinIO before touching production data.
- **Why this order / value delivered:** the audit is the precondition for a mechanical cutover, and the rehearsal proves copy/verify/flip/rollback on the real code path.
- **Deliverables:** `src/modules/storage_ops/index.ts` (`ModuleInfo`, `requires: ['attachments']`); `cli.ts` (`audit`, `migrate`, `verify`, `rollback`, `prune-local`); `lib/paths.ts`, `lib/audit.ts`, `lib/migrate.ts`, `lib/manifest.ts`; `README.md` (surfaces, commands, exit contract, runbook, verification, rollback); `__integration__/meta.ts`; unit tests TEST-001/TEST-005; integration specs `__integration__/TC-STORAGE-001.spec.ts` (TEST-002, the extension-surface row), `TC-STORAGE-002.spec.ts` (TEST-003), `TC-STORAGE-003.spec.ts` (TEST-004, TEST-010), `TC-STORAGE-004.spec.ts` (TEST-006, TEST-007, TEST-009, TEST-011); `src/modules.ts` registration; the `storage:migrate` alias in `package.json`.
- **Independent slices / estimated commits:** (a) paths + manifest + unit tests, (b) audit, (c) migrate/verify, (d) rollback/prune, (e) integration specs + meta. (a) precedes (b)–(d); (e) follows its target.
- **Requirements closed:** REQ-002, REQ-003, REQ-005, REQ-006, REQ-007, REQ-008
- **Tests:** TEST-001…TEST-007, TEST-009, TEST-010
- **Validation:** the broad gate; `yarn test:integration` with `docker compose --profile storage-s3 up -d`
- **Exit gate:** `audit` on the live dev DB reproduces the measured baseline (149 rows / 290 MB in `privateAttachments`; 201 orphans there and 96 in `productsMedia`; zero duplicate ledger rows; zero non-terminal reservations) with orphans reported non-blocking; the MinIO rehearsal completes `migrate` → `verify` → `rollback` → `migrate` twice with byte-identical downloads; the concurrent delete+insert scenario aborts cleanly.

### Phase 2 — Production cutover of `privateAttachments`

- **Runbook:** [`docs/deploy/storage-cutover-runbook.md`](../../docs/deploy/storage-cutover-runbook.md) — prerequisites, bucket/credential provisioning parameters, the window commands with expected outputs and failure criteria, the rollback decision tree, retention, and the evidence table. **Blocked on the object-storage service being provisioned** (no bucket or credentials yet as of 2026-09-23).

- **Depends on:** Phase 1 exit gate
- **Outcome:** `privateAttachments` serves from object storage; local files remain on disk as the rollback path.
- **Why this order / value delivered:** this is the business outcome; it is last because it is the only irreversible-feeling step and it is cheap once Phases 0–1 hold.
- **Deliverables:** the executed runbook in `docs/deploy/storage.md` (window, snapshot, exact commands, spot checks), the recorded run evidence, and any fix the real run surfaces.
- **Independent slices / estimated commits:** one — a single maintenance-window operation.
- **Requirements closed:** REQ-003, REQ-004, REQ-006
- **Tests:** TEST-008 (recorded smoke)
- **Validation:** `storage_ops audit` (zero blocking violations) before the window; `storage_ops verify --sample 20` after; a UI download and a fresh upload after restart.
- **Exit gate:** an old file downloads byte-identically, a new upload lands in the bucket with `storage_driver='s3'`, `verify` reports zero mismatches, and usage equals the post-repair baseline.

### Phase 3 — Steady state, retention, documentation

- **Depends on:** Phase 2 exit gate
- **Outcome:** local files are pruned on an explicit operator decision after an agreed retention period, and the deployment docs describe the final state.
- **Why this order / value delivered:** frees the disk only after the new path has proven itself; keeps rollback available as long as anyone might need it.
- **Deliverables:** `prune-local` verified in the rehearsal; `docs/deploy/storage.md` final state + retention policy; `src/modules/storage_ops/README.md` verification/rollback section; a lesson record in `.ai/lessons/` with the real run's evidence; `docs/plans/README.md` status board + this spec's Status/Changelog updated.
- **Independent slices / estimated commits:** (a) prune verification, (b) docs + lesson.
- **Requirements closed:** REQ-009, REQ-010
- **Tests:** TEST-004 covers the pruned-partition path: `rollback` re-materializes the deleted local files from the bucket (it no longer refuses — the bytes exist in the bucket, so refusing would be arbitrary)
- **Validation:** the broad gate; `yarn test:integration` (MinIO)
- **Exit gate:** `prune-local --dry-run` lists exactly the verified rows; `--yes` removes only those files; a later `rollback` re-materializes them from the bucket and the partition still round-trips; docs match the tree.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/command contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-002 prerequisite, `/backend/config/attachments` | `storage_s3` registration, env flags, unchanged `attachments` behavior, provider probe | Phase 0 | TEST-011, exit-gate check | AC-001 |
| REQ-002 | J-004, `storage_ops audit` | report over `attachments` / `attachment_partitions` / `attachment_quota_reservations` / disk | Phase 1 | TEST-005, TEST-006, TEST-009 | AC-002 |
| REQ-003 | J-001, J-002, `storage_ops migrate` | object keys `[pathPrefix]<partition>/<canonical path>`; manifest file | Phase 1, Phase 2 | TEST-001, TEST-002, TEST-003, TEST-009 | AC-003, AC-004, AC-006 |
| REQ-004 | J-002 | one transaction over `attachments` + ledger + `attachment_partitions`, keyed by the verified id set | Phase 2 | TEST-002, TEST-003, TEST-010 | AC-005, AC-013 |
| REQ-005 | J-003, `storage_ops rollback` | inverse prefix strip + verbatim partition restore; objects → local files | Phase 1, Phase 3 | TEST-004, TEST-010 | AC-007 |
| REQ-006 | all commands | exit contract (0/1 via throw), structured summary, manifest | Phase 1 | TEST-003, TEST-006 | AC-009 |
| REQ-007 | J-002, multi-tenant deployments | per-row scope resolution; driver `key` assertion; partition existence | Phase 1 | TEST-002, TEST-007, TEST-011 | AC-009 |
| REQ-008 | all phases | no schema change; data-only rewrite | Phase 1 | TEST-001, TEST-005, TEST-010 | AC-008 |
| REQ-009 | operator runbook | `docs/deploy/storage.md`, module README | Phase 0, Phase 3 | documentation review | AC-010 |
| REQ-010 | `storage_ops prune-local` | verified-object-only deletion | Phase 3 | TEST-004 (post-prune) | AC-010 |

### Extension-surface traceability

| Surface | Mechanism | Reference capability / exact source file | Phase | Integration test |
|---|---|---|---|---|
| Module metadata entry (`storage_ops` becomes discoverable) | `emitted-example` | `module.metadata` → `src/modules/example/index.ts` | Phase 1 | — (covered by `yarn generate` discovery + the module's own specs) |
| Module CLI commands (`audit`, `migrate`, `verify`, `rollback`, `prune-local`) | `emitted-example` | `module.cli-command` → `src/modules/example/cli.ts` | Phase 1 | `src/modules/storage_ops/__integration__/TC-STORAGE-001.spec.ts` (TEST-002) |

No other extension surface is added: no ACL feature, no setup hook, no DI registration, no route, no page, no widget, no event, no worker, no i18n catalog (D10). The rule owner for both rows is `om-module-scaffold`.

## Rollout, Migration, and Rollback

**Forward (per partition):**

```bash
# 0. preconditions
yarn mercato storage_ops audit --partition privateAttachments          # zero blocking violations; orphans acknowledged
docker compose --profile storage-s3 up -d                              # rehearsal only
pg_dump … > pre-migration.sql                                          # DB snapshot
rsync -a storage/attachments/privateAttachments/ <backup>/             # byte snapshot

# 1. window (app stopped or read-only; no non-terminal reservations)
yarn mercato storage_ops migrate --partition privateAttachments --dry-run
yarn mercato storage_ops migrate --partition privateAttachments --yes
yarn mercato storage_ops verify --partition privateAttachments --sample 20

# 2. restart the app; spot-check a download and a fresh upload
```

Statements the flip runs (single transaction, id-set and affected-rows asserted):

```sql
-- verified id set comes from the manifest; a live row outside it aborts the stage before this runs
UPDATE attachments
   SET storage_path   = partition_code || '/' || storage_path,
       storage_driver = 's3'
 WHERE id = ANY(:ids);

UPDATE attachment_quota_reservations
   SET storage_driver = 's3',
       storage_path   = :code || '/' || storage_path,
       updated_at     = now()
 WHERE storage_driver = 'local'
   AND storage_path = ANY(:oldPaths);

UPDATE attachment_partitions
   SET storage_driver = 's3',
       config_json    = :payload,
       updated_at     = now()
 WHERE code = :code;
```

**`config_json` at flip.** `:payload` is the settings-page shape, so the row is indistinguishable from one edited in the UI:

| Credential mode | `config_json` written | How it is produced |
|---|---|---|
| Integration Marketplace credentials (default) | `{}` | no `--s3-config`; the provider's credential enhancer resolves bucket/region/endpoint/keys per `(tenantId, organizationId)` scope at driver construction (`storage-s3/di.ts:38-67`) |
| Overrides on top of marketplace credentials | `{ bucket?, region?, endpoint?, forcePathStyle? }` | `--s3-config '{"bucket":"…"}'` |
| Partition-local env credentials | `{ bucket, region, endpoint?, forcePathStyle?, credentialsEnvPrefix }` | `--s3-config @file.json`; the prefix is what makes the enhancer skip the marketplace |

`--dry-run` prints the exact payload it would write, and the Phase 1 oracle is that `/backend/config/attachments` renders the same values afterwards.

**Rollback:** `yarn mercato storage_ops rollback --partition <code> --yes` — objects are materialized at their local paths first (skipping files that are already byte-identical), then one transaction runs the inverse of all three statements above and restores the partition row **verbatim from the manifest's pre-flip snapshot** (driver and `config_json`, not a guessed `local` + `null`). `rollback` fails closed when an object cannot be read for a row, and it refuses once local files have been pruned, naming the reason.

**Retention:** local files stay until `storage_ops prune-local --partition <code> --older-than <days> --yes` runs; `prune-local` deletes only files whose object reads back with a matching length, and is dry-run by default.

**Observability:** stdout summary per stage (rows, bytes, objects, skipped, failed, duplicates removed, rewritten ledger rows), the JSONL manifest, and the exit code (0/1 via throw).

**Compatibility:** no installed API/table/event/page changes; `attachments.url` and the file/image routes are unchanged; nothing in the app's business modules changes; the added CLI commands, npm alias and env flags are additive under `BACKWARD_COMPATIBILITY.md` §13.

**Rehearsal is a prerequisite, not a nice-to-have:** J-001 runs on MinIO before any production window, and J-003's rollback is rehearsed in the same session.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Concurrent write during the flip window | A row written by the old driver after the plan was computed, or an uncopied row flipped | The flip re-lists the partition's `local` rows, copies anything new, and asserts **set equality** (not counts) before updating by id; the transaction aborts on mismatch; the runbook stops the app during the window | If the app is not stopped, the operator re-runs after the window |
| In-flight quota reservations created before the flip | Recovery jobs resolve the S3 driver afterwards with unprefixed paths, violating its key contract | `preflight` refuses while a non-terminal reservation exists for the partition; the runbook drains/expires them first; TEST-009 | Operator must wait for the reservation TTL |
| Interrupted copy (network, process kill, container restart) | Partial objects, a half-finished run | Manifest resume + read-back before re-store + local files untouched; a lost manifest degrades to a safe full re-copy (290 MB today, documented) | Re-copy cost only |
| The provider's internal behaviors (conditional put, key assertions) are read from the published tarball while the package is absent in-tree | The design could rest on an unverified detail | Phase 0 probe records the produced key, a store/read/delete round trip, the second-store behavior and the unscoped-key rejection; copy correctness does not depend on the conditional-put header (read-back instead) | Low after the probe |
| `storage_s3` disabled while a partition says `s3` (the silent local fallback, Problem 2) | Reads/writes split between disk and bucket | `preflight` asserts the resolved driver `key` equals the configured driver and that the partition row exists; REQ-007 | None once the assertion ships |
| Credentials wrong, bucket unreachable, or an internal endpoint rejected by SSRF protection | Migration cannot start | `preflight` probe round trip before any write; `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS` documented for self-hosted MinIO only | Operator fixes configuration and re-runs |
| Quota usage inflation from stale `committed` ledger rows (nothing in core self-heals: `reconcileStandaloneObjects` has no caller) | Tenants hit `quota_exceeded` with real usage lower | `preflight` repairs duplicates and prints the count; `audit` reports ledger rows with no matching attachment row; TEST-005/TEST-010 assert the usage baseline | None after the repair |
| Ledger rows that stop matching after a flip (either direction) | Usage drifts, reconciliation reports noise | The flip and rollback rewrite ledger rows referencing migrated paths in the same transaction, with counts printed; TEST-010 | None after the rewrite |
| Rows whose driver is neither `local` nor `s3` (`legacyPublic`) inside the partition | After the flip they resolve through the partition driver and 404 | `preflight` refuses such rows (C-2) and records the operator decision in the manifest; TEST-006 plants one | Operator must resolve them before the window |
| Orphan files (297 today) mistaken for migration input | Wasted copy, confusing verification | Copy iterates rows only; orphans are reported (informational) and never copied; AC-002 requires the report | Operator decides separately whether to delete them |
| Large files / memory pressure | Slow or OOM copy | Per-row `read()` (one file in memory at a time) with bounded concurrency (default 4); platform upload cap 25 MB by default | Very large legacy files need a lower concurrency |
| Rollback after pruning | Data loss for pruned rows | `prune-local` is dry-run by default, requires `--yes`, deletes only verified objects, and `rollback` refuses once files are gone | Accepted and documented as the retention trade-off |
| Bucket layout chosen wrong before the first byte | Keys are permanent; changing them means a second migration | Layout frozen in Phase 0 (D5) and asserted by `preflight` | Accepted; empty prefix minimizes the cost of a later change |
| Multi-tenant credentials differ per scope | Wrong credentials for some rows | Per-row scope resolution (D7) and the driver's scope assertions; TEST-007 | None after the assertion ships |

## Acceptance Criteria

- [ ] **AC-001** — With `OM_ENABLE_STORAGE_S3=true`, both partitions still report `local`; an upload through the app lands under `storage/attachments/privateAttachments/org_*/tenant_*/` and its row reads `storage_driver='local'`; the file downloads unchanged; the Phase 0 probe results are recorded. (REQ-001)
- [ ] **AC-002** — `storage_ops audit` on the live dev DB reports 149 rows / 290 MB in `privateAttachments`, 201 orphans there and 96 in `productsMedia` (non-blocking), zero missing files, zero duplicate ledger rows and zero non-terminal reservations, exits 0 with orphans alone and 1 with `--strict` or any blocking violation. (REQ-002)
- [ ] **AC-003** — `migrate --dry-run` prints the plan (rows, bytes, object keys, `config_json`, SQL shape) and changes no row, no object and no file. (REQ-003)
- [ ] **AC-004** — After `migrate` against MinIO, every object is readable at `[pathPrefix]<partition>/<canonical storage_path>` with a length equal to the row's `file_size`, and a sampled download is byte-identical to the local file. (REQ-003)
- [ ] **AC-005** — No point in time exposes a state where `storage_path` carries the prefix while the partition (or the row) still says `local`, or vice versa; the flip updates by the verified id set and aborts on a set mismatch. (REQ-004)
- [ ] **AC-006** — An interrupted `migrate` resumes from its manifest, produces no duplicate objects, and a completed partition re-run reports already-migrated with zero writes. (REQ-003, REQ-006)
- [ ] **AC-007** — `rollback` restores the partition row verbatim from the pre-flip snapshot, strips the prefix, brings back rows written after the cutover, and is byte-identical; it fails closed with a readable reason when an object is unreadable or an existing local file differs, and it re-materializes local files that were already pruned. (REQ-005)
- [ ] **AC-008** — Tenant usage is unchanged by the migration itself: the post-`preflight` usage equals the pre-window baseline minus the printed duplicate removals, and the flip/rollback rewrites leave usage identical (asserted in TEST-005/TEST-010); no schema change is introduced by any phase. (REQ-008)
- [ ] **AC-009** — With `storage_s3` disabled, the partition row missing, a driver-key mismatch, an unreachable bucket, a non-terminal reservation, or a mixed `local`/non-`local` state, `migrate` fails in `preflight` with a thrown error (exit 1) and writes nothing; per-row scope resolution keeps each tenant's objects under its own `org_*`/`tenant_*` prefix. (REQ-006, REQ-007)
- [ ] **AC-010** — `docs/deploy/storage.md` (C-1…C-8, the frozen layout, the volume requirement, the runbook), `src/modules/storage_ops/README.md`, `docs/plans/README.md` and this spec's Status/Changelog describe the shipped state, and `prune-local` deletes only files whose objects are verified. (REQ-009, REQ-010)
- [ ] **AC-011** — The CLI surfaces match their recorded reference (`module.metadata` → `src/modules/example/index.ts`, `module.cli-command` → `src/modules/example/cli.ts`): `ModuleInfo` export plus a `ModuleCli[]` default export, `createRequestContainer()` for DI, English console output, refusals by throwing (exit 1). No UI surface is added, so the UI component/theme checklist is N/A by construction. (REQ-006)
- [ ] **AC-012** — A partition with an in-flight reservation refuses `migrate` in `preflight` and is untouched afterwards. (REQ-002, REQ-003)
- [ ] **AC-013** — A row deleted and another inserted during the window makes the flip abort with a set-mismatch message; every row of the partition remains on `local` and readable. (REQ-004)
- [ ] Every affected CLI/API path has self-contained coverage (TEST-001…TEST-011, with TEST-008 recorded as smoke) and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`, `.ai/guides/integrations.md`, `om-integration-builder`, `om-spec-writing`, `.ai/guides/spec-delivery.md`, `om-module-scaffold`, `.ai/specs/SPEC-000-template.md`, `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` §13 (CLI commands are additive), `.ai/lessons/module-features-need-role-acl-sync.md` (no new ACL features → no `sync-role-acls` step) |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Data Models = N/A (no schema change, REQ-008); the commands table, phases and traceability rows agree on REQ-004/AC-005/AC-013 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001/J-002 inside Phases 1–2; Phase 3 is retention + documentation only |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map: installed driver factory, `storage_s3` provider, installed tables, `__integration__/meta.ts` gating; only audit/migration state is app-owned |
| UI contracts identify references, canonical components, and theme/state coverage | pass (N/A) | No UI surface; the affected existing surfaces (`/api/attachments`, `/backend/config/attachments`) are unchanged and serve as the round-trip oracle for `config_json` |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 0–3 with explicit exit gates and the broad validation gate per phase |
| Extension surfaces trace to a reference file and their own test | pass | `module.metadata`, `module.cli-command` rows above |
| Independent fresh-context review completed and its findings resolved | pass | 12 findings (1 Critical, 5 High, 5 Medium, 1 Low) — see the Changelog row for the mapping to this revision |

Verdict: `Ready for implementation` — the document Status flips from `Draft` to `Ready for implementation` when the owner approves starting Phase 0.

## Open Questions

No blocking question remains; all five were answered by the owner on 2026-09-23.

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Install + credential `storage_s3` now, or only at cutover? | owner | no | Install and credential now, driver stays `local` (D1) — 2026-09-23 |
| Q-002 | Tool home: app module CLI, `scripts/`, or both? | owner | no | App-owned `storage_ops` module CLI plus a `package.json` alias (D2) — 2026-09-23 |
| Q-003 | Path/table hardening strength? | owner | no | Audit command + documented constraints, no DB constraint (D3) — 2026-09-23 |
| Q-004 | Cutover tolerance? | owner | no | Short maintenance window with a transactional flip (D4) — 2026-09-23 |
| Q-005 | Bucket layout? | owner | no | One bucket per environment, empty `pathPrefix`, frozen in Phase 0 (D5) — 2026-09-23 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-23 | Initial skeleton from the read-only investigation; Q1–Q5 raised |
| 2026-09-23 | Q1–Q5 answered by the owner; full design, phases, tests, traceability, rollout/rollback and acceptance criteria filled in |
| 2026-09-23 | **Phase 0 shipped.** `@open-mercato/storage-s3@0.8.0` installed (`package.json` pinned, `yarn.lock`), registered in `src/modules.ts` behind `OM_ENABLE_STORAGE_S3`, flag enabled in `.env`/`.env.example`, registries regenerated; provider probed against MinIO through the real `StorageDriverFactory` seam (key formula, store/read/`toLocalPath`/delete round trip, conditional-put behavior, partition and scope assertions); partitions still `local`, upload + download verified on both the dev server and a production build; the `storage-s3` compose profile swapped from LocalStack (now license-gated) to MinIO; probe evidence in `docs/deploy/storage.md`; new constraints C-9 (scope-carrying driver config) and C-10 (flag identical at build and runtime). Broad gate green: `yarn generate`, `typecheck`, `lint` (0 errors), `ds:check`, `test` (191 passed), `build`. |
| 2026-09-23 | **Phase 2 runbook written** (`docs/deploy/storage-cutover-runbook.md`, indexed and linked from `docs/deploy/storage.md` §6 and the Phase 2 section above). Phase 2 is blocked on the object-storage service: no bucket or credentials exist yet. The runbook carries the pre-work that needs no cloud service (orphan acknowledgement, naming freeze, provisioning parameters, local MinIO rehearsal), the window commands with expected outputs and failure criteria, the rollback decision tree, the retention procedure, a trap table mapping the observed error messages to their fixes, and the evidence table to fill during execution. |
| 2026-09-23 | **Phase 1 shipped.** `storage_ops` module (CLI only, no entity/route/page/ACL) with `audit`, `migrate`, `verify`, `rollback`, `prune-local`; `lib/paths.ts` (canonical contract), `lib/manifest.ts` (append-only JSONL + captured partition row), `lib/context.ts` (partition/scope/driver resolution), `lib/audit.ts` (drift report + pure ledger plan), `lib/migrate.ts` (state machine). Registered in `src/modules.ts`, `storage:audit`/`storage:migrate` aliases, module README. Evidence: 13 Jest tests, 7 Playwright specs (gated by `__integration__/meta.ts` on `STORAGE_OPS_TEST_S3_CONFIG` + `OM_ENABLE_STORAGE_S3`), and a full MinIO rehearsal (migrate → verify → refuse re-migrate → prune → rollback re-materializing 3 files, byte-identical). Broad gate green (generate/typecheck/lint 0 errors/ds:check 636 files/jest 26 suites 213 tests/build in the review worktree). Deltas: per-scope driver resolution, `live ⊆ verified` flip assertion, rollback re-materializes after prune (AC-007 + Phase 3 gate updated), extra `lib/context.ts`. |
| 2026-09-23 | Independent review applied (12 findings). Critical: flip now asserts **set equality** against the verified id set and re-copies stragglers, with the concurrent delete+insert scenario in TEST-003/AC-013. High: C-1…C-8 enumerated; copy/verify restated in terms of the installed `StorageDriver` seam (no stat/HEAD — one full read pass, sampling for hashes, read-back instead of trusting a conditional put); the partition row is captured at preflight and restored verbatim on rollback; `--s3-config` replaces the per-field flags; ledger rules defined in both directions with a usage baseline; the audit exit contract separates blocking violations from informational orphans. Medium: one canonical refusal list (incl. `legacyPublic` rows), `__integration__/meta.ts` gating instead of a bespoke skip, exit codes fixed to 0/1 via throw (the dispatcher cannot return a code), in-flight reservations refuse the window, the broad validation gate per phase, the manifest moved onto the persistent volume. Low: manifest-loss degradation documented. |
