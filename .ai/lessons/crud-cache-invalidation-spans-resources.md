---
title: "With ENABLE_CRUD_API_CACHE on, a command must invalidate every collection it changed — including another resource's"
modules: ["platform", "trade_docs", "cross_border"]
areas: ["architecture", "module-data", "framework-context"]
topics: ["crud-cache", "cache-invalidation", "read-after-write", "stale-ui", "invalidate-crud-cache", "integration-environment"]
---

# With ENABLE_CRUD_API_CACHE on, a command must invalidate every collection it changed — including another resource's

**Context**: the 2026-09-28 PI/CI/tax-invoice work was reported green by the API but every
read-after-write assertion in the integration suite answered the **pre-write** state until the
assertion used a different URL (`&_=<timestamp>`). Reproduced deterministically against the dev
server started with `ENABLE_CRUD_API_CACHE=true`:

```
-- warm contract read --             financeTotal 1000.0000
confirm=201                          # invoice bound to that contract line
-- same contract URL after confirm   financeTotal 1000.0000   ← stale
-- cache-busted contract URL         financeTotal  100.0000   ← truth
```

**Problem**: `makeCrudRoute` caches list payloads per resource + tenant + organization
(`node_modules/@open-mercato/shared/src/lib/crud/factory.ts:1633-1693`) and invalidates only the
resource **its own route owns** (`invalidate-crud-cache` at `:2561/:2903/:3195`). Three shapes fall
outside that:

- a command that rewrites **another** resource's columns — `trade_docs.invoices.transition` moves the
  contract's `finance_total` (`lib/contractRecalc.ts`), so the contracts collection stays cached;
- a write whose **child** collections are separate resources — a shipment update replaces its
  allocations, while the read-only `…/allocations` and `…/sales-allocations` routes derive their
  resource from the **entity name** (no commands to derive from);
- this module's `[id]/…` action routes (`generate`, `aggregate-lines`, `copy-from`) which dispatch
  through the command bus and **bypass the factory entirely**, so nothing invalidates anything.

The integration harness runs the app with `ENABLE_CRUD_API_CACHE: 'true'`
(`node_modules/@open-mercato/cli/src/lib/testing/integration.ts:2223`) while the local `.env` ships
`ENABLE_CRUD_API_CACHE=false`, so a stale-list defect is invisible in a plain `yarn dev` and only
shows up in the harness or a deployment that enables the flag. A spec that "fixes" it with a
cache-busting query parameter hides the defect instead of fixing it.

**Rule**: after every successful write, a command invalidates the CRUD cache for **each** collection
whose payload the write changed — calling `invalidate-crud-cache(container, '<module>.<entity>', { id,
tenantId, organizationId }, tenantId, reason, aliases)` inside `runWithCacheTenant(tenantId, …)` (the
tags are tenant-prefixed). Read-only routes derive their resource from the entity class name, so the
alias has to spell it out (`cross_border.shipment.sales.allocation` for
`CrossBorderShipmentSalesAllocation`). Keep the read-back assertion on the **plain** URL: that is what
proves the invalidation, and `ENABLE_CRUD_API_CACHE=true` is the environment in which it is testable.
Shipped wiring: `src/modules/trade_docs/lib/cacheInvalidation.ts`,
`src/modules/cross_border/lib/cacheInvalidation.ts` (23 call sites), oracle
`src/modules/trade_docs/__integration__/crud-cache-freshness.spec.ts`.

**Note (2026-09-28)**: `cross_border.shipments.depart` and `.receive` were also missing this. Both
dispatch through the bus, so the peer collections stayed stale: the allocated orders' status
(`purchasing.purchase.order`), the lines' `received_quantity` (`purchasing.purchase.order.line`) and
the wms balances the receipt books stock into (`inventory.balance`). `cross_border/lib/cacheInvalidation.ts`
now exports `PEER_CACHE_RESOURCES` + `invalidatePeerCaches(scope, resources, reason)` (whole-collection
flush, no record id) and both commands call it; the oracle is
`src/modules/finance/__integration__/finance-flow.spec.ts`, whose plain-URL reads of the lines and the
balances caught it. For a peer resource, derive the tag from the **peer route's own entity class** via
`canonicalizeResourceTag` (`InventoryBalance` → `inventory.balance`), never from a path.

**Applies to**: every app-owned module with commands that write rows outside the resource their own
route serves — `trade_docs` (documents/invoices/contracts), `cross_border` (shipments and their
allocations); any future module that adds list routes plus a command that mutates a *different*
resource's columns.
