---
title: "src/modules.ts is loaded by the CLI: page overrides shadow the package file, never import client code"
modules: ["platform", "dictionaries"]
areas: ["umes", "architecture", "framework-context"]
topics: ["module-overrides", "route-overrides", "page-override", "module-registry", "cli-bootstrap", "client-boundary"]
---

# src/modules.ts is loaded by the CLI: page overrides shadow the package file, never import client code

**Context**: Replacing the installed `/backend/config/dictionaries` page body, the first wiring put the
app component into `src/modules.ts` — `overrides.routes.pages['/backend/config/dictionaries'] = { Component: DictionariesLibrary }`
with a static import of the component, which is `"use client"` and imports `next/navigation`. Next
compiled it and the page rendered, but every `yarn mercato …` invocation (and the dev supervisor's MCP
API-key provisioning, which loops on it) failed with
`Failed to load the app-level modules file (src/modules.ts); entry.overrides cannot be applied. Refusing
to bootstrap with a partial override set.`, and the browser logged
`Failed to apply module overrides on the client; registries stay unfiltered`.

**Problem**: `src/modules.ts` is not a Next-only module. The CLI, the dev supervisor and the
client-side override applier all evaluate it outside the RSC graph, so a static import there drags the
whole imported graph into plain Node/browser. A client-component graph (`next/navigation`, Radix, UI
primitives) is not loadable in that context, and the override dispatcher **fails closed** — the app
refuses to bootstrap rather than apply a partial override set. The failure appears in a side channel
(MCP provisioning, client console), not in the page you were working on.

**Rule**: keep `src/modules.ts` free of app UI imports — types and small server-safe helpers only. To
replace an installed **page body**, mirror the file inside the app module directory instead:
`src/modules/<id>/backend/.../page.tsx` shadows the packaged page (the generator merges
`src/modules/<id>` with the package module root by logical path and the app file wins, so the generated
route manifest imports the app file), and `page.meta.ts` can be a one-line
`export { metadata } from '@open-mercato/core/…'` so navigation, ACL features, title and breadcrumb
stay package-owned. For `overrides.routes.pages` values, use `{ metadata }`, `null` (disable), or a
`load` that resolves a server-safe module — never a static client-component import.

**Applies to**: `src/modules.ts`, `src/modules/<id>/backend/**/page.tsx` + `page.meta.ts`,
`overrides.routes.pages`, any app-side override of an installed page. Worked example:
`src/modules/dictionaries/` (contract in its `README.md`).
