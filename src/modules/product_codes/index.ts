import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'product_codes',
  title: 'Product codes',
  version: '0.1.0',
  description: 'Code rules, the issuance ledger and the parser behind generated product codes.',
  author: 'App',
}

export { default as setup } from './setup'
