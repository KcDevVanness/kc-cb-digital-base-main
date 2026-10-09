import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const fetchCrudList = jest.fn<(apiPath: string, params: Record<string, unknown>) => Promise<unknown>>()

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  fetchCrudList: (apiPath: string, params: Record<string, unknown>) => fetchCrudList(apiPath, params),
}))

// Imported after the mock so the helper resolves the mocked module.
import { resolveCompanyOrderForDocument } from '../companyOrderResolve'

const DOCUMENT_ID = '11111111-1111-1111-1111-111111111111'
const COMPANY_ORDER_ID = '22222222-2222-2222-2222-222222222222'

function list(items: Array<Record<string, unknown>>) {
  return { items, total: items.length, page: 1, pageSize: 1, totalPages: items.length > 0 ? 1 : 0 }
}

describe('companyOrderResolve', () => {
  beforeEach(() => {
    fetchCrudList.mockReset()
  })

  it('answers with the id directly when the URL already names a company order', async () => {
    fetchCrudList.mockResolvedValueOnce(list([{ id: COMPANY_ORDER_ID }]))

    const result = await resolveCompanyOrderForDocument(COMPANY_ORDER_ID)

    expect(result).toEqual({ status: 'found', companyOrderId: COMPANY_ORDER_ID })
    // The reverse lookup must not run when the root read already answered.
    expect(fetchCrudList).toHaveBeenCalledTimes(1)
    expect(fetchCrudList).toHaveBeenCalledWith('order_hub/orders', { id: COMPANY_ORDER_ID, pageSize: 1 })
  })

  it('falls back to the reverse link lookup for a child document id', async () => {
    fetchCrudList
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(list([{ companyOrderId: COMPANY_ORDER_ID, kind: 'internal_sales_order' }]))

    const result = await resolveCompanyOrderForDocument(DOCUMENT_ID)

    expect(result).toEqual({ status: 'found', companyOrderId: COMPANY_ORDER_ID })
    expect(fetchCrudList).toHaveBeenNthCalledWith(2, 'order_hub/orders/links', { refId: DOCUMENT_ID, pageSize: 1 })
  })

  it('reports an unlinked document instead of a blank page', async () => {
    fetchCrudList.mockResolvedValueOnce(list([])).mockResolvedValueOnce(list([]))

    await expect(resolveCompanyOrderForDocument(DOCUMENT_ID)).resolves.toEqual({ status: 'unlinked' })
  })

  it('propagates a transport failure rather than mislabelling it as unlinked', async () => {
    fetchCrudList.mockRejectedValueOnce(new Error('boom'))

    await expect(resolveCompanyOrderForDocument(DOCUMENT_ID)).rejects.toThrow('boom')
  })
})
