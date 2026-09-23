---
title: "Reads expand to descendant organizations; writes act in the selected one"
modules: ["products", "trade_docs", "purchasing"]
areas: ["module-data", "architecture", "backend-ui"]
topics: ["data-scoping", "organization-tree", "pickers", "option-sources", "write-scope", "crud-factory"]
---

# Reads expand to descendant organizations; writes act in the selected one

**Context**: With HQ selected, the contracts list showed a subsidiary's contract (the CRUD
factory's list scope expands to descendant organizations), but clicking a transition on it
answered `404 Contract not found`, and a picker offered the subsidiary's product types twice
(once per organization) while the create command rejected the foreign one with
`400 Product type not found in this organization`.

**Problem**: The two sides of the scope rule disagree by design, and nothing in the payload says
which organization a row belongs to:

- **Reads** (`makeCrudRoute` list, the CRUD factory's automatic scope guard) use
  `resolveOrganizationScopeForRequest(...).filterIds` — HQ plus its descendants.
- **Writes** (commands) use `ctx.selectedOrganizationId` alone, so a command acting on a
  descendant's row fails closed with a not-found.
- **Option sources** built on the same list route therefore offer rows the write path will
  reject, and a label like `fountain — 智能饮水机` can appear twice with no way to tell the two
  rows apart.

The failure is silent until the operator submits: the picker looks fine, the server answers 400.

**Rule**: Pickers that feed a write must be narrowed with an explicit organization filter —
list schemas accept `organizationId` and `buildFilters` maps it to `filters.organization_id`,
which the factory ANDs with the descendant scope. Pass the value from
`useOrganizationScopeDetail()` on the client. Keep list/table lookups wide (they only resolve
display names for rows the caller may read). For an action on a descendant's row, answer with a
message that names the cause ("belongs to another organization; switch to that organization")
instead of a bare not-found. Never widen a command's write scope to the visible set to make a
picker work.

**Applies to**: `src/modules/products/api/{items,types,categories}/route.ts`,
`src/modules/trade_docs/api/{contracts,invoices}/route.ts`, their `data/validators.ts` schemas,
`src/modules/trade_docs/api/contracts/[id]/document/route.ts`, and the form option loaders in
`src/modules/trade_docs/components/formOptions.ts` and `src/modules/products/components/*`.
