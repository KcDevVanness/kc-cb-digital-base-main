---
title: "A page opened from another page must carry where it came from, in a parameter that is whitelisted"
modules: ["order_hub", "purchasing", "internal_sales", "trade_docs", "cross_border", "export_finance"]
areas: ["backend-ui", "module-data"]
topics: ["navigation", "return-to", "back-link", "cross-module-jump", "open-redirect", "hub"]
---

# A page opened from another page must carry where it came from, in a parameter that is whitelisted

**Context**: The company-order hub (`/backend/orders/<id>`) links into the module pages of the documents it
shows — a purchase order's detail/edit, a sales order's edit, a contract, a PI/CI, a shipment, a packing list,
an export-finance archive. Every one of those pages had one fixed `backHref` (its own ledger), so filling in an
order meant: leave the order, land in the module, come back by re-finding the order in the workbench. Owner
feedback 2026-10-09: 「从不同关联模块点击进去的跳转页面，返回都需要重新返回上一个订单的页面」.

**Problem**: The back link is a server-rendered href, so the jump target cannot be inferred at click time —
the destination must *receive* its origin, and a received href is attacker-controllable (`?returnTo=https://evil`,
`//evil`, `javascript:`). Silently trusting it makes the parameter an open redirect that also survives typecheck;
ignoring it (each page keeping its ledger) is exactly the behaviour the operator complained about. A second
trap: the parameter must be consumed by *every* surface the hub can reach — one page forgetting it is a dead
jump the operator only finds by clicking.

**Rule**: A cross-page jump carries its origin as `?returnTo=<same-app path>`; the destination reads it through
the one shared helper (`src/lib/navigation/returnTo.ts` — `readReturnTo` / `useReturnHref`) which accepts only a
`/backend/` path with no whitespace or control characters and otherwise returns the caller's own ledger href as
the fallback. The emitter uses `withReturnTo`, never hand-built query strings. Extending the pattern means adding
both ends in the same change (link + destination), keeping the whitelist the only reader.

**Applies to**: any hub/detail page that jumps into another module's page — `order_hub` today; `purchasing`,
`internal_sales`, `trade_docs`, `cross_border` and `export_finance` on the receiving side; any future
`?returnTo=` producer (the `dictionaries` library already had one, which is where the parameter name comes from).
