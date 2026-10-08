---
title: "A PR whose base is a feature branch runs no CI at all"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["ci", "gate", "branch-protection", "pull-request", "local-gate", "release-gate"]
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
measured over that day's `validate` runs; 344s in run `36518277456`), so it was split into parallel
slices (`checks`, `build`) behind a fan-in job — 225s on the first cold run of the new shape
(`36520357923`), 166s once the incremental type-check records survive between runs (`36520762983`).
That is the step where the same hazard returns from a different direction: the
required check is matched by job *name*, and both the new slices and any renaming produce names branch
protection does not wait for.

**Problem**: coverage that depends on the PR's target branch is invisible exactly where parallel work
happens — unit PRs land on integration branches first and only the umbrella PR reaches `main`, so a
green `validate` on `main` proves nothing about the units that composed it. The same hole exists in
the other direction: a workflow filtered with `paths-ignore` never reports, and a *required* check
that never reports leaves the PR stuck on "Expected — Waiting" forever. Restructuring the gate reopens
it from a third direction: a fan-in job that treats a skipped slice as success (or that renames the
reported job) turns a broken slice into a green check, or into a PR that can never merge.

2026-09-30 — the *coverage* half of the rule below was deliberately reversed, by repo-owner decision:
unit PRs into the integration trunk `dev` merge on their author's local gate instead of waiting ~3
minutes (measured 2.6–3.4 min per PR run) for CI to re-prove it. The structural half was not: the
check still reports on every PR, from inside the job. Both halves are stated below because they fail
differently — a wrong coverage decision costs a red trunk, an unreported required check costs a stuck
PR (or, in the other direction, a silent hole).

**Rule** (current, 2026-09-30):

1. **Structural — never relaxed.** The required check always *reports* on every PR: no `paths-ignore`
   and no branch filter on `on.pull_request` (a required context that never reports is a PR that can
   never merge). The reporting job keeps the exact name branch protection matches (`validate`), runs
   with `if: always()`, fails on any slice that did not pass, and accepts `skipped` only when the
   scope decision sent that slice home (`needed=false`). Skipping is a `scope` decision, never a
   trigger filter.
2. **Coverage — a policy, currently: release targets only.** The gate's *commands* run when the PR's
   base is `main` / `production` (the wave PR, the production sync) and on every push to `main`
   (plus the docs / deploy-side allow-list for those). A PR whose base is the integration branch
   `dev` — or another unit branch — reports the check green in seconds as out of scope; its
   verification is the author's local run of `validation.commands`, which `AGENTS.md` → Validation
   and `om-auto-create-pr` step 8 require before `gh pr ready`, and the wave PR is the release stop
   before `main`.

Consequence to keep in mind, in both directions: a green `validate` on a `dev` PR means "nothing to
run here", never "the code was checked" — and a red one on the wave PR is the *first* machine proof
of that wave, so it is fixed there, not routed around.

**Applies to**: `.github/workflows/validate.yml` (scope job, required check name), `.ai/agentic.config.json`
(`validation.commands`, `baseBranch`), `dev` / `main` / `production` branch protection,
`docs/dev/parallel-development.md`, `docs/deploy/cicd.md`, `AGENTS.md` (Validation).
