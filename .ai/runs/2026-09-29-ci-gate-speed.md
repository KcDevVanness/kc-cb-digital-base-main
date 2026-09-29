# Execution plan — make the `validate` gate fast (2026-09-29)

Cut the wall clock of `.github/workflows/validate.yml` without weakening what it proves: same seven
commands, same required check name, fewer minutes per PR.

## Goal

Every PR and every `main` push runs the gate serially in one job. Measured over the 2026-09-29 runs
(`gh api repos/…/actions/runs/<id>/jobs`, run `36518277456`, job wall clock 344s):

| Step | Cold CI |
|---|---|
| install dependencies | 66s |
| generate | 15s |
| typecheck | 75s |
| lint | 26s |
| lessons | 0s |
| ds:check | 1s |
| test | 11s |
| build | 140s |

Serial sum ≈ 344s (4:49–6:06 across that day's runs, 286–366s). Two properties make that expensive
exactly where this repo works in parallel: the wall clock is paid **per PR in flight**, and the run is
a serial chain, so the expensive tail (`build`) cannot start before everything cheap has finished.

Root cause of the two slowest steps: a fresh runner has no state.

- `tsconfig.json` sets `incremental`, but the record (`tsconfig.tsbuildinfo`) dies with the runner, so
  `tsc --noEmit` re-checks the whole program on every run (75s).
- `next build` type-checks the project *again* with its own record at `.mercato/next/cache/.tsbuildinfo`
  (`node_modules/next/dist/lib/typescript/runTypeCheck.js:107`), also cold — roughly half of the 140s.

## Scope

- `.github/workflows/validate.yml` — one job → `scope` → `checks` ∥ `build` → fan-in job **`validate`**.
- Caches: yarn (already), `tsconfig.tsbuildinfo`, `.mercato/next/cache/.tsbuildinfo`.
- `docs/dev/parallel-development.md` §CI, `docs/deploy/cicd.md` branch table.
- `.ai/lessons/gate-must-cover-every-pr-target.md` — the required-check *name* contract.

Non-goals: dropping a command from the gate (the gate stays `.ai/agentic.config.json` →
`validation.commands`), caching `node_modules` (1.8G: restore is not obviously cheaper than 66s of
linking), Turbopack's experimental build cache (an app-config change with production impact).

## Implementation Plan

### Phase 1: restructure

- 1.1 `scope` job publishes `needed`; the docs/deploy allow-list moves into it unchanged.
- 1.2 `checks` (install/generate/typecheck/lint/lessons/ds:check/test) and `build` (install/build, no
  second `generate`) both `needs: scope` and run in parallel.
- 1.3 Fan-in job named exactly `validate`: `if: always()`, green only when every slice passed or was
  skipped **because** `needed=false`.

### Phase 2: caches

- 2.1 `tsc-*` cache for the root buildinfo.
- 2.2 `next-tsc-*` cache for the build's own buildinfo.
- 2.3 Keys are `lockfile + tsconfig` scoped with prefix restore-keys, so a lockfile or compiler-option
  change starts cold instead of restoring a stale record.

### Phase 3: evidence

- 3.1 Local: YAML parse; the two shell snippets run against real ranges and across every
  (scope, checks, build) result permutation.
- 3.2 PR run with a docs-only diff → `needed=false`, `validate` green via the skip path.
- 3.3 PR run with a deliberate type error → both slices red, `validate` red.
- 3.4 PR run on the final tree → green, with warm-cache timings recorded here.

## Risks

- **Required check name.** Branch protection waits for the job name `validate`. If the fan-in is
  renamed or replaced by a matrix, every PR hangs on "Expected — Waiting". The rule is recorded in
  `.ai/lessons/gate-must-cover-every-pr-target.md`.
- **Skipped ≠ passed.** The fan-in accepts `skipped` only while `needed != true`; a slice that skipped
  while the scope step asked for it is reported as a failure.
- **Incremental records in CI.** Cached buildinfo is a *speed* record, not a result: the commands still
  run, and TypeScript invalidates by file content and compiler options. A stale entry costs time, never
  a missed error. Both caches are bounded by a lockfile/tsconfig-scoped key.
- **Extra runners.** Four jobs per run instead of one; standard runners are free on this public
  repository, so the cost is concurrency, not money.

## Results

Baseline, one serial job (run `36518277456`, 2026-09-29): **344s** — install 66, generate 15,
typecheck 75, lint 26, lessons 0, ds:check 1, test 11, build 140.

After, cold caches (run `36520357923`): **225s** total — `scope` 7s, then `checks` and `build` in
parallel, then the fan-in 2s.

| Slice | Job wall | Steps |
|---|---|---|
| `checks` | 130s | install 41 → generate 8 → typecheck 44 → lint 16 → lessons 0 → ds:check 0 → test 7 |
| `build` | 209s | install 55 → build 142 (that step is `generate` + `next build`, which type-checks internally) |

The run is now bounded by the `build` slice instead of the sum of every step, and the `checks` slice
finishes ~80s before it rather than delaying it.

After, warm caches (run `36520762983`, second run on the same lockfile/tsconfig — both incremental
records restored): **166s** total.

| Slice | Job wall | Steps |
|---|---|---|
| `checks` | 148s | install 65 → generate 14 → **typecheck 11** → lint 25 → lessons 0 → ds:check 0 → test 12 |
| `build` | 139s | install 59 → **build 62** (`generate` + `next build`, whose internal type check now reuses its record) |

344s → 225s cold → 166s warm (2:46). The remaining fat is `yarn install` (59–65s per slice, paid
twice): caching `node_modules` (~1.8G) was left out as a non-goal because a restore of that size is
not obviously cheaper than linking from the warm Yarn cache — worth measuring separately.

Gate-shape evidence, all on this PR:

| Run | Tree | Result |
|---|---|---|
| `36519752486` | docs-only diff | `scope` success, both slices skipped, `validate` **success** in 13s |
| `36519938204` | deliberate failing test | `checks` **failure**, `build` **failure**, `validate` **failure** |
| `36520357923` | final tree, cold | all four jobs success, 225s |
| `36520762983` | final tree, warm | all four jobs success, 166s |

## Source doc

`docs/dev/parallel-development.md` §CI (operating model). This file is the requirement record; the
tracker has no issues.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: restructure

- [ ] 1.1 `scope` job with the unchanged allow-list
- [ ] 1.2 parallel `checks` + `build` slices
- [ ] 1.3 fan-in job named `validate`

### Phase 2: caches

- [ ] 2.1 root `tsconfig.tsbuildinfo` cache
- [ ] 2.2 `next build` type-check record cache
- [ ] 2.3 scoped keys + restore-keys

### Phase 3: evidence

- [x] 3.1 local snippet harness (scope ranges + fan-in permutations)
- [x] 3.2 docs-only PR run → skip path green — run `36519752486`: `validate` success in 13s
- [x] 3.3 deliberate failure → `validate` red — run `36519938204`: `checks` + `build` failure
- [x] 3.4 final tree → green, timings recorded — runs `36520357923` (225s cold) and `36520762983` (166s warm)
