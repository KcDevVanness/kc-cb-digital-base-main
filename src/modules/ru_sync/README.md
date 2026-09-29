# ru_sync

The RU PETKIT supply contract as a `data_sync` provider: eight endpoints, one snapshot projection,
one cursor per endpoint, and the RU-code → product map.

Spec: [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md)
(Phase 3). The contract it implements is frozen in
[`docs/ru-petkit/supply-sync-tech.md`](../../../docs/ru-petkit/supply-sync-tech.md) — §0 conventions,
§1–§7 and §1.1.

## What it owns

| Table | Purpose |
|---|---|
| `ru_sync_snapshots` | one row per RU record per endpoint per `as_of`, payload stored verbatim |
| `ru_sync_cursors` | the `updated_at` watermark per endpoint, advanced only after a complete walk |
| `ru_sync_sku_map` | the decision for one RU code: bound to a product, ignored, or undecided |

Everything else is derived: the unmapped list is "a code the snapshots have seen with no `mapped`
decision", so it cannot go stale.

## Endpoints as entities

`skus`, `sku_mappings`, `stock`, `in_transit`, `unrecognized_inbound`, `plan`, `shipments`, `params`
— one `data_sync` run per entity, each with its own cursor. The zod schemas in
`lib/endpoints/supply.ts` are written from the contract and encode three of its rules:

- every page carries `as_of` (§0.3) and a page without one is **refused**, never stored under a
  guessed date;
- money is a decimal **string** with exactly two decimals (§0.4/§0.6); a JSON number or a third
  decimal is a contract violation, not a rounding opportunity;
- the `_label` mechanism is withdrawn (§0.5), so the schemas are strict and an unknown key fails the
  page.

`unrecognized_inbound` is its own endpoint on purpose: those rows must never be deducted from
demand, and merging them into `in_transit` would misstate the plan. The contract declares no natural
key for it, so the row's own `sku` (verbatim, it may be an unparseable factory code) is used.

## The rules this module exists to keep

1. **Cursor after success.** Snapshots are written per page (idempotent), but
   `ru_sync_cursors` advances only after the last page of a walk has been committed. A failed page
   keeps the old watermark, so the next run re-pulls exactly the same window — nothing is skipped.
2. **A missing timestamp never loses data.** A row without `updated_at` is a full-pull row per the
   contract; the watermark takes the maximum of the previous value and everything seen, so such a row
   cannot move it backwards.
3. **No silent SKU merge.** A RU code is bound automatically only when exactly one product matches
   `matchKey`; zero or several candidates leave it unmapped and it appears in the exception list.
4. **Receipt by date, not by status word** applies to the receivables ledger, not here — but the same
   spirit: the projection stores what the contract said, and the readers decide what it means.

## Surfaces

| Surface | Purpose |
|---|---|
| `/backend/ru-sync/sku-map` | the RU code registry: bind a code to a product, or ignore it |
| `/backend/ru-sync/health` | per endpoint: snapshot date, cursor, its age, the last run's outcome |
| `GET/PUT /api/ru-sync/sku-map` | the same list (derived) and the decision command `ru_sync.sku-map.update` |
| `GET /api/ru-sync/health` | the health projection |
| `notifications: ru_sync.pull_failed` | raised through `ru_sync.pull.failed` when a walk fails |
| `notifications: ru_sync.alert.*` (4) | 断货 / 超储 / ДРР 破线 / 未识别在途, evaluated after the endpoint whose data decides them (`lib/alerts.ts`) |

**Navigation (2026-09-28)**: `/backend/ru-sync/sku-map` and `/backend/ru-sync/health` moved out of 「财务」 into the sidebar group 「数据同步」 / "Data sync" (`pageGroupKey: ru_sync.nav.group`; the label key `ru_sync.nav.group` lives in this module's `i18n/{zh,en}.json`) — they are pipeline-maintenance pages, not finance-desk or boss pages.

The pull itself is a `data_sync` run for provider `ru_petkit` (`/api/integrations/ru_petkit/credentials`
holds the base URL, the bearer token and the private-host flag; the token is encrypted and never
returned). `lib/adapter.ts` emits `ru_sync.pull.failed` before rethrowing, which is what the
notification subscriber listens to.

## Alerts (四预警)

`lib/alerts.ts` evaluates the four thresholds from the projections after the endpoint whose data
decides them — `plan` (stockout), `stock` (overstock), `ads_overview` (ДРР), `unrecognized_inbound`
(unrecognized in-transit) — and emits one typed event per holding condition. Thresholds come from the
RU data where the contract carries them (`overstock_days`, `drr_target_percent`) and fall back to the
contract's own defaults. Repeating a condition does **not** pile up notifications: each alert carries
a `groupKey` and the notification service refreshes the active notification with the same
`(recipient, type, groupKey)` instead of creating a second one.

## Verification

- `yarn test src/modules/ru_sync` — 33 cases over four suites: the SKU normalization and the
  single-match rule, the cursor codec and watermark math, the eight contract schemas against the
  fixture payloads (including the negative cases: no `as_of`, money as a number, a three-decimal
  amount, a Russian enum value, a withdrawn `_label` key), and a full pull against a mock contract
  server with an in-memory projection: one row per fixture row, replay of the same `as_of` creating
  nothing, a failing page leaving the cursor untouched, RU codes registered, and an envelope without
  `as_of` rejected without storing anything.
- The boundary: those tests drive the real adapter, client, schemas and cursor rules against real
  HTTP, but with an in-memory store. The ORM store, the `data_sync` run plumbing and the notification
  path are exercised in the app (see the plan's progress table for the run evidence).
