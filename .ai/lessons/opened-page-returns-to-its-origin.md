---
title: "A back link resolves to where the operator came from: the recorded page, then an explicit `?returnTo=`, then the ledger"
modules: ["platform", "internal_sales", "order_hub", "purchasing", "trade_docs", "cross_border", "export_finance", "products"]
areas: ["backend-ui", "framework-context"]
topics: ["navigation", "back-link", "return-to", "nav-trail", "open-redirect"]
---

# A back link resolves to where the operator came from: the recorded page, then an explicit `?returnTo=`, then the ledger

**Context**: The company-order hub (`/backend/orders/<id>`) links into the module pages of the documents it
shows — a purchase order's detail/edit, a sales order's edit, a contract, a PI/CI, a shipment, a packing list,
an export-finance archive. Every one of those pages had one fixed `backHref` (its own ledger), so filling in an
order meant: leave the order, land in the module, come back by re-finding the order in the workbench. Owner
feedback 2026-10-09: 「从不同关联模块点击进来的跳转页面，返回都需要重新返回上一个订单的页面」 — fixed by carrying
`?returnTo=<origin>` on those jumps (the previous revision of this record). A day later the owner hit the other
half of the same fixed-ledger shape from the sales-quote workbench: `/backend/quotes` → row 「按此报价新建单」 →
the order create page, whose own ledger is the **orders** workbench — 「← 返回」 landed there instead of back on
the quote list, and every other app-owned page had the same one-fixed-`backHref` behaviour.

**Problem**: A back link is a rendered href, so its target must be known *before* the click. Two things do not
work: reading browser history — the framework renders `backHref` inside `FormHeader` / `CrudForm` /
`RecordNotFoundState` as a plain `<Link href>`, and no installed seam lets an app call `router.back()` on those
links (`.ai/lessons/installed-inputs-have-no-component-override.md`) — and assuming the destination's ledger
(`/backend/internal-sales/orders` for a page that creates sales orders), which is exactly the wrong answer when
the operator came from another ledger. An explicit parameter per jump fixes only the jumps an author remembered
to annotate: row actions, notification links, sidebar entries and every future page each need their own, and one
missing end is a dead target the operator only finds by clicking.

**Rule**: Every 「返回」/「取消」 target resolves through `useBackHref(fallback)` in
`src/lib/navigation/returnTo.ts`, in this order:

1. `?returnTo=` on the current URL, read through the whitelist (`readReturnTo` — only a `/backend/` path, no
   backslash or control character). This is the deliberate override: a jump that must survive a **new tab**,
   a bookmark or a reload keeps emitting it with `withReturnTo`, and only it crosses those boundaries.
2. The page the operator was last on in this tab, read from the per-tab trail (`om:nav-origin:v1` in
   `sessionStorage`), written on every navigation by `BackendNavOriginReporter`, mounted once by
   `src/app/(backend)/backend/layout.tsx`. This is the default that makes a back link behave like the browser's
   back button for **every** in-app jump, annotated or not.
3. The caller's `fallback` — its module ledger — when the tab has no trail (fresh tab, deep link, first visit).

Both trail entries are validated by the same whitelist on write and read: `sessionStorage` is as
attacker-writable as a query string. Traps: never pass a hard-coded ledger constant to `backHref`/`cancelHref`
(that is the bug this replaces — it typechecks and renders a real link); the receiving page of a
`?returnTo=` jump still needs its own end wired (link + destination in the same change); a page that is the
record's own surface must not point at itself
(`.ai/lessons/edit-page-is-not-its-own-back-target.md`); `redirect()`/`router.replace` navigations are recorded
like pushes, so the trail can name a URL that redirects again — the resolver refuses an entry equal to the
current page, and otherwise the ledger fallback stands.

**Applies to**: every app-owned page that renders a `backHref`, `cancelHref` or `RecordNotFoundState` back link
— `internal_sales` (including the quotes workbench row action, which carries `withReturnTo`), `order_hub`,
`purchasing`, `products`, `product_codes`, `trade_docs`, `cross_border`, `export_finance`, `finance`,
`platform_ops`, `parties`, `our_parties`, `example` — and any future one. Installed module pages keep rendering
their own platform ledger link: that code is framework-owned and cannot resolve this helper.
