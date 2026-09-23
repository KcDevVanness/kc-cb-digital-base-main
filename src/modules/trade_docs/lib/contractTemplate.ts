import type { XlsxSheet } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { amountInWords } from './amountInWords'

/**
 * The printed contract, as data.
 *
 * This module is the **one** place that decides what a generated contract looks like. The company
 * has its own paper template in Excel; when it is supplied, only the constants and the row layout
 * below change — the write path (`buildXlsx`), the command, the attachment storage and the
 * download route stay exactly as they are. `CONTRACT_TEMPLATE_ID` is the contract of that promise:
 * a stored document can name the template revision it was produced with.
 *
 * **Labels follow the i18n system, not a hand-written bilingual string.** A generated contract is a
 * document, but it is not a second locale: the operator generates it once, in the language they are
 * working in, and the file is archived (see `commands/contracts.ts`), so the labels are resolved
 * with the request's locale at generation time and the stored file keeps them. Writing
 * 「合同号 Contract No.」 into one cell is the one thing the language rule forbids — a Chinese
 * operator reads a Chinese contract, an English operator an English one, and a document that needs
 * a specific wording gets a template revision, not a mixed string.
 */

export const CONTRACT_TEMPLATE_ID = 'default@1'

/**
 * Header labels, in the order the rows are emitted. Keys live in this module's `i18n/*.json`;
 * the fallback is the English string, as everywhere else in the app.
 */
function contractLabels(t: TranslateFn) {
  return {
    purchaseTitle: t('trade_docs.contracts.print.purchaseTitle', 'Purchase contract'),
    salesTitle: t('trade_docs.contracts.print.salesTitle', 'Sales contract'),
    contractNumber: t('trade_docs.contracts.print.contractNumber', 'Contract no.'),
    signedAt: t('trade_docs.contracts.print.signedAt', 'Signed on'),
    partyA: t('trade_docs.contracts.print.partyA', 'Party A'),
    partyB: t('trade_docs.contracts.print.partyB', 'Party B'),
    currency: t('trade_docs.contracts.print.currency', 'Currency'),
    priceTier: t('trade_docs.contracts.print.priceTier', 'Price tier'),
    deliveryDate: t('trade_docs.contracts.print.deliveryDate', 'Delivery date'),
    paymentTerms: t('trade_docs.contracts.print.paymentTerms', 'Payment terms'),
    shippingMethod: t('trade_docs.contracts.print.shippingMethod', 'Shipping method'),
    destination: t('trade_docs.contracts.print.destination', 'Destination'),
    marks: t('trade_docs.contracts.print.marks', 'Marks'),
    notes: t('trade_docs.contracts.print.notes', 'Notes'),
    status: t('trade_docs.contracts.print.status', 'Status'),
    lineNumber: t('trade_docs.contracts.print.lineNumber', 'No.'),
    name: t('trade_docs.contracts.print.name', 'Name'),
    model: t('trade_docs.contracts.print.model', 'Model'),
    spec: t('trade_docs.contracts.print.spec', 'Spec'),
    unit: t('trade_docs.contracts.print.unit', 'Unit'),
    quantity: t('trade_docs.contracts.print.quantity', 'Qty'),
    unitPrice: t('trade_docs.contracts.print.unitPrice', 'Unit price'),
    amount: t('trade_docs.contracts.print.amount', 'Amount'),
    lineNote: t('trade_docs.contracts.print.lineNote', 'Note'),
    contractTotal: t('trade_docs.contracts.print.contractTotal', 'Contract total'),
    financeTotal: t('trade_docs.contracts.print.financeTotal', 'Finance total'),
    differenceTotal: t('trade_docs.contracts.print.differenceTotal', 'Difference'),
    inWords: t('trade_docs.contracts.print.inWords', 'Amount in words'),
  }
}

export type ContractSheetLine = {
  lineNumber: number
  name: string | null
  sku: string | null
  model: string | null
  spec: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  contractAmount: string
  note: string | null
}

export type ContractSheetParty = Record<string, unknown> | null

export type ContractSheetInput = {
  number: string | null
  direction: string
  status: string
  currencyCode: string
  priceTier: string | null
  signedAt: string | null
  deliveryDate: string | null
  paymentTerms: string | null
  shippingMethod: string | null
  destination: string | null
  marks: string | null
  notes: string | null
  counterparty: ContractSheetParty
  ourParty: ContractSheetParty
  contractTotal: string
  financeTotal: string
  differenceTotal: string
  lines: ContractSheetLine[]
}

function partyText(party: ContractSheetParty, key: string): string {
  if (!party) return ''
  const value = party[key]
  return typeof value === 'string' ? value : ''
}

function partyBlock(party: ContractSheetParty): string {
  return [partyText(party, 'name'), partyText(party, 'address'), partyText(party, 'contact'), partyText(party, 'bank')]
    .filter((part) => part.trim().length > 0)
    .join(' / ')
}

/**
 * A number for the amount columns, so Excel can sum them.
 *
 * The strings handed in are already quantized by the money engine (`3601.2000`), so the conversion
 * here is a presentation step, not a rounding step: the printed cell and the stored value agree.
 */
function amountCell(value: string): number | string {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

function quantityCell(value: string): number | string {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

export function buildContractSheet(input: ContractSheetInput, t: TranslateFn): XlsxSheet {
  const words = amountInWords(input.contractTotal, input.currencyCode)
  const labels = contractLabels(t)
  const rows: XlsxSheet['rows'] = []

  rows.push([input.direction === 'sales' ? labels.salesTitle : labels.purchaseTitle])
  rows.push([labels.contractNumber, input.number ?? '', labels.signedAt, input.signedAt ?? '', labels.status, input.status])
  rows.push([labels.partyA, partyBlock(input.ourParty)])
  rows.push([labels.partyB, partyBlock(input.counterparty)])
  rows.push([labels.currency, input.currencyCode, labels.priceTier, input.priceTier ?? ''])
  rows.push([labels.deliveryDate, input.deliveryDate ?? '', labels.paymentTerms, input.paymentTerms ?? ''])
  rows.push([labels.shippingMethod, input.shippingMethod ?? '', labels.destination, input.destination ?? ''])
  rows.push([labels.marks, input.marks ?? ''])
  rows.push([labels.notes, input.notes ?? ''])
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
      quantityCell(line.unitPrice),
      amountCell(line.contractAmount),
      line.note ?? '',
    ])
  }

  rows.push([])
  rows.push(['', '', '', '', '', '', labels.contractTotal, amountCell(input.contractTotal), ''])
  rows.push(['', '', '', '', '', '', labels.financeTotal, amountCell(input.financeTotal), ''])
  rows.push(['', '', '', '', '', '', labels.differenceTotal, amountCell(input.differenceTotal), ''])
  // Both word forms are the bank/customs convention for the amount (人民币大写 + SAY …), not a
  // language pairing: the Chinese line is the amount in words, the second line its FX wording.
  rows.push([labels.inWords, words.chinese])
  rows.push(['', words.english])

  return {
    name: (input.number ?? 'Contract').slice(0, 31),
    rows,
  }
}
