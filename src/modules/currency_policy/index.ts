import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'currency_policy',
  title: 'Currency Policy',
  version: '0.1.0',
  description:
    'Keeps the FX master and the currency dictionary on the currencies this app trades in (Greater China, Russia, Southeast Asia, the United States).',
  author: 'kc-cb-digital-base-min',
  license: 'MIT',
  requires: ['currencies', 'dictionaries', 'customers'],
}
