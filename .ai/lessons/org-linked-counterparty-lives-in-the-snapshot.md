---
title: "An organization-linked counterparty lives in the document snapshot, not the customer FK"
modules: ["internal_sales", "sales", "parties", "directory"]
areas: ["module-data", "backend-ui", "architecture"]
topics: ["counterparty", "snapshot", "organization-tree", "pickers", "sales-documents", "option-sources"]
---

# An organization-linked counterparty lives in the document snapshot, not the customer FK

**Context**: the internal-sales buyer field (2026-09-28,
`.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`) has to address two kinds of buyer through one
picker: an **organization** (总部 → 分公司, both `directory` companies) and an **external customer**
(an app-owned `parties` record). The installed `sales` document offers exactly one buyer-shaped
column, `customer_entity_id`, and one free-form `customer_snapshot` jsonb.

**Problem**: each of the two obvious moves is wrong in a different way.

- Writing the organization id into `customerEntityId` is a type lie: the column means
  `customer_entities.id` — the create command resolves it against the customers table
  (`resolveCustomerSnapshot`) and the list projection falls back to printing the raw column value
  as the buyer's display name. It is a uuid with no FK, so nothing fails loudly; the damage shows
  up later, in whatever consumes that column as a customer reference.
- Creating a mirrored customer row per branch (or per group company) keeps two masters that drift,
  and the branch already exists as the organization the operator logs in with.
- Enumerating "related organizations" with a new server route re-implements the visibility rule the
  organization tree already enforces — and would need its own feature id, while the switcher
  payload is readable by any authenticated caller.

**Rule**:

1. A counterparty from a namespace other than `sales`'s customer entities is frozen **in the
   snapshot** next to its printed name, under this module's own key
   (`customerSnapshot.internalSales.organizationId` / `.partyId`), and the snapshot is the whole
   read-back source. Adding `customer.displayName` costs one key and makes the installed document
   detail page and the update response render the buyer's name.
2. The internal option source is the **top-bar organization switcher payload** — flatten it, keep
   `selectable` nodes, drop the organization the document is being written in. Fail-closed comes
   free: a subsidiary account's payload holds only itself (plus non-selectable ancestors), so it
   gets no internal options without a single business rule in the form.
3. An emptied buyer must clear the snapshot with an explicit `null` on update; the sales update
   command treats an absent key as "leave unchanged", so omitting it leaves a ghost buyer.
4. `ComboboxInput` renders the selected value as its option label and, on focus, re-queries the
   source with the input's text (and locally filters the rendered list by that same text). Decide
   deliberately what a filled field's focus does: treat "the query equals the selected label" as
   "no query" in the loader, and accept/document that changing a selection means typing or clearing
   first — the component's own filter, not the loader, decides what a filled field shows.

**Applies to**: `src/modules/internal_sales/components/InternalSalesForm.tsx`, `lib/buyer.ts`, and
any future picker that addresses a group organization or another non-customer namespace on an
installed document.
