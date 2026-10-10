import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'product_codes',
  title: 'Product codes',
  version: '0.2.0',
  description:
    'Retired product-code aliases (searchable old codes) and the brand/category dictionaries the product domain reads.',
  author: 'App',
}

export { default as setup } from './setup'
