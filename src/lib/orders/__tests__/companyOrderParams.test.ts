import { describe, expect, it } from '@jest/globals'
import { parseCompanyOrderParam } from '../companyOrderParams'

/**
 * The `?companyOrderId=` parameter, parsed once for both "create a child document for this company
 * order" entries (the internal/external sales form and the purchase-order form). Each decision is
 * pinned here because both callers act on it: an unusable value opens a plain create and says so.
 */

const params = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
})

describe('parseCompanyOrderParam', () => {
  it('reads a usable company order id', () => {
    expect(parseCompanyOrderParam(params({ companyOrderId: '0f8fad5b-d9cb-469f-a165-70867728950e' })))
      .toEqual({ status: 'ok', companyOrderId: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  })

  it('reports "none" when the page was opened without the parameter', () => {
    expect(parseCompanyOrderParam(params({}))).toEqual({ status: 'none' })
  })

  it('reports "none" for an empty or whitespace-only value rather than an error', () => {
    expect(parseCompanyOrderParam(params({ companyOrderId: '' }))).toEqual({ status: 'none' })
    expect(parseCompanyOrderParam(params({ companyOrderId: '   ' }))).toEqual({ status: 'none' })
  })

  it('refuses a value that is not a uuid', () => {
    expect(parseCompanyOrderParam(params({ companyOrderId: 'CO-2026-0001' }))).toEqual({ status: 'invalid' })
    expect(parseCompanyOrderParam(params({ companyOrderId: '0f8fad5b-d9cb-469f-a165-70867728950' }))).toEqual({ status: 'invalid' })
  })

  it('trims a value that carries surrounding whitespace before validating it', () => {
    expect(parseCompanyOrderParam(params({ companyOrderId: ' 0f8fad5b-d9cb-469f-a165-70867728950e ' })))
      .toEqual({ status: 'ok', companyOrderId: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  })
})
