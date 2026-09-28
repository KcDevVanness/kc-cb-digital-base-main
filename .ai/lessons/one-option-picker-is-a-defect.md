---
title: "A picker whose only remaining option is one value is a defect: delete the entry point, not the data model"
modules: ["purchasing"]
areas: ["backend-ui", "module-data"]
topics: ["form-affordance", "price-list", "round-trip-submission", "base-row", "owner-feedback"]
---

# A picker whose only remaining option is one value is a defect: delete the entry point, not the data model

**Context**: `/backend/purchasing/supplier-products/create`. After 本公司报价 moved to the product
master (D10), the library's price editor still rendered a row list: a 价格类型 picker with exactly one
option (供应商供货价), a 起订量 field, an 启用 checkbox, 移除 per row and a 新增价格 button. The owner
said what every operator would: 「现在只有一种类型，供应商供货价，那么新增多条好像意义不大了」.

**Problem**: the affordance promised a matrix the business does not have. Every row the button could
create was the same kind × currency × minimum quantity, i.e. exactly the payload the API rejects as a
duplicate key — so the button's only reachable outcomes were "one row" or "a 400". Checking usage
confirmed it before touching anything: every live row in the dev database was
`supplier_cost`/`CNY`/`min_quantity 1` (9 of 9), no ladder step, no second currency.

**Rule**:

1. When a picker's **creatable** options collapse to one value, delete the picker and its add/remove
   controls — not just the extra options. A single-option select plus an "add row" button is read as a
   broken feature, and it invites the one payload the server must refuse.
2. Narrow the **entry point, not the schema**. The table keeps its generality (here: a row per
   `kind × currency × min_quantity`, with the whole-set `replace-prices` contract); the form edits the
   **base** row and submits every other row back **unchanged**. The base row must be chosen by the
   *same* comparison the list column and the promotion already use — extract it into one exported
   function (`lib/priceKinds.ts` `comparePriceBaseRows`/`pickBasePriceRow`) instead of writing a
   second copy in the component.
3. **Never prefill an edited field from a deactivated row.** Showing a withdrawn price in the single
   field and saving the form for any other reason would reactivate it — a silent data change the
   operator did not ask for. Withdrawn and legacy rows belong in a read-only list, and the whole-set
   payload carries them back in their stored state.
4. Round-tripping is what makes the simplification safe: the payload builder is unchanged, so an item
   whose price was not touched keeps every stored row exactly as it was (that is the assertion a smoke
   test should make).
5. Back the removal with usage, and record it: the spec gets a decision row (D11), a new REQ/AC pair,
   a unit-level test for the base-row rule, and a Changelog row quoting the owner's words.

**Applies to**: any "this entry point is pointless now" request on a form that mirrors a generalized
table — most recently `purchasing/components/SupplierProductForm.tsx` and
`purchasing/lib/{priceKinds,supplierProductFormValues,supplierProductPrices}.ts`.
