---
title: "A page that is the record's own surface is never its own back/cancel target"
modules: ["internal_sales", "platform"]
areas: ["backend-ui", "debugging"]
topics: ["navigation", "back-link", "cancel-link", "dead-link", "crud-form", "href-helpers"]
---

# A page that is the record's own surface is never its own back/cancel target

**Context**: The `internal_sales` quote/order edit page (`/backend/internal-sales/{quotes,orders}/[id]/edit`) fed
`CrudForm`'s `backHref` and `cancelHref` from `documentDetailHref(kind, documentId)`, and that helper returns
`` `${listHref}/${id}/edit` `` — the edit page itself. All three operator links (header 「← 返回」, header and footer
「取消」) therefore addressed the URL already in the address bar: the click navigated nowhere and the buttons read as
broken (live report 2026-09-29, reproduced on a quote edit page; fixed by pointing both at `listHrefFor(kind)`).

**Problem**: The trap is a name, not a typo. This module ships **no** detail view — its edit page *is* the document's
page — yet the helper was called "detail" and `CrudForm`'s back/cancel attributes read like "go to the record", so
composing them from the record's own href is the plausible move. Nothing fails early: a link to the current route is
valid JSX, passes typecheck, renders a real `<a>` with a correct-looking href, and only a click reveals it is dead.
The correct answer (`listHrefFor`) already existed one line above and was already what the create form used.

**Rule**: A back/cancel target names the surface the operator leaves *toward*, and that surface must not be the page
rendering the link. When a module has no detail page, the target is the list href — reuse the existing list helper
instead of composing one from the record href. Name helpers after the page they return (`documentEditHref`), never
after the concept they resemble, so the next author cannot build a self-link out of one.

**Applies to**: app-owned modules that render their own `CrudForm` create/edit surfaces and keep navigation inside
their own routes (`internal_sales`, `products`, `parties`, `finance`, `purchasing`, `cross_border`, `platform_ops`,
`export_finance`); every `backHref` / `cancelHref` / `successRedirect` / row-action href in those modules.
