import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { quickEditValues, readRowDate, readRowText } from '@/lib/quick-edit/rowValues'
import { loadPaymentTermOptions } from '../components/formOptions'

/**
 * The trade-document (PI/CI) header fields the order hub's 单据 block may quick-edit in place.
 *
 * The set is the writable head of `documentUpdateSchema` minus everything that belongs to the
 * document's own page: the kind, the direction, the counterparty, the currency and the lines are
 * absent on purpose, because changing any of them rewrites what the document *is*. 付款条件 keeps the
 * dictionary its own form reads while staying typeable, exactly as there.
 *
 * Field labels are i18n keys, resolved by the dialog that renders them (see `QuickEditDialog`).
 */
export const fields: CrudField[] = [
  {
    id: 'validUntil',
    label: 'trade_docs.documents.form.field.validUntil',
    type: 'date',
  },
  {
    id: 'deliveryDate',
    label: 'trade_docs.documents.form.field.deliveryDate',
    type: 'date',
  },
  {
    id: 'paymentTerms',
    label: 'trade_docs.documents.form.field.paymentTerms',
    type: 'combobox',
    allowCustomValues: true,
    resolveLabel: (value) => value,
    loadOptions: (query) => loadPaymentTermOptions(query),
  },
  {
    id: 'incoterms',
    label: 'trade_docs.documents.form.field.incoterms',
    type: 'text',
  },
  {
    id: 'notes',
    label: 'trade_docs.documents.form.field.notes',
    type: 'textarea',
  },
]

/**
 * Reads the writable head off one document row — the module's camelCase projection first, then the
 * raw column — and omits what the row does not carry (see `quickEditValues`).
 */
export function toValues(row: Record<string, unknown>): Record<string, unknown> {
  return quickEditValues({
    validUntil: readRowDate(row, 'validUntil', 'valid_until'),
    deliveryDate: readRowDate(row, 'deliveryDate', 'delivery_date'),
    paymentTerms: readRowText(row, 'paymentTerms', 'payment_terms'),
    incoterms: readRowText(row, 'incoterms'),
    notes: readRowText(row, 'notes'),
  })
}
