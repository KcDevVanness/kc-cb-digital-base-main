---
title: "An option loader must ask for no more rows than the route's pageSize cap"
modules: ["sourcing", "purchasing", "internal_sales"]
areas: ["debugging", "backend-ui"]
topics: ["option-sources", "pickers", "page-size", "zod-rejection", "empty-dropdown"]
---

# An option loader must ask for no more rows than the route's pageSize cap

**Context**: the quotation create page's supplier dropdown (`/backend/sourcing/quotes/create#manual`)
offered an empty list — nothing selectable, no error on screen. Both quotation panels loaded it with
`fetchCrudList('purchasing/suppliers', { pageSize: 200, … })`, and that route's own list schema caps
the value at 100 (`src/modules/purchasing/data/validators.ts`, `supplierListSchema`).

**Problem**: a list route that declares its own zod query schema **rejects** an oversized page rather
than clamping it — `?pageSize=200` answers `400 {"error":"Invalid input","details":[{"path":["pageSize"],"message":"Too big: expected number to be <=100"}]}` (verified against the dev server on
2026-09-23). The failure is invisible in the UI: `useQuery` (or `CrudForm`'s loader) ends up with an
empty option array, so the picker renders exactly like a real "no suppliers yet" state. The
`makeCrudRoute` default clamps to 100 when a route declares **no** schema of its own
(`@open-mercato/shared/src/lib/crud/factory.ts`: `Math.min(Math.max(pageSize, 1), 100)`), which is why
the same mistake in one caller fails and in another silently returns a smaller page — the cap is
per-route, not global.

**Rule**: an option loader reads its source route's `pageSize` cap and asks for exactly that value
(never more), and a picker that cannot load its options says so instead of rendering an empty list
that reads as "no data". Concretely: `purchasing/suppliers` and `customers/companies` cap at 100;
`purchasing/supplier-products` (and its prices), `products/items`, `products/prices`,
`sourcing/quote-lines`, `trade_docs/contracts` at 200; `trade_docs` contract/invoice **lines** at
500; `cross_border` shipment allocations/milestones/documents at 200; `platform_ops` settlement
lines at 200. Verify with `grep -n 'pageSize: z' <module>/data/validators.ts` next to the route, and
prefer one shared loader per source (e.g. `src/modules/sourcing/components/supplierOptions.ts`)
over repeating the literal at every call site.

**Applies to**: `src/modules/sourcing/components/{QuoteCreatePanel,QuoteReviewPanel}.tsx`,
`src/modules/internal_sales/components/InternalSalesForm.tsx`,
`src/modules/purchasing/components/orderFormOptions.ts` (the correct reference: it names the cap in
a comment and asks for exactly it), and any new picker/option loader that reads another module's
CRUD list route.
