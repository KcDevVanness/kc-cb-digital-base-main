import { describe, expect, it } from '@jest/globals'
import {
  PARTY_ROLE_VALUES,
  partyBankAccountSchema,
  partyCreateSchema,
  partyUpdateSchema,
} from '../validators'

describe('party create validation', () => {
  it('requires a code and a name', () => {
    expect(partyCreateSchema.safeParse({ code: '', name: 'ACME' }).success).toBe(false)
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: '' }).success).toBe(false)
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME Trading' }).success).toBe(true)
  })

  it('normalizes a two-letter country code and rejects anything else', () => {
    const parsed = partyCreateSchema.parse({ code: 'ACME', name: 'ACME', countryCode: 'ru' })
    expect(parsed.countryCode).toBe('RU')
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME', countryCode: 'RUS' }).success).toBe(false)
  })

  it('accepts an absent email but rejects a malformed one', () => {
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME', email: null }).success).toBe(true)
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME', email: '' }).success).toBe(true)
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME', email: 'not-an-address' }).success).toBe(false)
  })

  it('rejects an unknown role and keeps every declared role usable', () => {
    for (const role of PARTY_ROLE_VALUES) {
      expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME', roles: [role] }).success).toBe(true)
    }
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME', roles: ['supplier'] }).success).toBe(false)
  })

  it('accepts a party with no bank block and a party with several rows', () => {
    expect(partyCreateSchema.safeParse({ code: 'ACME', name: 'ACME' }).success).toBe(true)
    const parsed = partyCreateSchema.parse({
      code: 'ACME',
      name: 'ACME',
      bankAccounts: [
        { beneficiaryBank: 'Bank of China', accountNumber: '1234567890', isDefault: true },
        { beneficiaryBank: 'ICBC', accountNumber: '0987654321', swiftCode: 'ICBKCNBJ' },
      ],
    })
    expect(parsed.bankAccounts).toHaveLength(2)
  })
})

describe('party bank account validation', () => {
  it('requires the bank and the account number', () => {
    expect(partyBankAccountSchema.safeParse({ beneficiaryBank: 'Bank of China' }).success).toBe(false)
    expect(
      partyBankAccountSchema.safeParse({ beneficiaryBank: 'Bank of China', accountNumber: '   ' }).success,
    ).toBe(false)
    expect(
      partyBankAccountSchema.safeParse({ beneficiaryBank: 'Bank of China', accountNumber: '1234567890' }).success,
    ).toBe(true)
  })

  it('keeps SWIFT and bank address optional and clearable', () => {
    const parsed = partyBankAccountSchema.parse({
      beneficiaryBank: 'Bank of China',
      accountNumber: '1234567890',
      swiftCode: null,
      bankAddress: null,
    })
    expect(parsed.swiftCode).toBeNull()
    expect(parsed.bankAddress).toBeNull()
  })
})

describe('party update validation', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  it('requires a uuid id', () => {
    expect(partyUpdateSchema.safeParse({ name: 'ACME' }).success).toBe(false)
    expect(partyUpdateSchema.safeParse({ id, name: 'ACME' }).success).toBe(true)
  })

  it('distinguishes an omitted field from an explicit clear', () => {
    const untouched = partyUpdateSchema.parse({ id })
    expect(untouched.city).toBeUndefined()
    expect(untouched.roles).toBeUndefined()

    const cleared = partyUpdateSchema.parse({ id, city: null, roles: [] })
    expect(cleared.city).toBeNull()
    expect(cleared.roles).toEqual([])
  })

  it('caps the bank block at ten rows', () => {
    const row = { beneficiaryBank: 'Bank', accountNumber: '1' }
    const rows = Array.from({ length: 11 }, () => row)
    expect(partyUpdateSchema.safeParse({ id, bankAccounts: rows }).success).toBe(false)
  })
})
