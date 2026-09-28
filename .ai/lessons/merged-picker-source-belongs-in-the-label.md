---
title: "A merged picker's source belongs at the front of the option label, not in a note under it"
modules: ["purchasing"]
areas: ["backend-ui", "module-data"]
topics: ["option-sources", "pickers", "option-labels", "owner-feedback", "duplicate-items", "combobox-input"]
---

# A merged picker's source belongs at the front of the option label, not in a note under it

**Context**: the purchase-order line editor searches two lists through one `ComboboxInput` (the two
pickers were merged on 2026-09-23 after an owner review): the selected supplier's own product library
(`purchasing_supplier_products`) and the app-owned product master (`products_products`). The first
attempt named the source in the option's `description` — the small muted second line
`ComboboxInput` renders under the bold label — while the option values stayed bare
(`supplier-product:` / `product:` prefixes).

**Problem**: one physical item legitimately exists in both lists with the **same code and the same
name** — promotion writes the library row's SKU/name into the master and links `product_id` back — so
two suggestions rendered an identical bold line
(`SPL-MUF3YPC4-BATCH-DUPLICATE — Batch item (duplicate ids)`) and the only difference sat in 12px
muted text underneath. Owner, on `/backend/purchasing/orders/create` (2026-09-24): 「显示了两个产品库…
分不清哪个是供应商哪个是自建产品」. The eye compares the bold line first; when those collide, the
scan never reaches the note.

**Rule**: when one search box merges two sources and the same item can appear in both, the source
goes **first on the label** (`本供应商产品库 · …` / `商品库 · …`, the existing `lines.source.*` keys) and
the description line is reserved for what the pick costs downstream (here
`未建档：建过档才能发运、收货`). The value protocol (`supplier-product:` / `product:`) the write path
keys off, the payload, and the frozen line snapshot do not change — this is form-local presentation,
composed in the app's loader. There is no input-level component override to reach for:
`.ai/lessons/installed-inputs-have-no-component-override.md`.

**Applies to**: `src/modules/purchasing/components/PurchaseOrderForm.tsx`
(`loadLineProductOptions`), `src/modules/purchasing/README.md`, and any future picker that merges the
supplier library with the product master (the same collision appears in `internal_sales`,
`trade_docs` and `sourcing` line pickers only if they start offering both lists).
