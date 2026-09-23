---
title: "Next inlines only static process.env reads, so a framework dynamic lookup sees browser defaults"
modules: ["auth", "platform"]
areas: ["backend-ui", "framework-context"]
topics: ["password-policy", "client-env", "process-env", "next-inlining", "auth-forms", "ssr-hydration"]
---

# Next inlines only static process.env reads, so a framework dynamic lookup sees browser defaults

**Context**: `.env` carried the app's rule (`OM_PASSWORD_MIN_LENGTH=8`, digit required,
uppercase/special off) and every server path obeyed it — the API zod schemas, the commands,
`auth set-password`, and even the server-rendered HTML ("密码要求：至少 8 个字符, 一个数字"). The
*hydrated* form kept showing and enforcing the framework default (6 + digit + uppercase + special):
`abc12345` was rejected client-side with "Password does not meet the requirements." while the API
stored it happily. Adding the keys to `next.config.ts`'s `env` block and purging the Turbopack dev
cache changed nothing.

**Problem**: `getPasswordPolicy()` (`@open-mercato/shared/lib/auth/passwordPolicy`) reads the keys
**dynamically** — `env[rawKey]`, then `env['NEXT_PUBLIC_' + rawKey]`, on `process.env`. Next only
substitutes *static* `process.env.KEY` expressions in client bundles (per-key defines built from
`NEXT_PUBLIC_*` and from `next.config.env`; `next/dist/lib/static-env.js`,
`next/dist/build/define-env.js`), and the browser's `process` object is
`next/dist/build/polyfills/process`, whose `env` is `{}`. A dynamic lookup therefore returns
`undefined` and the framework silently falls back to its defaults — and the default is *stricter*
here, so the form blocks values the server would accept. SSR shows the right rule, hydration
overwrites it: the mismatch is invisible unless you compare the served HTML with the live DOM.

**Rule**: for an env-driven value an *installed* client component reads, never trust `.env`,
`NEXT_PUBLIC_*`, or `next.config.ts` — check what the browser actually computes, and bridge it
explicitly when it differs. This app resolves the policy server-side (root layout,
`collectPasswordPolicyEnv(process.env)`), passes it to `AppProviders`, and
`src/lib/password-policy-env.ts` publishes the keys into the browser `process.env` imported from
`next/dist/build/polyfills/process` — the very object the framework reads — before the route
renders. Keep such values request-scoped rather than build-inlined so an image built without `.env`
still hands the app's rule to the browser. Unset keys stay unset on both sides, leaving the
framework default in charge.

**Applies to**: `src/lib/password-policy-env.ts`, `src/app/layout.tsx`, `src/components/AppProviders.tsx`,
the installed auth forms (`backend/users/create`, `backend/users/[id]/edit`,
`backend/profile/change-password`, `frontend/reset/[token]`), and any future env-contract value an
installed client component resolves at render time (the installed search config's
`resolveSearchMinTokenLength()` has the same shape).
