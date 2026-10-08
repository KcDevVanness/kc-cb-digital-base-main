import { describe, expect, it } from '@jest/globals'
import { ourPartyProfileCreateSchema, ourPartyProfileUpdateSchema } from '../../data/validators'
import { bankAccountIsDefault } from '../profiles'

const ORGANIZATION_ID = '9279aeeb-3fa4-42f6-8ee1-0071293e5776'

describe('our-party profile validators', () => {
  it('requires the subject organization as a uuid and uppercases a two-letter country code', () => {
    const parsed = ourPartyProfileCreateSchema.parse({ organizationId: ORGANIZATION_ID, countryCode: 'ru' })
    expect(parsed.organizationId).toBe(ORGANIZATION_ID)
    expect(parsed.countryCode).toBe('RU')

    expect(ourPartyProfileCreateSchema.safeParse({ organizationId: 'not-a-uuid' }).success).toBe(false)
    expect(
      ourPartyProfileCreateSchema.safeParse({ organizationId: ORGANIZATION_ID, countryCode: 'RUS' }).success,
    ).toBe(false)
  })

  it('accepts an empty email but rejects a malformed one, and keeps clearing distinct from omission', () => {
    expect(ourPartyProfileCreateSchema.safeParse({ organizationId: ORGANIZATION_ID, email: '' }).success).toBe(true)
    expect(
      ourPartyProfileCreateSchema.safeParse({ organizationId: ORGANIZATION_ID, email: 'not-an-email' }).success,
    ).toBe(false)

    const cleared = ourPartyProfileCreateSchema.parse({ organizationId: ORGANIZATION_ID, city: null })
    expect(cleared.city).toBeNull()
    const omitted = ourPartyProfileCreateSchema.parse({ organizationId: ORGANIZATION_ID })
    expect(omitted.city).toBeUndefined()
  })

  it('requires a bank row to carry bank and account number, and never accepts more than ten', () => {
    const withBank = ourPartyProfileCreateSchema.parse({
      organizationId: ORGANIZATION_ID,
      bankAccounts: [{ beneficiaryBank: 'Bank of China', accountNumber: '6222' }],
    })
    expect(withBank.bankAccounts).toHaveLength(1)

    expect(
      ourPartyProfileCreateSchema.safeParse({
        organizationId: ORGANIZATION_ID,
        bankAccounts: [{ beneficiaryBank: '', accountNumber: '6222' }],
      }).success,
    ).toBe(false)
    expect(
      ourPartyProfileCreateSchema.safeParse({
        organizationId: ORGANIZATION_ID,
        bankAccounts: Array.from({ length: 11 }, (_, index) => ({
          beneficiaryBank: `Bank ${index}`,
          accountNumber: '6222',
        })),
      }).success,
    ).toBe(false)
  })

  it('drops the subject organization from the update contract: the key is immutable', () => {
    const parsed = ourPartyProfileUpdateSchema.parse({
      id: ORGANIZATION_ID,
      organizationId: 'c608b673-6722-478a-83e9-6290dadb47b6',
    })
    expect('organizationId' in parsed).toBe(false)
  })
})

describe('bankAccountIsDefault', () => {
  const row = (isDefault?: boolean) => ({ beneficiaryBank: 'Bank', accountNumber: '1', isDefault })

  it('uses the ticked row when the operator ticked exactly one', () => {
    const rows = [row(false), row(true), row(false)]
    expect(rows.map((_, index) => bankAccountIsDefault(rows, index))).toEqual([false, true, false])
  })

  it('falls back to the first row when nothing is ticked, so one account still prints', () => {
    const rows = [row(), row()]
    expect(rows.map((_, index) => bankAccountIsDefault(rows, index))).toEqual([true, false])
  })

  it('has no default at all when the block is empty', () => {
    expect(bankAccountIsDefault([], 0)).toBe(false)
  })
})
