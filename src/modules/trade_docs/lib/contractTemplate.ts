import type { XlsxSheet } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
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
 * Everything here is bilingual on purpose. A generated contract is a document, not UI chrome: it
 * is printed, signed and filed, so its labels carry no runtime locale and no translation lookup —
 * a document re-rendered next year must read the same.
 */

export const CONTRACT_TEMPLATE_ID = 'default@1'

/** Header labels, in the order the rows are emitted. */
const LABELS = {
  purchaseTitle: '采购合同 / PURCHASE CONTRACT',
  salesTitle: '销售合同 / SALES CONTRACT',
  contractNumber: '合同号 Contract No.',
  signedAt: '签订日期 Signed At',
  partyA: '甲方 Party A',
  partyB: '乙方 Party B',
  currency: '币种 Currency',
  priceTier: '价格档 Price Tier',
  deliveryDate: '交期 Delivery',
  paymentTerms: '付款方式 Payment Terms',
  shippingMethod: '运输方式 Shipping Method',
  destination: '目的地 Destination',
  marks: '唛头 Marks',
  notes: '备注 Notes',
  lineNumber: '序号 No.',
  name: '品名 Name',
  model: '型号 Model',
  spec: '规格 Spec',
  unit: '单位 Unit',
  quantity: '数量 Qty',
  unitPrice: '单价 Unit Price',
  amount: '金额 Amount',
  lineNote: '备注 Note',
  contractTotal: '合同金额 Contract Total',
  financeTotal: '财务金额 Finance Total',
  differenceTotal: '差额 Difference',
  inWords: '大写金额 In Words',
} as const

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

export function buildContractSheet(input: ContractSheetInput): XlsxSheet {
  const words = amountInWords(input.contractTotal, input.currencyCode)
  const rows: XlsxSheet['rows'] = []

  rows.push([input.direction === 'sales' ? LABELS.salesTitle : LABELS.purchaseTitle])
  rows.push([LABELS.contractNumber, input.number ?? '', LABELS.signedAt, input.signedAt ?? '', '状态 Status', input.status])
  rows.push([LABELS.partyA, partyBlock(input.ourParty)])
  rows.push([LABELS.partyB, partyBlock(input.counterparty)])
  rows.push([LABELS.currency, input.currencyCode, LABELS.priceTier, input.priceTier ?? ''])
  rows.push([LABELS.deliveryDate, input.deliveryDate ?? '', LABELS.paymentTerms, input.paymentTerms ?? ''])
  rows.push([LABELS.shippingMethod, input.shippingMethod ?? '', LABELS.destination, input.destination ?? ''])
  rows.push([LABELS.marks, input.marks ?? ''])
  rows.push([LABELS.notes, input.notes ?? ''])
  rows.push([])

  rows.push([
    LABELS.lineNumber,
    LABELS.name,
    LABELS.model,
    LABELS.spec,
    LABELS.unit,
    LABELS.quantity,
    LABELS.unitPrice,
    LABELS.amount,
    LABELS.lineNote,
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
  rows.push(['', '', '', '', '', '', LABELS.contractTotal, amountCell(input.contractTotal), ''])
  rows.push(['', '', '', '', '', '', LABELS.financeTotal, amountCell(input.financeTotal), ''])
  rows.push(['', '', '', '', '', '', LABELS.differenceTotal, amountCell(input.differenceTotal), ''])
  rows.push([LABELS.inWords, words.chinese])
  rows.push(['', words.english])

  return {
    name: (input.number ?? 'Contract').slice(0, 31),
    rows,
  }
}
