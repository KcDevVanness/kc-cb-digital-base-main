import { describe, expect, it } from '@jest/globals'
import {
  contractCreateSchema,
  contractLineInputSchema,
  documentLineInputSchema,
  invoiceLineInputSchema,
} from '../validators'

/**
 * The decimal calibers of the trade documents module.
 *
 * Owner rule (2026-09-28): an amount is always 2 decimals, a unit price always 4; a quantity keeps
 * its `numeric(18,6)`. A value with more decimals than its column is refused instead of silently
 * rounded (the API answers 400), and a value within its caliber is zero-padded to the column
 * scale so the command and the entity agree on formatting.
 */
describe('trade_docs decimal validators', () => {
  const line = { quantity: '3', unitPrice: '1200.4' }

  it('accepts a 4-decimal unit price and pads it to the column scale', () => {
    const parsed = contractLineInputSchema.parse({ ...line, unitPrice: '341.2382' })
    expect(parsed.unitPrice).toBe('341.2382')
    expect(contractLineInputSchema.parse({ ...line, unitPrice: '1200.4' }).unitPrice).toBe('1200.4000')
    expect(contractLineInputSchema.parse({ ...line, unitPrice: '7' }).unitPrice).toBe('7.0000')
    expect(contractLineInputSchema.parse({ ...line, unitPrice: 12.5 }).unitPrice).toBe('12.5000')
  })

  it('refuses a fifth decimal on a unit price instead of rounding it away', () => {
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '341.23825' }).success).toBe(false)
    expect(invoiceLineInputSchema.safeParse({ ...line, unitPrice: '0.12345', amount: '1' }).success).toBe(false)
    expect(documentLineInputSchema.safeParse({ ...line, unitPrice: '0.12345' }).success).toBe(false)
    // The old 6-decimal caliber is gone: a price is never re-rounded after entry, so a sixth
    // decimal is refused exactly like a fifth one.
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '341.238200' }).success).toBe(false)
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '341.23821' }).success).toBe(false)
  })

  it('keeps the quantity at 6 decimals', () => {
    expect(contractLineInputSchema.parse({ ...line, quantity: '1.234567' }).quantity).toBe('1.234567')
    expect(contractLineInputSchema.parse({ ...line, quantity: '2.5' }).quantity).toBe('2.500000')
    expect(contractLineInputSchema.safeParse({ ...line, quantity: '1.2345678' }).success).toBe(false)
  })

  it('holds the invoice line amount to 2 decimals and the tax rate to 3', () => {
    const parsed = invoiceLineInputSchema.parse({ ...line, amount: '238866.74' })
    expect(parsed.amount).toBe('238866.74')
    expect(invoiceLineInputSchema.parse({ ...line, amount: '1' }).amount).toBe('1.00')
    expect(invoiceLineInputSchema.parse({ ...line, amount: '0' }).amount).toBe('0.00')
    expect(invoiceLineInputSchema.safeParse({ ...line, amount: '238866.745' }).success).toBe(false)
    expect(invoiceLineInputSchema.parse({ ...line, amount: '1', taxRate: '13' }).taxRate).toBe('13.000')
    expect(invoiceLineInputSchema.safeParse({ ...line, amount: '1', taxRate: '13.0001' }).success).toBe(false)
    // The schema default is a literal that skips the padding transform; the DB column still stores
    // it as `0.000`, and an explicitly sent `0` is normalized like any other value.
    expect(invoiceLineInputSchema.parse({ ...line, amount: '1' }).taxRate).toBe('0')
    expect(invoiceLineInputSchema.parse({ ...line, amount: '1', taxRate: '0' }).taxRate).toBe('0.000')
  })

  it('holds the document line amount to 2 decimals, and leaves it absent when not given', () => {
    expect(documentLineInputSchema.parse({ ...line }).amount).toBeUndefined()
    expect(documentLineInputSchema.parse({ ...line, amount: '11806.49' }).amount).toBe('11806.49')
    expect(documentLineInputSchema.safeParse({ ...line, amount: '11806.488' }).success).toBe(false)
  })

  it('keeps the exchange rate at 8 decimals and never negative', () => {
    const base = { lines: [line] }
    expect(contractCreateSchema.parse({ ...base, exchangeRate: '7.12345678' }).exchangeRate).toBe('7.12345678')
    expect(contractCreateSchema.parse({ ...base, exchangeRate: '7' }).exchangeRate).toBe('7.00000000')
    expect(contractCreateSchema.parse({ ...base, exchangeRate: null }).exchangeRate).toBeNull()
    expect(contractCreateSchema.safeParse({ ...base, exchangeRate: '7.123456789' }).success).toBe(false)
    expect(contractCreateSchema.safeParse({ ...base, exchangeRate: '-1' }).success).toBe(false)
  })

  it('rejects a non-decimal and a negative price', () => {
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '1e3' }).success).toBe(false)
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '12,5' }).success).toBe(false)
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '-0.01' }).success).toBe(false)
    expect(contractLineInputSchema.safeParse({ ...line, unitPrice: '' }).success).toBe(false)
  })
})
