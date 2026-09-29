---
title: "Dev UI only hydrates on an allowed dev origin; a fallback port browsed as 127.0.0.1 serves 403 chunks"
modules: ["platform"]
areas: ["backend-ui", "testing", "debugging"]
topics: ["dev-server", "allowed-dev-origins", "hydration", "playwright", "verification", "beforeall-timeout"]
---

# Dev UI only hydrates on an allowed dev origin; a fallback port browsed as 127.0.0.1 serves 403 chunks

**Context**: verifying Phase 2 UI in a standalone worktree whose dev runner had fallen back to a
spare port (`Port 3000 is in use by process …, using available port 3002 instead`). Browsing
`http://127.0.0.1:3002/...` looked alive — SSR HTML arrived, the sidebar rendered, `?contractId=`
prefills were visible in the markup — but nothing was interactive: the login submit stayed
`disabled` (`form[data-auth-ready="0"]`), a click on 「添加合同」 added no row, no `window`-side
client code ran, and `Object.keys(el).filter(k => k.startsWith('__react'))` on the rendered form was
empty (no fiber). A second browser reported the same chunks as `net::ERR_ABORTED`; Playwright's own
Chromium showed the truth: `GET /_next/static/chunks/*.js → 403 Forbidden` for the app-shell chunks
(zod, the UI kit, `src_*` and `src_app_*`), so the page never hydrated. Integration runs against the
same server then failed with `"beforeAll" hook timeout of 20000ms exceeded`.

**Problem**: the 403 is not an app bug and not a caching problem. `next.config.ts` sets
`allowedDevOrigins = resolveAllowedDevOrigins()` in development, and Next refuses dev asset requests
whose `Origin`/`Referer` is not on that list — a bare `curl` for the same URL returns **200** (no
Origin header), while the identical request with `Origin: http://127.0.0.1:3002` returns **403**
(`localhost:3002` returns 200). The dev runner's *effective* port differs from the one a session
expects (`APP_URL`, `INTERNAL_APP_ORIGIN`, or the port block in `.env`), and the fallback port is
what actually listens — so "open the port from the runner's line, on `localhost`" is the only
browsable origin. The knock-on `beforeAll` timeouts are the second half of the same trap: an
uncompiled dev server needs more than the suite's 20s hook timeout to create fixtures on the first
request of a page/module it has not compiled yet, and the failures look like product bugs (they were
`beforeAll` timeouts, not assertion failures).

**Rule**:
1. Verify dev UI at `http://localhost:<the port the dev runner printed>` — never `127.0.0.1`, never
   a stale expected port. If the page is visually fine but inert, check hydration before blaming the
   component (`data-auth-ready`, a `__react*` key on a rendered node, or the chunk requests' status;
   `curl -H "Origin: …" <chunk>` distinguishes 403-from-origin from a real asset failure).
2. Before running Playwright integration suites against a *dev* server, warm it: load the app (login
   + one backend page) or re-run the failing files, and report `beforeAll` timeouts as
   environment-cold, not as case failures — never "fix" code for them.
3. Report browser-path evidence with the origin used; "verified in the browser" is only true when
   the client actually hydrated.

**Applies to**: any agent session verifying UI or running integration suites against a local dev
server (`scripts/dev.mjs` output, `next.config.ts` `allowedDevOrigins`, `.ai/qa/tests/playwright.config.ts`).
