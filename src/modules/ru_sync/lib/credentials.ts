/**
 * Credential shape the `data_sync` engine hands the adapter (resolved by the integrations
 * credential service for the configured provider instance).
 *
 * Only two fields are required and neither is ever logged: the base URL and the bearer token.
 * `allowPrivate` exists because the local mock contract server a dry run talks to is not public;
 * it must not be set for a real RU endpoint (the URL guard otherwise refuses private hosts).
 */
export type RuCredentials = {
  baseUrl: string
  token: string
  allowPrivate: boolean
}

export function readRuCredentials(raw: Record<string, unknown> | null | undefined): RuCredentials {
  const baseUrl = typeof raw?.baseUrl === 'string' ? raw.baseUrl.trim() : ''
  const token = typeof raw?.token === 'string' ? raw.token.trim() : ''
  const allowPrivate = raw?.allowPrivate === true || raw?.allowPrivate === 'true'
  if (baseUrl.length === 0) throw new Error('RU integration is missing the base URL credential')
  if (token.length === 0) throw new Error('RU integration is missing the token credential')
  return { baseUrl, token, allowPrivate }
}
