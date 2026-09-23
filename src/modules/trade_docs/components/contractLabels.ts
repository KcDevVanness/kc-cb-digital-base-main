import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Shared label vocabulary for contracts and invoices.
 *
 * One module-level source for the status/direction display strings so the list, the detail pane
 * and the transition buttons can never drift apart, and so every label goes through i18n keys
 * rather than a literal.
 */

export const CONTRACT_STATUSES = ['draft', 'issued', 'signed', 'closed', 'cancelled'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const INVOICE_STATUSES = ['draft', 'confirmed', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const CONTRACT_DIRECTIONS = ['purchase', 'sales'] as const
export type ContractDirection = (typeof CONTRACT_DIRECTIONS)[number]

export const INVOICE_DIRECTIONS = ['inbound', 'outbound'] as const
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number]

const CONTRACT_STATUS_KEYS: Record<ContractStatus, string> = {
  draft: 'trade_docs.contracts.status.draft',
  issued: 'trade_docs.contracts.status.issued',
  signed: 'trade_docs.contracts.status.signed',
  closed: 'trade_docs.contracts.status.closed',
  cancelled: 'trade_docs.contracts.status.cancelled',
}

const INVOICE_STATUS_KEYS: Record<InvoiceStatus, string> = {
  draft: 'trade_docs.invoices.status.draft',
  confirmed: 'trade_docs.invoices.status.confirmed',
  void: 'trade_docs.invoices.status.void',
}

const DIRECTION_KEYS: Record<string, string> = {
  purchase: 'trade_docs.contracts.direction.purchase',
  sales: 'trade_docs.contracts.direction.sales',
  inbound: 'trade_docs.invoices.direction.inbound',
  outbound: 'trade_docs.invoices.direction.outbound',
}

export function contractStatusLabel(t: TranslateFn, status: string): string {
  const key = CONTRACT_STATUS_KEYS[status as ContractStatus]
  return key ? t(key) : status
}

export function invoiceStatusLabel(t: TranslateFn, status: string): string {
  const key = INVOICE_STATUS_KEYS[status as InvoiceStatus]
  return key ? t(key) : status
}

export function directionLabel(t: TranslateFn, direction: string): string {
  const key = DIRECTION_KEYS[direction]
  return key ? t(key) : direction
}
