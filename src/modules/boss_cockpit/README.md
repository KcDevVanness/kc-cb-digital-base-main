# boss_cockpit

The read-only executive cockpit: the RU supply numbers and the CN cash numbers on one page, each
with the snapshot date it came from, plus four dashboard widgets that read the same aggregation and
the four threshold alerts.

Spec: [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md)
(Phase 4 = v1, Phase 7 = the full six groups and the alerts).

## What it owns

Nothing persistent. One aggregation (`lib/summary.ts`), one endpoint
(`GET /api/boss_cockpit/summary`), one page (`/backend/boss-cockpit`) and four widgets. The module
has a view feature and no manage feature on purpose: a read-only surface with a write feature is how
a read-only surface starts growing mutations.

## The three rules the shape follows

1. **Every figure carries its `asOf` and its source.** A total without them cannot be argued with;
   the cockpit's job is that the boss can ask "as of when, and from where".
2. **Nothing is added across currencies.** The supply side is priced in ₽ and the shipments in $, so
   the API answers per currency and the page shows the list.
3. **A missing input is reported, never zeroed.** No snapshot yet → the group is `dataMissing`; a pile
   of stock nothing can price is reported as an unpriced quantity. The stale banner keeps the numbers
   visible instead of hiding them — hiding is the dishonest version of "do not decide on these".

The ОПИУ block links to the month P&L page; ДРР is reported in both calibers (应计 / 实付) with the
target line the alert uses, from `ads_overview`.

The four dashboard widgets ship `defaultEnabled: false`: the cockpit is a screen an operator opens,
not four cards every new user's start page carries. Enabling one is a per-user (or per-role) choice in
the dashboard's 自定义 view, and the widget then reads the same `GET /api/boss_cockpit/summary` the
page reads — a widget can therefore never disagree with the page it mirrors.

A figure is the card's **value**, never only its footer: a `KpiCard` whose value is `null` renders a
bare `--` and drops the footer, which would hide the number the widget exists to show. Money is shown
as the first currency group with every group listed in the footer, because this module never adds two
currencies together.

## Surfaces

| Surface | Purpose |
|---|---|
| `/backend/boss-cockpit` | the six-group page (v1 subset: supply three + unrecognized inbound, CN cash three, SKU coverage, sources) |
| `GET /api/boss_cockpit/summary` | the same aggregation as JSON |
| widgets `boss_cockpit.dashboard.{supplyGap,inTransit,overstock,drr}` | one figure each, reading the same endpoint |

**Navigation (2026-09-28)**: `/backend/boss-cockpit` anchors the sidebar group 「经营概览」 / "Executive overview" (`pageGroupKey: executive_overview.nav.group`; the label key `executive_overview.nav.group` lives in this module's `i18n/{zh,en}.json`). The `finance` module's 月损益 / SKU 毛利 / 库存资金占用 sit in the same group.

## Verification

- `yarn test` covers the money-formatting rules this module reuses; the aggregation itself is a
  read-only projection whose evidence is the app run (see the plan's progress table for the figures
  against fresh snapshots).
- The page and the widgets are permission-gated by `boss_cockpit.view` (and `dashboards.view` on the
  dashboard host).
- Live evidence (2026-09-28, dev app with the RU fixtures pulled): the page showed 缺口金额 12.0K RUB
  (11,988.00 RUB), 在途 1.1K / 51,918.00 USD · 1,141.0000, ДРР 7.5% (实付 4.4%, 目标 ≤20%), 周销售
  1.0M RUB · 18.0000, 周毛利率 37.9%, 周广告实付 66.4K RUB, 应付未付 5.2K CNY, 应收未收 250 USD,
  库存资金占用 600 — 积压金额 stayed `--` because no stock row crosses the line, which is the
  intended shape of "no data" versus "zero". The four widgets rendered the same figures on the
  dashboard host after being enabled.
