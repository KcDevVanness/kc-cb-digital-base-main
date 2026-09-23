---
title: "The sidebar group key is the role boundary, and only one module may order the groups"
modules: ["sourcing", "purchasing", "cross_border", "export_finance", "internal_sales", "trade_docs"]
areas: ["backend-ui", "architecture"]
topics: ["navigation", "page-group-key", "menu-taxonomy", "sidebar-preferences", "module-overrides"]
---

# The sidebar group key is the role boundary, and only one module may order the groups

**Context**: The backend sidebar had two different groups both rendering as 「采购」 and trade pages
split across three groups. Regrouping it into six business-role groups
(`.ai/specs/2026-09-22-supplier-product-library.md`, REQ-SPL-009) surfaced two hard edges that are
invisible from a single `page.meta.ts`.

**Problem**:

1. **A group is its `pageGroupKey`, not its `pageGroup` label.** `purchasing.nav.group` and
   `sourcing.nav.group` both carried `pageGroup: 'Purchasing'` — and rendered as **two** groups with
   the same name, because `buildAdminNav` buckets by the untranslated key and only then labels each
   bucket. Changing the label alone changes nothing; two pages join one group only when they share
   the key. There is also no automated test that catches a split: the pages render fine, the menu is
   just wrong.
2. **The group order is one app-wide decision.** `overrides.nav.groupOrder` **prepends** ids ahead of
   the framework's `defaultGroupOrder`; ids it does not name keep their position. Declaring it on two
   module entries does not merge them — `applyModuleOverridesFromEnabledModules` logs
   `nav.groupOrder declared by more than one module — the later one wins` and silently drops the
   first declaration, so the sidebar order depends on module-load order.

**Rule**: one business role = exactly one `pageGroupKey`, declared identically on every page of that
role (including the create/edit/detail pages, which are separate `page.meta.ts` files); the group
**label** is an i18n key on the key (e.g. `cross_border.nav.group` → 外贸 / Trade), never a literal.
Ordering is declared **once**, on a single `enabledModules.push({ id, from, overrides: { nav: {
groupOrder: [...] } } })` entry — the app's `purchasing` entry in `src/modules.ts` — and the ids it
names are the existing ones, because a group id is also the persisted unit of per-user sidebar
preferences (`/backend/sidebar-customization`): renaming a key orphans every stored arrangement.
Verify by counting the rendered groups, not by reading one page's metadata.

**Applies to**: `src/modules.ts`, every `src/modules/*/backend/**/page.meta.ts`, the modules' i18n
catalogs (`*.nav.group` keys), and any future regroup or page addition — a new page that forgets its
`pageGroupKey` silently lands in the framework's default section.
