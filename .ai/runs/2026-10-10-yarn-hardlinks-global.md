# Execution plan — share the dependency tree across worktrees (2026-10-10)

Stop every worktree from paying a full ~1.8 GB copy of `node_modules`: switch Yarn's
node-modules linker to `nmMode: hardlinks-global` so one extracted store per machine is hardlinked
into each project.

## Goal

On this machine two worktrees carry `node_modules` of 1.8 GB each (`du -sh`), and a third is about
to — measured 2026-10-10 in `/Users/vanness/Developer/kc-cb-digital-base-min` and
`../kc-cb-digital-base-min-catalog-phase1`, with `stat -f %l` reporting **link count 1** on
installed files and `du -shc` of both trees summing to 3.5 GB, i.e. plain copies, no sharing.

Root cause: Yarn 4's `nodeLinker: node-modules` materialises packages by copy unless `nmMode` says
otherwise, and `nmMode` defaults to `classic` ("for compatibility with the ecosystem"). The global
zip cache (`~/.yarn/berry/cache`, 2.4 GB) is already shared, but the *extracted* tree is not.

`nmMode: hardlinks-global` is the Yarn-native equivalent of pnpm's store: Yarn keeps one extracted
content-addressable store (`~/.yarn/berry/store`) and hardlinks it into every project. Measured in
two throwaway copies of this project before writing this plan (`/tmp`, same filesystem, warm cache):
first tree 1.6 GB, second tree **768 KB**, both trees sharing one inode per file
(`next/package.json`: 3 links, identical inode), `du -shc` of both trees 1.6 GB; a third tree that
was first installed with `classic` and then re-run with the new setting converted in place
(link count 1 → 4) without deleting `node_modules`.

## Scope

- `.yarnrc.yml`: add `nmMode: hardlinks-global` with the caveat comment.
- Canary verification in this run's own worktree: full `yarn install` (install scripts enabled)
  under the new mode, then hardlink/native-artifact checks.
- `docs/dev/setup.md` and `docs/dev/parallel-development.md`: document the shared store, the
  per-worktree cost, and the write-through caveat.
- One lesson record (`.ai/lessons/*.md` + catalog row) so the next agent does not re-derive it.
- Non-goals: no package-manager migration (pnpm), no lockfile change, no dependency change, no
  changes to CI workflows or the Dockerfile, no `.env`/port changes.

## Implementation Plan

### Phase 1: config + canary

- 1.1 Worktree `../kc-cb-digital-base-min-yarn-hardlinks` on `chore/yarn-hardlinks-global` off
  `origin/dev` (`09c6403`), `.env` copied from the primary checkout.
- 1.2 Add `nmMode: hardlinks-global` to `.yarnrc.yml`.
- 1.3 Canary: full `yarn install` (install scripts on) and verify — link count ≥ 2 and store-shared
  inode on representative files, native build outputs present (`isolated-vm`,
  `@newrelic/native-metrics`, `esbuild`, `@parcel/watcher`), and the tree's `du` against the store.

### Phase 2: docs + lesson

- 2.1 `docs/dev/setup.md`: dependency-install section — what the mode does, per-worktree cost, how
  to reclaim the store, when to expect it not to apply (filesystem boundary, CI container).
- 2.2 `docs/dev/parallel-development.md`: one paragraph in the worktree section — dependencies are
  shared per machine, not per worktree.
- 2.3 Lesson record + catalog row; `node scripts/check-lessons.mjs` green.

### Phase 3: verification + PR

- 3.1 Broad gate (`validation.commands`) on this tree.
- 3.2 Draft PR off the first commit, labels, `om-auto-review-pr` pass, summary comment, ready.

## Risks

- **Write-through**: hardlinked files share their inode with the store, so rewriting a file in place
  under `node_modules` (patch tools, ad-hoc edits, an install script that rewrites its own files)
  changes the store for every project on the machine. This repo has no `yarn patch`/patch workflow
  and 11 packages with install scripts; the canary install runs those scripts and the gate exercises
  the result. If it ever bites, `rm -rf ~/.yarn/berry/store` + a reinstall rebuilds everything from
  the zip cache; pnpm (store + APFS clones) is the durable alternative and a separate unit.
- **Cross-filesystem fallback**: hardlinks need the store and the project on one filesystem; on a
  split setup Yarn degrades to copying (no failure). Same filesystem on this machine
  (`/System/Volumes/Data`) and inside the Docker/CI containers.
- **CI/Docker**: `.yarnrc.yml` is copied into both image stages and CI, so the mode applies there
  too. The CI cache only restores the zip cache, not the store, so each CI run rebuilds the store
  from the cache locally (no network, +10–30 s on this project's size); the runner stage's
  `yarn workspaces focus` + `chown` block stays one layer, where hardlinks cost nothing extra.
- **Space accounting**: `du` on a single tree still reports the logical size; only
  `du -shc`/inode checks show the sharing. Documented so the "still 1.8 GB" reading is not a false
  alarm.

## Source doc

This file is the requirement record (the tracker has no issues); the change lands in
`docs/dev/setup.md` + `docs/dev/parallel-development.md`. Owner decision 2026-10-10: fix with
Yarn's own store mode rather than migrating to pnpm.

## Progress

PR: #172

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: config + canary

- [x] 1.1 worktree + branch off `origin/dev` (`09c6403`), `.env` copied
- [x] 1.2 `nmMode: hardlinks-global` added to `.yarnrc.yml` — `56f98da`
- [x] 1.3 canary install verified — 23.7 s, link count ≥ 2, `next/dist/server/next.js` inode `30230023` == `~/.yarn/berry/store/v1/2f/5060aba5….dat`, native parity with the primary tree, throwaway second project 768 KB / shared inode, `require` smoke of four native packages green

### Phase 2: docs + lesson

- [x] 2.1 `docs/dev/setup.md` documents the mode, the cost and the caveat — `288ecaf`
- [x] 2.2 `docs/dev/parallel-development.md` notes the shared store — `288ecaf`
- [x] 2.3 lesson record + catalog row, `check-lessons` green — `288ecaf`

### Phase 3: verification + PR

- [x] 3.1 broad gate (`validation.commands`) green — `generate` ✓ (known OpenAPI bundle fallback, pre-existing), `typecheck` 0 error, `lint` 0 error / 12 pre-existing warnings, `check-lessons` ✓ (67 records), `ds:check` 1109 files, `test` 94 suites · 832 tests, `build` ✓
- [ ] 3.2 PR opened, labelled, reviewed, flipped to ready
