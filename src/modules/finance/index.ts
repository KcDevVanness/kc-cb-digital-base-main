import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'finance',
  title: 'Finance',
  version: '0.1.0',
  description:
    'Shipment-level cost records, read-time landed-cost allocation, period expenses, and the read-only payable / receivable / inventory-value / profit-and-loss ledgers derived from the purchasing, cross_border, trade_docs, products, sales and platform_ops tables.',
  author: 'App Team',
  license: 'MIT',
}
