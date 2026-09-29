# Execution plan — load an internal-sales order from an existing quote (2026-09-29)

> Delivered as PR [#30](https://github.com/KcDevVanness/kc-cb-digital-base-main/pull/30)
> (`feat/internal-sales-order-from-quote` → `dev`); the sibling unit
> `fix/internal-sales-edit-nav` (#29) merged first and this branch was rebased onto that `dev`.

Operator request (2026-09-29, after the PO/PI labelling round): the quote→order path only existed as
the engine's **in-place conversion** (the quote is deleted, 1:1). Real internal trade needs the other
shape — the quote stays, one quote can back several orders (分批发运/多柜), and the order usually
differs in a line or two — so the operator asked for a "reference load": start an order from a quote,
edit it, save.

## Goal

Order creation can be pre-filled from an existing quotation, and the created order records where it
came from. The quote is never modified or deleted; the conversion action stays as it is.

Owner decisions (2026-09-29, answering the research): ① keep 「转为订单」; ② add the reference-load
feature; ③ quotes need **no** archival role (but they stay untouched); ④ one quote may back several
orders and one order may ship in batches/multiple containers — so the load must be able to produce a
second order; ⑤ the order **must** record its source quote, shown in the UI.

## Scope

- `.ai/specs/2026-09-29-internal-sales-order-from-quote.md` — the spec (requirements, contracts,
  phases, evidence).
- `src/modules/internal_sales/lib/documentValues.ts` — the document ⇄ form value codec, extracted
  from the component (single consumer today) so the loader and the tests share it; gains
  `sourceQuote` and reads the serializer's `comment` key.
- `src/modules/internal_sales/lib/quoteLoad.ts` — quote option loader, quote+lines fetch, pure
  draft mapping with local line keys, dirty-form detection, and the `setValue` applier.
- `src/modules/internal_sales/components/QuoteLoadPanel.tsx` — the button / dialog / source line.
- `src/modules/internal_sales/components/InternalSalesForm.tsx` — panel group, `?fromQuote=`
  auto-load, `metadata` on the create payload, edit-page source display, single-document read `id=`.
- `src/modules/internal_sales/components/InternalSalesTable.tsx` — 「按此报价新建订单」 row action.
- `src/modules/internal_sales/i18n/{zh,en}.json`, `lib/__tests__/quoteLoad.test.ts`.
- `src/modules/internal_sales/README.md`, `docs/plans/cross-border-erp.md` (六·补23),
  `.ai/lessons/sales-single-doc-read-id-vs-ids-projection.md` + catalog row.
- Doc-drift correction: `.ai/specs/2026-09-28-internal-sales-quote-to-order.md` (the installed quote
  detail page *does* expose Convert to order in `@open-mercato/core@0.8.0`).
- Non-goals: engine changes, tables/migrations, feature ids, live sync, order→quote direction,
  batch loading, per-line source snapshots.

## Implementation Plan

### Phase 1: load path (order create page)

- 1.1 Worktree `../kc-cb-digital-base-min-feat-order-from-quote` on
  `feat/internal-sales-order-from-quote`, stacked on the sibling `fix/internal-sales-edit-nav`
  branch (same module, disjoint hunks) — retarget to `dev` once that PR merges.
- 1.2 Extract the value codec; add `sourceQuote` + `comment` tolerance.
- 1.3 Loader + panel + create payload metadata + edit-page source line; edit read `ids=` → `id=`.
- 1.4 Unit tests (mapping, local line keys, dirty check, metadata round-trip, `comment` fallback).

### Phase 2: list entry, docs, evidence

- 2.1 Quote list row action with `?fromQuote=`; create page auto-loads it once.
- 2.2 README surface/section/verification rows; plan row; lesson; quote-to-order spec correction.
- 2.3 Gate + browser smoke (recorded below).

## Verification (executed)

- Targeted: `yarn generate`, `yarn typecheck`, `yarn lint` (0 errors / 8 pre-existing warnings),
  `node scripts/check-lessons.mjs`, `yarn ds:check` (907 files), `npx jest src/modules/internal_sales`
  (2 suites / 27 tests), then the full gate (`yarn test`, `yarn build`).
- Browser smoke on a dev server started from this worktree (the runner chose port 3001 because 3000
  was taken; `APP_URL` in the local `.env` copy was bumped but the runner ignores it):
  1. Created probe quote `QUOTE-20260929-00022` through the module's own create page (buyer = related
     organization 俄罗斯 AB 有限公司, USD, reference BR-42, comment, one line
     LOWMOQ-1790586676106 → variant `96861c70-…`, 12 × 26.5).
  2. Order create page → 「从报价单载入」 → picker found `QUOTE-20260929-00022 — 俄罗斯 AB 有限公司` →
     load: header + line filled, flash 「已从报价单 QUOTE-20260929-00022 载入」, source line rendered.
  3. Changed the quantity to 7 → saved → `ORDER-20260929-00008`; `metadata.internalSales.sourceQuote`
     persisted; the order edit page shows 「来源报价单 QUOTE-20260929-00022」 linking to the quote's
     edit page; the quote is unchanged (still listed, its line still 12).
  4. Quote list row action 「按此报价新建订单」 → `/orders/create?fromQuote=<id>` auto-loaded the same
     values.
  5. Dirty-form load → destructive overwrite confirmation; 403 branch (request interception on
     `GET /api/sales/quotes`) → inline 「没有读取报价单的权限。」 with an untouched form; 420px narrow
     viewport and the dark theme checked.
  6. Probe documents deleted through `DELETE /api/sales/{orders,quotes}?id=…` (both 200, list reads
     return 0 items afterwards).
- Read-path contrast (feeds the lesson): the same order read with `?ids=` answers `metadata: null`,
  with `?id=` answers the stored source key.

## Risks

- The load is one-shot by design: a later quote edit does not touch existing orders (documented).
- `metadata` could be rewritten by an editor that submits the field wholesale; this module's update
  path never carries it.
- The sibling PR touches the same component file (different hunks); the rebase onto `dev` after it
  merges is expected and conflict-free in practice.
