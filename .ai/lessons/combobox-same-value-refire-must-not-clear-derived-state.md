---
title: "A combobox that re-fires onChange with the same value must not clear derived state first"
modules: ["internal_sales"]
areas: ["backend-ui", "module-data"]
topics: ["combobox-input", "async-derivation", "save-race", "data-loss", "sales-lines", "variant-bridge"]
---

# A combobox that re-fires onChange with the same value must not clear derived state first

**Context**: the internal-sales line editor resolves a product's **variant bridge** asynchronously
after a pick (`products_products.catalog_product_id` → `/api/catalog/variants` → the default active
variant written to `product_variant_id`; fulfilment ships and receives at variant level, so a line
without it is rejected later). The product picker is a `ComboboxInput` whose `onChange` fires **once
per pick, then again with the same value** once the component resolves the selected option's label
(suggestions reload). The handler's shape was:

```ts
updateLine(index, { productId, productLabel: '', productVariantId: '' })  // clear, then re-derive
const option = await loadProductOption(productId)
const variantId = await resolveVariantId(option.catalogProductId)
updateLine(index, { ...option, productVariantId: variantId })
```

**The trap**: the clearing write lands immediately; the re-derivation needs two round-trips. A save
that happens inside that window serializes the row **without the variant** (and without the label) —
the duplicate `onChange` is what makes the window appear at all, and it arrives exactly when the
operator is looking at a filled-in row and reaches for Save. Reproduced live: the POST body carried
`productId` + `catalogSnapshot` but no `productVariantId`, and the follow-up patch landed *after*
the request. The later, idempotent patch makes it look like a flaky server write; it is a client
ordering bug.

**Rule**: derived state that takes an `await` to rebuild must not be cleared before the rebuild when
the input value is unchanged. Clear only when the value actually changes, and let a same-value
re-fire re-resolve in place:

```ts
if (linesRef.current[index]?.productId !== productId) {
  updateLine(index, { productId, productLabel: '', productVariantId: '' })
}
// …await option + variant, then one patch
```

**Why it generalizes**: any picker that resolves extra fields (variant, price, UoM, snapshot) after
selection has the same window; treating `onChange` as "the value may be re-asserted" is the cheap
defensive default. A same-value re-fire must be a no-op or an in-place refresh — never a reset.

**Verification**: pick a product whose catalog link has a default active variant, save immediately →
the line must carry `product_variant_id`; then edit the quantity and save again → the variant must
survive (`PUT …-lines` body keeps it). Both were run against dev 3000 on 2026-09-28, before and
after the fix.
