import { z } from 'zod'

/**
 * The quick-create contract of an external customer from a trade-document form.
 *
 * Pure data (schema, empty values, payload builder) so it is unit-testable without the dialog; the
 * component only wires it to `CrudForm` and `POST /api/parties`. The customer master itself stays in
 * `parties` — this contract collects the identity the printed document needs, nothing more.
 */

export const customerQuickCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    // Blank defaults keep the form's value type plain `string`; the payload builder maps an empty
    // string onto an explicit `null`, the contract `parties` uses for a cleared field.
    countryCode: z.string().trim().max(2).default(''),
    contactName: z.string().trim().max(200).default(''),
    contactPhone: z.string().trim().max(64).default(''),
    email: z.string().trim().max(200).default(''),
    bankName: z.string().trim().max(200).default(''),
    bankAccount: z.string().trim().max(120).default(''),
  })
  .refine(
    // A half-typed account would be stored as a payee nobody can pay; the pair is all-or-nothing.
    (value) => (value.bankName ? Boolean(value.bankAccount) : !value.bankAccount),
    { message: 'bankName and bankAccount must be provided together', path: ['bankAccount'] },
  )

export type CustomerQuickCreateValues = z.infer<typeof customerQuickCreateSchema>

export const EMPTY_CUSTOMER_QUICK_CREATE: CustomerQuickCreateValues = {
  code: '',
  name: '',
  countryCode: '',
  contactName: '',
  contactPhone: '',
  email: '',
  bankName: '',
  bankAccount: '',
}

/** The body of `POST /api/parties` — the customer role plus, at most, one default bank account. */
export function buildCustomerQuickCreatePayload(values: CustomerQuickCreateValues): Record<string, unknown> {
  const orNull = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  const bankName = values.bankName.trim()
  const bankAccount = values.bankAccount.trim()
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    countryCode: orNull(values.countryCode.toUpperCase()),
    status: 'active',
    contactName: orNull(values.contactName),
    contactPhone: orNull(values.contactPhone),
    email: orNull(values.email),
    // The dialog exists to add a *customer*; any other role is maintained on the party page.
    roles: ['buyer'],
    bankAccounts:
      bankName && bankAccount
        ? [{ beneficiaryBank: bankName, accountNumber: bankAccount, isDefault: true }]
        : [],
  }
}
