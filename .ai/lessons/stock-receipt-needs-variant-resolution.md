---
title: "Shipping and stock receipt are variant-level, so a product needs a catalog link"
modules: ["purchasing", "cross_border", "products", "wms"]
areas: ["module-data", "architecture"]
topics: ["product-reference", "variants", "inventory-receive", "allocation", "catalog-link", "data-scoping"]
---

# Shipping and stock receipt are variant-level, so a product needs a catalog link

**Context**: Purchase order lines were switched from the installed catalog to the app-owned
`products_products` master (`.ai/specs/2026-09-22-products-and-trade-docs.md`, REQ-017). Orders
created through the UI looked perfect — until a shipment allocation for the same order answered
`422 … has no catalog product link, so the goods cannot be received into stock`.

**Problem**: `cross_border` receives goods by calling `wms.inventory.receive`, which books stock at
**variant** level, and it resolves that variant through the installed catalog
(`resolveDefaultVariantId` → `catalog_product_variants`). The app-owned product master has no
variants, so a line that only references a `products_products` row has nothing to book against: the
order can be placed, shipped and invoiced, but the warehouse step is impossible. Nothing in the
product entity or the order payload says so — the failure surfaces days later, at the warehouse.

**Rule**: keep the catalog reference on the order line as a **bridge**, never as a client input:
`resolveOrderLines` copies `products_products.catalog_product_id` into the line's
`catalog_product_id` when the master record carries a link, and the allocation command refuses a
line without one with a message that names the fix ("link the product to a catalog product first").
The product form exposes the link as an optional picker on the declaration step, with the
consequence spelled out; a dangling or cross-organization link is rejected with a 400 instead of
being stored. Which half of the chain owns which reference is recorded in the module READMEs and
`docs/dev/business-architecture.md` — a "switch product references" change is not finished until
the receiving path it feeds has been walked end to end.

**Applies to**: `src/modules/purchasing/commands/orders.ts`, `src/modules/cross_border/commands/shipments.ts`,
`src/modules/cross_border/lib/purchasingReads.ts`, `src/modules/products/{commands/items.ts,components/ProductForm.tsx}`,
and any future switch of `sales` document lines to the app-owned master.
