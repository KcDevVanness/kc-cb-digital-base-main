import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

/**
 * ISO-4217 shape only. Membership in the seeded currency dictionary is enforced in the
 * command layer (`assertCurrencyInDictionary`), because that check needs a scoped read.
 */
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
  .transform((value) => value.toUpperCase())

/**
 * Supplier input contracts.
 *
 * `nullable().optional()` on the free-text fields is deliberate: `undefined` means
 * "leave unchanged" on update, `null` means "clear the field". The entity, the
 * command, the API projection, and the form all keep that distinction so clearing a
 * value round-trips instead of silently reverting to the previous one.
 */
export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
  contactName: z.string().max(200).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  defaultCurrencyCode: currencyCodeSchema.default('CNY'),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
})

export const supplierUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(64).optional(),
  contactName: z.string().max(200).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  defaultCurrencyCode: currencyCodeSchema.optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const supplierListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  // `z.coerce.boolean()` would read the string "false" as `true`, silently turning an
  // "inactive only" filter into "active only". The factory may hand this key through as a
  // real boolean (it pre-parses recognized boolean query keys), so accept both shapes and
  // normalize with the platform token parser.
  isActive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined
      if (typeof value === 'boolean') return value
      return parseBooleanToken(value) ?? undefined
    }),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'name', 'code', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
export type SupplierListQuery = z.infer<typeof supplierListSchema>
