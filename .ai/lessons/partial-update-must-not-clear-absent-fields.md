---
title: "A partial update must not read 'field absent' as 'field cleared'"
modules: ["products", "purchasing", "sourcing", "platform"]
areas: ["module-data", "debugging", "architecture"]
topics: ["validators", "nullable-fields", "partial-update", "data-loss", "supplier-mapping", "zod"]
---

# A partial update must not read "field absent" as "field cleared"

**Context**: adding `volume` to the product master (2026-09-24) and syncing the supplier library's
`unit_volume` into it. `sync-fields` reported `fieldsChanged: ["volume"]`, the write answered 200, and the
master's `net_weight`/`gross_weight` came back **empty** — the two fields the payload never mentioned. The
reverse happened on the next call: a weights-only sync erased `volume`.

**Problem**: `products/data/validators.ts` and `purchasing/data/validators.ts` both built their nullable
decimals as

```ts
z.union([z.string(), z.number(), z.null()]).optional()
  .transform((value) => (value === null || value === undefined ? null : value))
  .pipe(z.union([decimalSchema(scale, options), z.null()]))
```

so an **absent** key parsed to `null`, indistinguishable from an explicit "clear it". The update commands are
written the other way round — `if (parsed.netWeight !== undefined) entity.netWeight = parsed.netWeight` — and
`productUpdateSchema`/`supplierProductUpdateSchema` are `.partial()`. Every partial write therefore erased the
decimal columns it did not send: `sync-fields` (which sends only the changed keys by design), the quotation →
library import (`changedLibraryFields`), and any hand-written `PUT`. The integer helper next door
(`nullableNonNegativeIntegerSchema`) already behaved correctly — `carton_quantity` survived the same payload —
which is what made the difference visible. Measured with a throwaway parse probe: `productUpdateSchema.parse({
id, volume: '88642' })` returned `netWeight: null, grossWeight: null` before the fix and `undefined` after.

**Rule**: a nullable field's schema must keep three states apart — value, explicit `null`, **absent** — and
only the caller may decide what absent means. Never fold `undefined` into `null` inside a transform that a
`.partial()` update schema shares; if the pipeline target must accept `undefined`, add `z.undefined()` to it.
Verify a partial write by reading the *untouched* columns back, not just the field you changed.

**Applies to**: `src/modules/*/data/validators.ts` (the `nullableDecimalSchema` helpers), every
`*.partial()` update schema, the supplier → master write contract (`products/lib/supplierMapping.ts`) and its
two callers, and any sync/import path that submits changed fields only.
