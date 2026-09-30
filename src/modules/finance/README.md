# finance

App-owned 财务 module: the container-level cost records, the landed-cost allocation derived from
them, period expenses, and the read-only payable / receivable / inventory-value ledgers.

Spec: [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md)
(Phase 1 = costs, Phase 2 = expenses and ledgers, Phase 6 = profit and loss).

## What it owns

| Table | Purpose |
|---|---|
| `finance_shipment_costs` | one row per cost actually incurred on one container (ocean freight, duty, …) |
| `finance_expenses` | one row per period expense not tied to a container (advertising, platform fee, …) |

Everything else the module shows is derived per request and never stored: the landed-cost split
(`lib/landedCost.ts`), the inventory value (`lib/costResolver.ts`), and the payable/receivable
ledgers (`lib/ledger.ts`). There is deliberately **no** allocation table, no journal, no chart of
accounts, no period close and no AR/AP aging: editing a fee cannot leave a stale split behind
because there is no split on disk.

## The ledger rules that are load-bearing

- **应付** reuses `purchasing`'s `derivePaymentState` (`purchasing/lib/orderTotals.ts`): one
  implementation of 未付/定金已付/部分付款/已付, never a second status computed beside it.
- **应收** judges receipt by the **receipt date**, never by a status word: a settlement whose status
  says "paid" but that carries no `received_at` is not money in the bank.
- **Cross-currency amounts are never summed.** Groups and totals always carry their currency; a CNY
  figure would need a rate and a date per row and is deliberately absent from this layer.

## Surfaces

| Surface | Purpose |
|---|---|
| `/backend/finance/shipment-costs` (+ create/edit) | record and correct container costs |
| `/backend/finance/expenses` (+ create/edit) | record and correct period expenses |
| `/backend/finance/landed-costs` | read-only: purchase value + allocated fees, per line and per SKU |
| `/backend/finance/inventory-value` | read-only: what the stock on hand is worth, both cost calibers |
| `/backend/finance/payables` | read-only: 应付台账 per purchase order, grouped by supplier × currency |
| `/backend/finance/receivables` | read-only: 应收台账 over collections, settlements and internal sales |
| `GET /api/finance/landed-costs?shipmentId=` / `?sku=` | the same derivation as JSON or `format=csv` |
| `GET /api/finance/inventory-value` | the same derivation as JSON or `format=csv` |
| `GET /api/finance/payables` / `receivables` | the same ledgers as JSON or `format=csv` |
| `GET/POST/PUT/DELETE /api/finance/shipment-costs` | CRUD over `finance_shipment_costs` |
| `/backend/finance/profit-loss` | read-only: the monthly ОПИУ lines with the CN cost line beside them |
| `/backend/finance/sku-margin` | read-only: the RU sales snapshot beside the CN landed cost, per SKU |
| `GET/POST/PUT/DELETE /api/finance/expenses` | CRUD over `finance_expenses` |
| `GET /api/finance/profit-loss` / `sku-margin` | the same derivations as JSON |
| `mercato finance due-reminders --org … --tenant …` | 逾期未付款 / 逾期未发运 / 库存低于阈值 → notifications |

**导航分组（2026-09-28 按受众拆分）**：`shipment-costs`、`landed-costs`、`expenses`、`payables`、`receivables` 留在侧边栏「财务」(`export_finance.nav.group`，财务人员作业与台账)；`profit-loss`、`sku-margin`、`inventory-value` 移入「经营概览」(`executive_overview.nav.group`，老板视角，与 `boss_cockpit` 的驾驶舱同组)。

## The two rules that are load-bearing

1. **One allocation rule.** Shares are `HALF_UP(fee × wᵢ / Σw, 4)`, the rounding remainder lands on
   the largest share, and ties go to the lowest `lineNumber`. `lib/landedCost.ts` imports
   `divideHalfUp` from the money engine (`trade_docs/lib/money.ts`) — the same helper the tax-refund
   allocation uses, so the two splits cannot drift apart.
2. **A missing rate never becomes a number.** A fee whose rate cannot be resolved is reported as
   `unconvertible` and excluded from the allocation; a purchase line whose order currency cannot be
   resolved keeps its original amount and reports `rateMissing` with a `null` CNY unit cost. Never
   ×1, never 0. `lib/costResolver.ts` follows the same policy when it prices stock.

## Read/write split

Writes go through `commands/shipmentCosts.ts` (`finance.shipment-costs.create/update/delete`), which
validates the dictionary value, checks the container is live **in the caller's organization**, and
enforces the optimistic lock. Reads of peer modules go through scoped Kysely projections in
`lib/peerReads.ts` — this module never declares a cross-module ORM relation and never writes a peer
table.

## Due reminders (FLOW-G2)

`lib/dueReminders.ts` evaluates three rules against the derived figures the rest of the app already
trusts — an outstanding balance from `purchasing`'s own `derivePaymentState`, "shipped" meaning an
allocation exists, and a stock threshold taken from the product's purchase-tier minimum (its MOQ).
`src/modules/finance/cli.ts` exposes it as `finance due-reminders`, which raises one notification per
condition **in the command's own process** (the CLI resolves the notification service and creates the
notification directly, because the module's subscribers are not mounted there) and also emits the typed
event for any app-side listener; both paths key on the reminder's `groupKey`, so running it twice
refreshes the same notifications. It is a command rather than a timer
because this deployment has no scheduler module enabled, and a reminder nobody can explain is worse
than no reminder.

## Status

Phases 1–8 are **delivered**: migrations
`src/modules/finance/migrations/Migration20260928064025_finance.ts` (costs),
`Migration20260928071448_finance.ts` (expenses) and
`Migration20260928073630_finance.ts` (amount columns narrowed to `numeric(18,2)`) applied, plus the
additive `export_finance` migration adding `amount`/`received_at` to `export_finance_collections`;
allocation rules under unit test. Phases 1–5 were exercised on dev (API + browser, light and dark,
narrow width) with the smoke data cleaned up afterwards, and the FLOW-G1 chain is green on a fresh
throwaway DB; the Phase 3 ads real-pull and the Phase 4/6/7 page smoke are recorded as verified in
the spec's Changelog.

## Verification

- `yarn test src/modules/finance` — the allocation rules (remainder placement, tie-break, weight
  fallback, unconvertible fees) and the assembly (Σ shares == Σ fees, landed unit cost, SKU rollup,
  missing-rate behaviour).
- Smoke: create a container cost in USD with an explicit rate, then
  `GET /api/finance/landed-costs?shipmentId=…` and assert Σ allocated == fee × rate.
- `finance.costs.view` / `finance.costs.manage` gate the cost surfaces, `finance.expenses.view` /
  `finance.expenses.manage` the period-expense surfaces; `finance.ledger.view` additionally
  gates the inventory value; `finance.profit.view` gates 月损益 / SKU 毛利.
- **FLOW-G1 (the whole chain, fresh DB)**:
  `JWT_SECRET=$(openssl rand -hex 32) yarn mercato test:integration finance-flow` —
  `src/modules/finance/__integration__/finance-flow.spec.ts` drives 供应商 → 采购单 → 定金 → 发运 →
  柜费用 → 收货 → 到岸成本 → 尾款 → 收汇 → 退税 through the real HTTP contracts and reconciles four
  figures: line received == `wms` balance, Σ landed shares == Σ fees × rate, payables settled,
  collection and refund visible in the receivables/order-file ledgers. The random secret is only for
  the throwaway database — see [pitfalls/ephemeral-integration-needs-a-real-jwt-secret.md](../../docs/pitfalls/ephemeral-integration-needs-a-real-jwt-secret.md).
- `yarn mercato finance due-reminders --org <id> --tenant <id>` prints one line per condition it
  raised and is safe to run repeatedly (the same condition refreshes its notification).
