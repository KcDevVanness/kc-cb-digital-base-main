---
title: "A module's API path segment is its directory name, not its page path"
modules: ["products", "trade_docs", "purchasing", "parties"]
areas: ["module-data", "framework-context"]
topics: ["api-routes", "route-generation", "generated-files", "module-registry", "path-naming", "debugging"]
---

# A module's API path segment is its directory name, not its page path

**Context**: The new `trade_docs` module registered its routes at
`src/modules/trade_docs/api/contracts/route.ts` and its pages at
`src/modules/trade_docs/backend/trade-docs/contracts/page.tsx`. The pages resolved at
`/backend/trade-docs/contracts`, so the client code assumed the API would live at
`/api/trade-docs/contracts` — every call 404'd with `{"error":"Not Found"}` until the paths were
changed to `/api/trade_docs/...`.

**Problem**: Two different naming rules apply to the same module, and only one of them is visible
in the URL you type while testing pages:

- **Pages** take the path written on disk under `backend/` — a kebab-case folder like
  `backend/trade-docs/` is served as `/backend/trade-docs/...`. This is what
  `docs/plans/cross-border-erp.md` calls "backend paths drop the module name" and is easy to
  over-generalize.
- **API routes** are projected by the generator as `/<module directory name>/<path under api/>`,
  i.e. `src/modules/trade_docs/api/contracts/route.ts` → `/api/trade_docs/contracts`. The
  segment is the *directory* name (`trade_docs`, snake_case), never the page folder name.

The generated manifest is the authority and is easy to check before writing client code:
`.mercato/generated/api-route-metadata.generated.ts` lists every route with its `moduleId` and
`path`, and `api-route-shard.NNN.<module>.generated.ts` repeats it per module.

**Rule**: Before wiring a client call to a new module route, read the module's entry in
`.mercato/generated/api-route-metadata.generated.ts` (or `.mercato/generated/api-route-shard.*`)
and use the `path` it reports, prefixed with `/api`. Do not derive API paths from page folders or
from the module's display name. A snake_case module directory keeps snake_case API segments even
when its pages use kebab-case folders.

**The module-name segment is the folder under `api/`, so the folder is the only way to drop it.**
A resource folder named like the module doubles it — the installed `currencies` module ships
`api/currencies/route.ts` and is served at `/api/currencies/currencies` (with
`/api/currencies/currencies/options` beside it). A route file directly at `api/route.ts` adds no
second segment, which is how the installed `dictionaries` module owns `/api/dictionaries`. The new
app-owned `parties` module wanted `/api/parties`, `/api/parties/[id]` and `/api/parties/options`;
nesting them under `api/parties/` produced `/api/parties/parties*`, and moving the three files to
`api/route.ts`, `api/[id]/route.ts`, `api/options/route.ts` produced exactly the intended paths. Do
this before writing clients against the URLs, and re-check `yarn generate` output afterwards — the
generated shard is the proof, not the spec prose.

**Applies to**: every `src/modules/<id>/api/**` route and its client callers
(`src/modules/trade_docs/components/**`, `src/modules/products/**`), `yarn generate` output under
`.mercato/generated/`, and any new app-owned module.
