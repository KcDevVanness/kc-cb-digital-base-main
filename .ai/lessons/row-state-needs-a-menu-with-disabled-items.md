---
title: "A row state belongs in the ⋯ menu, and the installed RowActions cannot render it disabled — ActionsDropdown can"
modules: ["purchasing", "platform"]
areas: ["backend-ui", "framework-context"]
topics: ["row-actions", "actions-dropdown", "disabled-state", "data-table", "installed-ui", "owner-feedback"]
---

# A row state belongs in the ⋯ menu, and the installed RowActions cannot render it disabled — ActionsDropdown can

**Context**: owner 2026-10-10 复查·三 on the purchase-order list: every row carried the row's `⋯`
menu **plus** a second button beside it — 「打开公司订单」 for a linked row, a greyed 「未关联公司订单」
for an unlinked one — and the reply was 「我希望你这个按钮操作可以放置「。。。」里面，这样放置外面很丑」.

**Problem**: the states are not actions. The move looks like "add a `disabled` item to the row's
menu", but the menu used by every table here — `RowActions` from `@open-mercato/ui/backend/RowActions`
— has no disabled item: `RowActionItem` is `{ id, label, onSelect?, href?, destructive? }`, and each
item renders a `Button`/`<a>` with hover styling. A state entry passed there looks clickable and
does nothing when clicked (worse than the standalone button), passing `onSelect: () => {}` is a lie,
and `node_modules` is read-only — the fix cannot be "add `disabled` to the package". The menu that
does carry the state is `ActionsDropdown` (`@open-mercato/ui/backend/forms`, exported with its
`ActionItem` incl. `disabled`, `icon`, `loading` and `triggerMode: 'icon'` for the ⋯ trigger);
`triggerClassName` keeps the trigger visually identical to the bare row-action icon.
Two traps when swapping it in: `DataTable` **rebuilds** the cell through `RowActions` as soon as any
widget injects row actions (`DataTable.tsx` merges `baseNode.props.items`), so a table with
`extensionTableId`-driven injections silently loses the disabled state; and the default row action
(`rowClickActionIds`, resolved from `props.items` when `onRowClick` is absent) only keeps working
because the replacement's prop is also named `items`.

**Rule**: an actionable row entry → installed `RowActions`; a row **state** that has to sit in the
menu (it explains something, it does nothing) → `ActionsDropdown` with `disabled: true`. Never park a
state as a second button beside the `⋯`, never fake it with a clickable no-op item, and keep the
menu's item-building in a pure helper so the linked / unlinked / unresolved states are pinned by a
unit test (`purchasing/components/purchaseOrderRowActions.ts`, TEST-037).

**Applies to**: `src/modules/**/components/*Table.tsx` `rowActions` renderers, any owner feedback
phrased as "put this button inside the ⋯", and tables that mix a widget-injected action with a state
entry (check for `extensionTableId` before choosing the menu component).
