---
title: "Keep file-agent sandbox sources out of the app's typed build"
modules: ["agent_examples"]
areas: ["ai-workflow", "architecture"]
topics: ["tsconfig", "typecheck", "build-gate", "sandbox", "file-agents"]
---

# Keep file-agent sandbox sources out of the app's typed build

**Context**: `yarn dev` never type-checks, so this stayed latent until `yarn build` reached
its `Running TypeScript` step and failed on 18 errors — all of them in
`src/modules/agent_examples/agents/**/{scripts,tools}/*.ts`, none of them related to the
change being built. The files define `function run(args)` plus shared helpers like `clamp01`
with no imports and no exports, so TypeScript treats each as a global script and reports
`TS2393 Duplicate function implementation` as soon as two of them coexist.

**Problem**: These files are not modules. The orchestrator reads them with `fs` and wraps the
source text verbatim in `async () => { <source>; run(__args) }` before compiling it inside an
`isolated-vm` isolate, so adding `export {}` to silence the compiler breaks the sandbox, and
importing them anywhere is impossible. They are still inside `include: ["**/*.ts"]`, so tsc
picks them up and the build gate goes red for code that never executes at build time.

**Rule**: `tsconfig.json` `exclude` must list `src/modules/*/agents/**/scripts/**` and
`src/modules/*/agents/**/tools/**`. Never "fix" the errors in the files themselves — no
`export {}`, no type annotations, no `@ts-nocheck`; the source is data for the sandbox.
Enabling such a module can therefore change whether `yarn build` passes, which is why the
`exclude` entries ship with the module.

**Applies to**: `tsconfig.json`, `src/modules/*/agents/**/scripts/**`,
`src/modules/*/agents/**/tools/**`, `@open-mercato/enterprise` `agent_orchestrator`.
