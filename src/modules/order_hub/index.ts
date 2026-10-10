import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'order_hub',
  title: 'Order workbench',
  version: '0.1.0',
  description:
    'The company-order hub: each row is an app-owned company order — the root record of one deal — that attaches its sales and purchase orders and shows how far it has been filled in (purchasing, shipping, documents, collections and tax refunds), plus the stage projection it reads.',
  author: 'App Team',
  license: 'MIT',
}

export default metadata
