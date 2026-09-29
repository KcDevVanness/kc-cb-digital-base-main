---
title: "A permanent integration trunk survives only on a reset after each landing and a loud drift report"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["integration-branch", "trunk", "branch-hygiene", "reset", "force-with-lease", "parallel-development"]
---

# A permanent integration trunk survives only on a reset after each landing and a loud drift report

**Context**: 2026-09-29, right after the `feat/cross-border-erp` audit (270 paths stranded) and the
`production` reconciliation (PR #21 went DIRTY with a phantom 1 154-file three-dot view; PR #22
merged `main` back into the release branch), this deployment chose a permanent integration trunk:
`origin/dev`, with `.ai/agentic.config.json` `baseBranch: "dev"` so every unit PR opens against it and
a wave landing (`dev → main`) closes the cycle.

**Problem**: a trunk is safe exactly while its content is reachable from `main` *and* someone notices
when that stops being true. Both earlier casualties were silent: the ERP branch kept taking PRs after
its squash merge and no surface reported it; `production` fell 11 files behind `main` and the only
signal was a conflicted promotion PR. A trunk also breaks the cleanup tooling's default assumption —
`branch-cleanup` reports content that exists only on a branch as `STRANDED` and never deletes it, so
with `dev` not a cover ref every merged unit branch would stay in the report forever. And a
squash-only `main` makes commit ancestry useless as evidence for a trunk: after the squash landing
`main` is not an ancestor of `dev`, and after the reset `dev` is not an ancestor of `main` — in both
cases with identical content, which is why the trunk report compares content per path.

**Rule**: (1) unit PRs target the trunk the config names; (2) after every wave landing the trunk is
**reset** onto the mainline — `git push --force-with-lease origin origin/main:<trunk>` — the only
force push a trunk accepts, and never a substitute for reconciling a `diverged` trunk; (3) the trunk
is a cover ref while it is the configured base (so merged unit branches clean up) and never a
deletion candidate; (4) every `yarn branches:cleanup` run prints the trunk rows as content per path,
never as commit counts — `in-sync` / `carrying` (close the wave) / `behind` (reset it) / `diverged`
(reconcile by hand first).

**Applies to**: `.ai/agentic.config.json` (`baseBranch: "dev"`), `scripts/git/branch-cleanup.mjs`
(`TRUNK_REFS`, `DEFAULT_KEEP`, the config-derived cover ref, `classifyTrunk`), `AGENTS.md` Delivery
Flow steps 2/6/8, `docs/dev/parallel-development.md` (「`dev` 集成分支（常驻）」), `origin/dev`,
`origin/production`, PRs #21/#22, `origin/feat/cross-border-erp`.
