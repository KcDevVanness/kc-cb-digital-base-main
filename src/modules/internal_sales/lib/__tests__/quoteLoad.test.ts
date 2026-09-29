import { describe, expect, it } from '@jest/globals'
import {
  EMPTY_LINE,
  buildDocumentMetadata,
  readSourceQuote,
  toInternalSalesFormValues,
  toInternalSalesLineValues,
  type InternalSalesFormValues,
} from '../documentValues'
import {
  hasOperatorInput,
  quoteDraftFromRecords,
  quoteOptionFromRecord,
  rekeyLines,
  sourceQuotePreviewFromDraft,
} from '../quoteLoad'

/**
 * The reference-loading contract of the internal-sales orders
 * (`.ai/specs/2026-09-29-internal-sales-order-from-quote.md`).
 *
 * What is pinned here is the mapping that turns a *quotation* (head + snake_case line rows) into
 * *order* form values — the part where a mistake silently produces a wrong order — plus the source
 * quote that is written onto the new order's `metadata`. The network half (`loadQuoteDraft`,
 * `applyQuoteDraftToForm`) is exercised in the browser smoke, not here.
 */

const QUOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BRANCH_ID = '22222222-2222-4222-8222-222222222222'
const PARTY_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function formValues(patch: Partial<InternalSalesFormValues> = {}): InternalSalesFormValues {
  return {
    buyerRef: '',
    customerName: '',
    currencyCode: '',
    customerReference: '',
    comments: '',
    lines: [{ ...EMPTY_LINE }],
    ...patch,
  }
}

describe('quote draft mapping', () => {
  const quote = {
    id: QUOTE_ID,
    quoteNumber: 'QUOTE-20260929-00007',
    currencyCode: 'USD',
    customerReference: 'BR-42',
    comments: '分批出运',
    customerSnapshot: {
      name: '俄罗斯 AB 有限公司',
      customer: { displayName: '俄罗斯 AB 有限公司' },
      internalSales: { organizationId: BRANCH_ID },
    },
  }
  const lines = [
    {
      id: LINE_ID,
      product_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      product_variant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'P4108-UVC',
      quantity: '12.0000',
      unit_price_net: '26.5000',
      comment: '第一批',
      catalog_snapshot: { sku: 'P4108-UVC', spec: 'UVC 灯管' },
    },
  ]

  it('maps the head, the buyer link and the snake_case lines', () => {
    const { values, sourceQuote, lineCount } = quoteDraftFromRecords(quote, lines)

    expect(sourceQuote).toEqual({ id: QUOTE_ID, number: 'QUOTE-20260929-00007' })
    expect(lineCount).toBe(1)
    expect(values).toMatchObject({
      id: QUOTE_ID,
      buyerRef: `org:${BRANCH_ID}`,
      customerName: '俄罗斯 AB 有限公司',
      currencyCode: 'USD',
      customerReference: 'BR-42',
      comments: '分批出运',
      sourceQuote: { id: QUOTE_ID, number: 'QUOTE-20260929-00007' },
    })
    expect(values.lines).toEqual([
      {
        key: 'line-1',
        productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        productLabel: 'P4108-UVC',
        productVariantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        name: 'P4108-UVC',
        spec: 'UVC 灯管',
        sku: 'P4108-UVC',
        quantity: '12.0000',
        unitPriceNet: '26.5000',
        note: '第一批',
      },
    ])
  })

  it('never lets a loaded line keep the quote line id as its key', () => {
    const { values } = quoteDraftFromRecords(quote, lines)
    // A fresh order plus an inherited row id would make the create payload claim an id the engine
    // does not own (the edit path needs the id, the create path must not carry one).
    expect(values.lines.every((line) => line.key === 'line-1')).toBe(true)
    expect(values.lines.some((line) => line.key === LINE_ID)).toBe(false)
  })

  it('falls back to the starter line when the quote has no lines', () => {
    const { values, lineCount } = quoteDraftFromRecords(quote, [])
    expect(lineCount).toBe(0)
    expect(values.lines).toEqual([{ ...EMPTY_LINE }])
  })

  it('reads a buyer without an app link as a name only', () => {
    const { values } = quoteDraftFromRecords(
      { ...quote, customerSnapshot: { name: 'ABC GmbH', customer: { displayName: 'ABC GmbH' } } },
      [],
    )
    expect(values.buyerRef).toBe('')
    expect(values.customerName).toBe('ABC GmbH')
  })

  it('reads the party link of an external customer', () => {
    const { values } = quoteDraftFromRecords(
      { ...quote, customerSnapshot: { name: 'ABC GmbH', internalSales: { partyId: PARTY_ID } } },
      [],
    )
    expect(values.buyerRef).toBe(`party:${PARTY_ID}`)
  })
})

describe('source quote preview', () => {
  // The engine's own projection: what the drawer shows that the form values never carry.
  const quote = {
    id: QUOTE_ID,
    number: 'QUOTE-20260929-00007',
    status: 'confirmed',
    total: '318.00',
    currencyCode: 'USD',
    customerSnapshot: {
      name: '俄罗斯 AB 有限公司',
      customer: { displayName: '俄罗斯 AB 有限公司' },
      internalSales: { organizationId: BRANCH_ID },
    },
  }
  const lines = [
    {
      id: LINE_ID,
      name: 'P4108-UVC',
      quantity: '12.0000',
      unit_price_net: '26.5000',
      catalog_snapshot: { sku: 'P4108-UVC', spec: 'UVC 灯管' },
    },
  ]

  it('carries the record the form values have no use for, and maps the lines', () => {
    const draft = quoteDraftFromRecords(quote, lines)

    expect(draft.record).toBe(quote)
    expect(sourceQuotePreviewFromDraft(draft)).toMatchObject({
      id: QUOTE_ID,
      number: 'QUOTE-20260929-00007',
      buyerName: '俄罗斯 AB 有限公司',
      currencyCode: 'USD',
      status: 'confirmed',
      total: '318.00',
      customerReference: '',
      comments: '',
    })
    expect(
      sourceQuotePreviewFromDraft(draft).lines.map((line) => [line.name, line.quantity, line.unitPriceNet, line.sku]),
    ).toEqual([['P4108-UVC', '12.0000', '26.5000', 'P4108-UVC']])
  })

  it('falls back to the record number when the stored reference carries none', () => {
    const draft = quoteDraftFromRecords(quote, lines)
    const preview = sourceQuotePreviewFromDraft({ ...draft, sourceQuote: { id: QUOTE_ID, number: '' } })
    expect(preview.number).toBe('QUOTE-20260929-00007')
  })

  it('shows no lines for a quote without any, and degrades missing fields to empty strings', () => {
    // The loader hands the form a starter row for an empty quote; the preview must not show it.
    const preview = sourceQuotePreviewFromDraft(quoteDraftFromRecords({ id: QUOTE_ID, currencyCode: 'USD' }, []))
    expect(preview.lines).toEqual([])
    expect(preview.status).toBe('')
    expect(preview.total).toBe('')
    expect(preview.buyerName).toBe('')
  })
})

describe('quote picker options', () => {
  it('labels a quote with its number and buyer, and falls back to the id prefix', () => {
    expect(quoteOptionFromRecord({
      id: QUOTE_ID,
      quote_number: 'QUOTE-20260929-00007',
      customer_snapshot: { name: '俄罗斯 AB 有限公司' },
    })).toEqual({ value: QUOTE_ID, label: 'QUOTE-20260929-00007 — 俄罗斯 AB 有限公司' })

    expect(quoteOptionFromRecord({ id: QUOTE_ID })).toEqual({
      value: QUOTE_ID,
      label: QUOTE_ID.slice(0, 8),
    })
  })

  it('drops records without an id', () => {
    expect(quoteOptionFromRecord({ quoteNumber: 'QUOTE-1' })).toBeNull()
  })
})

describe('operator input detection', () => {
  it('treats the untouched starter form as empty', () => {
    expect(hasOperatorInput(formValues())).toBe(false)
    expect(hasOperatorInput(formValues({ comments: '   ' }))).toBe(false)
  })

  it('sees any head field or any line the operator touched', () => {
    expect(hasOperatorInput(formValues({ customerName: 'ABC GmbH' }))).toBe(true)
    expect(hasOperatorInput(formValues({ currencyCode: 'USD' }))).toBe(true)
    expect(hasOperatorInput(formValues({
      lines: [{ ...EMPTY_LINE, productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }],
    }))).toBe(true)
    expect(hasOperatorInput(formValues({
      lines: [{ ...EMPTY_LINE, name: '手填品名' }],
    }))).toBe(true)
  })
})

describe('source quote on the document', () => {
  it('round-trips through the engine metadata column', () => {
    const metadata = buildDocumentMetadata({ id: QUOTE_ID, number: 'QUOTE-20260929-00007' })
    expect(metadata).toEqual({
      internalSales: { sourceQuote: { id: QUOTE_ID, number: 'QUOTE-20260929-00007' } },
    })
    expect(readSourceQuote(metadata)).toEqual({ id: QUOTE_ID, number: 'QUOTE-20260929-00007' })
  })

  it('degrades unknown or partial shapes to what is readable', () => {
    expect(readSourceQuote(undefined)).toBeNull()
    expect(readSourceQuote('nope')).toBeNull()
    expect(readSourceQuote({})).toBeNull()
    expect(readSourceQuote({ internalSales: {} })).toBeNull()
    expect(readSourceQuote({ internalSales: { sourceQuote: { number: 'QUOTE-1' } } }))
      .toEqual({ id: '', number: 'QUOTE-1' })
    expect(readSourceQuote({ internalSales: { sourceQuote: { id: 42, number: null } } })).toBeNull()
  })

  it('is read back into the edit form values and absent on a plain document', () => {
    const withSource = toInternalSalesFormValues({
      id: QUOTE_ID,
      metadata: buildDocumentMetadata({ id: QUOTE_ID, number: 'QUOTE-20260929-00007' }),
    })
    expect(withSource.sourceQuote).toEqual({ id: QUOTE_ID, number: 'QUOTE-20260929-00007' })

    expect(toInternalSalesFormValues({ id: QUOTE_ID }).sourceQuote).toBeNull()
  })

  it('reads the head comment from the serializer key the document read answers with', () => {
    // The sales factory serializes `comments` as `comment`; the write contract takes `comments`.
    expect(toInternalSalesFormValues({ comment: '分批出运' }).comments).toBe('分批出运')
    expect(toInternalSalesFormValues({ comments: '分批出运' }).comments).toBe('分批出运')
  })
})

describe('line and draft helpers', () => {
  it('re-keys lines in order, preserving every mapped field', () => {
    const mapped = toInternalSalesLineValues({ id: LINE_ID, product_id: 'p-1', quantity: '3' })
    const [first, second] = rekeyLines([mapped, { ...mapped }])
    expect(first!.key).toBe('line-1')
    expect(second!.key).toBe('line-2')
    expect(first!.productId).toBe('p-1')
    expect(first!.quantity).toBe('3')
  })
})
