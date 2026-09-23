export const features = [
  { id: 'cross_border.shipments.view', title: 'View shipments', module: 'cross_border' },
  {
    id: 'cross_border.shipments.manage',
    title: 'Manage shipments',
    module: 'cross_border',
    dependsOn: ['cross_border.shipments.view'],
  },
  {
    id: 'cross_border.shipments.receive',
    title: 'Receive shipments into a warehouse',
    module: 'cross_border',
    dependsOn: ['cross_border.shipments.view'],
  },
  {
    id: 'cross_border.documents.manage',
    title: 'Manage export documents',
    module: 'cross_border',
    dependsOn: ['cross_border.shipments.view'],
  },
]

export default features
