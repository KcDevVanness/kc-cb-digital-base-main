---
title: "A metadata file no parser reads reads as configured"
modules: ["storage_ops", "platform"]
areas: ["testing", "framework-context"]
topics: ["integration-discovery", "metadata-syntax", "env-gating", "silent-gate", "playwright"]
---

# A metadata file no parser reads reads as configured

**Context**: `src/modules/*/__integration__/meta.ts` declared its requirements as `export const dependsOnModules = [...]` / `export const requiredEnvVars = [...]`. The installed discovery extractor (`@open-mercato/cli/lib/testing/integration-discovery`) matches object-property `name: [...]` syntax only, so every app module's file parsed to an empty requirement list. The gate did nothing: the four `storage_ops` specs that need an S3 endpoint were discovered and failed with "STORAGE_OPS_TEST_S3_CONFIG is not set", while every other app meta dependency (`products`, `purchasing`, `trade_docs`, …) was equally inert.

**Problem**: A metadata file that parses to nothing is worse than no file at all, because reviewers and future agents read it as configured and trust a gate that is not there. The extractor is also first-match: it scans the whole file for `name: [` and takes the earliest hit, so a comment above the real list that spells out the property name followed by `[...]` shadows the declaration and silently empties it again.

**Rule**: Declare integration metadata as properties of one exported `integrationMeta` object — the shape the installed package's own `*.meta.js` files use — and verify it with `discoverIntegrationSpecFiles(projectRoot, path.join(projectRoot, '.ai', 'qa', 'tests'))`: the returned entries must carry non-empty `requiredModules` / `requiredEnvVars`. Keep spec-side `test.skip(...)` guards even when the filter works, so a direct invocation and a future metadata break stay honest.

**Applies to**: `src/modules/*/__integration__/meta.ts`, `src/modules/*/__integration__/helpers.ts`, `.ai/qa/tests/playwright.config.ts`, `node_modules/@open-mercato/cli/lib/testing/integration-discovery`.
