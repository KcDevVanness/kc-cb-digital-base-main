---
title: "Unit pickers read the app's unit dictionary, not the installed catalog's"
modules: ["products", "trade_docs", "sourcing", "catalog"]
areas: ["module-data", "backend-ui"]
topics: ["dictionary", "unit-of-measure", "master-data", "pickers", "cross-module-ownership"]
---

# Unit pickers read the app's unit dictionary, not the installed catalog's

**Context**: the product form's 单位 field and the trade-document line editors had no picker — the
operator typed a code (`PCS`, `CTN`, `cm`) into a text box. Meanwhile `sourcing` was already seeding
a `supplier_product_unit` dictionary with the business codes (件/套/箱/千克…), and the installed
`catalog` module seeds a dictionary under the key `unit`.

**Problem**: two stores answer to "unit", and they are not the same list.

- `catalog/lib/seeds.ts:56-110` seeds key `unit` with 39 **lowercase** engineering units (`pc`, `set`,
  `box`, `kg`, `cm`), and the platform's UoM resolution reads it —
  `catalog/lib/unitResolution.ts` (`UOM_DICTIONARY_KEYS = ['unit', 'units', 'measurement_units']`),
  also reached from `sales/commands/documents.ts` and `catalog` product commands.
- The app's vocabulary is `supplier_product_unit` (`src/modules/purchasing/setup.ts` since the
  supplier product library moved there on 2026-09-23): **uppercase**
  customs codes with Chinese labels, and it is what a customs declaration, a quotation and the
  product master actually print.

Pointing the product form at the installed dictionary would have silently re-spelled every new unit
(`PCS` → `pc`) and left one master table holding two spellings of the same unit; seeding a third app
dictionary would have split the vocabulary a second time. Also note the installed UoM resolver
*enforces* membership once such a dictionary exists (`uom.unit_not_found` → 400), so which dictionary
gets seeded is a write-path decision, not a cosmetic one.

**Rule**: the unit a business document prints comes from the app's `supplier_product_unit`
dictionary. `src/modules/products/lib/unitOptions.ts` is the one client loader (product form, trade
document lines); the seeded-installed `unit` dictionary stays the catalog/pricing vocabulary and app
pickers deliberately do not read it. A dictionary key is owned by the module that seeds it, so a
reader in another module imports the loader (never the seed), keeps the value the record already
holds selectable even when the dictionary does not list it, and treats a missing/unreadable
dictionary as "no suggestions" rather than an error — a picker must never block a save the API would
accept. Normalizing to the dictionary's canonical spelling would need a data migration; the code
column keeps whatever spelling the row already has.

**Extended (2026-09-23)** — the same split now runs through the app's other main-data vocabularies, and
the control follows what the value *is*:

- A **code the system keys on** (currency, unit of measure, country, dimension unit) gets a **strict
  picker**: the dictionary is the vocabulary, and a record whose value left the list keeps it as its own
  option (`withCurrentUnit` / `withCurrentCurrency`) instead of rendering blank.
- A **name or wording a document prints** (port, carrier, payment terms, shipping method, destination,
  platform, quotation section) gets a **combobox with `allowCustomValues`**: there the dictionary is a
  maintained shortcut, the server accepts any text, and a word the list does not carry must never block a
  shipment or a signed contract.
- Each dictionary is seeded by the module that owns the vocabulary, insert-only and idempotent
  (`cross_border` → `container_type` / `port` / `carrier`, `trade_docs` → `payment_terms` /
  `shipping_method`, `platform_ops` → `channel_platform`, `sourcing` → `supplier_product_unit` /
  `quote_section`), and a reader in another module imports the *loader* — never the seed. Currency is the
  one vocabulary with a shared client loader (`currency_policy/lib/clientOptions.ts`, beside the route).
- `/backend/config/dictionaries` is the single installed admin page this app leaves in the navigation
  (`src/modules.ts`): no app-owned replacement exists, and every picker above depends on the operators
  being able to maintain those lists.

**Applies to**: `src/modules/products/lib/unitOptions.ts`,
`src/modules/products/components/ProductForm.tsx`,
`src/modules/trade_docs/components/{ContractForm,formOptions}.ts`, `src/modules/purchasing/setup.ts`,
and any future "turn this field into a dropdown" request where an installed module already owns a
similarly-named list.
