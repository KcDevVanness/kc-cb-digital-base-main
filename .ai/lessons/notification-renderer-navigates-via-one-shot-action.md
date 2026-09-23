---
title: "A renderer that navigates only through the one-shot action response dead-ends on repeat clicks"
modules: ["notifications", "sales", "wms"]
areas: ["backend-ui", "umes", "debugging"]
topics: ["notification-panel", "renderer-wrapper", "repeat-click", "action-idempotency", "link-href", "deep-links"]
---

# A renderer that navigates only through the one-shot action response dead-ends on repeat clicks

**Context**: The bell's notification items did nothing on the second click — first click opened the
document, every later click on the same item only flashed `执行操作失败`. Reproduced on
`sales.quote.created` / `sales.order.created` (this tenant's only unread notifications), and the same
shape exists in the `wms` renderers.

**Problem**: two upstream behaviors compose into a dead control, and neither is visible from the
notification data:

1. `POST /api/notifications/{id}/action` is **one-shot**. `notificationService.executeAction` refuses
   an already-actioned notification (`throw conflict('Notification action already executed')` → 409),
   so the response has no `href` — that `href` is the only href the client ever sees for an action
   (the list DTO's `actions[]` carries `id`/`labelKey`/`variant`/`icon`, never `href`).
2. The installed custom renderers for `sales.order.created`, `sales.quote.created`,
   `wms.inventory.low_stock` and `wms.inventory.reservation_shortfall` navigate **only** on
   `NotificationItem`'s `if (result.href) router.push(result.href)` — the fallback
   `if (!viewAction) router.push(linkHref)` is skipped whenever an action exists. They also keep
   rendering the button for `status === 'actioned'` (the base item hides actions there; the
   renderers ignore that gate).

So the button is a live, always-drawn control whose only exit is a request the server answers once.
The obvious workaround — "rely on the stored row" — does not help: `link_href` + `action_data` are
frozen at creation, the row keeps them, and the host deliberately will not re-run the action. (The
route side of that frozen href — why a stored notification 404s if its page is dropped from the
manifest — is owned by `.ai/lessons/module-override-page-hide-needs-routes-domain.md`.)

**Rule**: when an installed renderer's affordance is *navigation* (its action has no `commandId`),
pin the click to the row's `linkHref` instead of the action response, from a **renderer wrapper**
(props transform — no UI duplication, no `node_modules` edit) supplied through the app's
`customRenderers` map (`src/components/notifications/navigatingActionRenderers.tsx`, applied in
`NotificationBellWrapper`). Call the host action only while the panel still shows the item as
not-actioned, so `action_taken`/read state gets recorded once and later clicks skip the doomed POST
entirely; then navigate when the host left the URL behind (guard on `window.location.pathname` so the
first click does not push twice). A stale panel that still posts gets the 409 and is covered by the
same navigation. Never wrap a type whose action carries a `commandId`: there the repeat click must
keep the host's refusal, and a renderer that swallows it would re-enter a decision flow. Verify by
clicking the same item three times — the first click posts (`200`) and the host navigates, later
clicks must land on the document with no failed request, and `history.back()` must return to the
list (a duplicate push would strand you on the same page).

**Applies to**: `@open-mercato/ui`'s `NotificationBell`/`NotificationItem`/`NotificationPanel` and
the `customRenderers` prop, `@open-mercato/core` notification type definitions with a `Renderer`
(`sales`, `wms`, and any future module that adds one), the `linkHref` every notification type
declares, and the app-owned `src/components/NotificationBellWrapper.tsx`.
