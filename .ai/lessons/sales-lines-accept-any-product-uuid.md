---
title: "Sales lines accept any product uuid; only the installed picker needs the catalog"
modules: ["sales", "products", "catalog"]
areas: ["framework-context", "architecture", "umes"]
topics: ["product-reference", "sales-documents", "uom-resolution", "component-replacement", "injection-points", "option-sources"]
---

# Sales lines accept any product uuid; only the installed picker needs the catalog

**Context**: after the app-owned `products` master replaced the catalog for purchasing, the question
was whether the installed `sales` chain (quotes → orders → shipments → invoices) can sell app-owned
products. The obvious answer — "it reads `/api/catalog/products`, so no" — is wrong in a way that
matters: the *write* path has no such dependency.

**Problem**: the installed document flow resolves a line's product in two different places with two
different strictness levels, and only the UI is catalog-bound:

- **Schema**: the sales line's product reference is a plain optional uuid
  (`data/validators.ts`, `productId: uuid().optional()`); there is no catalog validation, and
  `sales_order_lines.product_id` is a nullable uuid without a foreign key.
- **Command**: `normalizeLineUom` (`commands/documents.ts`) looks the product up only to enrich UoM
  (base unit, sales unit, unit-price reference, conversions). A product that is **not found** takes
  the documented fallback branch and the line is written anyway.
- **Picker UI**: `components/documents/LineItemDialog.tsx` hard-codes `/api/catalog/products`,
  `/api/catalog/variants` and the unit-conversion endpoints, exposes **no injection spot**, and
  `sales/widgets` registers no component handle — the platform's replacement handles are only
  `page:`, `data-table:`, `crud-form:` and `section:`.

So "switch sales to the app-owned master" is a UI-ownership decision, not a schema migration: either
replace the document pages with app-owned ones (a new surface), mirror the master into the catalog
(two sources of truth), or eject `sales`.

**Rule**: before promising a cross-module product switch, walk the *write* path independently of the
picker: read the line schema, then read the command's product resolution and its missing-product
branch. Then check the seam inventory (`ComponentReplacementHandles` + the module's
`widgets/injection-table.ts`) before proposing UI work — a hard-coded option source with no
injection spot and no registered handle cannot be swapped by configuration, only by replacing the
whole page or ejecting the module. Inventory and unit/lot semantics follow the catalog, so a module
without variants/UoM still needs a bridge in the logistics half (see
`stock-receipt-needs-variant-resolution.md`).

**Applies to**: `node_modules/@open-mercato/core/src/modules/sales/{data/validators.ts,commands/documents.ts,components/documents/LineItemDialog.tsx}`,
`src/modules/trade_docs/**` (the surfaces that currently carry the internal-sales documents), and any
future decision about `sales` document pages.
