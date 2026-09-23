export const features = [
  { id: 'parties.view', title: 'View parties', module: 'parties' },
  {
    id: 'parties.manage',
    title: 'Manage parties',
    module: 'parties',
    dependsOn: ['parties.view'],
  },
]

export default features
