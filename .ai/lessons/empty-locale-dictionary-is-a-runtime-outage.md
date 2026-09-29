---
title: "An empty or half-written locale dictionary is a whole-app outage, and the degraded banner outlives the fix"
modules: ["platform"]
areas: ["debugging"]
topics: ["i18n", "locale-dictionaries", "generated-i18n-barrel", "dev-runtime", "json-imports", "atomic-writes"]
---

# An empty or half-written locale dictionary is a whole-app outage, and the degraded banner outlives the fix

**Context**: `.mercato/generated/modules.i18n.<locale>.generated.ts` statically imports every enabled
module's `i18n/<locale>.json`, so each dictionary is part of the server bundle — not a file read at
request time. `yarn dev` watches the tree, and the dev supervisor classifies app-log failures into
runtime incidents (`.mercato/dev-runtime-status.json`) surfaced by the auto-opened splash window
(`scripts/dev.mjs`, `OM_DEV_AUTO_OPEN=0` disables the window).

**Problem**: on 2026-09-24 16:05:37 the app died with
`⨯ ./.mercato/generated/modules.i18n.zh.generated.ts:22:1`, and the real cause sat one frame below:
`./src/modules/purchasing/i18n/zh.json:1:1 Unable to make a module from invalid JSON — EOF while
parsing a value at line 1 column 0`, i.e. the bundler read a **0-byte** file where the import at line 22
(`T_purchasing_zh_A`) expected `export default`. Every route, `/api/healthz` included, answered 500 for
17 minutes (~977 failed compiles) until the file was rewritten with its committed content at 16:22:46 —
and `git status` showed the file as *unmodified versus HEAD*, so nothing was lost and the diff never
hinted at a problem. The two earlier incidents were the same class, differently worded: 2026-09-21
`src/modules/cross_border/i18n/zh.json:31`, 2026-09-24 12:23 `src/i18n/zh.json:1273`, both
"expected `,` or `}`" from a dictionary rewritten in place while the dev server watched the tree. All
three landed immediately after a translation edit, so the trigger is the write, never the app. The
banner also lies about recovery: log-sourced incidents are latched for the whole runtime generation and
only `beginGeneration`/`markReady` clear them (`scripts/dev-runtime-state.mjs:445,481,487`); only
`probe` incidents auto-clear (`scripts/dev-runtime-supervisor.mjs:73`). A now-valid file therefore
leaves the panel reporting 运行时已降级 / degraded until the runtime is relaunched.

**Rule**: write a locale dictionary — like any file a generated barrel imports — complete in one write,
never truncate-then-fill, and never leave an edit half-applied: a dictionary that is momentarily empty
or missing one comma is a whole-app 500, not a missing label. When the popup names
`.mercato/generated/modules.i18n.*.generated.ts:<line>`, read one frame further for the real file,
verify it parses, then clear the banner by restarting the dev runtime (the panel's 重启运行时, recovery
action `restart`) — fixing the file alone leaves the incident latched, and the app answering 200 again
does not change the reported health.

**Applies to**: `src/modules/*/i18n/*.json`, `src/i18n/*.json`, and anything imported by
`.mercato/generated/**`; evidence in `.mercato/dev-runtime-status.json`,
`.mercato/dev-splash-child-state.json`, `scripts/dev-runtime.mjs` (`publishRuntimeFailure`), and the
app log tail under `.mercato/logs/*-app-raw.log`.
