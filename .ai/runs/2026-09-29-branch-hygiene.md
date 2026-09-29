# Execution plan — branch hygiene and cleanup (2026-09-29)

Audit the branch inventory, delete what has already landed, and make "merge ⇒ delete the branch"
part of the delivery flow — with a tool (`yarn branches:cleanup`) instead of a manual habit.

## Goal

The parallel-development model (one unit = one worktree = one branch = one PR) had no exit step, so
merged branches accumulated: 12 local + 4 remote branches on 2026-09-29, of which 11 were leftovers.
The audit also found the failure mode that step hides: `origin/feat/cross-border-erp` — squash-merged
into `main` on 2026-09-28T09:28Z (PR #1, `b42887b`) — kept taking PRs (#11, #16) and 35 direct
commits afterwards, so **270 paths exist only on that branch**. `main`'s spec status board already
lists that work as 已实现 and `production` lacks it too: silent divergence.

## Audit (as of 2026-09-29, before cleanup)

| Branch | PR | Verdict | Action |
|---|---|---|---|
| `docs/erp-doc-catchup` | #16 → `feat/cross-border-erp` | content ⊆ integration branch | deleted |
| `feat/cross-border-erp` (local) | #1 | same tip as `origin/feat/cross-border-erp` | deleted (remote kept) |
| `feat/finance-ledger-and-cockpit` | #11 → integration branch | content ⊆ integration branch | deleted |
| `feat/internal-trade-org-model` | #15 → `main` | landed | deleted |
| `feat/money-2dp-caliber` | #9 → integration branch | landed in `main` via #1 | deleted + worktree removed |
| `feat/agent-delivery-flow` | #10 → `main` | landed | deleted + worktree removed |
| `feat/storage-s3-phase0` / `-ops-phase1` / `-cutover-runbook` | #4/#5/#6 → integration branch | landed in `main`; the only branch-only path (`trade_docs/lib/currencyScale.ts`) is an old name of `productSnapshots.ts`, still in `main`'s history | deleted |
| `review/pr-4` / `-5` / `-6` | PR-head clones | 0 unique paths vs `main` | deleted |
| `qa-evidence-pr-11-repair2` | — (tip == `main`) | landed | deleted |
| `origin/qa-evidence-pr-11` | #12 closed | images byte-identical on `main`; PR #11's comment repointed to `main/pr-11/*.webp` (raw URL still 200) | deleted |
| `origin/feat/cross-border-erp` | #1 merged | **STRANDED: 270 paths not in `main`** | kept |

270 stranded paths by area: `finance` 79, `ru_sync` 71, `trade_docs` 43, `boss_cockpit` 20,
`docs/ru-petkit` 19, `sourcing` 12, specs 6, lessons 6, `cross_border` 5, `lib/attachments` 4,
`export_finance` 2, docs 4.

## Scope

- `scripts/git/branch-cleanup.mjs` (new) + `branches:cleanup` in `package.json`.
- `docs/dev/parallel-development.md` — 「分支生命周期与清理」, base=`main`, docs ride the unit branch.
- `AGENTS.md` Delivery Flow — base rule in step 2, docs-in-same-PR in step 5, cleanup step 6.
- `docs/dev/README.md` — index row for the above.
- `.ai/lessons/squash-merged-base-strands-later-prs.md` + catalog row.
- Repo state: 10 local branches, 2 worktrees and 1 remote branch deleted; PR #11 comment repointed.

Non-goals (need an owner decision): landing the 270 paths back into `main` (its own unit: a merge PR
from `origin/feat/cross-border-erp` that must keep `main`'s newer #13/#15 work), deleting
`origin/feat/cross-border-erp` (impossible until that lands).

## Implementation Plan

### Phase 1: audit and cleanup

- 1.1 Inventory: `git worktree list`, local/remote branches, `gh pr list --state all`, per-branch
  two-dot tree diff against `main`.
- 1.2 Repoint PR #11's image URLs to `main`, delete `origin/qa-evidence-pr-11`.
- 1.3 Delete the landed local branches and the two finished worktrees.

### Phase 2: tool and rules

- 2.1 `scripts/git/branch-cleanup.mjs`: report/`--apply`, `--remote`, `--deep`, `--cover`, `--keep`.
- 2.2 Flow rules in `AGENTS.md` + `docs/dev/parallel-development.md` + the docs index row.
- 2.3 Lesson record + catalog row.

### Phase 3: evidence

- 3.1 `node scripts/check-lessons.mjs` green; `npx eslint scripts/git/branch-cleanup.mjs` clean.
- 3.2 Tool smoke: report on the real repo (lists `STRANDED` for the integration branch), scratch-repo
  run proving a worktree without a merged PR is never removed, and `--cover` refs are protected.
- 3.3 PR draft → ready with `validate` green.

## Risks

- **Cover ref self-deletion.** The first `--apply` run was given a single `--cover origin/feat/cross-border-erp`
  and deleted that very branch (a ref is an ancestor of itself). Restored from the local object store
  in the same minute (`git push origin 72458a7:refs/heads/feat/cross-border-erp`, 1814 files, hook
  `guard-tree` OK). Candidates are now screened against the cover refs and the rule is in the lesson.
- Worktree removal also removes ignored scratch files (`.env` port block, `.next/`, HAR) — regenerable.
- `docs/dev/parallel-development.md` and `.ai/lessons.md` are spine files: append-only edits.

## Source doc

`docs/dev/parallel-development.md` (operating model). This file is the requirement record; the
tracker has no issues.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: audit and cleanup

- [x] 1.1 inventory + per-branch tree diff — audit table above
- [x] 1.2 PR #11 comment repointed to `main`, `origin/qa-evidence-pr-11` deleted — raw URL 200 after delete
- [x] 1.3 10 local branches + 2 worktrees deleted (`--deep --apply`) — `git branch` = `main` + this unit

### Phase 2: tool and rules

- [x] 2.1 `scripts/git/branch-cleanup.mjs` + `branches:cleanup` — new
- [x] 2.2 `AGENTS.md` + `docs/dev/parallel-development.md` + docs index row — this PR
- [x] 2.3 lesson + catalog row (42 → 43) — this PR

### Phase 3: evidence

- [x] 3.1 lessons check + eslint — `Lessons catalog is valid`, eslint OK
- [x] 3.2 tool smoke (real repo report, scratch-repo guard test) — see Risks / PR body
- [x] 3.3 PR draft → ready with `validate` green — PR #17; `validate` run 36510123359 pass (5m25s),
  `guard-tree` run 36510123375 pass (8s)
