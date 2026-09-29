import { z } from 'zod'

/**
 * The §0 conventions of `docs/ru-petkit/supply-sync-tech.md`, shared by both domains (supply §1–§7
 * and ads §10–§18) so the two endpoint files cannot disagree about what a date or an amount is.
 *
 * The three rules the shapes below encode:
 *
 * 1. **Every response carries `as_of`** (§0.3); a page without it is refused instead of being stored
 *    under a guessed date.
 * 2. **Amounts are decimal strings** (§0.4/§0.6): a JSON number is not accepted for money, and an
 *    amount inside an amount object carries exactly two decimals. Quantities are decimals with any
 *    scale; prices are §0.4 `price` objects with four decimals (§17/§18 carry 4-decimal prices).
 * 3. **No `_label`** (§0.5): the mechanism is withdrawn, so a payload carrying one is a contract
 *    violation and the strict objects reject unknown keys.
 */

export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'decimal must be a decimal string, not a JSON number')

/** §0.6: money is a two-decimal **string**; the scale is part of the contract. */
export const moneyAmount = z.string().regex(/^-?\d+\.\d{2}$/, 'money amounts carry exactly two decimals')

/** §0.4 `price`: a unit price with four decimals (the repricer and cost pages use it). */
export const priceAmount = z.string().regex(/^-?\d+\.\d{4}$/, 'prices carry exactly four decimals')

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')

/** §0.4: RFC 3339 with an offset — the cursor is compared against these strings. */
export const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'date-time must be RFC 3339 with an offset')

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 code in upper case')

export const amountObject = z.object({ amount: moneyAmount, currency: currencyCode }).strict()

export const priceObject = z.object({ price: priceAmount, currency: currencyCode }).strict()

export const nullableAmountObject = amountObject.nullable().optional()
export const nullablePriceObject = priceObject.nullable().optional()
export const nullableDecimal = decimalString.nullable().optional()
export const nullableDate = isoDate.nullable().optional()
export const nullableNumber = z.number().nullable().optional()
export const nullableInteger = z.number().int().nullable().optional()

/** §0.3 — the envelope every endpoint wraps its page in. */
export function ruEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      as_of: isoDate,
      page: z.number().int().min(1),
      page_size: z.number().int().min(1).max(500),
      total: z.number().int().min(0),
      items: z.array(item),
    })
    .strict()
}

export type RuPage<T> = {
  as_of: string
  page: number
  page_size: number
  total: number
  items: T[]
}

/** The row's own `updated_at`, the watermark candidate for the endpoint cursor. */
export function rowUpdatedAt(row: Record<string, unknown>): string | null {
  const value = row.updated_at
  return typeof value === 'string' && value.length > 0 ? value : null
}
