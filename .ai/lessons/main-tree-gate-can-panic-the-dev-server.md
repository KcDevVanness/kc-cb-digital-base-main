---
title: "Running the main-tree validation gate beside the dev server can panic Turbopack"
modules: ["platform"]
areas: ["debugging"]
topics: ["dev-server", "turbopack", "validation-gate", "dev-reset", "generate", "verification"]
---

# Running the main-tree validation gate beside the dev server can panic Turbopack

**Context**: 2026-10-09 — `docs/dev/parallel-development.md` keeps the owner's review checkout running
`yarn dev` in the main directory, and expects every unit to run the broad gate
(`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check &&
yarn test && yarn build`) in that same tree after merging into the local `dev`. Doing both at once
that day cost ~30 minutes of effectively dead app: `yarn generate` rewrote `.mercato/generated/**`,
every client chunk importing a generated module was invalidated, and the Turbopack dev server went
from ~3s pages to 22–44s ones with 161 chunk requests queued. Under that load the runtime aborted:

```
thread 'tokio-rt-worker' panicked at turbopack/crates/turbo-tasks-backend/src/backend/operation/mod.rs:292:17:
Restore of All for task TaskId 1986592 failed in another thread: restoring failed
turbo-tasks: an internal panic occurred outside the per-task panic boundary … Aborting.
[server] Shutting down...  💥 Failed: Next.js dev server exited unexpectedly
```

The dev supervisor reported `App runtime exited unexpectedly with exit code 1` and stopped, so
`localhost:3000` answered connection-refused while the failure looked, from the browser, like an app
defect (pages stuck on 加载中 / 加载失败, blocks never appearing, CDP calls timing out).

**Problem**: the two workloads are both legitimate and both documented, and the failure they can
produce together is *indistinguishable from a code regression* inside a browser session — the pages
that fail are exactly the ones a smoke is meant to verify. The persisted Turbopack cache makes it
worse: a restore failure survives the process, so a bare `yarn dev` restart can panic again.

**Rule**: after running the gate in the main tree, treat the dev server as suspect until it answers
warm (a page under ~5s): if it degrades or exits, run `yarn dev:reset` (drops `.mercato/next/dev` +
`.next/cache/turbopack|webpack` — never the DB) and start `yarn dev` again; never diagnose an app
defect from a page that loaded while the gate was running, and never leave the owner's tree without a
live supervisor. When the smoke can wait, gate first, smoke after — or smoke in another checkout.

**Applies to**: the main review checkout's `yarn dev`, `yarn dev:reset`, `.mercato/logs/*-app-raw.log`,
`.mercato/next/dev/logs/next-development.log`, and any UI smoke run against :3000 during a gate.
