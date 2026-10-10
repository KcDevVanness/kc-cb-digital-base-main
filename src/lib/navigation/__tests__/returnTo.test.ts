import { describe, expect, it } from '@jest/globals'
import {
  backendLocation,
  nextNavOrigin,
  readReturnTo,
  readNavOrigin,
  resolveBackHref,
  withReturnTo,
  type NavOrigin,
} from '../returnTo'

describe('readReturnTo', () => {
  it('accepts a same-app backend path, with query and hash', () => {
    expect(readReturnTo('/backend/orders/abc')).toBe('/backend/orders/abc')
    expect(readReturnTo('/backend/orders/abc#sales')).toBe('/backend/orders/abc#sales')
    expect(readReturnTo('/backend/trade-docs/contracts?page=2')).toBe(
      '/backend/trade-docs/contracts?page=2',
    )
    expect(readReturnTo('  /backend/orders/abc  ')).toBe('/backend/orders/abc')
  })

  it('refuses anything that is not a same-app backend path', () => {
    expect(readReturnTo(null)).toBeNull()
    expect(readReturnTo(undefined)).toBeNull()
    expect(readReturnTo('')).toBeNull()
    expect(readReturnTo('https://evil.example/backend/orders/abc')).toBeNull()
    expect(readReturnTo('//evil.example/backend/orders/abc')).toBeNull()
    expect(readReturnTo('javascript:alert(1)')).toBeNull()
    expect(readReturnTo('/api/order_hub/orders')).toBeNull()
    expect(readReturnTo('/backend')).toBeNull()
    expect(readReturnTo('backend/orders/abc')).toBeNull()
    expect(readReturnTo('/backend/orders/abc\nset-cookie: x')).toBeNull()
    expect(readReturnTo('/backend/orders\\..\\win')).toBeNull()
  })
})

describe('withReturnTo', () => {
  it('encodes the return target and appends it to both plain and parametered hrefs', () => {
    expect(withReturnTo('/backend/purchasing/orders/1/edit', '/backend/orders/root#purchasing')).toBe(
      '/backend/purchasing/orders/1/edit?returnTo=%2Fbackend%2Forders%2Froot%23purchasing',
    )
    expect(withReturnTo('/backend/orders/create?companyOrderId=1', '/backend/orders/root')).toBe(
      '/backend/orders/create?companyOrderId=1&returnTo=%2Fbackend%2Forders%2Froot',
    )
  })

  it('round-trips through readReturnTo', () => {
    const href = withReturnTo('/backend/trade-docs/contracts/1', '/backend/orders/root#contracts')
    const param = new URL(href, 'https://app.local').searchParams.get('returnTo')
    expect(readReturnTo(param)).toBe('/backend/orders/root#contracts')
  })

  it('carries the list query of the emitting page, not just its path', () => {
    const href = withReturnTo('/backend/internal-sales/orders/create?fromQuote=1', '/backend/quotes?type=external')
    const param = new URL(href, 'https://app.local').searchParams.get('returnTo')
    expect(readReturnTo(param)).toBe('/backend/quotes?type=external')
  })
})

describe('nextNavOrigin', () => {
  const first = nextNavOrigin(null, '/backend/quotes')

  it('records the page the tab opens on, with nothing before it', () => {
    expect(first).toEqual({ at: '/backend/quotes', from: null })
  })

  it('slides the previous page into `from` on the next navigation', () => {
    expect(nextNavOrigin(first, '/backend/internal-sales/quotes/1/edit')).toEqual({
      at: '/backend/internal-sales/quotes/1/edit',
      from: '/backend/quotes',
    })
  })

  it('keeps the same object when the page is recorded again (reload, effect re-run)', () => {
    const origin: NavOrigin = { at: '/backend/quotes', from: '/backend/orders' }
    expect(nextNavOrigin(origin, '/backend/quotes')).toBe(origin)
    expect(nextNavOrigin(origin, '/backend/quotes?type=all')).toEqual({
      at: '/backend/quotes?type=all',
      from: '/backend/quotes',
    })
  })

  it('ignores a URL that is not a backend page', () => {
    expect(nextNavOrigin(first, '/login')).toBe(first)
    expect(nextNavOrigin(first, 'https://evil.example/backend/x')).toBe(first)
    expect(nextNavOrigin(null, 'javascript:alert(1)')).toBeNull()
  })
})

describe('readNavOrigin', () => {
  it('reads a stored trail, dropping a `from` that repeats `at`', () => {
    expect(readNavOrigin('{"at":"/backend/quotes","from":"/backend/orders"}')).toEqual({
      at: '/backend/quotes',
      from: '/backend/orders',
    })
    expect(readNavOrigin('{"at":"/backend/quotes","from":"/backend/quotes"}')).toEqual({
      at: '/backend/quotes',
      from: null,
    })
  })

  it('refuses anything it cannot vouch for', () => {
    expect(readNavOrigin(null)).toBeNull()
    expect(readNavOrigin('')).toBeNull()
    expect(readNavOrigin('not json')).toBeNull()
    expect(readNavOrigin('[]')).toBeNull()
    expect(readNavOrigin('{"from":"/backend/orders"}')).toBeNull()
    expect(readNavOrigin('{"at":"https://evil.example/backend/x"}')).toBeNull()
    expect(readNavOrigin('{"at":"/api/orders"}')).toBeNull()
    expect(readNavOrigin('{"at":"/backend/x\\u0000y"}')).toBeNull()
    expect(readNavOrigin('{"at":"/backend/quotes","from":"/login"}')).toEqual({
      at: '/backend/quotes',
      from: null,
    })
  })
})

describe('resolveBackHref', () => {
  const base = { current: '/backend/internal-sales/orders/create', fallback: '/backend/internal-sales/orders' }

  it('prefers the explicit return target', () => {
    expect(
      resolveBackHref({
        ...base,
        returnTo: '/backend/quotes?type=internal',
        origin: { at: base.current, from: '/backend/orders' },
      }),
    ).toBe('/backend/quotes?type=internal')
  })

  it('returns to the recorded previous page — before the current page is recorded', () => {
    expect(resolveBackHref({ ...base, returnTo: null, origin: { at: '/backend/quotes', from: null } })).toBe(
      '/backend/quotes',
    )
  })

  it('returns to the recorded previous page — after the current page is recorded', () => {
    expect(
      resolveBackHref({ ...base, returnTo: null, origin: { at: base.current, from: '/backend/quotes' } }),
    ).toBe('/backend/quotes')
  })

  it('falls back to the caller ledger with no usable record', () => {
    expect(resolveBackHref({ ...base, returnTo: null, origin: null })).toBe(base.fallback)
    expect(
      resolveBackHref({ ...base, returnTo: null, origin: { at: base.current, from: null } }),
    ).toBe(base.fallback)
    // A trail that points at the page rendering the link would be a dead click.
    expect(
      resolveBackHref({ ...base, returnTo: null, origin: { at: base.current, from: base.current } }),
    ).toBe(base.fallback)
    expect(resolveBackHref({ ...base, returnTo: null, origin: null, current: null })).toBe(base.fallback)
  })
})

describe('backendLocation', () => {
  it('joins the path and its query for a backend page', () => {
    expect(backendLocation('/backend/quotes', 'type=external&page=2')).toBe('/backend/quotes?type=external&page=2')
    expect(backendLocation('/backend/quotes', '')).toBe('/backend/quotes')
    expect(backendLocation('/backend/quotes', null)).toBe('/backend/quotes')
    expect(backendLocation('/backend/quotes', '?type=external')).toBe('/backend/quotes?type=external')
  })

  it('refuses pages and queries a back link must not carry', () => {
    expect(backendLocation(null, 'type=all')).toBeNull()
    expect(backendLocation('/login', '')).toBeNull()
    expect(backendLocation('/api/orders', '')).toBeNull()
    expect(backendLocation('/backend/quotes', 'type=all\nx')).toBeNull()
  })
})
