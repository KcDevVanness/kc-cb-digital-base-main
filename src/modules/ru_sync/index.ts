import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'ru_sync',
  title: 'RU Supply Sync',
  version: '0.1.0',
  description:
    'The RU PETKIT supply contract: its DataSyncAdapter, the per-endpoint snapshot projections and cursors, the RU-to-canonical SKU map, and the sync health surface.',
  author: 'App Team',
  license: 'MIT',
}
