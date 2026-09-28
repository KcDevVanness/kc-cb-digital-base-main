# Money caliber unification — amounts 2 decimals / unit prices 4 (dedicated PR)

Source doc: `.ai/specs/2026-09-28-money-scale-2dp-unification.md`

## Goal

Every monetary **amount** in the app is `numeric(18,2)` with HALF_UP (away from zero) as the single
rounding rule; every **unit price** is `numeric(18,4)`; the only rounding point is
`HALF_UP(quantity × unit price, 2)` and totals are exact sums of already-rounded line amounts.
Storage, computation, API, exports, printed documents and reconciliation all share that caliber.

## Scope

- **In**: the money engine (`trade_docs/lib/money.ts` → `AMOUNT_SCALE=2`, `PRICE_SCALE=4`, exact
  `divideHalfUp`/`toScaledUnits`, currency-scale machinery removed), the amount/price columns that
  exist on this branch (trade_docs contracts+invoices, purchasing, products prices, sourcing quote
  lines, platform_ops, export_finance refunds), their validators and write paths, the display layer
  (`MoneyAmount` fixed 2 decimals, unit prices 4), the printed contract template
  (4-decimal price / 2-decimal amount cells), the internal_sales entry check, and the caliber
  documentation.
- **Out**: modules that do not exist on this branch yet (`finance/**`, PI/CI invoice+document
  pipeline, ru_sync, boss_cockpit) — they adapt in their own PRs; quantities, weights, tax rates and
  FX rates are deliberately unchanged.

## Risks

- The migrations narrow columns (`18,4 → 18,2`, `18,6 → 18,4`); existing values round HALF_UP and
  the change is not reversible for already-rounded digits (migration is generate-only here; the
  owner applies it).
- A supplier-price migration lives in the `sourcing` chain on purpose: `purchasing` is registered
  before `sourcing`, so an ALTER there would run before the table rename that creates the table
  (`.ai/lessons/cross-module-rename-migration-ordering.md`).

## Implementation Plan

This PR extracts the already-implemented and verified change from the shared integration tree onto
this branch's HEAD; it contains only the caliber slice and none of the other sessions' work.

### Phase 1: Engine and schema on this branch

- [x] 1.1 Engine: `AMOUNT_SCALE=2`/`PRICE_SCALE=4`, `divideHalfUp`/`toScaledUnits` in the engine, currency-scale machinery deleted — extracted
- [x] 1.2 Columns on this branch's tables patched to amounts `18,2` / prices `18,4`; migrations regenerated, scoped and reviewed — extracted
- [x] 1.3 The supplier-price ALTER relocated to the `sourcing` chain — extracted

### Phase 2: Write paths and reconciliation

- [x] 2.1 purchasing (engine totals, deposit derivation, exact guards, price kinds) — extracted
- [x] 2.2 platform_ops (quantize + warn, exact reconciliation, dedup rule) — extracted
- [x] 2.3 cross_border (exact quantities, exact over-allocation guard) — extracted
- [x] 2.4 sourcing/products (import quantization, price scale 4, exact change detection) — extracted
- [x] 2.5 currency_policy (engine rate inversion, 2-decimal CNY conversion) — extracted
- [x] 2.6 trade_docs/export_finance validators and call sites — extracted

### Phase 3: Display, templates and entry checks

- [x] 3.1 `MoneyAmount`/`formatMoneyAmount` fixed 2 decimals; unit prices 4 (`kind="price"`) — extracted
- [x] 3.2 Contract template: 4-decimal price / 2-decimal amount cells — extracted
- [x] 3.3 internal_sales entry validation (`lineScaleViolation`) + i18n keys — extracted

### Phase 4: Documentation

- [x] 4.1 Spec `.ai/specs/2026-09-28-money-scale-2dp-unification.md` + lesson recurrence — extracted
- [x] 4.2 Affected specs/docs/README caliber statements and status board row — extracted

### Phase 5: Validation

- [x] 5.1 `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test`, `yarn build` on this branch
- [x] 5.2 Commit, push, open the PR against `feat/cross-border-erp`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Engine and schema on this branch

- [x] 1.1 Engine: `AMOUNT_SCALE=2`/`PRICE_SCALE=4`, `divideHalfUp`/`toScaledUnits` in the engine, currency-scale machinery deleted
- [x] 1.2 Columns on this branch's tables patched to amounts `18,2` / prices `18,4`; migrations regenerated, scoped and reviewed
- [x] 1.3 The supplier-price ALTER relocated to the `sourcing` chain

### Phase 2: Write paths and reconciliation

- [x] 2.1 purchasing (engine totals, deposit derivation, exact guards, price kinds)
- [x] 2.2 platform_ops (quantize + warn, exact reconciliation, dedup rule)
- [x] 2.3 cross_border (exact quantities, exact over-allocation guard)
- [x] 2.4 sourcing/products (import quantization, price scale 4, exact change detection)
- [x] 2.5 currency_policy (engine rate inversion, 2-decimal CNY conversion)
- [x] 2.6 trade_docs/export_finance validators and call sites

### Phase 3: Display, templates and entry checks

- [x] 3.1 `MoneyAmount`/`formatMoneyAmount` fixed 2 decimals; unit prices 4 (`kind="price"`)
- [x] 3.2 Contract template: 4-decimal price / 2-decimal amount cells
- [x] 3.3 internal_sales entry validation (`lineScaleViolation`) + i18n keys

### Phase 4: Documentation

- [x] 4.1 Spec `.ai/specs/2026-09-28-money-scale-2dp-unification.md` + lesson recurrence
- [x] 4.2 Affected specs/docs/README caliber statements and status board row

### Phase 5: Validation

- [x] 5.1 `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test`, `yarn build` on this branch — all green (typecheck 0; 39 suites / 310 tests; lint 0 errors / 8 pre-existing warnings; ds:check 705 files; production build ✓)
- [ ] 5.2 Commit, push, open the PR against `feat/cross-border-erp`

### Deferred (not this PR)

- purchasing payment-state wiring (`paidTotal`/`outstanding` on the order API and the detail view consuming them, replacing the local float `summarizePayments`) and attachment previews stay uncommitted in the shared tree; they ride with the purchasing payment/attachment slices.
