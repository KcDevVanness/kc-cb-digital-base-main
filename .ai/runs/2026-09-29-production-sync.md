# Execution plan — production sync after PR #21 went DIRTY (2026-09-29)

Clear the merge conflicts on PR #21 (`production` → `main`) by making `production` contain `main`
again, without touching `main` and without inventing content: the two branches differ on exactly the
11 files PR #20 rewrote.

## Goal

PR #21 reports `Merge state: DIRTY` with **1154 files** in its three-dot view. That view is a
history artefact, not a content one: `main` landed the ERP work through squash merges (#1, #8, #18)
while `production` carries the original lineage, so the merge base is `5c997df` and the file list
counts everything each side added *since* that base — almost all of it byte-identical on both sides.

The real divergence is the two-dot diff `git diff --name-only origin/main origin/production`:
**11 modified files**, exactly the file list of PR #20 (`7e5859e`, "fix(labels): mark PO/PI/CI/PL
concepts and fix the missing status column key"). `production` is a pre-#20 snapshot: it still has
「内部销售订单」 without （PO）, `packing_list` labelled 「装箱单」 without （PL）, and is missing
`internal_sales.list.columns.status` (the key whose absence rendered the raw key as the column
header). Both lineages authored those files, so git reports add/add conflicts and the only correct
resolution is `main`'s side — `production`'s side would revert #20.

## Scope

- A `production`-based sync branch with `main` (`7e5859e`) merged in, all 11 conflicts resolved to
  `main`'s content.
- `.ai/runs/2026-09-29-production-sync.md` (this file) — the run record, so PR #21 has a
  `Tracking plan:` and the resolution is re-runnable from the branch.
- Non-goals: no change to `main`; no change to any source file beyond the merge result; no
  migration, deploy-side or host-side change; PR #21 itself is not retargeted, merged or closed here.

## Implementation Plan

### Phase 1: resolve

- 1.1 Worktree `../kc-cb-digital-base-min-production-sync` on `chore/production-sync-pr21` off
  `origin/production` (`1fd3786`).
- 1.2 `git merge origin/main`, resolve the 11 add/add conflicts with `git checkout --theirs`
  (`theirs` = `origin/main`), commit the merge.
- 1.3 Prove the resolution: `git write-tree` must equal `origin/main^{tree}`.

### Phase 2: evidence

- 2.1 Gate (`validation.commands`) on the merged tree.
- 2.2 Push the branch, open the PR against `production` as a draft, watch CI (`validate`,
  `guard-tree`), flip to ready.
- 2.3 Report the PR #21 state — after the sync lands on `production`, `production` contains `main`
  and PR #21 is conflict-free (its remaining content: this run record).

## Risks

- **The merge is resolved to `main`'s tree.** Any file that `production` had and `main` did not is
  therefore dropped. Checked: `git diff origin/main origin/production` reports 11 modified files and
  **no** production-only path, so there is nothing unique to lose (unlike PR #19, which had one
  renamed path to drop).
- **Merging this PR into `production` triggers `deploy.yml`** (build → ssh → compose up →
  `/api/healthz`). That is inherent to updating the release branch and is the reason this PR is
  opened as a draft: the merge is the deploy trigger, and the deploy decision is the owner's.
- **Squash-only `main`.** The repo only allows squash merges, so PR #21 cannot import `production`'s
  74 commits into `main`'s history; resolving this conflict makes `production` contain `main`, it
  does not make `main` contain `production`'s lineage.

## Source doc

`docs/dev/parallel-development.md` (branch lifecycle) + `.ai/runs/2026-09-29-branch-hygiene.md`,
which recorded this divergence ("silent divergence", same branch class) and left the landing to an
owner decision. This file is the requirement record; the tracker has no issues.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: resolve

- [x] 1.1 worktree + branch off `origin/production` (`1fd3786`)
- [x] 1.2 merge `origin/main`, 11 add/add conflicts resolved to `main`'s side — merge commit
- [x] 1.3 tree proof: `git write-tree` == `origin/main^{tree}` (`1eee2b6`)

### Phase 2: evidence

- [x] 2.1 gate (`validation.commands`) on the merged tree — `generate` ✓ (known OpenAPI bundle fallback, pre-existing) / `typecheck` 0 error / `lint` 0 error (8 pre-existing warnings) / `check-lessons` 「Lessons catalog is valid」 / `ds:check` 900 files / `test` 54 suites · 439 tests (same counts as #20) / `build` ✓ Compiled successfully; `git status --short` empty afterwards, so `generate` is idempotent on this tree — commit `fd24e4a`
- [x] 2.2 push + draft PR against `production` (PR #22), CI `validate` run [36517824218](https://github.com/KcDevVanness/kc-cb-digital-base-main/actions/runs/36517824218) pass (5m45s) + `guard-tree` run [36517824236](https://github.com/KcDevVanness/kc-cb-digital-base-main/actions/runs/36517824236) pass, flipped ready
- [x] 2.3 PR #21 state reported — modelled on the squash result (`git commit-tree <sync tree> -p 1fd3786`, repo is squash-only: `allow_merge_commit=false`): `git merge-tree --write-tree origin/main <tip>` exits **0** (no conflict), and the merged tree `733b28f` is `main`'s tree plus this file. Convergence here is on **content**, not history — `main` never becomes a git ancestor of `production` under squash-only merges, so PR #21 stays a one-file PR carrying this run record.
