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

**Recurrence (2026-10-10)** — the single-store cutover (`.ai/specs/2026-10-10-catalog-single-store.md`)
made "which dictionary" a **write-path** question, not a picker one: a product's unit is catalog's
`default_unit` now, and `catalog.products.create|update` resolves it through catalog's own `unit`
dictionary, so the first promote/create of a product with `PCS` failed with `400
uom.unit_not_found` — measured: 19 integration tests (`POST /api/products/items` → 400) across
`cross_border`, `finance`, `order_hub`, `products`, `purchasing`, `trade_docs`.

The rule that survived is narrower, and the seed now enforces it: **the app's vocabulary is a subset
of the installed `unit` dictionary, and it is the app that closes the gap.**
`src/modules/products/lib/unitVocabulary.ts` holds the list and explains its spelling, because three
facts fix its shape:

- the resolver stores **the entry's own `value`**, not the string the caller sent — the entry's
  spelling is what a product keeps and a customs declaration prints;
- catalog already ships eight of the app's codes in lowercase (`set`, `pair`, `box`, `roll`, `kg`,
  `g`, `m`, `l`): re-spelling them as `SET`/`KG`/… would either rename an entry that already stores
  products (their next update then fails with the very same `uom.unit_not_found`) or add a second
  entry whose normalized key collides (resolution then picks whichever row the database returns
  first), so the app accepts catalog's spelling for those eight;
- the three codes catalog does not ship (`PCS`, `CTN`, `BAG`) are inserted by the app's own setup
  (`products/setup.ts` → `ensureCatalogUnitEntries`) with the trade spelling and the Chinese label,
  insert-only — and the `unit` dictionary is created when missing, because with no dictionary at all
  the resolver silently returns the canonicalized (lowercased) code instead of raising.

Seeding therefore moved from `purchasing/setup.ts` to `products/setup.ts` (the module that writes the
field owns the list), and a unit typed by hand on a library row now needs a dictionary entry before
that row can be promoted into a product. The lesson generalizes: when a value crosses into an
installed module through a **resolver — not a schema — an unexpected spelling is a write failure, so
a code vocabulary must be *unioned* with the installed one, never parallel to it, and the union has to
be seeded by the module that performs the write.**

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
- **Presentation follows one rule** (`docs/dev/i18n.md`): a dictionary label is the display name in one
  language (`件`), and a picker that stores a code renders `CODE — 名称` (`PCS — 件`, `USD — 美元`,
  `FEEDING — 喂食`). The code is never glued into the label — `件 (PCS)` was the older shape and the
  language-purity test now rejects it. A *symbol* vocabulary (packing `dimensions.unit` →
  `cm/mm/m/in/ft`) has no second label to show: `cm` reads the same in zh and en, so it stays a symbol.
- `/backend/config/dictionaries` is the single installed admin page this app leaves in the navigation
  (`src/modules.ts`): no app-owned replacement exists, and every picker above depends on the operators
  being able to maintain those lists.

**Applies to**: `src/modules/products/lib/unitOptions.ts`,
`src/modules/products/lib/unitVocabulary.ts`, `src/modules/products/setup.ts`,
`src/modules/products/components/ProductForm.tsx`,
`src/modules/trade_docs/components/{ContractForm,formOptions}.ts`,
and any future "turn this field into a dropdown" request where an installed module already owns a
similarly-named list.
