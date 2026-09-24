# CNY Equivalents for Money Amounts (全站金额的 CNY 换算显示)

**Date**: 2026-09-24
**Status**: Implemented and verified — **Phases 1–6 landed 2026-09-24** (feed live, rates route + shared money component, every app-owned money surface converted, and the installed sales-orders table carrying an injected 折合人民币 column). One documented gap: the installed quotes/payments tables publish no enricher host, so a CNY column there has no source to read (see Phase 6)

> Prerequisite reading: the installed `currencies` module owns the rate master (`exchange_rates`),
> the provider registry and the fetch service; `currency_policy` (app-owned) owns the currency policy
> that converges the currency dictionary and the rate master; `2026-09-22-supplier-product-library.md`
> owns the price surfaces this spec starts with. This spec adds **no** table of its own.

## TLDR

Every money amount the app renders can carry its **CNY equivalent** — the company is China-based, so a
price in USD/HKD/EUR is only readable when the yuan figure is beside it. One shared display mechanism
(a rates endpoint + one money component) computes it from the installed `currencies` rate master, which
is fed by a **new app-owned provider** that speaks CNY (the built-in providers are Polish and cannot
produce `USD→CNY` in this deployment). No rate stored → no converted line; the rate and its date are
always shown next to the number, so a reader can audit the conversion instead of trusting it.

## Problem Statement

**Money in this app is multi-currency and the reader is in China.** Prices, order lines, contract and
invoice amounts travel in USD, HKD, TWD, VND, MOP, BND, KHR, LAK, MMK, RUB, MYR, SGD, THB, IDR and PHP
(`currency_policy` enables exactly those beside CNY), and every one of them is rendered as a bare
`US$21.50` — a number nobody in the office can price-check without a calculator.

**The rate capability exists but is dead in this deployment.** The installed `currencies` module ships
`exchange_rates` (from/to/rate(18,8)/date/source), `RateFetchingService` with a global provider
registry (`registerCurrencyRateProvider`), `POST /api/currencies/fetch-rates`, the CLI
`yarn mercato currencies fetch-rates`, and the admin pages `/backend/exchange-rates` and
`/backend/config/currency-fetching`. In this deployment: `exchange_rates` holds **0 rows**, both seeded
fetch configs (`NBP`, `Raiffeisen Bank Polska`) are `is_enabled = false`, and every one of those pages is
`navHidden` by `src/modules.ts` — so the owner's recollection ("系统好像有这个功能") is right and the
feature is unreachable.

**The built-in providers cannot produce the pair the business needs.** Both are Polish: NBP returns
`PLN↔XXX` only and skips itself unless `PLN` is a known currency (this deployment deactivated PLN), and
the fetch service stores **provider-returned pairs only** — it does not triangulate. So `USD→CNY` cannot
be obtained from them at all, no matter which currencies are enabled.

**There is no shared money formatter either.** Three modules each hand-roll their own
`Intl.NumberFormat` money formatting (`purchasing/components/PurchaseOrderForm.tsx`,
`purchasing/lib/priceKinds.ts`, `platform_ops/components/SettlementImportDialog.tsx`), so a second
convention per surface is exactly what a site-wide feature must not add.

## Goals

- **REQ-CNY-001** — **The display currency is CNY**, fixed by policy, independent of the master's
  `is_base` currency (this deployment's base is USD) and of the record's currency. CNY amounts carry no
  second line.
- **REQ-CNY-002** — **One rate feed**: an app-owned `RateProvider` registered into the installed
  registry, whose source is a CNY-based public FX endpoint covering every currency the policy enables
  (the built-ins are PLN-based and stay untouched). It is fetched through the installed route/CLI, and
  its fetch config is seeded per organization so the (now visible) config page shows its sync state.
- **REQ-CNY-003** — **Rates are read, never invented**: a converted line is shown only when a stored
  rate exists for that pair; a missing rate renders the original amount alone. The converted line names
  the rate and its date, and the pair's staleness is visible rather than silent.
- **REQ-CNY-004** — **One read contract**: `GET /api/currency_policy/rates` returns the latest stored
  rate per requested currency (≤ today), `currencies.view`-gated and scoped to the caller's
  organization. Direction resolution (`X→CNY` stored directly, else the inverse of a stored `CNY→X`) and
  rounding live in **one** implementation shared by client and server.
- **REQ-CNY-005** — **One display component**: `MoneyAmount` renders the native amount and, when a rate
  is available, the `≈ ¥…` line under it; the three hand-rolled `Intl` money formatters migrate onto the
  same implementation (no second convention).
- **REQ-CNY-006** — **Site-wide rollout, surface by surface**, each phase listing its surfaces and its
  evidence: product prices (library + product master), purchasing documents, sales/trade documents,
  finance and platform surfaces, and finally the installed modules' own pages through UMES.
- **REQ-CNY-007** — The FX surfaces are reachable again: `/backend/exchange-rates` (+ create/detail) and
  `/backend/config/currency-fetching` are un-hidden in `src/modules.ts` so the owner can read rates,
  add a rate by hand, and see/trigger fetching — hiding them was why the capability looked absent.

## Non-goals

- **Booking in CNY.** Conversions are display-only: no stored amount, price, line or document changes,
  and no accounting entry is derived from a converted figure.
- **Replacing the rate master or the fetch service.** The app adds a provider and a read route; the
  table, the service, the fetch route, the CLI and the admin pages stay the installed module's.
- **Historical revaluation.** A document keeps the amounts it froze; this spec shows today's CNY
  equivalent, not the equivalent at the document's own date.
- **A second base-currency policy.** `currency_policy`'s `BASE_CURRENCY_CODE` (USD) is untouched.
- **Triangulation and per-customer rates.** Only direct pairs (stored, or inverted from the opposite
  direction) are used; no cross-rate math through a third currency.

## Proposed Solution

Three pieces, each with one owner:

| Piece | Owner | What it is |
|---|---|---|
| Feed | `currency_policy` | `lib/providers/openErApi.ts` — a `RateProvider` (source `OPEN_ER_API`) that reads `https://open.er-api.com/v6/latest/CNY` and emits `X→CNY` and `CNY→X` pairs for the organization's currencies; registered from `currency_policy/di.ts` through the installed registry; its fetch config seeded per organization |
| Read | `currency_policy` | `GET /api/currency_policy/rates?symbols=USD,HKD` — latest stored rate per currency, ≤ today, scoped, `currencies.view`-gated; plus the shared direction/rounding helper both sides use |
| Display | app-wide | `MoneyAmount` (+ `useCnyRates`) in `src/lib/money/` — renders the native amount and the `≈ ¥…` line with the rate and date |

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| **D1 — Display currency is CNY, fixed** (owner decision 2026-09-24) | The company's books and its buyers are in China; the master's `is_base` (USD) answers a different question and must not decide what a reader sees | Convert to `BASE_CURRENCY_CODE`; make the target a per-user preference | Base currency is a policy fact, not a reading preference; a per-user preference adds a setting nobody asked for and a second rendering path |
| **D2 — A CNY-based provider on the installed registry** (owner decision 2026-09-24) | The built-ins cannot produce `USD→CNY` (PLN-only, and the service never triangulates); the registry is the installed seam for exactly this, and `currency_policy` already owns the rate master's convergence | (a) enable PLN and triangulate in the app; (b) hand-maintained rates only; (c) call the FX API from the render path | (a) invents cross-rate math the installed service deliberately does not do and couples the deployment to a Polish bank's table; (b) is not "实时" and ages silently; (c) puts a network call in a list render — the app reads what is stored |
| **D3 — `open.er-api.com` as the source** | One unauthenticated call covers **all 15** non-CNY currencies the policy enables; verified 2026-09-24 | ECB/Frankfurter (`api.frankfurter.dev`) | Central-bank reference rates, but its currency list misses TWD, VND, MOP, BND, KHR, LAK, MMK and RUB — 8 of this deployment's 15 |
| **D4 — Read stored rates only; feed via the installed route/CLI** | A render path must be deterministic and offline-safe, and a list of 50 rows must not become 100 provider calls | `ExchangeRateService.getRate({ autoFetch: true })` from the display path | Fetches inside a request, per pair; the fetch belongs to the feed (route/CLI/scheduler), not to a table cell |
| **D5 — No rate → no line** | An invented or stale-by-default figure is worse than a missing one in a price conversation | Show `≈ —` or convert with the newest rate regardless of age | `≈ —` is noise on every row; converting with an ancient rate silently misleads. The rate line carries its own date, and a stale one is visible by its date |
| **D6 — Display-only** | Money that is booked must stay exactly as stored; a display conversion can never be the number a document is settled on | Store the converted amount beside the native one | Duplicates every money column, and a revaluation would then need a migration and a policy this spec does not have |
| **D7 — Inversion allowed, triangulation not** | The feed writes both directions, so inversion is a rare fallback for hand-entered rows; inverting a `numeric(18,8)` rate loses ~1e-9 relative precision, which is far below display rounding | Only exact-direction rows | A hand-entered `CNY→USD` row would then be unusable for a `USD` amount, and the operator would have to know which direction the app wants |
| **D8 — Un-hide the FX pages** | The capability existed and was invisible; the owner must be able to see rates, add one by hand, and see the fetch config | Build an app-owned FX page | A second surface over the same tables for no new capability; `navHidden` was a menu decision, not an access decision (URLs always worked) |

## Architecture and Data Flow

```text
provider fetch  (yarn mercato currencies fetch-rates | POST /api/currencies/fetch-rates | 汇率页)
    OPEN_ER_API ──► RateFetchingService ──► exchange_rates (from,to,rate,date,source)

display         (any page)
    GET /api/currency_policy/rates?symbols=USD,HKD  ──► latest stored rate per pair (≤ today, scoped)
    useCnyRates()  ──► MoneyAmount { currencyCode, amount }
                          └─ native amount, and below it  ≈ ¥153.73  ·  1 USD = 6.7226 CNY (2026-09-24)
```

- **Scope:** every read and write derives `tenantId`/`organizationId` from the caller's context; the
  rate route answers `400 organization_scope_required` with no resolvable organization, `403` without
  `currencies.view`, and never reads another organization's rates.
- **Freshness:** the route returns the newest active row with `date <= now` per pair; the response
  carries that row's `date` and `source`, which the component prints. There is no hidden fallback date.
- **Direction:** `X→CNY` is preferred; when only `CNY→X` exists the rate is inverted (D7). The rounding
  of the converted amount follows the target currency's `decimal_places` (CNY: 2).

## API, Command, and Error Contracts

| Method | Path | Auth | Input | Success | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/currency_policy/rates` | `currencies.view` | `symbols` (1–32 comma-separated ISO codes, optional; default = every active currency of the organization) | `200 { base: 'CNY', items: [{ currencyCode, rate, date, source }] }` — only pairs with a stored rate; `rate` is CNY per one unit of `currencyCode` | 400 malformed symbols / `organization_scope_required`, 401, 403, 500 |
| `POST` | `/api/currencies/fetch-rates` (installed, unchanged) | `currencies.fetch.manage` | `{ date?, providers? }` | installed shape; `OPEN_ER_API` appears in `byProvider` | installed |
| CLI | `yarn mercato currencies fetch-rates --tenant <id> --org <id>` (installed, unchanged) | — | flags | installed | installed |

No new command, event, ACL feature or table: the feed is the installed service's, the read reuses
`currencies.view`, and nothing is written by the display path.

## UI and Interaction Contracts

| Surface | Change | Canonical pieces | States |
|---|---|---|---|
| `/backend/exchange-rates` (+ create/detail), `/backend/config/currency-fetching` | Un-hidden (`src/modules.ts` `routes.pages` overrides drop the `navHidden: true` metadata) | installed pages, unchanged | unchanged |
| Supplier product library list — 供应商供货价 / 本公司报价 columns | The converted line joins the existing breakdown/hint lines under the amount | `MoneyAmount` inside the existing `DataTable` cell | no rate → no extra line; stale rate → date visible |
| Product form — 三档价格 step (成本价 / 内部结算价 / 对外销售价 rows) | The converted line appears under each non-CNY amount while typing | `MoneyAmount` in the price-rows editor | no rate → no extra line |
| Later phases | see Phasing | | |

The component never throws on an unparseable amount or an unknown code: it renders the native amount
exactly as before, and the converted line is additive.

## Risks and Tradeoffs

| Risk | Impact | Mitigation | Residual |
|---|---|---|---|
| The FX endpoint is down when a fetch runs | No new rates; conversions keep showing the last stored ones | Fetch failures are the installed service's (`byProvider` errors, `last_sync_status`), and the display carries each rate's date | Stale rates age visibly by their date (D5) |
| The endpoint is a third-party aggregator, not a central bank | A business may prefer ECB/central-bank reference rates | One provider file, one source constant; swapping the source is a new provider, not a schema change | Accepted for a display-only figure; the rate's `source` is printed |
| A rate is entered by hand with the wrong direction | A conversion is off by a factor of ~45 (USD/CNY) | The read inverts only when the exact direction is missing, and the display prints `1 USD = 6.7226 CNY`, which reads wrong immediately | The reader must read the rate line; that is what it is for |
| Rates are organization-scoped | A second organization starts with no rates and shows no conversions | The config is seeded per organization and the fetch runs per organization | Accepted; the fetch is per-organization by design |
| Converting on every cell costs a request per page | Slight load | One request per page (React Query cache keyed by scope+symbols); the read is a single indexed query | Accepted |
| Rolling out to installed modules' pages | Needs UMES enrichers/widgets rather than direct edits | Phases 6 lists those surfaces separately and explicitly | Deferred by design |

## Phasing

### Phase 1 — 汇率供给（app provider + 放出汇率页）

- **Depends on:** none
- **Outcome:** the app can fetch CNY-based rates through the installed service, and the owner can see
  them.
- **Deliverables:** `currency_policy/lib/providers/openErApi.ts`, `currency_policy/di.ts` registration,
  a seeded `currency_fetch_configs` row per organization in `currency_policy/setup.ts`, the
  `src/modules.ts` overrides dropped for the four FX pages, README notes.
- **Requirements:** REQ-CNY-002, REQ-CNY-007
- **Tests:** a unit test for the provider's pair construction (mocked fetch: both directions, only
  known currencies, CNY guard, provider date) + a live fetch proving rows land in `exchange_rates`.
- **Exit gate:** `yarn mercato currencies fetch-rates` (or the route) stores `USD→CNY` and `CNY→USD` for
  the organization, `/backend/exchange-rates` is reachable from the menu, and its list shows the rows
  with source and date.

### Phase 2 — 显示基座（rates 只读路由 + 共享金额组件）

- **Depends on:** Phase 1 (a rate to read)
- **Outcome:** one request per page answers "what is USD worth in CNY", and one component renders the
  `≈ ¥` line anywhere.
- **Deliverables:** `currency_policy/api/rates/route.ts`, `lib/rateLookup.ts` (direction + rounding, one
  implementation), `src/lib/money/{format.ts,useCnyRates.ts,MoneyAmount.tsx}`, the three hand-rolled
  `Intl` money formatters migrated onto it, i18n keys, README notes.
- **Requirements:** REQ-CNY-003, REQ-CNY-004, REQ-CNY-005
- **Tests:** unit tests for direction/inversion/rounding and for the formatter; an integration test for
  the route (scope, 403, malformed symbols, only-stored-pairs) — and the browser smoke in Phase 3
  exercises the component end to end.
- **Exit gate:** with a stored `USD→CNY`, a page renders `≈ ¥…`; with none, the amount renders alone;
  no module keeps a private money formatter.

### Phase 3 — 价格面（产品库 + 商品三档价）

- **Depends on:** Phase 2
- **Outcome:** the two price surfaces this feature was asked for show CNY beside every non-CNY amount.
- **Deliverables:** `SupplierProductsTable` price cells, `ProductForm` price rows, README/spec updates.
- **Requirements:** REQ-CNY-006 (first surfaces)
- **Tests:** browser smoke (a USD price shows `≈ ¥…`, a CNY price does not, a missing rate shows
  nothing) + the existing suites stay green.
- **Exit gate:** the library list's 本公司报价 (USD 21.5) and the product's 内部结算价 row both show a
  CNY equivalent computed from the stored rate, and the rate line names the pair and date.

### Phase 4 — 采购与销售单据（行价、金额、付款）  ✅ shipped 2026-09-24

- **Depends on:** Phase 3
- **Surfaces:** `/backend/purchasing/orders` (list/detail/create/edit: line unit prices, order totals,
  stage payments), supplier quotations (`sourcing`), purchase/sales contracts and invoices
  (`trade_docs`).
- **Requirements:** REQ-CNY-006
- **Exit gate:** every non-CNY amount on those pages carries its CNY line, and document totals are
  unchanged.
- **Evidence (2026-09-24):** purchasing `PurchaseOrdersTable` / `PurchaseOrderDetail` (line unit price, line total,
  payment amount, totals block) and `sourcing/QuoteLinesGrid`’s current-price cell converted; trade_docs
  `ContractsTable` / `ContractDetail` / `InvoicesTable` / `InvoiceForm` (line amounts, totals, difference) and
  `internal_sales/InternalSalesTable` converted. `PurchaseOrderForm`, `PurchaseOrderEditForm`, `QuoteReviewPanel`
  and `QuotesTable` render no read-only money and were reported as such rather than given a dead conversion.
  Browser: the contracts list renders `US$0.00 / ≈ ¥0.00` on the USD contract and `¥9,000.00` alone on the CNY one;
  the purchase-order list keeps `¥4,000.00` single-line.

### Phase 5 — 财务与平台面  ✅ shipped 2026-09-24

- **Depends on:** Phase 4
- **Surfaces:** `export_finance` (collections, tax refunds), `platform_ops` (orders, settlements,
  reconciliation), `internal_sales` (quotes/orders).
- **Requirements:** REQ-CNY-006
- **Exit gate:** as Phase 4, on those pages.
- **Evidence (2026-09-24):** platform_ops `OrdersTable` / `SettlementsTable` / `SettlementDetail` /
  `ReconciliationTable` and export_finance `OrderFileDetail` / `OrderFilesTable` / `ContainerFileDetail` converted
  where a currency is in scope. Amounts with no currency available — a reconciliation row the platform reported
  without one, and `ContainerFilesTable`’s refund column — were left as plain figures and reported, never guessed.

### Phase 6 — 安装层页面（UMES）  ✅ shipped for the sales orders table; quotes/payments blocked by their host

- **Depends on:** Phase 5
- **Surfaces:** installed modules' own money surfaces the business still uses (`sales` documents, `wms`
  inventory values, `catalog` prices) — each through a UMES enricher or injected widget, never by
  editing installed code.
- **Requirements:** REQ-CNY-006
- **Exit gate:** the chosen installed surfaces show the same line, with their own integration coverage.
- **Shipped (2026-09-24):** the installed **sales orders** table. `data/enrichers.ts` computes
  `_currency_policy.cnyEquivalent` for `sales:sales_order` (the only documents entity whose route publishes an
  enricher host — `enrichers: binding.kind === 'order' ? … : undefined`), reading the **transformed** camelCase
  record because enrichers run after the route’s `afterList`/`transformItem`; `widgets/injection/sales-order-cny/widget.tsx`
  plus `widgets/injection-table.ts` inject the **折合人民币** column into `data-table:sales.orders:columns`, its header
  resolved from this module’s new i18n catalogs. Verified live: a 100 USD order renders `¥672.26` with
  `1 USD = 6.722644 CNY · 2026-09-24`, a CNY order renders an empty cell.
- **Blocked by the host, not by this design:** `sales` quotes and payments publish **no** enricher host, and an
  injected column’s cell receives only `getValue()` — never the row — so a CNY column there would render empty on
  every row. Fixing that means changing the installed routes, which this app must not do; the state is recorded here
  instead of mounting a dead column. `wms` inventory screens hold no money amounts, and `catalog`’s price pages are
  hidden in this deployment, so neither carries a surface to convert.

## Requirement Traceability

| Requirement | Surface / contract | Phase | Tests | Acceptance |
|---|---|---|---|---|
| REQ-CNY-001 | display policy (CNY fixed) | 2 | unit + browser smoke | AC-CNY-001 |
| REQ-CNY-002 | `currency_policy` provider + registration + config seed | 1 | unit + live fetch | AC-CNY-002 |
| REQ-CNY-003 | `MoneyAmount` (no rate → no line; rate+date printed) | 2, 3 | unit + browser smoke | AC-CNY-003 |
| REQ-CNY-004 | `GET /api/currency_policy/rates` + `lib/rateLookup.ts` | 2 | unit + integration | AC-CNY-004 |
| REQ-CNY-005 | `src/lib/money/*`, three formatters migrated | 2 | unit + lint (no local `Intl` money formatter left) | AC-CNY-005 |
| REQ-CNY-006 | the phase-by-phase surface list | 3–6 | browser smoke per phase (product prices, contracts list, purchase-order list, the injected sales-orders column) | AC-CNY-006 |
| REQ-CNY-007 | `src/modules.ts` FX page overrides dropped | 1 | browser smoke | AC-CNY-007 |

## Acceptance Criteria

- [x] **AC-CNY-001** — A CNY amount never renders a second line; a non-CNY amount renders `≈ ¥…` only
  when a rate exists.
- [x] **AC-CNY-002** — `OPEN_ER_API` appears in the fetch result's `byProvider`, rows for `USD→CNY` and
  `CNY→USD` land in `exchange_rates` with the provider's date, and a second run does not duplicate them.
- [x] **AC-CNY-003** — The converted line prints the pair and the rate date, and a pair with no stored
  rate renders the native amount alone.
- [x] **AC-CNY-004** — The route answers only stored pairs, only in the caller's organization, and only
  with `currencies.view`; an inverted direction converts with the inverse rate.
- [x] **AC-CNY-005** — No module keeps its own money formatter; all three previous call sites render
  through the shared one.
- [x] **AC-CNY-006** — Each phase's listed surfaces show the line, verified in the browser per phase.
- [x] **AC-CNY-007** — `/backend/exchange-rates` and `/backend/config/currency-fetching` are reachable
  from the sidebar; the pages themselves are unchanged.

## Changelog

| Date | Change |
|---|---|
| 2026-09-24 | **Phases 4–6 landed: the rollout is complete.** ① Phases 4–5 converted every app-owned display render (purchasing orders list/detail + sourcing quote grid, trade_docs contracts/invoices, internal_sales, platform_ops orders/settlements/reconciliation, export_finance order/container files) to `MoneyAmount`; amounts with no currency in scope (a reconciliation row without one, the container-files refund column) were left plain and reported. ② Phase 6 shipped the installed **sales orders** table: a `sales:sales_order` response enricher plus a headless column widget on `data-table:sales.orders:columns`, verified live (`US$100.00` → `¥672.26` + the rate line; a CNY order renders an empty cell). ③ The installed quotes/payments tables publish no enricher host and an injected column cannot read a row, so no CNY column is mounted there — a host-side blocker, recorded rather than shipped dead. ④ The app-owned CLI `yarn mercato currency_policy fetch-rates` closes the feed’s operational gap (the installed CLI never reads the provider registry) and is idempotent (two runs → the same 30 rows). Gates: `yarn typecheck` clean, eslint clean on every touched file, `yarn ds:check` 694 files, `yarn test` 257 tests / 32 suites green (including the new provider pair-set and rate-lookup suites), `yarn test:integration:ephemeral` 35 passed / 5 skipped / 4 failed — the four failures are the `storage_ops` specs gated on the unset `STORAGE_OPS_TEST_S3_CONFIG`, and the purchasing library suite (TEST-SPL-013 included) is green — plus browser checks on the product price surfaces, the contracts list, a contract detail, the purchase-order list and the injected sales-orders column. |
| 2026-09-24 | **Phases 1–3 implemented and verified.** ① Feed: `currency_policy/lib/providers/openErApi.ts` (source `OPEN_ER_API`, CNY base, 15 currencies × 2 directions per call), registered from `currency_policy/di.ts` through the installed registry, its fetch config seeded per organization (`lib/rateFetchConfig.ts`), and the four FX page overrides dropped from `src/modules.ts`. The installed CLI does **not** read the provider registry (it constructs its own service with the two built-in providers), so the triggers that see `OPEN_ER_API` are the 汇率抓取配置 page button, `POST /api/currencies/fetch-rates`, and the app-owned `yarn mercato currency_policy fetch-rates` command added for cron (it resolves the container’s `rateFetchingService`); a second run stores the same 30 rows, i.e. the fetch is idempotent per `(from,to,date,source)`. ② Read + display: `GET /api/currency_policy/rates` + `lib/rateLookup.ts` (stored rates only, `X→CNY` preferred, inversion fallback, no rate → no entry) and `src/lib/money/` (`formatMoney`/`formatCnyEquivalent`/`formatRateLine`, `useCnyRates`, `MoneyAmount`); the three hand-rolled `Intl` money formatters (purchasing order form/detail/table, platform_ops settlement dialog/detail/table/reconciliation, purchasing price kinds) migrated onto it with every call site updated. ③ Surfaces: the supplier library list's two price columns and the product form's 三档价格 rows. Evidence: live fetch stored 30 rows (`USD→CNY 6.72264388`, source `OPEN_ER_API`, date from the endpoint), the rates route answered 15 currencies, unit tests for direction/inversion/formatting (10 passed), the existing purchasing/products/platform_ops/i18n suites still green (69), `yarn ds:check` 691 files, typecheck clean, and a browser walk over both price surfaces (a USD amount shows `≈ ¥…` with the rate line, a CNY amount shows no second line). Open: Phases 4–6. The periodic trigger is now a one-line cron over `yarn mercato currency_policy fetch-rates` (the installed module still ships no scheduler). |
| 2026-09-24 | Initial spec. Owner decisions: display currency CNY (not the master's base USD); add an app-owned CNY-based provider rather than relying on the Polish built-ins; scope is every money amount in the app, rolled out surface by surface. Facts recorded: `exchange_rates` empty, both fetch configs disabled, FX pages `navHidden`, built-in providers PLN-only, `open.er-api.com` covers all 15 enabled currencies while ECB/Frankfurter misses 8. |
