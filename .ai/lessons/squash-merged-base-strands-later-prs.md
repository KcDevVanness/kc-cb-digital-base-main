---
title: "A branch that keeps taking PRs after its squash merge strands that work"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["branch-hygiene", "squash-merge", "stacked-pull-requests", "integration-branch", "catch-up", "worktree"]
---

# A branch that keeps taking PRs after its squash merge strands that work

**Context**: 2026-09-29 branch audit. `feat/cross-border-erp` was the integration branch: unit PRs
#4/#5/#6/#9 merged into it, then PR #1 squash-merged it into `main` (2026-09-28T09:28Z, `b42887b`,
237 files). The branch was not deleted and kept receiving merges — PR #11 (09:59Z, `finance`,
`ru_sync`, `boss_cockpit`) and PR #16 (09-29T01:21Z, ERP docs), plus 35 commits pushed straight to
it. Measured result: `git diff --diff-filter=A --name-only origin/main origin/feat/cross-border-erp
| wc -l` → **270**; `src/modules/finance` (79), `ru_sync` (71), `trade_docs` document/invoice pages
(43), `boss_cockpit` (20) and `docs/ru-petkit` (19) exist only on that branch. `main`'s spec status
board already recorded the same work as 已实现, and `production` (the deploy branch) lacks it too, so
nothing failed loudly: the divergence was silent until the two trees were diffed.

**Problem**: a squash merge leaves no ancestry, so a branch that was just merged still looks like an
ordinary unmerged branch, and `git branch -d` refuses it. GitHub's `delete_branch_on_merge` only
covers the head branch of that one merge, and a PR's base is not retargeted to `main` unless the base
branch is deleted. So "merge the next unit PR into the old integration branch" looks healthy on both
sides — the child PR runs the gate (`pull_request` carries no branch filter), the merge succeeds, the
Progress list is ticked — while the content stops at a branch that no longer feeds the trunk. Neither
`main` nor the branch reports anything; only a tree-level diff shows it.

**Rule**: every PR's base is the branch `.ai/agentic.config.json` names as `baseBranch` — `main`, or
the live integration trunk (`dev`) that unit PRs land on; stacking (base = parent branch) is allowed
only when the PR body declares it, and the child is retargeted to that base the moment the parent
merges (`gh pr edit <child> --base <base>`, then rebase). A trunk is the one branch that keeps taking
PRs on purpose, and it survives only by being reset onto `main` right after every landing
(`git push --force-with-lease origin origin/main:<trunk>`) with its unlanded content printed on every
`yarn branches:cleanup` run — a trunk that keeps taking PRs and is *not* reset is this lesson's
failure mode. A branch that has been merged into `main` stops being a work unit — delete it
right away (remote by auto-delete, local with `yarn branches:cleanup --apply`) and cut a fresh branch
from the base branch for anything new. An integration branch other than the trunk is finished only when
`git diff --diff-filter=A --name-only origin/main <branch>` is empty; anything else is a "land it back
into `main`" task, not a delete. Tooling must never treat a ref that it uses as the *evidence* of a
landing as a deletion candidate — a ref is trivially an ancestor of itself, which is how
`branch-cleanup` deleted `origin/feat/cross-border-erp` on its first apply run (restored from the
local object store within the same minute; candidates are now screened against the cover refs).

**Applies to**: `origin/feat/cross-border-erp` (270 paths awaiting a land-back PR), PRs #1/#11/#16,
`docs/dev/parallel-development.md` (「`dev` 集成分支（常驻）」+「分支生命周期与清理」), `AGENTS.md`
Delivery Flow steps 2/6/8, `.ai/agentic.config.json` (`baseBranch`), the `dev` trunk and its
reset-after-landing rule, `scripts/git/branch-cleanup.mjs` (trunk rows),
`.github/workflows/validate.yml`, and every stacked PR.