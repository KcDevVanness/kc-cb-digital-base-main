import { safeOutboundFetch, type HostLookup, type SafeOutboundFetchOptions, type UrlSafetyReason } from '@open-mercato/shared/lib/url-safety'
import { FetchTimeoutError, fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { ADS_ENDPOINT_PATHS } from './endpoints/ads'
import { SUPPLY_ENDPOINT_PATHS } from './endpoints/supply'
import type { RuEndpoint } from './endpoints/paths'

/**
 * The RU HTTP client: base URL, bearer token, SSRF-safe transport, bounded retries and page
 * fetching. Everything the adapter needs to talk to `{BASE}/api/v1`.
 *
 * - The URL is validated by the platform's own outbound-URL guard (`safeOutboundFetch`), which
 *   resolves the host and pins the connection to the validated address, so a DNS rebind between
 *   validation and connect cannot point the request at an internal service.
 * - `allowPrivate` exists for one case only: the local mock contract server a test or a local dry
 *   run talks to. It is off unless the caller sets it explicitly.
 * - Retries are bounded and only for the transient classes the contract names (§0.7): 429 and 5xx.
 *   A 4xx (other than 429) is a contract or credential problem and is reported, never retried.
 * - The token never appears in an error message, a log line or a thrown URL: `Authorization` is
 *   built at request time and errors carry status codes and the endpoint key instead.
 */

export class RuHttpError extends Error {
  readonly status: number | null
  readonly endpoint: RuEndpoint
  readonly transient: boolean

  constructor(message: string, options: { status?: number | null; endpoint: RuEndpoint; transient: boolean }) {
    super(message)
    this.name = 'RuHttpError'
    this.status = options.status ?? null
    this.endpoint = options.endpoint
    this.transient = options.transient
  }
}

export class RuUrlRejectedError extends Error {
  readonly reason: string

  constructor(reason: UrlSafetyReason | string, message?: string) {
    super(message ?? `RU base URL rejected: ${reason}`)
    this.name = 'RuUrlRejectedError'
    this.reason = reason
  }
}

export type RuPullLogEvent = {
  endpoint: RuEndpoint
  page: number
  attempt: number
  status: number | null
  message: string
}

export type RuClientOptions = {
  baseUrl: string
  token: string
  /** Test/local seam: allow a private host (the mock contract server). */
  allowPrivate?: boolean
  lookupHost?: HostLookup
  /** Test seam: swap the transport entirely. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxRetries?: number
  /** Test seam: no real waiting between retries. */
  sleep?: (ms: number) => Promise<void>
  onEvent?: (event: RuPullLogEvent) => void
}

export type RuPageRequest = {
  endpoint: RuEndpoint
  page: number
  pageSize: number
  /** `updated_at` watermark; omitted on a full pull. */
  updatedSince?: string | null
}

const DEFAULT_MAX_RETRIES = 3
const BASE_BACKOFF_MS = 250
const MAX_BACKOFF_MS = 4_000

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function buildPageUrl(baseUrl: string, request: RuPageRequest): string {
  const path = request.endpoint in SUPPLY_ENDPOINT_PATHS
    ? SUPPLY_ENDPOINT_PATHS[request.endpoint as keyof typeof SUPPLY_ENDPOINT_PATHS]
    : ADS_ENDPOINT_PATHS[request.endpoint as keyof typeof ADS_ENDPOINT_PATHS]
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  url.searchParams.set('page', String(request.page))
  url.searchParams.set('page_size', String(request.pageSize))
  if (request.updatedSince) url.searchParams.set('updated_since', request.updatedSince)
  return url.toString()
}

/** A base URL the app is willing to send a bearer token to: parseable, http(s), no credentials. */
export function assertRuBaseUrl(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw new RuUrlRejectedError('invalid_url', 'RU base URL must be an absolute URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RuUrlRejectedError('invalid_scheme', 'RU base URL must use https')
  }
  if (url.username || url.password) {
    throw new RuUrlRejectedError('credentials_in_url', 'RU base URL must not embed credentials')
  }
  return url
}

export type RuClient = {
  /** One page of one endpoint, already SSRF-validated and retried per the contract's transient rules. */
  fetchJson: (request: RuPageRequest) => Promise<unknown>
  baseUrl: string
}

export function createRuClient(options: RuClientOptions): RuClient {
  const base = assertRuBaseUrl(options.baseUrl)
  const token = options.token.trim()
  if (token.length === 0) throw new RuUrlRejectedError('missing_token', 'RU token is not configured')
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const timeoutMs = resolveTimeoutMs(options.timeoutMs)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const safeFetchOptions: SafeOutboundFetchOptions = {
    subject: 'RU API URL',
    allowPrivate: options.allowPrivate === true,
    lookupHost: options.lookupHost,
    fetchImpl: options.fetchImpl,
  }

  async function fetchJson(request: RuPageRequest): Promise<unknown> {
    const url = buildPageUrl(base.toString(), request)
    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        const response = await safeOutboundFetch(
          url,
          {
            method: 'GET',
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json',
            },
            signal: AbortSignal.timeout(timeoutMs),
          },
          safeFetchOptions,
        )

        if (!response.ok) {
          const transient = isTransientStatus(response.status)
          const detail = await response.text().catch(() => '')
          const message = `RU ${request.endpoint} responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
          options.onEvent?.({ endpoint: request.endpoint, page: request.page, attempt, status: response.status, message })
          if (transient && attempt <= maxRetries) {
            await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS))
            continue
          }
          throw new RuHttpError(message, { status: response.status, endpoint: request.endpoint, transient })
        }

        return (await response.json()) as unknown
      } catch (error) {
        if (error instanceof RuHttpError) throw error
        const message =
          error instanceof FetchTimeoutError
            ? `RU ${request.endpoint} timed out after ${timeoutMs}ms`
            : error instanceof Error
              ? error.message
              : 'RU request failed'
        options.onEvent?.({ endpoint: request.endpoint, page: request.page, attempt, status: null, message })
        if (attempt > maxRetries) {
          throw new RuHttpError(message, { endpoint: request.endpoint, transient: true })
        }
        await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS))
      }
    }
  }

  return { fetchJson, baseUrl: base.toString() }
}
