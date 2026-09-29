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

**Problem**: coverage that depends on the PR's target branch is invisible exactly where parallel work
happens — unit PRs land on integration branches first and only the umbrella PR reaches `main`, so a
green `validate` on `main` proves nothing about the units that composed it. The same hole exists in
the other direction: a workflow filtered with `paths-ignore` never reports, and a *required* check
that never reports leaves the PR stuck on "Expected — Waiting" forever.

**Rule**: the gate runs on every PR target, not only `main` (`on.pull_request` carries no branch
filter; the docs/deploy scope step keeps doc-only PRs cheap). Required checks always report — filter
inside the job, never with `paths-ignore`. Direct pushes to `main` or `production` are not a delivery
channel: `production` is a deploy trigger (`deploy.yml` runs on its push) and accepts only PRs too.

**Applies to**: `.github/workflows/validate.yml`, `.ai/agentic.config.json` (`validation.commands`),
`main`/`production` branch protection, `docs/dev/parallel-development.md`.
