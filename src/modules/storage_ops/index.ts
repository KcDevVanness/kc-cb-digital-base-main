import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'storage_ops',
  title: 'Storage Operations',
  version: '0.1.0',
  description:
    'Operator CLI for the attachment storage migration: audit canonical paths, ledger and orphans; copy a partition to S3-compatible object storage and flip it in one transaction; verify, roll back and prune the local copies.',
  author: 'kc-cb-digital-base-min',
  license: 'MIT',
  requires: ['attachments'],
}
