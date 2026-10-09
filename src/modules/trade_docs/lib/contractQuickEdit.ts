import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { quickEditValues, readRowDate, readRowText } from '@/lib/quick-edit/rowValues'
import { loadPortOptions, loadShippingMethodOptions } from '../components/formOptions'

/**
 * The contract header fields the order hub's 购销合同 block may quick-edit in place.
 *
 * The set is the writable head of `contractUpdateSchema` minus everything that belongs to the
 * contract's own page: the counterparty, the currency, the direction and the lines are absent on
 * purpose, because they re-price or re-scope the contract and only the dedicated edit form owns
 * that. 贸易术语 stays plain text and 运输方式/目的地 keep the dictionaries their own form reads, so
 * the picker offers exactly what the operator sees there.
 *
 * Field labels are i18n keys, resolved by the dialog that renders them (see `QuickEditDialog`).
 */
export const fields: CrudField[] = [
  {
    id: 'signedAt',
    label: 'trade_docs.contracts.form.field.signedAt',
    type: 'date',
  },
  {
    id: 'deliveryDate',
    label: 'trade_docs.contracts.form.field.deliveryDate',
    type: 'date',
  },
  {
    id: 'incoterms',
    label: 'trade_docs.contracts.form.field.incoterms',
    type: 'text',
  },
  {
    id: 'shippingMethod',
    label: 'trade_docs.contracts.form.field.shippingMethod',
    type: 'combobox',
    allowCustomValues: true,
    resolveLabel: (value) => value,
    loadOptions: (query) => loadShippingMethodOptions(query),
  },
  {
    id: 'destination',
    label: 'trade_docs.contracts.form.field.destination',
    type: 'combobox',
    allowCustomValues: true,
    resolveLabel: (value) => value,
    loadOptions: (query) => loadPortOptions(query),
  },
  {
    id: 'notes',
    label: 'trade_docs.contracts.form.field.notes',
    type: 'textarea',
  },
]

/**
 * Reads the writable head off one contract row — the module's camelCase projection first, then the
 * raw column — and omits what the row does not carry (see `quickEditValues`).
 */
export function toValues(row: Record<string, unknown>): Record<string, unknown> {
  return quickEditValues({
    signedAt: readRowDate(row, 'signedAt', 'signed_at'),
    deliveryDate: readRowDate(row, 'deliveryDate', 'delivery_date'),
    incoterms: readRowText(row, 'incoterms'),
    shippingMethod: readRowText(row, 'shippingMethod', 'shipping_method'),
    destination: readRowText(row, 'destination'),
    notes: readRowText(row, 'notes'),
  })
}
