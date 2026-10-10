'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * The `?returnTo=` round trip: a page opened **from another page** (the order hub opening a linked
 * document's own page, a dictionary editor opening the dictionary library) carries the page it was
 * opened from, and the destination uses it for its back link instead of its own ledger.
 *
 * The parameter is user-controlled, so it is never trusted as-is: only a same-app backend path is
 * accepted (`/backend/...`), anything else — an absolute URL, a protocol-relative `//host`, a
 * `javascript:` payload, whitespace or control characters — is ignored and the caller's own
 * fallback href stands. Values arrive URL-decoded from `useSearchParams`; the emitting side uses
 * `withReturnTo`.
 */

export const RETURN_TO_PARAM = 'returnTo'

const RETURN_TO_PREFIX = '/backend/'

/** A same-app backend path from the parameter, or `null` when it is missing or not trustworthy. */
export function readReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate.startsWith(RETURN_TO_PREFIX)) return null
  // `//host` cannot occur behind the prefix, but a backslash or control character still could:
  // browsers and proxies disagree about them, so a value carrying one is refused rather than
  // normalized.
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return null
  return candidate
}

/**
 * The href a back link should use: the page this one was opened from, else the caller's own
 * fallback (its ledger page). Every destination page of the order hub reads its back link through
 * this, so the operator returns to the order they were filling in rather than to the ledger.
 */
export function useReturnHref(fallbackHref: string): string {
  const searchParams = useSearchParams()
  const returnTo = readReturnTo(searchParams?.get(RETURN_TO_PARAM))
  return returnTo ?? fallbackHref
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
