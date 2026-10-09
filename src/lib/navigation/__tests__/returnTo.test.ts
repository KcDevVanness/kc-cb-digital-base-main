import { describe, expect, it } from '@jest/globals'
import { readReturnTo, withReturnTo } from '../returnTo'

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
})
