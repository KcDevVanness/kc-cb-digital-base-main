# Execution plan — internal trade + multi-company org model (shipped as a PR)

**Slug**: `internal-trade-org-model`
**Branch**: `feat/internal-trade-org-model`
**Base**: `main` (resolved via tracker **default-branch**)
**Source doc**: `.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`, `.ai/specs/2026-09-28-product-distribution-to-branches.md`, `.ai/specs/2026-09-28-internal-sales-quote-to-order.md`, `docs/dev/multi-company-org-model.md`
**Status**: complete

> This run ships work that was already implemented and verified live on dev while the shared tree
> carried it uncommitted (the owner's instruction: 内部销售买方关联 → 多公司组织模型 → 商品分发 →
> 模拟建档 → 报价转订单 → 重复商品清理 → 提交 PR). The plan below records the phases with their
> evidence; each step was exercised against the running dev app before the commit.

## Goal

Make the app usable for one tenant with a head office plus branch companies: the internal-sales buyer
is a related organization (or an external customer), branches are enabled (orgs, roles, accounts,
parties, warehouses with locations, dictionaries, product copies), the head office can distribute its
product master, the fulfilment prerequisite (catalog rows + default variants + links) is in place, and
the quote→order step finally has a UI entry.

## Scope

- `src/modules/internal_sales/**` (buyer picker, list gating, quote→order action, i18n, README)
- `src/modules/products/**` (distribution slice, list action gating, catalog-link docs, README)
- `src/modules/parties/**` (role-filtered option source used by the buyer picker)
- `src/lib/orgs/**` (shared organization-option assembly)
- Specs, lessons, `docs/dev/multi-company-org-model.md`, the plan/status rows
- `scripts/demo-data/seed-internal-trade-parties.mjs` (simulated customers + branch bank blocks)

## Non-goals

- No engine changes, no new tables/migrations beyond the distribution's `source_product_id` column,
  no new ACL feature ids.
- The mock records are placeholders (`MOCK-` codes / `（模拟）` names) until the owner supplies the
  real customer list; replacing them is a filtered delete + re-seed.
- `eversweet-*` duplicate rows are soft-deleted, not re-pointed in the one draft purchase order that
  referenced them (the line renders from its own frozen snapshot; the PO-line route is read-only).

## Implementation Plan

### Phase 1: Internal-sales buyer linkage

- [x] 1.1 Merge two buyer sources (organization tree + `parties`) into one picker with the source at the front of the label
- [x] 1.2 Snapshot protocol `internalSales.{organizationId|partyId}` + name auto-fill + explicit clear semantics
- [x] 1.3 `parties/options` role filter (`?roles=`) so branch-role records stay out of the buyer list
- [x] 1.4 Fix the variant-bridge save race (same-value `onChange` re-fire must not clear derived state)
- [x] 1.5 Gate list actions by the document's manage feature (read-only roles see a read-only list)

### Phase 2: Product distribution to branches

- [x] 2.1 `products_products.source_product_id` column + reviewed migration
- [x] 2.2 `products.items.distribute` command (whitelist, variant upsert by code, first-price-only, SKU skip, per-target authorization)
- [x] 2.3 `POST /api/products/items/distribute` + row/header dialog entries with all UI states

### Phase 3: Multi-company org model (data + docs)

- [x] 3.1 Branch orgs under the head office; branch roles and accounts; HQ operator account
- [x] 3.2 Branch parties (internal buyers) with bank/address block
- [x] 3.3 Branch warehouses + **locations** (the receive needs warehouse + location + catalog variant)
- [x] 3.4 Currency/dictionary seeds per branch; product copies via the distribution action

### Phase 4: Fulfilment prerequisite (catalog master)

- [x] 4.1 Mirror the five canonical products into the official catalog (+ one default active variant each) and set the links
- [x] 4.2 Verify the variant bridge fills `productVariantId` from the new links

### Phase 5: New capability — quote → order

- [x] 5.1 Spec `.ai/specs/2026-09-28-internal-sales-quote-to-order.md`
- [x] 5.2 Row action + irreversible confirm + engine convert call + redirect to the order edit page
- [x] 5.3 i18n (zh/en) and the module README note

### Phase 6: Simulated records + duplicate cleanup

- [x] 6.1 `scripts/demo-data/seed-internal-trade-parties.mjs` (idempotent, `MOCK-` marked) and one real run
- [x] 6.2 Soft-delete the six `eversweet-*` duplicate rows (HQ + both branch copies) and record the口径

## Risks

- The distribution intentionally does not copy the catalog link; a branch that later needs local
  fulfilment must be linked per organization (recorded in the distribution spec's non-goals).
- The simulated records must be replaced before any real reporting; they are marked for exactly that.
- The worktree's first full gate run is slow (cold TypeScript cache); CI runs the same commands.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Internal-sales buyer linkage

- [x] 1.1 Merge two buyer sources (organization tree + `parties`) into one picker with the source at the front of the label — 7f7fd99
- [x] 1.2 Snapshot protocol `internalSales.{organizationId|partyId}` + name auto-fill + explicit clear semantics — 7f7fd99
- [x] 1.3 `parties/options` role filter (`?roles=`) so branch-role records stay out of the buyer list — 7f7fd99
- [x] 1.4 Fix the variant-bridge save race (same-value `onChange` re-fire must not clear derived state) — 7f7fd99
- [x] 1.5 Gate list actions by the document's manage feature (read-only roles see a read-only list) — 7f7fd99

### Phase 2: Product distribution to branches

- [x] 2.1 `products_products.source_product_id` column + reviewed migration — 8b9e691
- [x] 2.2 `products.items.distribute` command (whitelist, variant upsert by code, first-price-only, SKU skip, per-target authorization) — 8b9e691
- [x] 2.3 `POST /api/products/items/distribute` + row/header dialog entries with all UI states — 8b9e691

### Phase 3: Multi-company org model (data + docs)

- [x] 3.1 Branch orgs under the head office; branch roles and accounts; HQ operator account — a9e6e47
- [x] 3.2 Branch parties (internal buyers) with bank/address block — a9e6e47
- [x] 3.3 Branch warehouses + locations (the receive needs warehouse + location + catalog variant) — a9e6e47
- [x] 3.4 Currency/dictionary seeds per branch; product copies via the distribution action — a9e6e47

### Phase 4: Fulfilment prerequisite (catalog master)

- [x] 4.1 Mirror the five canonical products into the official catalog (+ one default active variant each) and set the links — 8b9e691
- [x] 4.2 Verify the variant bridge fills `productVariantId` from the new links — 8b9e691

### Phase 5: New capability — quote → order

- [x] 5.1 Spec `.ai/specs/2026-09-28-internal-sales-quote-to-order.md` — 7f7fd99
- [x] 5.2 Row action + irreversible confirm + engine convert call + redirect to the order edit page — 7f7fd99
- [x] 5.3 i18n (zh/en) and the module README note — 7f7fd99

### Phase 6: Simulated records + duplicate cleanup

- [x] 6.1 `scripts/demo-data/seed-internal-trade-parties.mjs` (idempotent, `MOCK-` marked) and one real run — 4b26578
- [x] 6.2 Soft-delete the six `eversweet-*` duplicate rows (HQ + both branch copies) and record the口径 — 8b9e691
