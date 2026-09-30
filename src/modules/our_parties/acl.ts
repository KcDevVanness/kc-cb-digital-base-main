export const features = [
  { id: 'our_parties.view', title: 'View our entities', module: 'our_parties' },
  {
    id: 'our_parties.manage',
    title: 'Manage our entities',
    module: 'our_parties',
    dependsOn: ['our_parties.view'],
  },
]

export default features
