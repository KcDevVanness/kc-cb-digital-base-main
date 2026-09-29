---
title: "A cross-version diff needs a line-unique key, and its chain needs a duplicate rule"
modules: ["sourcing"]
areas: ["module-data", "architecture"]
topics: ["quotation-versions", "diff-key", "item-no-vs-derived-sku", "version-chain", "same-day-collapse"]
---

# A cross-version diff needs a line-unique key, and its chain needs a duplicate rule

## What happened

The supplier quotation archive stores every workbook a supplier ever sent. Comparing two versions of
one supplier's quotation looked like a five-line job: index the lines by some key, walk both sides,
report the differences. Two measured failures said otherwise — both from real data in this repo, not
from a thought experiment.

**The key that is not unique inside one file.** `sourcing_quote_lines.item_no` looks like the natural
identity: it is the supplier's own item number, it is printed on the sheet, and two versions of the
same sheet repeat it exactly. But a supplier quotes several **variants** under one Item No. — the
Petkit sheet carries `P4108` twice (standard and UVC) and the derived SKU is what separates them
(`P4108`, `P4108-UVC`). Indexing by `item_no` makes both variants share one slot, so the two rows pair
with each other: two imports of **the same file** reported `changed = 16` instead of `0`, with prices
compared across variants. Keying on `upper(trim(derived_sku ?? item_no))` — the same rule the SKU
derivation already guarantees is unique within a file — returned the correct `0`.

**The chain that thought four copies were four versions.** The archive had 15 Excel imports: the
Petkit sheet 7 times, the EXW invoice 3 times, the downloaded template 4 times — all inside
thirteen minutes of trial-and-error on 2026-09-22. A "version list" built from `status = approved`
therefore showed four versions of one file, and the previous version of a layout was a different
import of the same workbook. A version is now: decided (approved or archived), carrying a layout
signature, **and one entry per calendar day** — the newest import of that layout that day wins, and
`collapsedCount` reports how many were folded in. `quote_date` wins over the import timestamp when
the operator filled it. Archived versions stay in the chain: a chain that forgets retired versions
cannot answer "what did this cost last quarter?".

## The durable rules

- A cross-version key must be unique **within one document**, not merely stable across documents.
  When the identity is a variant-level SKU, the item number is the wrong key even though it is the
  key the supplier prints.
- A comparison over a document archive needs an explicit **duplicate/collapse policy** for the same
  subject imported repeatedly. Without one, "versions" silently means "import attempts".
- Three states must be reported rather than guessed: `currency_mismatch` (never subtract a JPY price
  from a CNY one), `no_price` (a blank cell is not zero), and `unmatched` (a line with no usable
  code). Silence in a comparison reads as "no change".
- Money comparisons run on scaled BigInt. The percentage is the only float, and it is computed at the
  boundary where it is displayed.

## Where it lives

- `src/modules/sourcing/lib/quoteChanges.ts` — `normalizeItemKey`, `classifyChange`, `diffQuotes`,
  `buildVersionChains`, `pickPreviousVersion`, `buildItemTimeline`; unit proof in
  `lib/__tests__/quoteChanges.test.ts` (including the variant fan-out case).
- `src/modules/sourcing/lib/quoteChangeReads.ts` — the scoped reads (own tables through the entity
  manager, foreign tables through declared Kysely projections).
- Spec: `.ai/specs/2026-09-24-supplier-quotation-change-analysis.md`; integration proof:
  `src/modules/sourcing/__integration__/quote-changes.spec.ts`.

## See also

- `.ai/lessons/pruning-a-field-means-pruning-every-carrier.md` — the same archive's field-removal
  discipline; this record is about reading it, not reshaping it.
- `.ai/lessons/kysely-bare-handle-types-tables-away.md` — why the reads declare their projections.
