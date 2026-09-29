---
title: "A hand-written route that reads cookies only is invisible to the integration harness"
modules: ["sourcing"]
areas: ["framework-context", "module-data"]
topics: ["custom-routes", "auth-resolution", "bearer-token", "integration-harness", "fail-closed"]
---

# A hand-written route that reads cookies only is invisible to the integration harness

**Context**: three new read-only routes were added to `sourcing`
(`/api/sourcing/quote-changes`, `.../quote-changes/versions`, `/api/sourcing/item-timeline`). Each one
started from the module's existing hand-written route as its template, so each resolved the caller with
`getAuthFromCookies()`. The browser worked. The focused integration suite failed on the first request
with `401 Unauthorized`, after the *fixture* calls in the same test — supplier creation, quotation
creation, the multipart upload, `parse`, `approve` — had all succeeded against the same server with the
same token.

**Problem**: the integration harness (`@open-mercato/core/helpers/integration/authFixtures`
`apiRequestWithSelectedOrg`) authenticates with `Authorization: Bearer <jwt>` and uses cookies only to
carry `om_selected_org`. The CRUD factory resolves the principal with
`const auth = request ? await getAuthFromRequest(request) : await getAuthFromCookies()` — so every
`makeCrudRoute`/command route accepts both, which is why the fixtures passed. A hand-written route that
copies `getAuthFromCookies()` from a sibling page-facing route silently narrows the accepted
credentials: it works in the browser and is unreachable for the harness (and for any API-key or
bearer-only caller). The failure surfaces as a permission-looking `401` on the *newest* surface, which
invites the wrong diagnosis ("the feature gate is wrong") instead of "the route cannot see the
principal".

**Rule**: resolve the authenticated principal the way the platform does — `getAuthFromRequest(request)`
in a route that has the request object — never `getAuthFromCookies()` alone. Cookies-only resolution is
a deliberate choice for a page-local handler, not a default to copy; a route offered to API callers
must accept what the platform's own callers send.

**Applies to**: every hand-written route under `src/modules/*/api/**` that is not built with
`makeCrudRoute` (`sourcing/api/quotes/[id]`, `sourcing/api/quotes/ai-mapping`, the three change-analysis
routes fixed here). Symptom in tests: fixture calls green, the newest endpoint `401`; symptom in
production: a bearer-token or API-key caller cannot reach a route the browser reaches.
