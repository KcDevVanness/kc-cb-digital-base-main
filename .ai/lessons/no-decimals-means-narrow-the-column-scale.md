---
title: "「不需要小数点」 is a column-scale decision, not a display format"
modules: ["purchasing", "products", "sourcing"]
areas: ["module-data", "backend-ui", "architecture"]
topics: ["numeric-scale", "column-precision", "form-input", "owner-feedback", "validators", "migrations"]
---

# 「不需要小数点」 is a column-scale decision, not a display format

**Context**: twice on the supplier library form, from
`/backend/purchasing/supplier-products/create`: first `unit_volume`（体积）confronted the owner with a
padded `0.088600` where the sheet holds 单件体积 as whole cm³ (2026-09-24), then 折扣 showed up as a
percentage with decimals at all (2026-09-24, 「价格-折扣，只有使用整数，不需要保留小数点」). Both columns
had been created as `numeric(…,4)` — a scale chosen for the *shape* of a decimal, not for the business
term — and both times the complaint was really about the column, not about the widget.

**Problem**: a `numeric(16,4)` / `numeric(7,4)` column stores `5` as `5.0000` and hands that string back
through the API, so the form renders the padding the owner just rejected, and every later reader has to
know to trim. Trimming in the UI alone is a second source of truth: the DB still accepts a fraction from
any other write path (a command, the quotation import, a direct API call), so "integers only" becomes a
convention held up by one component. It also silently changes the number the business already agreed:
rounding `3.75` to `4` is a different discount.

**Rule**: read 「不需要小数点」 as a scope-0 contract and carry it through three seams, in this order.

1. **Contract** (`data/validators.ts`): `nullableDecimalSchema(0, { min, max })` — the module's existing
   shape for a scale-0 numeric (`unit_volume` uses it too). It keeps the absent/null/value distinction
   every partial update depends on, and its "at most 0 decimal places" refine refuses a decimal point
   instead of rounding one away. Do **not** reach for `nullableNonNegativeIntegerSchema`: it coerces to
   `Number`, while a numeric column round-trips as the string the form typed.
2. **Column** (`data/entities.ts`): `precision` to the domain's real width, `scale: 0`
   (`discount_percent` → `numeric(3,0)`; 0–100 fits three digits). Then `yarn db:generate`, review the
   one `alter column … using (…::numeric(3,0))` statement, check for existing fractional rows first —
   the `using` cast **rounds** them — and get the owner's approval before applying.
3. **Form**: `inputMode="numeric"` (the same treatment the integer 起订量 field in that card already
   takes) and an unchanged `onChange`. Do **not** sanitize the keystrokes: stripping non-digits turns a
   pasted `3.5` into `35` — a silently wrong discount, which is strictly worse than a refused one. Let
   the validator refuse and the field-level error explain.

Two follow-ons the same change owns: the **snapshot stays with the entity** (`yarn db:generate` must be
a no-op afterwards for both modules) while the **migration file goes to the chain that created the
table** — see `cross-module-rename-migration-ordering.md` — and the REQ / acceptance criterion /
data-model row / README that name the old scale move in the same change.

**Applies to**: `purchasing_supplier_products.unit_volume` (2026-09-24, `Migration20260924035458_sourcing`),
`discount_percent` (2026-09-24, `Migration20260924054410_sourcing`), and any other field where the owner
says the business figure has no decimals: `products_prices`, `trade_docs` amounts and every
`numeric(*,4)` column whose `scale` was never argued for.
