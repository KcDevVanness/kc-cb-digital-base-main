---
title: "A `.partial()` update schema must not inherit create defaults"
modules: ["trade_docs"]
areas: ["module-data", "debugging"]
topics: ["validators", "partial-update", "data-loss", "zod", "defaults"]
---

# A `.partial()` update schema must not inherit create defaults

**Context**: the trade-document counterparty work (2026-09-29). Wiring the direction → counterparty-kind
rule exposed a defect that had shipped with every trade-document update since Phase 0: the three update
schemas were built as `createSchema.partial().extend({ id })`, and the create bodies carried
`.default(...)` on `direction`, `counterpartyKind`, `currencyCode` and `lines`.

**Problem**: the repository's zod (4.4.3) keeps `.default()` through `.partial()` — `.partial()` makes the
key optional, but a parse of a payload that *omits* the key still receives the default. Measured with a
probe in the worktree:

```
update.parse({ id, notes: 'edited' })  →
  { direction: 'purchase', counterpartyKind: 'supplier', currencyCode: 'CNY', lines: [], notes: 'edited', id }
```

Every partial write therefore rewrote the stored direction/kind/currency with the create defaults, and — the
damaging half — handed `lines: []` to the command, whose own guard is `parsed.lines ? resolve(parsed.lines) : null`
(`[]` is truthy). `persistContractLines` then replaced the line set with nothing: **a notes-only `PUT` on a
contract silently deleted every line** and recomputed the head totals to zero. The same shape existed on
`documents` and `invoices`.

**Rule**: define the head's field list **without defaults** as a plain object (`const contractBase = { … }`),
build the create schema as `z.object({ ...contractBase, direction: contractBase.direction.default('purchase'), … })`
and the update schema as `z.object(contractBase).partial().extend({ id })`. Defaults belong to the create
contract alone; a partial update must materialize **only** the keys the caller sent — collections and
enums included, not just nullable scalars (the sibling lesson
[`partial-update-must-not-clear-absent-fields`](partial-update-must-not-clear-absent-fields.md) covers the
value/`null`/absent distinction; this one covers defaults being invented for absent keys).

**Detection**: parse `{ id }` (or `{ id, <one field> }`) with the update schema in a unit test and assert
`direction`/`currencyCode`/child arrays come back `undefined`. An integration test that creates a two-line
record and `PUT`s only `notes`, then asserts the stored total and line count, catches the data-loss half.

**Applies to**: `src/modules/trade_docs/data/validators.ts` (all three families) and any future module whose
create schema defaults a field the update schema shares.
