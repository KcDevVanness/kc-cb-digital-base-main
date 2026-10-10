'use client'

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Where a page's 「返回」/「取消」 link points.
 *
 * Every back link resolves through this file, in this order:
 *
 * 1. `?returnTo=` — the explicit origin a jump carried. A page opened **from another page** (the
 *    order hub opening a linked document's own page, a dictionary editor opening the dictionary
 *    library) receives where it came from, so the operator returns to the order they were filling
 *    in even after a reload, a bookmark or a new tab. The parameter is user-controlled, so it is
 *    never trusted as-is: only a same-app backend path is accepted (`/backend/...`), anything else
 *    — an absolute URL, a protocol-relative `//host`, a `javascript:` payload, whitespace or
 *    control characters — is ignored and the next source stands.
 * 2. The page the operator actually came from, read from the per-tab trail the backend shell keeps
 *    (`NAV_ORIGIN_KEY` + `useNavOriginReporter`). This is what makes a back link behave like the
 *    browser's own back button for **every** in-app jump — including the ones no author remembered
 *    to attach `?returnTo=` to. The trail is session-scoped: a new tab, a notification link or a
 *    first visit has nothing recorded and falls through.
 *
 * When neither source yields a page, the caller's own fallback stands — the module's ledger.
 */

export const RETURN_TO_PARAM = 'returnTo'

const RETURN_TO_PREFIX = '/backend/'

/**
 * A two-page trail of the operator's in-tab navigation: `at` is the page they are on (or were on
 * last), `from` the page before it. Stored in `sessionStorage`, so a reload keeps it and a new tab
 * starts empty.
 */
export const NAV_ORIGIN_KEY = 'om:nav-origin:v1'

export type NavOrigin = { at: string; from: string | null }

/** A same-app backend path from an untrusted value, or `null` when it is missing or unusable. */
function trustedBackendPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate.startsWith(RETURN_TO_PREFIX)) return null
  // `//host` cannot occur behind the prefix, but a backslash or control character still could:
  // browsers and proxies disagree about them, so a value carrying one is refused rather than
  // normalized.
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return null
  return candidate
}

/** A same-app backend path from the parameter, or `null` when it is missing or not trustworthy. */
export function readReturnTo(value: string | null | undefined): string | null {
  return trustedBackendPath(value)
}

/**
 * The href a back link should use: the page this one was opened from (`?returnTo=`, when the jump
 * carried it), else the page the operator came from, else the caller's own fallback (its ledger
 * page).
 */
export function useBackHref(fallbackHref: string): string {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const origin = React.useSyncExternalStore(
    subscribeNavOrigin,
    getNavOriginSnapshot,
    getServerNavOriginSnapshot,
  )
  return resolveBackHref({
    returnTo: readReturnTo(searchParams?.get(RETURN_TO_PARAM)),
    origin,
    current: backendLocation(pathname, searchParams?.toString() ?? null),
    fallback: fallbackHref,
  })
}

/**
 * The href a back link resolves to, as a pure function of the three sources. `current` is the page
 * rendering the link (`pathname` plus query), `null` when it is not a backend page.
 *
 * The page that is rendering a link is recorded into the trail by an effect, one paint after it
 * renders — so on the first render after a navigation `origin.at` is still the page the operator
 * came from, and once the effect has run `origin.at` is this page and `origin.from` holds the same
 * answer. Both shapes resolve to the same href, which is why this does not need to wait for the
 * effect.
 */
export function resolveBackHref(input: {
  returnTo: string | null
  origin: NavOrigin | null
  current: string | null
  fallback: string
}): string {
  const { returnTo, origin, current, fallback } = input
  if (returnTo) return returnTo
  if (!origin) return fallback
  const candidate = origin.at === current ? origin.from : origin.at
  if (!candidate || candidate === current) return fallback
  return candidate
}

/** `pathname` with its query for a backend page, or `null` when the page is not one. */
export function backendLocation(
  pathname: string | null | undefined,
  search: string | null | undefined,
): string | null {
  const path = trustedBackendPath(pathname)
  if (!path) return null
  const query = typeof search === 'string' ? search.replace(/^\?/, '') : ''
  // The query goes through the same whitelist as the path: a location a back link may carry is a
  // backend page with no backslash or control character anywhere in it.
  return trustedBackendPath(query ? `${path}?${query}` : path)
}

/** `href` with this page attached as its return target, for links that open another page. */
export function withReturnTo(href: string, returnTo: string): string {
  const separator = href.includes('?') ? '&' : '?'
  return `${href}${separator}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`
}

/**
 * The current path (with its hash, without query) as a return target, or the fallback when the
 * router has not resolved one yet. Used by surfaces whose own sub-pages (the workbench's field
 * drawer links, the hub's block rows) should come back to them.
 */
export function currentReturnPath(pathname: string | null, hash: string | null, fallback: string): string {
  if (!pathname) return fallback
  const suffix = hash && hash.length > 1 ? hash : ''
  return `${pathname}${suffix}`
}

/**
 * The trail after a navigation to `url`: the previous page slides into `from` and `url` becomes
 * `at`. Idempotent for the page that is already recorded (effect re-runs, reloads), and a URL that
 * is not a backend path leaves the trail alone.
 */
export function nextNavOrigin(current: NavOrigin | null, url: string): NavOrigin | null {
  const at = trustedBackendPath(url)
  if (!at) return current
  if (current?.at === at) return current
  return { at, from: trustedBackendPath(current?.at) }
}

/** The trail as stored: both entries re-validated, a `from` equal to `at` dropped. */
export function readNavOrigin(raw: string | null | undefined): NavOrigin | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as { at?: unknown; from?: unknown }
  const at = trustedBackendPath(record.at)
  if (!at) return null
  const from = trustedBackendPath(record.from)
  return { at, from: from && from !== at ? from : null }
}

const originListeners = new Set<() => void>()
let originSnapshot: NavOrigin | null = null
let originHydrated = false

function safeSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // Storage can be denied outright (sandboxed iframe, hardened privacy mode).
    return null
  }
}

function hydrateOrigin(): void {
  if (originHydrated) return
  originHydrated = true
  originSnapshot = readNavOrigin(safeSessionStorage()?.getItem(NAV_ORIGIN_KEY))
}

export function subscribeNavOrigin(listener: () => void): () => void {
  originListeners.add(listener)
  return () => {
    originListeners.delete(listener)
  }
}

function getNavOriginSnapshot(): NavOrigin | null {
  hydrateOrigin()
  return originSnapshot
}

function getServerNavOriginSnapshot(): NavOrigin | null {
  return null
}

/**
 * Records the page the operator is on. Called by the backend shell on every navigation, so the
 * next page's back link can point here.
 */
export function recordNavOrigin(url: string | null): void {
  const storage = safeSessionStorage()
  if (!storage || !url) return
  hydrateOrigin()
  const next = nextNavOrigin(originSnapshot, url)
  if (next === originSnapshot) return
  originSnapshot = next
  try {
    storage.setItem(NAV_ORIGIN_KEY, JSON.stringify(next))
  } catch {
    // Quota or private-mode refusal: the in-memory trail still serves this session.
  }
  originListeners.forEach((listener) => listener())
}
