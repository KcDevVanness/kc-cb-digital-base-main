---
title: "The sidebar group key is the role boundary, and only one module may order the groups"
modules: ["sourcing", "purchasing", "cross_border", "export_finance", "internal_sales", "trade_docs", "boss_cockpit", "finance", "ru_sync"]
areas: ["backend-ui", "architecture"]
topics: ["navigation", "page-group-key", "sidebar-preferences", "untranslated-fallback", "group-order", "audience-split"]
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

**2026-09-28 — a group that mixes audiences splits by adding keys, never by renaming.** The 财务
group had drifted into three audiences: the finance desk's work (单证档案 / 费用 / 台账 / 发票台账),
the boss's results (驾驶舱 / 月损益 / SKU 毛利 / 库存资金占用) and the RU pipeline's maintenance pages.
The split re-pointed those pages' `pageGroupKey` at two **new** ids
(`executive_overview.nav.group` / 「经营概览」, `ru_sync.nav.group` / 「数据同步」) and added them to the
one `nav.groupOrder` declaration; `export_finance.nav.group` kept its id **and** its 「财务」 label, so
stored sidebar preferences survived — renaming it to something like `finance.nav.group` would have
orphaned every user's arrangement for a cosmetic win. Verify by counting the rendered groups (the
dev sidebar, 9 groups), not by reading one `page.meta.ts`.

**2026-09-29 — a key with no catalog row renders the raw `pageGroup` literal, and a group `groupOrder`
never names sinks to the bottom.** The sales module's external entry carried
`pageGroupKey: 'cross_border.nav.group'` on all four of its pages, but no catalog ever defined that
key: `buildAdminNav` calls `translate(groupKey, group)` and the fallback is the page's own
`pageGroup` string, so the Chinese sidebar rendered the English literal 「Cross-Border」 — and
because `nav.groupOrder` did not name it either, the group rendered **after** every named group,
i.e. at the very bottom. Neither symptom fails a build, a typecheck or a test; both are only visible
by rendering the sidebar in the non-English locale. A new `pageGroupKey` therefore lands in the same
change as three things: its **zh and en** catalog entries, its position in the single `groupOrder`
declaration, and `page.meta.ts` files whose `pageGroup` fallback reads like the localized label
(it is what users see whenever the key resolves to nothing).

**2026-09-29 — an entry named after one of the two things it serves is wrong the moment it serves
both.** `/backend/internal-sales/**` was 「出口业务-内部销售」 with items 「内部销售报价单」/
「内部销售订单（PO）」 — accurate while that entry could only write internal documents. Once its create
form offered 对内 **and** 对外, the names described half of the entry's capability and the owner
reported them as simply wrong. The fix renamed the group key to `cross_border.nav.group.sales`
(「出口业务-销售」) with type-neutral items, kept the type-specific entry on its own key
(`cross_border.nav.group.externalSales`), and — the part that makes the names true — changed the
entry's list to show both types with an always-on 类型 column. Naming and list scope are one decision:
a name that covers both types while the list filters to one is the next report.

**Applies to**: `src/modules.ts`, every `src/modules/*/backend/**/page.meta.ts`, the modules' i18n
catalogs (`*.nav.group` keys), and any future regroup or page addition — a new page that forgets its
`pageGroupKey` silently lands in the framework's default section.
