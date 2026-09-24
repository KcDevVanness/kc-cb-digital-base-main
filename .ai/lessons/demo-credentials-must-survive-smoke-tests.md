---
title: "Demo credentials are a repo-wide contract; a smoke test must restore them"
modules: ["auth", "platform", "export_finance"]
areas: ["debugging", "testing"]
topics: ["demo-credentials", "password-policy", "smoke-test", "dev-supervisor", "audit-gap", "env-parity"]
---

# Demo credentials are a repo-wide contract; a smoke test must restore them

**Context**: `superadmin@acme.com` stopped accepting `secret` mid-workday, with no visible cause: no
UI error, no `action_logs` row, no server restart. The account row (`users.password_hash`) matched a
throwaway smoke-test password instead. The same had already happened to `employee@acme.com`. Three
components resolve the demo credentials themselves (env keys with a `secret` fallback) and fail
*silently* when the DB value drifts from them: the dev supervisor's login preheat
(`scripts/dev-runtime.mjs` → `resolveWarmupCredentials`), the framework integration helper
(`@open-mercato/core/helpers/integration/auth.ts`), and `.ai/skills/om-prepare-test-env` — which is
exactly the outage `docs/dev/setup.md` warns about when it says these credentials must not be changed
on one side only.

**Problem**: an agent session unblocked an API smoke test with
`yarn mercato auth set-password --email superadmin@acme.com --password 'Smoke-Test-2026!x'`
(then `employee@acme.com` → `Smoke-Emp-2026!x`) and never restored the demo values. Four properties
make that mutation expensive to notice and to undo:

1. **The CLI bypasses the audit trail.** `auth set-password` assigns `user.passwordHash = bcrypt(...)`
   and flushes — it emits no command, so `action_logs` (`changed_fields`, `primary_changed_field`)
   holds nothing and the app's own audit surfaces cannot answer "who changed this credential".
2. **The password policy makes `secret` unsettable by default.** `set-password` runs
   `ensurePasswordPolicy` (`OM_PASSWORD_MIN_LENGTH`, `OM_PASSWORD_REQUIRE_DIGIT`,
   `OM_PASSWORD_REQUIRE_UPPERCASE`, `OM_PASSWORD_REQUIRE_SPECIAL`). This checkout relaxes it in
   `.env` (8 + digit, uppercase/special off — `docs/deploy/runtime.md`), which still rejects
   `secret`: the value is 6 characters and carries no digit. The plain command is therefore rejected
   without writing anything — observed output under the framework defaults:
   `Password does not meet the requirements: At least {min} characters, One number, One uppercase
   letter, One special character.` Agents read that rejection as "pick a different password" and
   mint a throwaway, when the correct reading is "the demo value needs the policy knobs disabled for
   this one write".
3. **The failure mode is not a login error.** The demo accounts keep working for whoever set the new
   password; what breaks is the supervisor warmup and framework integration helpers, which report 401
   far from the credential change.
4. **The row's identity is not readable.** `users.email` is encrypted at rest and `email_hash` is the
   `v2:` HMAC (`hashForLookup`), keyed by `LOOKUP_HASH_PEPPER` falling back to
   `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`. A raw `select` shows ciphertext, so identifying "which row is
   superadmin" needs the pepper, not the email column.

**Confirmed again (2026-09-22, order-file slice)**: the culprit this time was a *delegated
subagent* told to browser-verify its own page. It hit `401 Invalid email or password` for
`superadmin@acme.com`, reached for `auth set-password` with a throwaway value to get past its own
verification, and died. The parent noticed only because a fresh `curl` login answered 401 while the
still-open browser session kept working — a JWT cookie outlives the password change, so an active
session hides the breakage. Restoring the contract value needed the policy knobs disabled for that
one write:

```bash
OM_PASSWORD_MIN_LENGTH=6 OM_PASSWORD_REQUIRE_DIGIT=false OM_PASSWORD_REQUIRE_UPPERCASE=false \
OM_PASSWORD_REQUIRE_SPECIAL=false yarn mercato auth set-password --email superadmin@acme.com --password secret
```

When delegating verification work, state in the assignment that the demo password must never be
changed; and after any delegated run that touched the running app, re-login with `secret` before
reporting green.

**Rule**: the demo credentials are a **value-parity** contract, not a fixed constant: each account's
stored password must equal the value every consumer resolves. Keep both sides in sync, and keep
literal values out of tracked files.

- Where the value comes from: `admin@acme.com` / `employee@acme.com` are always `secret`;
  `superadmin@acme.com` is whatever `OM_INIT_SUPERADMIN_EMAIL` / `OM_INIT_SUPERADMIN_PASSWORD` say
  (this checkout sets both in the untracked `.env`, so the superadmin value is user-owned). Consumers
  fall back to `superadmin@acme.com` / `secret` only when those keys are unset, so a DB write without
  the matching `.env` edit — or the reverse — makes the supervisor preheat and the integration helpers
  401 while the UI keeps working.
- Do not touch the accounts if you can avoid it: smoke-test as `admin@acme.com` / `secret` (an `admin`
  session covers most surfaces). A rejected login is a state bug to converge back to the contract —
  never a reason to pick a new password.
- When a write is unavoidable, write the value the consumers already resolve (for `admin@`/`employee@`
  that is `secret`); never leave a value no consumer knows. Every write needs the policy knobs —
  the documented value and typical human passwords both fail this checkout's policy (8 + digit) and
  the plain command is rejected without writing anything:
  `OM_PASSWORD_MIN_LENGTH=6 OM_PASSWORD_REQUIRE_DIGIT=false OM_PASSWORD_REQUIRE_UPPERCASE=false OM_PASSWORD_REQUIRE_SPECIAL=false yarn mercato auth set-password --email <demo> --password <value>`.
- If a flow must exercise password *change* behaviour, run it against an app-owned test user (the
  `ru-*` accounts), never a demo account.
- Never write a literal credential value into a tracked file (`docs/`, `.ai/` are tracked; `.env` is
  gitignored) — reference the env key instead.
- Diagnose "the password changed by itself" by verifying candidates against the stored hash — bcrypt
  compare on `users.password_hash`, or the app's own `authService.verifyPassword` (the identical
  `compare` call the login route makes) for a code-path check — never by re-seeding or `init
  --reinstall` (the users table survives `--reinstall`-free flows and re-seeding destroys the tenant).
- Recover the account behind a row with `email_hash = 'v2:' + HMAC-SHA256(pepper, lower(email))`,
  reading the pepper from `LOOKUP_HASH_PEPPER` → `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` →
  `TENANT_DATA_ENCRYPTION_KEY`.
- For CLI mutations that leave no `action_logs` row, the harness transcripts under
  `~/.omp/agent/sessions/<project>/` are the audit trail: grep them for the command and its `intent`.

**Applies to**: the installed `auth` module's `set-password` / `setup` CLI, the demo-account contract in
`docs/dev/setup.md`, dev supervisor warmup, `@open-mercato/core/helpers/integration/auth.ts`,
`.ai/skills/om-prepare-test-env`, and every agent that runs API or browser smoke tests against the
local dev database.
