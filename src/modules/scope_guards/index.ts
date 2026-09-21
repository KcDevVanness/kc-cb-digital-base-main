import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'scope_guards',
  title: 'Scope Guards',
  version: '0.1.0',
  description:
    'Blocks out-of-scope writes on installed auth admin commands (user creation destination, role/user ACL ownership) and surfaces the rejection as 403.',
  author: 'kc-cb-digital-base-min',
  license: 'MIT',
  requires: ['auth', 'directory'],
}
