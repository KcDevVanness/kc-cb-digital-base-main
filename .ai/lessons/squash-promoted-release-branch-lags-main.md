---
title: "A squash-promoted release branch lags main, and its PR to main misreports the size"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["branch-hygiene", "squash-merge", "release-branch", "merge-conflicts", "branch-protection"]
---

# A squash-promoted release branch lags main, and its PR to main misreports the size

**Context**: 2026-09-29. `production` — the only branch that deploys — had been promoted from `main`
by a squash merge (PR #19, `1fd3786`), and `main` then took PR #20 the same way. `production`'s next
PR into `main` (PR #21) sat `DIRTY` and reported **1154 files**; the two branches actually differ by
**11 files**: `git diff --name-only origin/main origin/production` lists exactly PR #20's file list
(the PO/PI/CI/PL markers and `internal_sales.list.columns.status`). Both lineages had authored those
files, so git produced add/add conflicts — and `production`'s side of them is the *pre-#20* text, so
resolving towards `production` would have silently reverted #20. `production` was also unprotected
(`branches/production.protection.enabled` → `false`) while the repo runs
`delete_branch_on_merge=true` and allows only squash merges (`allow_merge_commit` → `false`).

**Problem**: a squash merge leaves no ancestry, so a promoted release branch never becomes a
descendant of its trunk, and GitHub's PR file list — a three-dot diff against the *merge base* — keeps
counting everything each side authored since that base. A release branch one squash behind therefore
presents as a thousand-file merge with conflicts, while the real overlap is only the files the trunk
touched after the promotion. Three traps sit inside that shape: (1) trusting the reported file count
and "resolving" by taking the release branch's side, which reverts the trunk's later work; (2) merging
a PR whose **head** is the release branch, which with `delete_branch_on_merge` on and no protection
deletes the branch that deploys; (3) assuming the branches can ever converge by history — with
squash-only merges they converge on content only, and the trunk will never be an ancestor of the
release branch.

**Rule**: measure divergence with the **two-dot** diff (`git diff --name-only origin/main
origin/production`), never with the PR's three-dot file list — the three-dot view only answers "what
does the head add relative to the merge base". Resolve each conflict towards the side that is newer
*for that file*, and prove the resolution instead of eyeballing it: after the merge,
`git write-tree` must equal `git rev-parse origin/main^{tree}`, which makes the merged tree
byte-identical to the tree the gate already validated (here `1eee2b6…`, with `yarn test` at 54
suites/439 tests, `ds:check` 900 files, build ✓ — PR #22's CI re-ran it anyway). Land it through a PR
whose base is the release branch (`chore/production-sync-*`), because direct pushes to `main` and
`production` are forbidden; PR #19 is the same shape. Before merging, model the outcome locally:
`git commit-tree HEAD^{tree} -p <release-tip>` then `git merge-tree --write-tree origin/main $sim`
must exit 0 — that is the PR's future state. Before merging a PR whose **head** is the release branch,
check `delete_branch_on_merge` and the branch's deletion protection: the 2026-09-29 precedent turned
the setting off for that one merge and restored it immediately, and `production` now mirrors `main`'s
protection.

**Applies to**: PRs #21/#22 and the `chore/production-sync-pr21` branch,
`.ai/runs/2026-09-29-production-sync.md` (the full sequence), `docs/deploy/cicd.md` (分支模型 / 回滚),
`docs/dev/parallel-development.md` § 分支保护现状, `.github/workflows/deploy.yml`, and every promotion
of `main` to `production`.
