import { z } from 'zod'

/**
 * Our-entity profile input contracts.
 *
 * `organizationId` is a **business key** here — which of our companies the profile describes — not a
 * scope instruction: scope (tenant, acting organization) always comes from the request context, and
 * the command checks that the caller may address the organization it names. On update the key is
 * immutable: moving a profile to another company would rewrite the identity of an existing row, so
 * a caller that wants another company's profile creates one for that company.
 *
 * `nullable().optional()` on the free-text fields keeps "leave unchanged" (`undefined`) apart from
 * "clear" (`null`), the same contract the rest of the app's validators use.
 */

export const ourPartyBankAccountSchema = z.object({
  /** Present when editing an existing row; absent for a new one. */
  id: z.string().uuid().optional(),
  beneficiaryBank: z.string().trim().min(1, 'Beneficiary bank is required').max(200),
  accountNumber: z.string().trim().min(1, 'Beneficiary number is required').max(120),
  swiftCode: z.string().trim().max(32).nullable().optional(),
  bankAddress: z.string().trim().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
})

export const ourPartyProfileCreateSchema = z.object({
  organizationId: z.string().uuid('Organization is required'),
  addressLine1: z.string().trim().max(500).nullable().optional(),
  addressLine2: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Country must be a two-letter ISO code')
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
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
  notes: z.string().trim().max(2000).nullable().optional(),
  /** ≤10 accounts; absent on update means "leave the block unchanged", `[]` clears it. */
  bankAccounts: z.array(ourPartyBankAccountSchema).max(10).optional(),
})

export const ourPartyProfileUpdateSchema = ourPartyProfileCreateSchema
  .omit({ organizationId: true })
  .partial()
  .extend({
    id: z.string().uuid(),
    /** The version the caller rendered the form with; the aggregate lock uses it. */
    updatedAt: z.string().trim().min(1).optional(),
  })

export const ourPartyProfileListSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  sortField: z.enum(['created_at', 'updated_at', 'organization_id']).optional().default('updated_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export type OurPartyBankAccountInput = z.infer<typeof ourPartyBankAccountSchema>
export type OurPartyProfileCreateInput = z.infer<typeof ourPartyProfileCreateSchema>
export type OurPartyProfileUpdateInput = z.infer<typeof ourPartyProfileUpdateSchema>
