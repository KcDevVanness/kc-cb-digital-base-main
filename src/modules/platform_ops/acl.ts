export const features = [
  { id: 'platform_ops.channels.view', title: 'View platform channels', module: 'platform_ops' },
  {
    id: 'platform_ops.channels.manage',
    title: 'Manage platform channels',
    module: 'platform_ops',
    dependsOn: ['platform_ops.channels.view'],
  },
  { id: 'platform_ops.settlements.view', title: 'View platform settlements', module: 'platform_ops' },
  {
    id: 'platform_ops.settlements.manage',
    title: 'Import platform settlements',
    module: 'platform_ops',
    dependsOn: ['platform_ops.settlements.view'],
  },
  { id: 'platform_ops.reconciliation.view', title: 'View reconciliation items', module: 'platform_ops' },
  {
    id: 'platform_ops.reconciliation.manage',
    title: 'Resolve reconciliation items',
    module: 'platform_ops',
    dependsOn: ['platform_ops.reconciliation.view'],
  },
]

export default features
