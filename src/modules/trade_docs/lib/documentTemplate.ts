import type { XlsxSheet } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { amountInWords } from './amountInWords'
import { AMOUNT_SCALE, PRICE_SCALE, toAmountString } from './money'

/**
 * The printed PI (proforma invoice) and CI (commercial invoice), as data.
 *
 * This is the **one** place that decides what a generated document looks like, mirroring
 * `contractTemplate.ts` on purpose: PI/CI share one table (`kind`), one command set and one page
 * body, and they share this renderer too — the `kind` picks the title and whether the customs-only
 * blocks (consignee, notify party) are printed. `DOCUMENT_TEMPLATE_IDS` is the same promise the
 * contract template makes: a stored document can name the revision it was produced with.
 *
 * **Labels follow the i18n system, not a hand-written bilingual string.** The operator generates
 * the file once, in the language they are working in, and it is archived; so labels are resolved
 * with the request's locale at generation time. A cell never mixes 「形式发票 Proforma Invoice」 —
 * a Chinese operator reads Chinese, an English operator English.
 */

export const DOCUMENT_TEMPLATE_IDS = {
  proforma: 'proforma@1',
  commercial: 'commercial@1',
} as const

/** Header labels, in the order the rows are emitted. Keys live in this module's `i18n/*.json`. */
function documentLabels(t: TranslateFn) {
  return {
    titleProforma: t('trade_docs.documents.print.title.proforma', 'Proforma invoice'),
    titleCommercial: t('trade_docs.documents.print.title.commercial', 'Commercial invoice'),
    number: t('trade_docs.documents.print.number', 'No.'),
    issueDate: t('trade_docs.documents.print.issueDate', 'Issued on'),
    currency: t('trade_docs.documents.print.currency', 'Currency'),
    incoterms: t('trade_docs.documents.print.incoterms', 'Incoterms'),
    paymentTerms: t('trade_docs.documents.print.paymentTerms', 'Payment terms'),
    validUntil: t('trade_docs.documents.print.validUntil', 'Valid until'),
    deliveryDate: t('trade_docs.documents.print.deliveryDate', 'Delivery date'),
    notes: t('trade_docs.documents.print.notes', 'Notes'),
    ourParty: t('trade_docs.documents.print.ourParty', 'Seller'),
    bank: t('trade_docs.documents.print.bank', 'Beneficiary bank'),
    counterparty: t('trade_docs.documents.print.counterparty', 'Buyer'),
    consignee: t('trade_docs.documents.print.consignee', 'Consignee'),
    notifyParty: t('trade_docs.documents.print.notifyParty', 'Notify party'),
    lineNumber: t('trade_docs.documents.print.lineNumber', 'No.'),
    name: t('trade_docs.documents.print.name', 'Name'),
    model: t('trade_docs.documents.print.model', 'Model'),
    spec: t('trade_docs.documents.print.spec', 'Spec'),
    unit: t('trade_docs.documents.print.unit', 'Unit'),
    quantity: t('trade_docs.documents.print.quantity', 'Qty'),
    unitPrice: t('trade_docs.documents.print.unitPrice', 'Unit price'),
    amount: t('trade_docs.documents.print.amount', 'Amount'),
    lineNote: t('trade_docs.documents.print.lineNote', 'Note'),
    total: t('trade_docs.documents.print.total', 'Total'),
    inWords: t('trade_docs.documents.print.inWords', 'Amount in words'),
  }
}

export type DocumentSheetLine = {
  lineNumber: number
  name: string | null
  sku: string | null
  model: string | null
  spec: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  amount: string
  note: string | null
}

export type DocumentSheetParty = Record<string, unknown> | null

export type DocumentSheetInput = {
  kind: string
  direction: string
  number: string | null
  issuedAt: string | null
  currencyCode: string
  incoterms: string | null
  paymentTerms: string | null
  validUntil: string | null
  deliveryDate: string | null
  notes: string | null
  ourParty: DocumentSheetParty
  counterparty: DocumentSheetParty
  consignee: DocumentSheetParty
  notifyParty: DocumentSheetParty
  total: string
  lines: DocumentSheetLine[]
}

function partyText(party: DocumentSheetParty, key: string): string {
  if (!party) return ''
  const value = party[key]
  return typeof value === 'string' ? value : ''
}

function partyBlock(party: DocumentSheetParty): string {
  return [partyText(party, 'name'), partyText(party, 'address'), partyText(party, 'contact')]
    .filter((part) => part.trim().length > 0)
    .join(' / ')
}

function bankBlock(party: DocumentSheetParty): string {
  return [
    partyText(party, 'beneficiaryBank'),
    partyText(party, 'accountNumber'),
    partyText(party, 'swiftCode'),
    partyText(party, 'bankAddress'),
  ]
    .filter((part) => part.trim().length > 0)
    .join(' / ')
}

/**
 * A fixed-decimal string for the money columns, so the printed PI/CI carries the agreed caliber:
 * amount at 2 decimals, unit price at 4. Values arrive already quantized by the money engine, so
 * this is a presentation step; the cell is text on purpose — a numeric cell drops trailing zeros
 * (`1188.25` where the printed document reads `1188.2500`).
 */
function moneyCell(value: string, scale: number): string {
  const parsed = parseExactDecimal(value)
  return parsed ? toAmountString(parsed, scale) : value
}

/**
 * Display-only: a quantity is written as a spreadsheet *number* so a reader can sum the column,
 * which is why it goes through `Number`. It is never an amount — every money column is rendered by
 * `moneyCell` above and stays an exact decimal string.
 */
function quantityCell(value: string): number | string {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

export function buildDocumentSheet(input: DocumentSheetInput, t: TranslateFn): XlsxSheet {
  const words = amountInWords(input.total, input.currencyCode)
  const labels = documentLabels(t)
  const isCommercial = input.kind === 'commercial'
  const rows: XlsxSheet['rows'] = []

  rows.push([isCommercial ? labels.titleCommercial : labels.titleProforma])
  rows.push([labels.number, input.number ?? '', labels.issueDate, input.issuedAt ?? ''])
  rows.push([labels.currency, input.currencyCode, labels.incoterms, input.incoterms ?? ''])
  rows.push([labels.paymentTerms, input.paymentTerms ?? '', labels.validUntil, input.validUntil ?? ''])
  rows.push([labels.deliveryDate, input.deliveryDate ?? ''])
  rows.push([labels.notes, input.notes ?? ''])
  rows.push([])

  rows.push([labels.ourParty, partyBlock(input.ourParty)])
  const bank = bankBlock(input.ourParty)
  if (bank.length > 0) rows.push([labels.bank, bank])
  rows.push([labels.counterparty, partyBlock(input.counterparty)])
  if (isCommercial) {
    rows.push([labels.consignee, partyBlock(input.consignee)])
    rows.push([labels.notifyParty, partyBlock(input.notifyParty)])
  }
  rows.push([])

  rows.push([
    labels.lineNumber,
    labels.name,
    labels.model,
    labels.spec,
    labels.unit,
    labels.quantity,
    labels.unitPrice,
    labels.amount,
    labels.lineNote,
  ])

  for (const line of input.lines) {
    rows.push([
      line.lineNumber,
      line.name ?? line.sku ?? '',
      line.model ?? '',
      line.spec ?? '',
      line.unit ?? '',
      quantityCell(line.quantity),
      moneyCell(line.unitPrice, PRICE_SCALE),
      moneyCell(line.amount, AMOUNT_SCALE),
      line.note ?? '',
    ])
  }

  rows.push([])
  rows.push(['', '', '', '', '', '', labels.total, moneyCell(input.total, AMOUNT_SCALE), ''])
  // Both word forms are the bank/customs convention for the amount (人民币大写 + SAY …), not a
  // language pairing: the Chinese line is the amount in words, the second line its FX wording.
  rows.push([labels.inWords, words.chinese])
  rows.push(['', words.english])

  return {
    name: (input.number ?? 'Document').slice(0, 31),
    rows,
  }
}
