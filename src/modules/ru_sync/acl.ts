/**
 * Feature ids of the ru_sync module.
 *
 * `ru_sync.run` is the sync job's own feature: the pull writes projections and cursors and must not
 * be handed to a business role by default. `ru_sync.map.manage` is the business surface (binding a
 * RU code to a product), and `ru_sync.view` is read-only access to the health and mapping screens.
 */
export const features = [
  { id: 'ru_sync.view', title: 'View the RU sync health and the SKU map', module: 'ru_sync' },
  { id: 'ru_sync.map.manage', title: 'Bind or ignore RU SKU codes', module: 'ru_sync', dependsOn: ['ru_sync.view'] },
  { id: 'ru_sync.run', title: 'Run the RU supply pull job', module: 'ru_sync', dependsOn: ['ru_sync.view'] },
]

export default features
