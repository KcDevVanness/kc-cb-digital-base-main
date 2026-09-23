export const features = [
  { id: 'trade_docs.contracts.view', title: 'View contracts', module: 'trade_docs' },
  {
    id: 'trade_docs.contracts.manage',
    title: 'Manage contracts',
    module: 'trade_docs',
    dependsOn: ['trade_docs.contracts.view'],
  },
  { id: 'trade_docs.invoices.view', title: 'View invoices', module: 'trade_docs' },
  {
    id: 'trade_docs.invoices.manage',
    title: 'Manage invoices',
    module: 'trade_docs',
    dependsOn: ['trade_docs.invoices.view'],
  },
]

export default features
