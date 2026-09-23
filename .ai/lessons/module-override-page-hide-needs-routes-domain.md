---
title: "Hiding an installed page needs the routes.pages override domain"
modules: ["platform"]
areas: ["umes", "framework-context", "architecture"]
topics: ["module-overrides", "route-overrides", "nav-hidden", "installed-pages", "deep-links", "notifications"]
---

# Hiding an installed page needs the routes.pages override domain

**Context**: To make the app-owned `products` master the only product surface, eight installed
catalog pages (`/backend/catalog/products*`, `/backend/catalog/categories*`) were disabled from
`src/modules.ts` by writing `overrides: { pages: { '/backend/catalog/products': null } }`. The
compiled registry kept the key, `yarn generate` reported success, and the pages stayed in the
navigation.

**Problem**: the override dispatcher only walks the domains listed in `DOMAIN_KEYS`
(`@open-mercato/shared/src/modules/overrides.ts`): `ai, routes, events, workers, widgets,
notifications, interceptors, commandInterceptors, enrichers, guards, cli, setup, acl, di,
encryption, nav`. Page hiding belongs to **`routes.pages`**, keyed by the page pathname exactly as
the generator emits it (`.mercato/generated/backend-route-metadata.generated.ts`, e.g.
`/backend/catalog/products/[productId]/variants/[variantId]`). A domain key that is not in
`DOMAIN_KEYS` is read by nothing; the failure is a silent no-op, not an error — the page keeps
rendering and the navigation keeps listing it.

**Rule**: page/API overrides go under `routes.pages` / `routes.api` (`'METHOD /api/path'`), and the
pathnames are copied from the generated backend-route manifest rather than guessed from the
filesystem. After a registry change, run `yarn generate` and check
`.mercato/generated/app-modules-overrides.compiled.mjs` — the canonical, normalized shape is what
the runtime reads; if the key is not there in that shape, it is not doing anything. Hiding a page
removes the route manifest entry, so the URL 404s too; the module's API, entities and ACL stay
enabled (`config/catalog` was deliberately left visible because `sales` still depends on catalog
offers and price kinds).

**Two modes, and they answer different questions** (2026-09-22, extending the hide to
`customers`/`sales`/`wms`/`currencies`/`dictionaries`/`feature_toggles`):

- `routes.pages: { '/backend/x': null }` — the route manifest entry is dropped outright, so the URL
  404s as well. Use it for create/detail/edit pages, which never reach a sidebar anyway (`buildAdminNav`
  skips hrefs containing `[`).
- `routes.pages: { '/backend/x': { metadata: { navHidden: true } } }` — the page stays reachable by
  URL and disappears from every navigation surface. `buildAdminNav` skips `navHidden` entries *before*
  it splits them by `pageContext`, so one flag clears the main sidebar, the settings panel and the
  profile menu together. The override metadata is additive (`resolveDeclaredPageRouteMetadata` drops
  undeclared keys), so the authored `title`/`group`/`icon` survive.

A stale key is not always silent: keys that normalize fine but match no registered entry surface as
`Override did not match any registered entry — override skipped` at registration (`warnStaleOverrides`).
Only a key the dispatcher never reads at all (wrong domain) is silent.

**`null` is not the "hidden" mode — pick it only when nothing links to the URL** (2026-09-22, notification
click-through). `catalog`/`customers`/`sales`/`wms`/`currencies`/`feature_toggles` had every
create/detail/edit pathname on `null` with the reasoning "those pages never reach a sidebar anyway", so
the choice looked free. It is not: the app keeps those modules **enabled**, and enabled subsystems
deep-link into their canonical URLs —

- notification type definitions, resolved into a **stored** row at emit time:
  `sales.order.created`/`sales.payment.received` → `/backend/sales/orders/{sourceEntityId}`,
  `sales.quote.created`/`sales.quote.expiring` → `/backend/sales/quotes/{sourceEntityId}`,
  `catalog.product.low_stock` → `/backend/catalog/products/{sourceEntityId}`,
  `customers.deal.won|lost` → `/backend/customers/deals/{sourceEntityId}`,
  `wms.inventory.low_stock` → `/backend/sales/orders/{sourceEntityId}`;
- the rows of the official lists the app *kept* reachable (`navHidden`), whose detail links and
  `.../create` buttons 404ed;
- message-object hrefs and the catalog search presenter
  (`/backend/catalog/products/{id}/variants/{variantId}`);
- links inside each detail page (deal → `/backend/customers/companies-v2/{id}`,
  document → `/backend/sales/documents/create`), so a partially re-enabled subtree introduces new 404s.

Removing a route therefore breaks every one of those clicks, and rewriting the notification *types*
cannot repair it: `notifications` rows freeze `link_href` + `action_data` at creation, so already-emitted
notifications keep the dead href (36 `auth.role.assigned`, 16 `sales.quote.created`, 8
`sales.order.created` rows were in that state) — and `overrides.notifications.types` replaces a whole
definition (`isReplacement: isNotificationType`), not a field, while the app has no replacement page for
`catalog` products or `customers` deals to redirect to. Keeping the URL resolvable (`navHidden`) is the
only fix that covers stored rows, list rows, search results and future notifications in one edit.

Corollary: `navHidden` on a `[param]` path changes nothing in the navigation (nav already skips hrefs
containing `[`), so migrating `null` → `navHidden` is nav-neutral and purely a reachability fix.

**Applies to**: `src/modules.ts` `ModuleEntry.overrides`, `.mercato/generated/app-modules-overrides.compiled.mjs`,
`.mercato/generated/backend-route-metadata.generated.ts`, and any module whose installed UI is
replaced by an app-owned surface.
