---
title: "A cross-organization copy needs an explicit field whitelist and a source link"
modules: ["products", "internal_sales", "parties"]
areas: ["module-data", "architecture"]
topics: ["cross-organization", "master-data", "distribution", "idempotency", "data-scoping"]
---

# A cross-organization copy needs an explicit field whitelist and a source link

**Context**: product distribution (2026-09-28,
`.ai/specs/2026-09-28-product-distribution-to-branches.md`) copies the head office's products into
branch organizations: the platform keeps business rows organization-private, and the branches need
their own rows to sell. The same shape will recur for any "send this master data to another company"
feature (price lists, taxonomies, party masters).

**Problem**: three traps sit in the naive versions of this copy.

- **A spread copies the source's cross-organization references.** `typeId` / `categoryId` point at
  *this* organization's taxonomy rows and `catalogProductId` at *this* organization's catalog row;
  copied verbatim into another organization they are dangling ids that no read path can resolve.
  A field spread also silently starts copying whatever column the source entity gains next.
- **A re-run that rewrites everything silently repricess the target.** Prices (and any other field the
  target is expected to own after the first copy) must not be written again on a later sync, or the
  head office quietly overwrites the branch's own selling prices.
- **`ctx.organizationIds === null` is not "trust the payload".** An unrestricted actor (superadmin,
  no ACL organization list) passes the writable-set check trivially; taking the target ids from the
  request then writes rows whose `organization_id` is a nonexistent or foreign uuid — junk no surface
  shows, and (worse) a pattern that would leak the moment the same code path serves scoped actors.

**Rule**:

1. Copy through an **explicit field whitelist** (one function per entity, listing every copied field),
   never a spread or `Object.assign(source)`. Mutable values (jsonb, arrays) are cloned.
2. Keep a **source link** on the copy (`source_product_id`, self-FK `on delete set null`, indexed by
   scope). It is the idempotency key: a linked row is *updated*, a same-business-key row without the
   link is *reported* (`sku_taken`) and left alone, anything else is *created*.
3. Decide and document **who owns each field after the first copy**. Here: fields and variants follow
   the source on re-runs (variants upserted by `code`, never deleted), prices belong to the target
   forever. A silent overwrite is worse than a stale value.
4. Validate **every** target organization before the first write: in the actor's writable set when it
   is non-null, otherwise it must exist in the tenant (a `directory` organization read is the
   established app-side seam). One refusal before any write beats a partial run.

**Applies to**: `src/modules/products/commands/distribution.ts`, `lib/distribution.ts`, and any future
feature that copies app-owned master data across organizations.
