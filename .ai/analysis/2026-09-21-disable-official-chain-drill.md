# Disable-Official-Chain Drill — Evidence Record

**Date**: 2026-09-21
**Question**: if the app builds its own business flows, can the installed business modules be switched off — what disappears, what stays, and what breaks?
**Verdict**: the shrink is clean, non-destructive and reversible; the `requires` graph is **not** guarded at generate time, so disabling is a manual-correctness exercise with a hard runtime failure mode when a dependency edge is violated.

## Method

Isolated worktree (`drill/disable-official-chain`), HEAD `16214fd`, with `.env`, `src/modules.ts` (working-tree version), and the app-owned modules `currency_policy` / `scope_guards` copied in; `yarn install` (16 s).

```bash
yarn generate                    # baseline (all modules on)
# scenario A: remove sales + wms
yarn generate ; yarn db:generate ; yarn typecheck
# scenario B: remove catalog, customers, currencies, dictionaries, feature_toggles too
yarn generate ; yarn typecheck
# scenario C: `sales` enabled while its required `catalog` is absent (invalid graph)
yarn generate ; yarn tsx drill-probe-missing-dep.ts
```

## Scenario A — `sales` + `wms` off (registries shrink, nothing else changes)

| Metric | Before | After |
|---|---|---|
| entity modules (`entities.generated.ts`) | 16 | 14 |
| api route shards | 19 | 17 |
| backend route shards | 23 | 21 |
| `/api/**` paths | 240 | 181 |
| `/backend/**` paths | 105 | 80 |
| `/api/sales/**`, `/api/wms/**` paths | 36, 23 | 0, 0 |
| `/backend/sales/**`, `/backend/wms/**` pages | 12, 11 | 0, 0 |
| `sales.*` / `wms.*` ACL features in the runtime registry | 19, 8 | 1, 0 |
| generated files referencing `modules/sales` / `modules/wms` | 34, 29 | 0, 0 |
| catalog `/api/catalog/**` paths (unaffected) | 13 | 13 |

- `yarn generate` exits 0; `yarn typecheck` reports only the pre-existing `src/modules/scope_guards/__integration__/scope-guards.spec.ts(214,23)` error.
- **`yarn db:generate` produced no migration at all** (96 ms, no new files, exit 0): disabling a module does not drop tables, does not touch data, and does not invalidate the schema snapshot. Deactivation is registry-only, exactly as the ERP activation spec claimed.
- Shard files for the disabled modules are gone (`no sales/wms shard files remain`).

### Residual coupling found

The one surviving `sales.*` reference is catalog's own route metadata: `node_modules/@open-mercato/core/src/modules/catalog/api/offers/route.ts:43-46` gates `GET/POST/PUT/DELETE /api/catalog/offers` with `requireFeatures: ['sales.channels.manage']`. With `sales` disabled that feature is defined by no enabled module, so the endpoint cannot be granted through the ACL UI; `hasAllFeatures` (`node_modules/@open-mercato/shared/dist/lib/auth/featureMatch.js`) only passes when the granted list contains the string, i.e. it fails closed unless a stale grant survives on a role. Keeping `catalog` without `sales` therefore leaves a dead offers endpoint.

## Scenario B — all seven business modules off

| Metric | Value |
|---|---|
| entity modules | 9 (auth, directory, configs, entities, query_index, audit_logs, notifications, dashboards, attachments) |
| api route shards / backend shards | 12 / 14 |
| `/api/**` paths / `/backend/**` paths | 94 / 40 |
| `yarn generate` | exit 0, no warnings mentioning missing modules |
| `yarn typecheck` | only the pre-existing `scope_guards` spec error |

The platform-only surface still boots the app; the app-owned modules (`currency_policy`, `scope_guards`, both entity-less) keep registering.

**App-owned coupling to respect when shrinking**:

- `src/modules/currency_policy/index.ts:11` — `requires: ['currencies', 'dictionaries', 'customers']`
- `src/modules/scope_guards/index.ts:11` — `requires: ['auth', 'directory']`

## Scenario C — invalid graph (`sales` on, `catalog` off)

- `yarn generate`: **exit 0**, no warning, 103 API paths generated — the `requires` graph is not validated on this path. The only `requires` handling in the installed toolchain lives in `yarn mercato module add/enable` (`@open-mercato/cli/dist/lib/module-install.js`) and the dev supervisor manifest.
- Runtime probe (`drill-probe-missing-dep.ts`):

  ```
  [drill] registered entities: 66 | metadata entries: 66
  [drill] catalog entities registered: false
  [drill] CatalogOffer: FAILED — MetadataError: Metadata for entity CatalogOffer not found
  [drill] CatalogPriceKind: FAILED — MetadataError: Metadata for entity CatalogPriceKind not found
  ```

  So a violated dependency edge surfaces as a **hard `MetadataError` at request time** (sales' `/api/sales/channels`, `/api/sales/price-kinds`), never as a generate-time error.

## Documentation correction

`.ai/specs/2026-09-21-erp-core-module-activation.md` (REQ-001 / "Proposed Solution") states that `sales`/`wms` `requires` edges are "enforced by the generator, not by convention" and that the CLI "exits non-zero listing any missing module". Scenario C contradicts that on the installed toolchain (`@open-mercato/cli` as shipped with `@open-mercato/core@0.8.0`): the check does not fire for a module-to-module edge on the `generate` path. The spec should be amended before it is relied on again.

## Not covered

- Runtime verification with a live dev server and an authenticated session (route-level 404s, nav absence, ACL denial).
- Behaviour when a **required** app module is disabled and its seed/CLI path runs (`currency_policy` with `currencies` off).
- Re-enabling: not tested here, but it is the same `src/modules.ts` edit plus `yarn generate`; tables and data never left.
