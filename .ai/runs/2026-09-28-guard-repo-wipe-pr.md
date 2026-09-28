# Execution plan — guard the repository against wipe-shaped commits (2026-09-28)

PR #12 (branch `qa-evidence-pr-11` → `main`) existed only to host two QA screenshots for the
already-merged PR #11. Its single commit's tree held **only** those two files — parent `19e6d50`
(`main`'s tip), `1543 files changed, 593482 deletions(-)` against `main`, `yarn.lock` and `src/**`
included. Any merge mode would have turned `main` into two files, and nothing warned: a head that
deletes `.github/workflows/**` runs no `pull_request` workflow at all. Close that hole at the push,
in CI, and in the documented flow.

## Goal

A branch whose tree lost the repository cannot reach a protected branch by accident: `git push`
refuses it, CI reports it red (or, when the head deleted the workflows, reports nothing and the
required check keeps the PR unmergeable), and the operating doc says why.

## Scope

- `scripts/guards/guard-tree.mjs` — the rule: head tree must carry the sentinel paths and keep at
  least half of the base tree's files. Tree-based, so a `--depth=1` fetch is enough.
- `.github/workflows/guard-tree.yml` — check `guard-tree`, base-side script, `pull_request`.
- `.githooks/pre-push` — same rule before the push leaves the machine.
- `.ai/lessons/evidence-branch-is-cut-from-its-target.md` + catalog row.
- `docs/dev/parallel-development.md` — hook install, evidence-branch rule, the guard in CI, the
  self-check commands.

Non-goals: rewriting the harness-managed `.ai/trackers/github.md` (`attach-image-evidence` already
uploads through the Contents API), and branch protection for the integration branch (a policy
decision for the owner; the guard file is not on that branch today).

## Implementation Plan

### Phase 1: the rule and its two enforcement points

- 1.1 `scripts/guards/guard-tree.mjs` (`--base`, `--head`, `--min-kept-ratio`; exit 1 on violation).
- 1.2 `.github/workflows/guard-tree.yml`.
- 1.3 `.githooks/pre-push`.

### Phase 2: knowledge

- 2.1 Lesson record + catalog row (count 38 → 39).
- 2.2 `docs/dev/parallel-development.md`: hook install, evidence-branch rule, guard description in
  the CI item, `guard-tree` in branch protection, self-check lines.

### Phase 3: evidence

- 3.1 Guard against the real wipe commit `af9a724`: exit 1 with both violations; against `main`,
  the integration branch and the repaired evidence branch: exit 0.
- 3.2 Pre-push hook on a scratch bare remote: wipe refused (0 refs on the remote), normal push
  allowed, `--no-verify` bypass, missing `core.hooksPath` does not break a push, ref deletion skipped.
- 3.3 `validate` green on the PR; `guard-tree` added to `main`'s required checks after the merge.

## Risks

- The guard could refuse a deliberate large deletion; `git push --no-verify` is the documented escape,
  and the rule only fires on a missing sentinel or a >50% loss.
- `main`'s protection gains a second required check: PRs whose head deletes the workflows now show
  two "Expected" checks instead of one — the intended behaviour, still unmergeable either way.

## Source doc

This plan is the requirement record; the tracker has no issue. The incident itself is recorded in
`.ai/lessons/evidence-branch-is-cut-from-its-target.md` and on PR #12.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: the rule and its two enforcement points

- [ ] 1.1 `scripts/guards/guard-tree.mjs` — 3d9dec4
- [ ] 1.2 `.github/workflows/guard-tree.yml` — 3d9dec4
- [ ] 1.3 `.githooks/pre-push` — 3d9dec4

### Phase 2: knowledge

- [ ] 2.1 lesson record + catalog row — 3d9dec4
- [ ] 2.2 `docs/dev/parallel-development.md` — 3d9dec4

### Phase 3: evidence

- [ ] 3.1 guard vs the real wipe commit and the three clean refs — `af9a724` refused (missing all four sentinels; 2 of 1541 files kept), `origin/main` / `origin/feat/cross-border-erp` / repaired `origin/qa-evidence-pr-11` all OK
- [ ] 3.2 pre-push hook end to end — wipe push refused with 0 refs on the scratch remote; `HEAD` pushed (1541 → 1545 files); `--no-verify` pushed the wipe commit; missing hooks dir left pushes untouched; ref deletion skipped
- [ ] 3.3 PR green + `guard-tree` required on `main` — see the PR's verification comment

## Notes

- PR #12 was closed and its branch rebuilt as `main` + the two screenshots (`9616161`), so PR #11's
  embedded `raw.githubusercontent.com` images keep resolving; the original commit `af9a724` is no
  longer referenced by any ref.
- The workflow deliberately uses `pull_request`, not `pull_request_target`: this repository is
  public and GitHub's default event policy starts blocking `pull_request_target` on 2026-11-02,
  which would leave a required check permanently unreported.
- `3d9dec4` carries the rule, the hook, the lesson and the doc; the trigger correction and this plan
  land in the follow-up commit on the same branch.
