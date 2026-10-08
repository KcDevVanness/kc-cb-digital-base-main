import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { quickEditValues, readRowDate, readRowText } from '@/lib/quick-edit/rowValues'
import { INVOICE_KINDS } from '../data/validators'

/**
 * The tax-invoice header fields the order hub's 单据 block may quick-edit in place.
 *
 * The set is the writable head of `invoiceUpdateSchema`: 票种, 开票日期 and 备注 are the three facts an
 * operator corrects on an already-raised invoice without re-opening it. The direction, the
 * counterparty, the currency and the lines are absent on purpose, because they decide what the
 * invoice *is* and only the invoice's own page owns that.
 *
 * 票种 offers the three real kinds and no 「未分类」 sentinel: the module's own form maps that sentinel
 * back to `null` before the API sees it, and a quick edit has no payload transform of its own, so an
 * `unclassified` value would be rejected by the enum. A row without a kind simply shows the empty
 * choice and keeps it unless the operator picks one.
 *
 * Field labels and option labels are i18n keys, resolved by the dialog that renders them (see
 * `QuickEditDialog`).
 */
export const fields: CrudField[] = [
  {
    id: 'invoiceKind',
    label: 'trade_docs.invoices.form.field.invoiceKind',
    type: 'select',
    options: INVOICE_KINDS.map((kind) => ({ value: kind, label: `trade_docs.invoices.kind.${kind}` })),
  },
  {
    id: 'issuedAt',
    label: 'trade_docs.invoices.form.field.issuedAt',
    type: 'date',
  },
  {
    id: 'notes',
    label: 'trade_docs.invoices.form.field.notes',
    type: 'textarea',
  },
]

/**
 * Reads the writable head off one invoice row — the module's camelCase projection first, then the raw
 * column — and omits what the row does not carry (see `quickEditValues`). A row's `null` kind is
 * left out rather than sent as `''`, which the enum would reject.
 */
export function toValues(row: Record<string, unknown>): Record<string, unknown> {
  return quickEditValues({
    invoiceKind: readRowText(row, 'invoiceKind', 'invoice_kind'),
    issuedAt: readRowDate(row, 'issuedAt', 'issued_at'),
    notes: readRowText(row, 'notes'),
  })
}
