---
title: "A dictionary-backed status is written by entry id, never by value — and its labels are tenant data"
modules: ["internal_sales", "cross_border"]
areas: ["module-data", "backend-ui"]
topics: ["dictionary", "status-lifecycle", "engine-contract", "event-emission", "i18n-labels"]
---

# A dictionary-backed status is written by entry id, never by value — and its labels are tenant data

**Context**: the sales chain keeps a document's lifecycle state in `sales_orders.status` /
`sales_quotes.status`, with the vocabulary living in the tenant dictionary `sales.order_status`
(seeded per organization: `draft` `sent` `confirmed` `canceled` … with label, color, icon). Phase 1 of
`.ai/specs/2026-09-30-document-status-lifecycle.md` made this module write and gate that state:
new documents are born `draft`, a quote is sent through the engine's own `POST /api/sales/quotes/send`,
orders move `draft → confirmed`, and the shipment allocation picker only offers confirmed orders.

**Problem** — three traps, each invisible until production:

1. **The head schema has no `status` field.** `quoteCreateSchema` / `quoteUpdateSchema` accept
   `statusEntryId` (a dictionary **entry id**), not a status string. A payload carrying
   `status: "draft"` is parsed clean by zod's default object handling and then simply ignored —
   the document comes back with `status: null` and no error anywhere. The engine resolves the value
   itself (`resolveDictionaryEntryValue`) and rejects an unknown id with 400
   `sales.documents.detail.statusInvalid`.
2. **Labels are tenant data, not code.** `loadDictionaryEntriesByKey('sales.order_status')` returns
   whatever the tenant has: this deployment's seed is English (`Draft`, `Sent`, `Confirmed`,
   `Canceled`), and a tenant may rename or disable any value at `/backend/dictionaries`. Hard-coding a
   Chinese label in the module would (a) disagree with the installed sales pages that render the same
   dictionary and (b) break the moment the operator renames a value. The module's own i18n carries the
   *actions* (发出报价/确认/作废) and column headers; the *state names* come from the dictionary.
3. **A platform route can commit state and still answer 400.** `quotes/send` writes
   `status='sent'`, `validUntil`, `sentAt` and the acceptance token inside its transaction, and only
   *then* awaits `sendEmail`. On a machine with no email transport the route returns
   `400 Failed to send quote.` while the quote is already `sent`. Any UI that trusts the error alone
   will tell the operator nothing happened, and any retry will re-send a "draft" that is not one. The
   fix is to re-read the document after the call and to make the environment honest
   (`OM_DISABLE_EMAIL_DELIVERY=true` in local dev, documented in `docs/dev/setup.md` and `.env.example`).

**Rule**: for any dictionary-backed enum, write the **entry id** resolved from the tenant dictionary
(one shared client hook, so the list, the form and the row actions agree), keep the *policy* —
which action is legal in which state — in pure functions over the value (`lib/salesStatus.ts`), and let
the dictionary own the words. Before wiring a platform route into a button, read its body: know
whether it commits before it fails, and what it emits on success.

**Evidence**: `src/modules/internal_sales/lib/salesStatusEntries.ts` (value → entry id),
`src/modules/internal_sales/lib/salesStatus.ts` (action matrix + quote expiry),
`src/modules/internal_sales/components/InternalSalesTable.tsx` (row actions derived from the status),
`node_modules/@open-mercato/core/dist/modules/sales/commands/documents.js:595-615` (`statusEntryId`
handling), `sales/api/quotes/send/route.js:100-175` (commit-then-mail order),
`.ai/specs/2026-09-30-document-status-lifecycle.md` (Phase 1 acceptance).

**Applies to**: every module that reads or writes a dictionary-backed value (`dictionaries` module
consumers), any UI action that calls an installed route with side effects, and any future phase of the
status lifecycle spec (Phase 2 adds shipments, export documents, collections and tax refunds).
