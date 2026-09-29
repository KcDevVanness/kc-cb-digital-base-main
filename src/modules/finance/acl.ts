/**
 * Feature ids of the finance module.
 *
 * `finance.costs.*` is split from `finance.profit.*` on purpose: landed cost answers "what did
 * this container cost us", while the profit ledger combines it with sales and advertising
 * figures. A role that records freight bills is not automatically allowed to read margins, so
 * neither feature depends on the other — only the ledger view builds on costs, and it declares
 * that dependency explicitly.
 */
export const features = [
  { id: 'finance.costs.view', title: 'View shipment costs and landed cost', module: 'finance' },
  { id: 'finance.costs.manage', title: 'Record shipment costs', module: 'finance', dependsOn: ['finance.costs.view'] },
  { id: 'finance.expenses.view', title: 'View period expenses', module: 'finance' },
  { id: 'finance.expenses.manage', title: 'Manage period expenses', module: 'finance', dependsOn: ['finance.expenses.view'] },
  {
    id: 'finance.ledger.view',
    title: 'View payable, receivable and inventory-value ledgers',
    module: 'finance',
    dependsOn: ['finance.costs.view'],
  },
  {
    id: 'finance.profit.view',
    title: 'View profit and loss and SKU margin',
    module: 'finance',
    dependsOn: ['finance.costs.view', 'finance.ledger.view'],
  },
]

export default features
