# Execution plan — agent delivery flow (2026-09-28)

Make the worktree → commit → gate → PR flow the default of every session, and wire the CI gate to
every PR target instead of `main` only.

## Goal

An agent session that changes anything claims a work unit, isolates it in its own worktree, commits
per slice, runs the gate, and drives a draft→ready PR **without being asked**. The rules live in
`AGENTS.md` (auto-loaded every session) and the CI gate covers every PR target, so a unit PR into an
integration branch cannot merge ungated.

## Scope

- `AGENTS.md` — new `Delivery Flow` section + the `Always` / `Working Sequence` pointers.
- `docs/dev/parallel-development.md` — draft-first PR, required PR-body sections, `[AI-Generated]`
  trailer, no direct pushes to `main`/`production`, refreshed CI wording.
- `.github/workflows/validate.yml` + `.ai/agentic.config.json` — gate every PR target, add the
  lessons check to the shared gate list.
- `.ai/lessons/*` + catalog row — the lesson that produced the CI change.

Non-goals (need an owner decision, listed in the PR body): `ai/` branch-name prefix, coverage
thresholds, dependency/security scanning, closing the `main` admin bypass.

## Implementation Plan

### Phase 1: rules

- 1.1 `AGENTS.md`: `Delivery Flow` section (claim, isolate, commit per slice, gate, draft→ready PR,
  labels/disclosure, no direct push to `main`/`production`).
- 1.2 `docs/dev/parallel-development.md`: draft-first item, required PR-body sections, disclosure
  trailer, CI coverage wording.

### Phase 2: gate wiring

- 2.1 `.github/workflows/validate.yml`: run on every PR target, add the lessons step.
- 2.2 `.ai/agentic.config.json`: keep the local command list identical to CI.
- 2.3 Lesson record + catalog row for the ungated unit PR.

### Phase 3: evidence

- 3.1 `node scripts/check-lessons.mjs` green; both YAML/JSON files parse.
- 3.2 PR opened as a draft, body carries the required sections, flipped to ready when `validate` is green.

## Risks

- Broadening the trigger spends CI minutes on feature-branch PRs (accepted: PR #9 merged with
  `no checks reported`). The docs/deploy scope step keeps doc-only PRs cheap.
- `docs/dev/parallel-development.md` and `.ai/lessons.md` are spine files: append-only edits, the
  later merger keeps both sides.

## Source doc

`docs/dev/parallel-development.md` (operating model) — this plan is the requirement record; the
tracker has no issues.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: rules

- [ ] 1.1 `AGENTS.md`: `Delivery Flow` section
- [ ] 1.2 `docs/dev/parallel-development.md`: draft-first + PR body + disclosure

### Phase 2: gate wiring

- [ ] 2.1 `.github/workflows/validate.yml`: every PR target + lessons step
- [ ] 2.2 `.ai/agentic.config.json`: local list matches CI
- [ ] 2.3 lesson record + catalog row

### Phase 3: evidence

- [ ] 3.1 lessons check + YAML/JSON parse
- [ ] 3.2 PR draft → ready with `validate` green
