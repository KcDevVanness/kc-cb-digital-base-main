---
title: "yarn mercato module add rewrites src/modules.ts and drops its comments — diff the file before anything else"
modules: ["platform"]
areas: ["architecture", "framework-context"]
topics: ["module-registry", "cli-side-effects", "comments", "code-review", "generated-files"]
---

# yarn mercato module add rewrites src/modules.ts and drops its comments — diff the file before anything else

**Context**: Phase 0 of [`.ai/specs/2026-09-23-local-to-s3-storage-migration.md`](../specs/2026-09-23-local-to-s3-storage-migration.md) needed `@open-mercato/storage-s3` installed and registered, so the documented path was used: `yarn mercato module add @open-mercato/storage-s3`. The command installed the package, appended `{ id: 'storage_s3', from: '@open-mercato/storage-s3' }`, ran the generators, and printed `✅ Module "storage_s3" enabled from @open-mercato/storage-s3.`

**Problem**: the same command silently rewrote the rest of `src/modules.ts`. Measured with `git diff --stat src/modules.ts`: **1 insertion, 58 deletions** (309 → 252 lines) — every app-policy comment block in the file was gone, including the catalog "Product SEO Helper" override rationale, the `navHidden`-not-`null` rule for the installed ERP pages, and the per-module pointers to `.ai/specs/**`. The file was clean in `git status` before the command, so the loss was entirely the command's.

Two properties make this expensive to notice:

1. **The command reports success and points elsewhere.** Its "Next steps" talk about `.mercato/generated/` and `yarn dev`; nothing says "review `src/modules.ts`", and the entry it added looks correct in isolation.
2. **The lost content is the file's only documentation.** `src/modules.ts` carries decisions that no other file states — which installed pages are hidden and why, that `null` breaks stored notification links, that the SEO widget is dropped on purpose. The TypeScript still compiles and `yarn generate` still succeeds without them, so no gate catches it.

The mechanism: the registration writer parses the file with the TypeScript compiler API and re-prints it (`node_modules/@open-mercato/cli/src/lib/modules-config.ts` → `ensureModuleRegistration`). Comments that are not attached to a surviving node are not carried through the printer. The same writer runs for `module enable` and `module eject`.

**Rule**: treat any `yarn mercato module …` that touches the registry as a lossy edit to a documentation-bearing file.

- After `module add` / `module enable` / `module eject`, run `git diff src/modules.ts` (or `--stat`) as the very next step, before running anything else.
- If comments were dropped, `git checkout -- src/modules.ts` (safe when the file was clean before the command) and hand-add the entry in the file's own style — the conditional shape is fine and often better: `if (parseBooleanWithDefault(process.env.<FLAG>, false)) enabledModules.push({ id: '<module>', from: '<package>' })`.
- Prefer hand-editing `src/modules.ts` outright for this app; use `module add` only when the package itself must be installed, then verify the diff.
- The package install and the registry entry are separable: `yarn add <package>` + a hand-written entry achieves the same state without the rewrite.
- When the registry entry is flag-gated, remember the flag must match at generate/build time and at runtime (see [s3-storage-enablement-traps.md](./s3-storage-enablement-traps.md)).

**Applies to**: `src/modules.ts`, `yarn mercato module add|enable|eject`, any spec phase that installs an official module, and any future CLI command whose "success" includes rewriting a hand-maintained source file.
