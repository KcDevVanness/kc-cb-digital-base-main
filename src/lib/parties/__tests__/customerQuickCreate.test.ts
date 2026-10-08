import { describe, expect, it } from '@jest/globals'
import {
  buildCustomerQuickCreatePayload,
  customerQuickCreateSchema,
} from '../customerQuickCreate'

describe('customer quick-create contract', () => {
  it('fills the buyer role and the customer identity', () => {
    const payload = buildCustomerQuickCreatePayload({
      code: ' RU-CUST-1 ',
      name: ' 俄罗斯本地客户 ',
      countryCode: 'ru',
      contactName: 'Ivan',
      contactPhone: '',
      email: 'ivan@example.com',
      bankName: '',
      bankAccount: '',
    })
    expect(payload).toMatchObject({
      code: 'RU-CUST-1',
      name: '俄罗斯本地客户',
      countryCode: 'RU',
      status: 'active',
      contactName: 'Ivan',
      contactPhone: null,
      email: 'ivan@example.com',
      roles: ['buyer'],
      bankAccounts: [],
    })
  })

  it('adds exactly one default bank account when both bank fields are filled', () => {
    const payload = buildCustomerQuickCreatePayload({
      ...empty(),
      code: 'C1',
      name: 'Customer',
      bankName: 'Сбербанк',
      bankAccount: '40817810099910004312',
    })
    expect(payload.bankAccounts).toEqual([
      { beneficiaryBank: 'Сбербанк', accountNumber: '40817810099910004312', isDefault: true },
    ])
  })

  it('rejects a half-filled bank row', () => {
    const result = customerQuickCreateSchema.safeParse({ ...empty(), code: 'C1', name: 'Customer', bankName: 'Bank' })
    expect(result.success).toBe(false)
    const resultAccountOnly = customerQuickCreateSchema.safeParse({
      ...empty(),
      code: 'C1',
      name: 'Customer',
      bankAccount: '123',
    })
    expect(resultAccountOnly.success).toBe(false)
  })

  it('requires a code and a name', () => {
    expect(customerQuickCreateSchema.safeParse(empty()).success).toBe(false)
    expect(customerQuickCreateSchema.safeParse({ ...empty(), code: 'C1' }).success).toBe(false)
    expect(customerQuickCreateSchema.safeParse({ ...empty(), code: 'C1', name: 'Customer' }).success).toBe(true)
  })
})

function empty() {
  return {
    code: '',
    name: '',
    countryCode: '',
    contactName: '',
    contactPhone: '',
    email: '',
    bankName: '',
    bankAccount: '',
  }
}
