# Catalog Customization and Eject Decision (superseded decision record)

**Date**: 2026-09-21
**Status**: Superseded 2026-09-22 — kept only for the **preserved-contract register** and the recorded
eject trade-offs. Do not implement anything from this file.

> **Why superseded.** This spec was opened to decide *where* a catalog change lands (UMES contribution →
> `src/modules.ts` override → eject) while `catalog` stayed the product master. On 2026-09-22 the owner
> changed the business call: the app **owns the product master** in `src/modules/products/**` and keeps
> installed `catalog` enabled only as the platform-level registry it bridges to
> (`.ai/specs/2026-09-22-products-and-trade-docs.md`, REQ-016; decision row in
> [`docs/dev/business-architecture.md`](../../docs/dev/business-architecture.md) 已定决策与依据). The
> customize-in-place question for **product** surfaces is therefore moot, and its Phase 1–3 plan, open
> questions (`Q-001…Q-007`), data-model and journey sections were dropped in the 2026-09-23 cleanup.
> Eject is still **not** done — the measured costs below are the reason.
>
> **Live residues, and where they are owned now:**
> - Product/variant/category/price master → app-owned `products` (products spec) + `catalog` bridge via
>   `products_products.catalog_product_id`.
> - Hiding installed catalog pages → `src/modules.ts` `routes.pages` + `metadata.navHidden` (never `null`;
>   see [`.ai/lessons/module-override-page-hide-needs-routes-domain.md`](../lessons/module-override-page-hide-needs-routes-domain.md)).
> - Reminder flows (this file's `Q-002`) → still open, tracked as PRD `Q6` and in
>   [`docs/dev/business-architecture.md`](../../docs/dev/business-architecture.md) 开放问题.
> - Whether SKUs ever leave the catalog bridge → `.ai/specs/2026-09-22-product-variants.md`
>   (*Deferred — the wms round*).

## Mechanism ladder (still the app's policy for installed modules)

Escalate in this order, and record the rejection reason at each step:

1. **UMES app-side contribution** — extension entities/fields, enrichers, injectors, interceptors,
   guards, subscribers, widgets, component/page replacements (`om-system-extension`).
2. **`src/modules.ts` override key** — `entry.overrides.<domain>` is the supported disable/replace
   contract: `null` drops a registry entry, a value replaces it. The writable domains are the framework's
   `DOMAIN_KEYS` (`ai`/`routes`/`events`/`workers`/`widgets`/`notifications`/`interceptors`/
   `commandInterceptors`/`enrichers`/`guards`/`cli`/`setup`/`acl`/`di`/`encryption`/`nav`); an unknown
   key is silently ignored, so an ineffective override is a defect, not a preference. Page hiding lives
   under `routes.pages`.
3. **Eject** (`yarn mercato eject <module>`) — last resort, approval-gated, only when the module's own
   code must change.

"Hiding is safe removal": hiding a capability's UI while its data and API stay is acceptable where the
capability is unused, but **authorization is never replaced by hiding** — page-level `requireFeatures`
keeps applying.

### Measured eject trade-offs (`.ai/analysis/2026-09-21-catalog-eject-spike.md`)

- Eject = copy + rewrites: `src/modules/catalog/` becomes 159 files / 2.2 MB registered `from: '@app'`;
  dependents are **not** touched; the app copy becomes the registered entity source.
- Upgrade ownership transfers for 12 entities, 24 commands, 18 events, 9 pages, 7 ACL features,
  8 search entities, 2 AI agents, 29 AI tools, 1 worker, 1 subscriber, 26 migrations + snapshot.
- **Self-reference trap:** 33 package-path imports inside the copied files stay pointed at the package;
  editing the local components has no effect until those specifiers are repointed.
- The predicted duplicate-metadata hazard did **not** materialise: MikroORM resolves the app and package
  classes onto one metadata by entity name, so package-path imports keep working — but that depends on
  class/export names staying identical (renaming an entity is a contract change, not a refactor).

## Preserved-contract register (catalog)

Facts below were true at 2026-09-21 and remain the set any future change to `catalog` must not break
(`sales` requires catalog; `wms` binds to it). Cited by `.ai/specs/2026-09-22-product-variants.md`.

- **Routes:** `/api/catalog/products`, `/api/catalog/variants`, `/api/catalog/settings` (+ the module's
  remaining API paths); 24 domain commands `catalog.products.{create,update,delete}`,
  `catalog.variants.{create,update,delete}`, `catalog.categories.*`, `catalog.offers.*`,
  `catalog.prices.*`, `catalog.priceKinds.*`, `catalog.optionSchemas.*`,
  `catalog.product-unit-conversions.*`.
- **API interceptor bridges that installed consumers depend on:**
  `api-route:catalog/products:POST|PUT:api-interceptor-bridge` and
  `api-route:catalog/variants:POST|PUT:api-interceptor-bridge` (bound by
  `wms.catalog-products.inventory-profile-sync` / `wms.catalog-variants.inventory-profile-sync`) —
  payload shape and method set MUST stay compatible.
- **Events (18):** `catalog.product.{created,updated,deleted,stock_low}`, `catalog.variant.*`,
  `catalog.category.*`, `catalog.price.*`, `catalog.pricing.resolve.{before,after}`,
  `catalog.product_unit_conversion.*`.
- **ACL features (7):** `catalog.products.view|manage`, `catalog.categories.view|manage`,
  `catalog.variants.manage`, `catalog.pricing.manage`, `catalog.settings.manage`.
- **DI tokens:** `catalogPricingService`, `CatalogProduct`, `CatalogProductPrice`.
- **Background surfaces:** worker `catalog:product-bulk-delete`, subscriber
  `catalog:low-stock-notification`, notification type `catalog.product.low_stock`.
- **Search:** 8 indexed catalog entities; removing an entity from `search.ts` requires a reindex decision.
- **Stored references:** `sales` order/quote lines store `product_id` / `product_variant_id` +
  `catalog_snapshot`; `catalog_product` carries `hs_code`/`cn_code`/`country_of_origin_code`/
  weight/dimensions/lithium-battery flags (the cross-border fields the app re-uses).

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial skeleton: mechanism ladder, preserved-contract register, eject impact, risks, phases; Open Questions gate opened |
| 2026-09-21 | Eject spike executed in an isolated worktree; measured evidence recorded, duplicate-metadata hazard disproved, self-referencing-import trap added to risks |
| 2026-09-23 | **Superseded** by the 2026-09-22 decision to own the product master. Dead planning sections (phases, open questions, compliance report, journeys, data model) removed; mechanism ladder, eject trade-offs and the preserved-contract register kept as the decision record. |
