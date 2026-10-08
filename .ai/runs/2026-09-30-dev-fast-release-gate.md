# Execution plan — `dev` merges fast, the gate moves to the release PR (2026-09-30)

Repo-owner decision: unit PRs into the integration trunk `dev` must merge quickly and simply; the
broad gate runs **once per wave**, on the PR that promotes `dev` to `main` (and on `production`
PRs / `main` pushes), with fixes landing after the fact. Before the change every unit PR ran the full
seven-command gate in CI, which — measured over the last 100 `validate` runs on 2026-09-30 — cost
2.6–3.4 minutes of runner wall clock per PR for a verdict the author had already produced locally.

Evidence behind the call (2026-09-30, `gh run list/view`):

| Fact | Number |
|---|---|
| PR runs, last 100 `validate` runs | 85 (68 green, 5 red, 12 superseded → cancelled by `concurrency`) |
| `main`-push runs | 15 (14 green, 1 in flight) |
| Per-run wall clock | scope 6s + (`checks` 146–167s ∥ `build` 102–180s) + fan-in 3s |
| Split-before shape (2026-09-29, for contrast) | one serial job, 4:49–6:06 per run |

## Goal

Make the required check stop costing a unit PR three minutes while keeping the two properties that
must not move: (a) the check always *reports* on every PR (a required context that never reports
leaves PRs stuck on "Expected — Waiting"), and (b) the wave that reaches `main` / `production` is
gated by the same `validation.commands` a laptop runs. The unit PR's verification is the author's
local run of that gate — mandatory in `AGENTS.md` and in `om-auto-create-pr` step 8 — and
`guard-tree` (6s) still runs on every PR.

## Scope

- `.github/workflows/validate.yml` — `scope` job decides by PR base branch; comments state what a
  green check on a `dev` PR does and does not mean.
- `docs/dev/parallel-development.md` (§PR 与合并 items 1, 5, 7), `docs/deploy/cicd.md` (branch table
  + new 「门禁覆盖」 section).
- `.ai/lessons/gate-must-cover-every-pr-target.md` (+ `.ai/lessons.md` row): the structural half of
  the old rule stays, the coverage half is dated and reversed.
- `AGENTS.md` → Validation: the local broad run *is* the unit-PR gate.

Non-goals: no command leaves `validation.commands`; `guard-tree.yml` untouched; no branch-protection
edit (the check still reports, so `dev` PRs keep merging); the wave landing flow and `deploy.yml` are
untouched.

## Implementation Plan

### Phase 1: the workflow

- 1.1 `scope` step 1: `pull_request` with base `main` / `production` → fall through to the existing
  docs allow-list; any other base → `needed=false`; missing base ref → `needed=true` (fail closed).
- 1.2 Base ref arrives through `env: PR_BASE_REF`, not inline `${{ }}` (a branch name is
  repository-controlled text and would be spliced into shell source).
- 1.3 Comments: header (what a green `dev` check means), `on:` (why no filter), fan-in (three
  protected branches).

### Phase 2: docs and rules

- 2.1 `docs/dev/parallel-development.md`: item 1 (the ready-flip gate is the local run), item 5
  (coverage table + cost), item 7 (the two required checks mean different things on `dev`).
- 2.2 `docs/deploy/cicd.md`: branch table rows for `dev` / `main` / `feat/*` / `production`, plus the
  「门禁覆盖」 section stating the trade.
- 2.3 `AGENTS.md`: the broad local run is the unit-PR gate; the green `dev` check is not verification.
- 2.4 Lesson: structural invariant (report, exact name, `if: always()`, `skipped` only via
  `needed=false`) vs coverage policy (release targets only), dated 2026-09-30.

### Phase 3: evidence

- 3.1 Replay the extracted `scope` script in a scratch repo over 8 event shapes (throwaway harness in
  `/tmp`, not committed): base `dev` / stacked child → `false`; base `main` / `production` + source
  diff → `true`; base `main` + docs-only → `false`; empty base ref → `true`; push `main` source →
  `true`; push `main` docs-only → `false`.
- 3.2 `node scripts/check-lessons.mjs`; YAML parse of the modified workflow.
- 3.3 This PR's own run: base `dev` → `validate` green as out of scope in seconds (the workflow file
  of the head governs the run), `guard-tree` still red/green on its own merits.

## Risks

- **A red unit now lands on `dev`.** Found at the wave PR instead of at the unit PR; the wave stays
  one spec slice, and the fix lands as its own unit. Compensating controls: the local gate is
  mandatory before `gh pr ready`, `guard-tree` still runs everywhere, and the wave PR is a hard stop
  before `main` / `production`.
- **A green `validate` on a `dev` PR misread as verification.** Mitigated by explicit wording in
  `AGENTS.md`, both docs, the workflow header and the lesson.
- **A future "cleanup" filter on the trigger** (branch filter, `paths-ignore`) would deadlock every
  `dev` PR on a required check that never reports. The lesson states this as invariant 1, next to the
  2026-09-28 incident that produced it.

## Source doc

— (no spec drives this run; the requirement record is the 2026-09-30 repo-owner decision quoted above,
restated on the PR body).
