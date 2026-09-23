import { z } from 'zod'

/**
 * Party input contracts.
 *
 * `nullable().optional()` on the free-text fields is deliberate: `undefined` means "leave
 * unchanged" on update, `null` means "clear the field". The entity, the command, the API projection
 * and the form all keep that distinction so clearing a value round-trips instead of silently
 * reverting to the previous one.
 */

/** Role vocabulary. Rows, not a column, because one party holds several roles at once. */
export const PARTY_ROLE_VALUES = [
  'buyer',
  'consignee',
  'branch',
  'forwarder',
  'broker',
  'bank',
  'certifier',
] as const
export type PartyRoleValue = (typeof PARTY_ROLE_VALUES)[number]

export const PARTY_STATUS_VALUES = ['active', 'inactive'] as const
export type PartyStatusValue = (typeof PARTY_STATUS_VALUES)[number]

export const partyBankAccountSchema = z.object({
  /** Present when editing an existing row; absent for a new one. */
  id: z.string().uuid().optional(),
  beneficiaryBank: z.string().trim().min(1, 'Beneficiary bank is required').max(200),
  accountNumber: z.string().trim().min(1, 'Beneficiary number is required').max(120),
  swiftCode: z.string().trim().max(32).nullable().optional(),
  bankAddress: z.string().trim().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
})

export const partyCreateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Country must be a two-letter ISO code')
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
  status: z.enum(PARTY_STATUS_VALUES).optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(64).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'Enter a valid email address',
    })
    .nullable()
    .optional(),
  addressLine1: z.string().trim().max(500).nullable().optional(),
  addressLine2: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  /** Role set for this party; omitted means "no roles recorded". */
  roles: z.array(z.enum(PARTY_ROLE_VALUES)).max(PARTY_ROLE_VALUES.length).optional(),
  /** Bank block. At most one row may be `isDefault`. */
  bankAccounts: z.array(partyBankAccountSchema).max(10).optional(),
})

export const partyUpdateSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Country must be a two-letter ISO code')
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
  status: z.enum(PARTY_STATUS_VALUES).optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(64).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'Enter a valid email address',
    })
    .nullable()
    .optional(),
  addressLine1: z.string().trim().max(500).nullable().optional(),
  addressLine2: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  /**
   * When present the array is the new truth: existing ids update, unknown ids are rejected,
   * and rows absent from the payload are removed. Omitted means "leave roles untouched".
   */
  roles: z.array(z.enum(PARTY_ROLE_VALUES)).max(PARTY_ROLE_VALUES.length).optional(),
  /** Same replace semantics as `roles`, keyed by the optional per-row `id`. */
  bankAccounts: z.array(partyBankAccountSchema).max(10).optional(),
})

/**
 * List query. `sortField` is limited to plaintext columns on purpose: `name` is encrypted, and
 * sorting or filtering ciphertext would return rows in a meaningless order (see `encryption.ts`).
 */
export const partyListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(PARTY_STATUS_VALUES).optional(),
  countryCode: z.string().trim().max(2).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'code', 'country_code', 'status', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export type PartyCreateInput = z.infer<typeof partyCreateSchema>
export type PartyUpdateInput = z.infer<typeof partyUpdateSchema>
export type PartyListQuery = z.infer<typeof partyListSchema>
export type PartyBankAccountInput = z.infer<typeof partyBankAccountSchema>
