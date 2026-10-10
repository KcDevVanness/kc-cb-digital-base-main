import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'nav_shell',
  title: 'Navigation shell',
  version: '0.1.0',
  description:
    'The app-owned sidebar navigation tree: domain → module → page, rendered from the route manifest with the caller’s sidebar preferences and effective features applied.',
  author: 'App Team',
  license: 'MIT',
}

export default metadata
