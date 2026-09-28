---
title: "An evidence branch is cut from its target branch and only adds files"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["git", "worktree", "branch-hygiene", "ci", "repo-wipe", "screenshots"]
---

# An evidence branch is cut from its target branch and only adds files

**Context**: 2026-09-28 — PR #12 (`qa-evidence-pr-11` → `main`) existed only to host the two
cockpit/widgets screenshots that PR #11's merged comment embeds. Its single commit
(`af9a724`) had `main`'s tip as parent and a tree of exactly two files: `git ls-tree -r af9a724`
lists `pr-11/cockpit.webp` and `pr-11/widgets.webp`, nothing else. Against `main` the diff read
`1543 files changed, 593482 deletions(-)` — `yarn.lock`, `src/modules/**`, `src/app/**`,
`.ai/guides/**`, `docs/**`, `.github/workflows/**`. Any merge mode (merge, squash, rebase) would
have reduced `main` to those two files. The commit came out of a working tree that held only
`pr-11/` and was staged with `git add -A`; the PR reported no checks at all, because its head had
deleted both workflow files and a `pull_request` run uses the head-side copy.

**Problem**: `git add -A` stages *absence* as deletion, and a directory checked out for one purpose
(screenshots, a fixture, a scratch export) looks like a legitimate commit. Nothing in the PR view
shouts about it: the diff is reported as a normal change set, and a branch that deleted
`.github/workflows/**` cannot warn through `pull_request` CI. Evidence branches are the highest-risk
shape precisely because they are throwaway — they are created in the place that happens to contain
the files, not in a checkout of the repository.

**Rule**: an evidence/asset branch adds files and nothing else. Cut it from the branch the PR
targets (`git worktree add ../<slug> -b <branch> origin/<target>`), copy in only the new files, and
before opening the PR run `git diff --stat origin/<target>` — it must list your additions only. A
branch that exists only to serve `raw.githubusercontent.com` links is no exception, and it is never
merged; delete the PR, keep the branch if a comment still references the images. Enforced by the
`guard-tree` check (`.github/workflows/guard-tree.yml` — base-side script, `pull_request`) and by
`.githooks/pre-push` (`git config core.hooksPath .githooks`).

**Applies to**: `.github/workflows/guard-tree.yml`, `scripts/guards/guard-tree.mjs`,
`.githooks/pre-push`, `docs/dev/parallel-development.md`, every PR that carries screenshots or
fixtures rather than code. The sanctioned way to get images into a comment is the tracker operation
**attach-image-evidence** (`.ai/trackers/github.md`): it creates the slash-free evidence branch and
uploads blobs through the Contents API, so the local tree is never involved — reach for it before
hand-rolling a branch, and treat a hand-rolled evidence branch as the review target it is.
