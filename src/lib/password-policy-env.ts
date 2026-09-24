/**
 * The password policy has to hold on both sides of the wire, but the two sides read it
 * differently.
 *
 * Server (API routes, commands, `auth set-password`, SSR): `process.env` is the real one, so
 * `OM_PASSWORD_*` from `.env` applies directly.
 *
 * Browser: the installed auth forms (create/edit user, change password, password reset) resolve
 * the policy themselves through `getPasswordPolicy()`
 * (`@open-mercato/shared/lib/auth/passwordPolicy`), which looks the keys up **dynamically**
 * (`env[rawKey]`) on `process.env`. Next only substitutes *static* `process.env.KEY` reads in
 * client bundles — neither `.env` nor `next.config.ts`'s `env` block reaches a dynamic lookup —
 * so the browser silently falls back to the framework defaults (6 + digit + uppercase +
 * special) and the form rejects passwords the server accepts. That gap is why this module
 * existed as a bug report: 8-character digit+letter passwords were refused by the form.
 *
 * `publishPasswordPolicyEnv` closes it by writing the values the server resolved into that same
 * browser `process.env` (the shim Next reads), so both sides answer to the one `.env` contract
 * documented in `docs/deploy/runtime.md`. Keys left unset stay unset on both sides, which keeps
 * the framework default in charge.
 */
import browserProcess from 'next/dist/build/polyfills/process'

export const PASSWORD_POLICY_ENV_KEYS = [
  'OM_PASSWORD_MIN_LENGTH',
  'OM_PASSWORD_REQUIRE_DIGIT',
  'OM_PASSWORD_REQUIRE_UPPERCASE',
  'OM_PASSWORD_REQUIRE_SPECIAL',
] as const

export type PasswordPolicyEnv = Partial<Record<(typeof PASSWORD_POLICY_ENV_KEYS)[number], string>>

/** Server-side: keep only the policy keys that are actually configured. */
export function collectPasswordPolicyEnv(env: NodeJS.ProcessEnv = process.env): PasswordPolicyEnv {
  const configured: PasswordPolicyEnv = {}
  for (const key of PASSWORD_POLICY_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value.trim().length > 0) configured[key] = value
  }
  return configured
}

/**
 * Browser-side bridge. Call before the auth forms render — `AppProviders` does, since it wraps
 * every route — with the values the root layout collected on the server.
 */
export function publishPasswordPolicyEnv(values: PasswordPolicyEnv): void {
  if (typeof window === 'undefined') return
  for (const key of PASSWORD_POLICY_ENV_KEYS) {
    const value = values[key]
    if (typeof value === 'string' && value.length > 0) browserProcess.env[key] = value
  }
}
