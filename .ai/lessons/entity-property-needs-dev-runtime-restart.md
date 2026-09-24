---
title: "A new entity property needs a dev-runtime restart; until then the API accepts the write and silently drops it"
modules: ["purchasing", "sourcing", "products", "platform"]
areas: ["module-data", "debugging", "framework-context"]
topics: ["entity-properties", "mikro-orm-metadata", "dev-runtime", "restart-action", "silent-write-drop", "migrations"]
---

# A new entity property needs a dev-runtime restart; until then the API accepts the write and silently drops it

**Context**: adding two nullable columns to `PurchasingSupplierProduct` (`unit_gross_weight`, `unit_volume`)
on 2026-09-24. The migration was generated and applied to the dev database, `yarn typecheck` was green, the
list route already **returned** the new fields (`unitGrossWeight: null`), and an invalid value was **rejected**
by the validator (`400 … path: ["unitVolume"] value must be a decimal number`). A valid `PUT` with
`{"unitGrossWeight":"1.84","unitVolume":"0.0886"}` answered **200 `{"ok":true}`** — and the columns stayed
`null`. The same request succeeded after the dev runtime was restarted through the panel's restart action
(`POST /api/dev-runtime/actions/restart` with the token from `.mercato/dev-runtime-status.json`): `1.8400` /
`0.088600`.

**Problem**: the dev server had been started ~50 minutes *before* the entity file changed. Turbopack reloads
route/validator modules per request, so the read projection and the zod schema were fresh — but MikroORM
builds its metadata (and therefore its property list) **at boot**. An assignment to a property the metadata
does not know is not tracked as a change, so `updateOrmEntity({ apply })` writes nothing and still reports
success. Nothing in the response, the logs or the page indicates a dropped field, so the symptom looks like a
form bug or a bad payload. A restart is also not implied by `yarn generate`: it printed "Generated outputs
unchanged; skipping structural invalidation", so no generation-driven restart happened.

**Rule**: after adding or renaming an **entity property**, restart the dev runtime before testing the write
path, and verify a write by **reading the value back** (API or page), never by the `200` alone. When a write
appears to vanish, check the process start time against the entity file's mtime
(`ps -o lstart= -p <pid>` vs `stat -f %Sm <entity.ts>`) before touching the form, the schema or the command.
The sanctioned restart is the dev-runtime panel action, not killing the process.

**Applies to**: any `src/modules/*/data/entities.ts` change; dev-server smoke tests of CRUD writes;
`scripts/dev.mjs` / `scripts/dev-runtime.mjs` managed runtimes; the `purchasing` supplier product library and
every other app-owned module.
