---
title: "A bare getKysely() types every table away; read your own module's tables through the entity manager"
modules: ["sourcing"]
areas: ["module-data", "framework-context"]
topics: ["kysely", "mikro-orm", "entity-manager", "typecheck", "read-projections", "no-any"]
---

# A bare getKysely() types every table away; read your own module's tables through the entity manager

**Context**: while adding the supplier library's price table (then `sourcing_supplier_product_prices`,
now `purchasing_supplier_product_prices`), the first version of `lib/supplierProductPrices.ts` loaded the page's base prices with
`em.fork().getKysely().selectFrom('sourcing_supplier_product_prices')` — copying the shape of the
module's existing cross-module read helpers (`lib/productsReads.ts`,
`cross_border/lib/purchasingReads.ts`). `yarn typecheck` failed on five consecutive lines with
`Argument of type 'string' is not assignable to parameter of type
'TableExpressionOrList<MapValueAsTable<MapTableName<never, GetKyselyOptions>, never>, never>'` — the
handle had no tables at all.

**Problem**: in the installed MikroORM the DB generic of `getKysely()` defaults to `never`, so a bare
call compiles only against a schema you cannot name a table from. The repo's own precedents pass
`getKysely<any>()`, which makes the identical code compile — and that `any` is exactly what the
project's TypeScript rule forbids. So the "copy the neighbouring file" move either fails the
typecheck or violates the rule, and neither failure explains itself.

**Rule**: read a table **this module owns** through the entity manager — `em.fork().find(Entity,
{ tenantId, organizationId, … } as FilterQuery<Entity>, { orderBy })`, with a relation filter
(`{ product: { $in: ids } }`) for a batch read and `row.supplierProduct.id` to key the projection by
the FK (the PK is known on an unpopulated reference; no `populate` needed). Keep raw Kysely for
**another** module's tables, where the app's existing helpers already carry the cast. Never widen a
handler to `any` to make a query compile: if a query cannot be expressed without it, the entity
manager is the answer, not the cast.

For **another** module's tables, declare the projection you read and cast the handle once with the
reason in a comment (`src/modules/purchasing/lib/quoteLineReads.ts` does this for the quotation
tables), because that read is a projection, not an entity dependency.

**Applies to**: `src/modules/purchasing/lib/supplierProductPrices.ts` (the corrected read),
`src/modules/purchasing/components/SupplierProductsTable.tsx` (its consumer),
`src/modules/purchasing/lib/quoteLineReads.ts` (the cross-module case), and any new read helper for
an app-owned table under `src/modules/*/lib/`.
