---
title: "A PR whose base is a feature branch runs no CI at all"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["ci", "gate", "branch-protection", "pull-request", "worktree", "parallel-development"]
---

# A PR whose base is a feature branch runs no CI at all

**Context**: 2026-09-28 — the money-caliber unit PR (#9) targeted `feat/cross-border-erp`, not `main`.
`gh pr checks 9` answered `no checks reported on the 'feat/money-2dp-caliber' branch`: the `validate`
workflow's `on.pull_request.branches` filter listed only `main`, so the unit PR was labeled, commented
and merged (four minutes after it opened) with the broad gate never running anywhere but a laptop. The
same window shows the other half of the hole: a batch of commits landed on `main` during the
2026-09-23/24 deploy wave with no PR object at all (`gh api …/commits/<sha>/pulls` empty, while known
squash merges resolve to their PR), i.e. through the `enforce_admins=false` bypass.
2026-09-29 — the gate had also grown into seven commands inside one serial job (286–366s per run,
measured over that day's `validate` runs), so it was split into parallel slices (`checks`, `build`)
behind a fan-in job. That is the step where the same hazard returns from a different direction: the
required check is matched by job *name*, and both the new slices and any renaming produce names branch
protection does not wait for.

**Problem**: coverage that depends on the PR's target branch is invisible exactly where parallel work
happens — unit PRs land on integration branches first and only the umbrella PR reaches `main`, so a
green `validate` on `main` proves nothing about the units that composed it. The same hole exists in
the other direction: a workflow filtered with `paths-ignore` never reports, and a *required* check
that never reports leaves the PR stuck on "Expected — Waiting" forever. Restructuring the gate reopens
it from a third direction: a fan-in job that treats a skipped slice as success (or that renames the
reported job) turns a broken slice into a green check, or into a PR that can never merge.

**Rule**: the gate runs on every PR target, not only `main` (`on.pull_request` carries no branch
filter; the docs/deploy scope step keeps doc-only PRs cheap). Required checks always report — filter
inside the job, never with `paths-ignore`. The *name* of the job that reports it is part of that
contract: a fan-out keeps one aggregate job named exactly the required context (`validate`), it runs
with `if: always()`, it fails on any slice that did not pass, and it accepts `skipped` only when the
scope decision sent that slice home (`needed=false`). Direct pushes to `main` or `production` are not
a delivery channel: `production` is a deploy trigger (`deploy.yml` runs on its push) and accepts only
PRs too.

**Applies to**: `.github/workflows/validate.yml`, `.ai/agentic.config.json` (`validation.commands`),
`main`/`production` branch protection, `docs/dev/parallel-development.md`.
