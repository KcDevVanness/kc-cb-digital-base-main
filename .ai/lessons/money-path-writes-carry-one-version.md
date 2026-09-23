---
title: "Money-path writes carry exactly one version: the aggregate's"
modules: ["sales", "internal_sales"]
areas: ["module-data", "architecture", "backend-ui"]
topics: ["optimistic-locking", "crud-form", "document-lines", "upsert", "409", "stale-closure"]
---

# Money-path writes carry exactly one version: the aggregate's

**Context**: an app-owned create/edit surface for sales quotes and orders (`internal_sales`) wrote the
head and then reconciled lines through the installed line collection. Every line write answered
`409`, and the second save from the same form also answered `409`, while the first save looked fine.

**Problem**: two installed behaviours combine into a trap that a "patch everything in one submit"
design walks straight into:

- `sales.quotes.update` / `sales.orders.update` apply **scalar head fields only**. They never replace
  lines: lines are owned by their own collection endpoints, whose create **and** update verbs hit one
  `…lines.upsert` command.
- Every sales command — lines included — locks the **parent document's** `updatedAt`
  (`enforceSalesDocumentOptimisticLock`), and a line write bumps that version because it recalculates
  the document totals. So sending the loaded version on more than one write in a row guarantees a
  stale header on the second and every later one.

`CrudForm` attaches one `x-om-ext-optimistic-lock-expected-updated-at` header to every request its
`onSubmit` issues, derived from `initialValues.updatedAt` — which is the *document's* version, so line
writes inherit the wrong one. The platform documents the answer in `disableOptimisticLock`: "Use for
forms whose locking is owned elsewhere (e.g. sales document sub-resources guarded at the command
layer against the parent aggregate)", and `withScopedApiRequestHeaders` nests (an inner scope
overrides the same key), so a caller can also attach a per-request version deliberately.

**Rule**: for a document whose lines live on their own collection, one write may carry the operator's
version — the head patch, first — and the rest are guarded by the aggregate that patch just
re-checked. Form: `disableOptimisticLock`; on the head request wrap
`withScopedApiRequestHeaders(buildOptimisticLockHeader(loadedHeadVersion), …)`. Upsert lines with
their **line id** so a line is updated instead of duplicated, delete the rows the operator removed,
and **re-read the document after a successful save** — otherwise the next save from the same form
carries a version the previous write already invalidated.

**Related trap found in the same verification**: `CrudForm`'s `setValue` has no functional form, so an
async continuation that patches a row after an `await` writes from the rows captured at render time
and silently drops the field set a moment earlier (a picked product disappeared when its lookup
resolved behind a second state write). Patch once after every await, keep a `useRef` mirror of the
rows for the post-await read, and drop the patch if the row's key changed meanwhile.

**Applies to**: `src/modules/internal_sales/components/InternalSalesForm.tsx`, the installed
`sales/commands/documents.ts` + `api/documents/factory.ts` + `lib/makeSalesLineRoute.ts`, and any
future app-owned surface over a document with child collections (sales returns, credit memos).
