---
title: "An installed sales single-document read returns metadata only for `id`, never for `ids`"
modules: ["internal_sales", "sales"]
areas: ["framework-context", "module-data", "backend-ui"]
topics: ["sales-documents", "list-projection", "metadata", "single-document-read", "read-after-write", "field-vs-projection"]
---

# An installed sales single-document read returns metadata only for `id`, never for `ids`

**Context**: the internal-sales order records which quotation it was loaded from by writing
`metadata.internalSales.sourceQuote` on the document (`metadata` is the installed sales chain's
free-form jsonb — it has no "derived from" column). Reading it back happens on the edit page, which
loaded its document the way the module had always done it:

```ts
fetchCrudList('sales/orders', { ids: documentId, pageSize: 1 })
```

**The trap**: the sales documents factory picks its projection from the query key — `id` (singular)
gets the **full** projection, anything else gets the trimmed **grid** one, and the grid projection
blanks out `metadata` (it also blanks the address/method/totals snapshots). So the read succeeded,
returned the right document, and answered `"metadata": null`: the source quote rendered as "not
set", with no error anywhere. The field looked like a write bug while the write was fine.

**Rule**: a single-document read of an installed sales document uses `id=<uuid>` — the installed
detail page reads its own document exactly that way (`api/documents/factory.ts`: the detail page
"fetches a single document through this same list route with an `?id=` filter … so it needs the full
projection"). `ids=` stays for filtering several documents; it is a list read even with one id.

```ts
// full projection (metadata, snapshots) — the detail-style read
fetchCrudList('sales/orders', { id: documentId, pageSize: 1 })
// trimmed grid projection — `metadata` comes back null, not absent
fetchCrudList('sales/orders', { ids: documentId, pageSize: 1 })
```

**Why it generalizes**: when a projection is chosen by a query-param name, the call site cannot see
which columns it asked for. A field that is "definitely written" and "definitely not read" is a
projection question before it is a writer question — check what the read actually selected (the
response body) before touching the write path.

**Verification**: 2026-09-29, dev + `@open-mercato/core@0.8.0` — the same order read back with
`?ids=` answers `metadata: null`, with `?id=` answers the stored
`{ internalSales: { sourceQuote: { id, number } } }`; after switching the edit loader the order's
「来源报价单」line renders and links back to the quote.
