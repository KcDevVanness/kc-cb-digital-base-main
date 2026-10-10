import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { quickEditValues, readRowDate, readRowText } from '@/lib/quick-edit/rowValues'
import { PRODUCT_CATEGORY_DICTIONARY_KEY } from '../components/orderFormOptions'
import { loadCodeListOptions } from './codeListOptions'

/**
 * The purchase-order header fields the order hub's 采购单 block may quick-edit in place.
 *
 * The set is the writable head of `purchaseOrderUpdateSchema` minus everything that belongs to the
 * order's own page: the lines, the supplier, the currency and the deposit are absent on purpose,
 * because changing any of them re-prices the order and only the dedicated edit form owns that.
 * 订单描述 stays a `select` over the same `product_category` dictionary the edit form reads,
 * so a code the dictionary does not carry cannot be typed in here either.
 *
 * Field labels are i18n keys, resolved by the dialog that renders them (see `QuickEditDialog`).
 */
export const fields: CrudField[] = [
  {
    id: 'businessNumber',
    label: 'purchasing.orders.form.field.businessNumber',
    type: 'text',
  },
  {
    id: 'productCategory',
    label: 'purchasing.orders.form.field.productCategory',
    type: 'select',
    loadOptions: () => loadCodeListOptions(PRODUCT_CATEGORY_DICTIONARY_KEY),
  },
  {
    id: 'expectedShipAt',
    label: 'purchasing.orders.form.field.expectedShipAt',
    type: 'date',
  },
  {
    id: 'notes',
    label: 'purchasing.orders.form.field.notes',
    type: 'textarea',
  },
]

/**
 * Reads the writable head off one purchase-order row — the module's camelCase projection first, then
 * the raw column — and omits what the row does not carry (see `quickEditValues`).
 */
export function toValues(row: Record<string, unknown>): Record<string, unknown> {
  return quickEditValues({
    businessNumber: readRowText(row, 'businessNumber', 'business_number'),
    productCategory: readRowText(row, 'productCategory', 'product_category'),
    expectedShipAt: readRowDate(row, 'expectedShipAt', 'expected_ship_at'),
    notes: readRowText(row, 'notes'),
  })
}
