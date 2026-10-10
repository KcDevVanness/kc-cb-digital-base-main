---
title: "A peer command's scope guard resolves through a relation you left null"
modules: ["products", "catalog", "purchasing"]
areas: ["module-data", "debugging"]
topics: ["cross-module-write", "scope-guard", "catalog-prices", "variant", "silent-no-op"]
---

# A peer command's scope guard resolves through a relation you left null

**Context**: since the single-store cutover, a product's three price tiers are catalog price rows
written through `catalog.prices.create|update` by `products/lib/store.ts`
(`replaceStorePrices`). The store created them with `{ productId, currencyCode, priceKindId, … }` —
no `variantId` — and the read side (`listStorePrices`, by `product_id`) showed them fine, so the
first write, the list column, the promotion path and every read test passed.

**Problem**: the documented behavior "a tier that disappears from the payload is **closed**
(`ends_at = now`), never deleted" never worked, and nobody could see it: submitting a narrower set
answered `403 {"error":"Forbidden"}`, after the *other* rows had already been written.

- The 403 is not a feature gate: `catalog.prices.update` has no feature metadata. It is the
  platform's scope guard — `prepare()` runs `ensureOrganizationScope(ctx, snapshot.organizationId)`
  on the stored row, and for a **variant-less** price row the snapshot's organization resolves to
  nothing (`commands/scope.ts`: `isOrganizationAccessAllowed({ targetOrganizationId: null })` →
  false → `403 Forbidden`).
- The failure is *partial*: writes are per-row peer calls with no cross-module transaction (a known
  trade-off), so the update landed and the close did not — a half-written price set is the worst
  shape of this bug.
- Why it hid: creating a variant-less price row **is** accepted (`catalog.prices.create` keeps
  `product_id`), the read model joins on `product_id`, and nothing wrote a *narrowing* set in a test.
  Measured 2026-10-10: reproduced with a full-featured user (so not an ACL story), then with the
  platform route; the DB showed `variant_id = NULL` on every app-created row while the installed
  demo rows carried one.

**Rule**: when a field is written through a *peer command* rather than a table, its shape must match
what that command's **guards** read, not just what its inserts accept and its reads join on. Here
that means: a catalog price row hangs on the product's **default variant** (`resolvePriceVariantId`
in `lib/store.ts`), and the close call carries `productId` + `variantId` explicitly. Two checks worth
repeating for any cross-module write: (1) create **and then narrow/replace** in the same test — the
first write proves the insert shape, only the second exercises the update guard; (2) whenever a peer
table has a relation you do not need yourself, ask what its *other* commands resolve through it
(`prepare()`, scope guards, cascades) before leaving it null.

**Applies to**: `src/modules/products/lib/store.ts` (`replaceStorePrices`),
every `runPeer(... 'catalog.prices.*')` call, and any future cross-module write whose peer row has a
relation the app does not populate (variants, offers, channels). The regression is pinned by the
price-set assertion in `purchasing/__integration__/supplier-products.spec.ts` (Phase 9): submit two
tiers, submit one, expect `endsAt` + `isActive=false` on the dropped row.
