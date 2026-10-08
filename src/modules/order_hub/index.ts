import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'order_hub',
  title: 'Order workbench',
  version: '0.1.0',
  description:
    'The company-order workbench: the three order kinds on one screen with each order’s fill progress (purchasing, shipping, documents, collections and tax refunds), plus the stage projection it reads.',
  author: 'App Team',
  license: 'MIT',
}

export default metadata
