---
title: "A command interceptor rejection needs an explicit HTTP mapping on custom routes"
modules: ["platform", "scope_guards"]
areas: ["umes", "architecture", "framework-context"]
topics: ["command-interceptor", "error-mapping", "api-dispatcher", "http-status", "custom-routes"]
---

# A command interceptor rejection needs an explicit HTTP mapping on custom routes

**Context**: Adding app-side command interceptors that block out-of-scope writes worked —
the writes were blocked — but two routes answered **500** instead of the intended 403:
`PUT /api/auth/roles/acl` and `PUT /api/auth/users/acl`. The blocking was correct; the
transport was not, so callers saw a system failure instead of a stable rejection code.

**Problem**: `beforeExecute` rejections travel as `CommandInterceptorError`. Only the CRUD
factory maps them (`shared/src/lib/crud/factory.ts` uses
`getCommandInterceptorHttpRejection`). The ACL routes call `commandBus.execute` directly and
their local `catch` blocks only handle `isCrudHttpError`, so the error reaches
`src/app/api/[...slug]/route.ts`, whose catch re-throws on purpose ("Unhandled throws become
500s"). The same shape is recorded upstream for 17 routes, so this is a route-family
property, not one bad handler.

**Rule**: Before relying on a rejection's status, prove the caller can carry it. For
installed routes the app cannot edit, map it once in the app-owned dispatcher: at the head of
`src/app/api/[...slug]/route.ts`'s catch, call
`getCommandInterceptorHttpRejection(error)` (from `@open-mercato/shared/lib/commands/errors`)
and return its `status`/`body` when present, leaving the telemetry + re-throw path untouched
otherwise. Always return `status` and `body` **together** from `beforeExecute` — a status
without a body falls back to `{ error: message }`, and a body without a status is ignored
entirely. Assert the observed status in an integration test (403, not 500); a unit test on
the guard alone cannot see this.

**Applies to**: `src/modules/*/commands/interceptors.ts`, `src/app/api/[...slug]/route.ts`,
`node_modules/@open-mercato/shared/src/lib/commands/{errors,command-bus,command-interceptor}.ts`,
`node_modules/@open-mercato/shared/src/lib/crud/factory.ts`,
`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`.
