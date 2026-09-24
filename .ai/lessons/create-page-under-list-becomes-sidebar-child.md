---
title: "A create page under a list route renders as an indented sidebar child unless `navHidden` is set"
modules: ["platform", "products"]
areas: ["backend-ui", "framework-context"]
topics: ["navigation", "nav-hidden", "page-meta", "sidebar", "create-route", "admin-nav"]
---

# A create page under a list route renders as an indented sidebar child unless `navHidden` is set

**Context**: While renaming the `products` taxonomy pages (2026-09-23) the sidebar showed 「新建产品线」/「新建产品品类」/「新建产品」
as extra entries beside their list pages, although each is reached from the list's own "New …" button.
`src/modules/products/backend/products/{items,types,categories}/create/page.meta.ts` all omit `navHidden`.

**Problem**: `buildAdminNav` (`node_modules/@open-mercato/ui/src/backend/utils/nav.ts`) skips only routes whose href contains
`[` or that declare `navHidden`, then nests every remaining route under the longest matching href prefix **inside the same
`pageGroupKey`**. `CollapsibleNavSection` renders those children only while the parent is active
(`pathname.startsWith(item.href)`), so the extra entry is invisible on every other page and is easy to miss in review;
`[id]/edit` routes never leak only because their path contains `[`.

**Rule**: A `backend/**/{create,[id]/edit}/page.meta.ts` reached from a list MUST declare `navHidden: true`; only real
destinations omit it. Verify by opening the list page itself (children render only there) and counting sidebar items —
not by reading one page's metadata.

**Applies to**: `src/modules/*/backend/**/page.meta.ts`, `src/modules.ts` page overrides,
`.mercato/generated/backend-route-metadata.generated.ts`, `@open-mercato/ui` `buildAdminNav` + `CollapsibleNavSection`.
