import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

/**
 * The RU PETKIT integration: the provider instance the `data_sync` adapter pulls through.
 *
 * The credentials are exactly the two the contract needs (§0.1): the base URL of the RU API and the
 * bearer token. Both are stored by the installed integrations credential service (encrypted
 * per organization) — never in this file, never in a log, never in a response. `allowPrivate` is a
 * boolean for the one local case: a mock contract server on a private host, which the platform's
 * outbound-URL guard otherwise refuses.
 */
export const integration: IntegrationDefinition = {
  id: 'ru_petkit',
  title: 'RU PETKIT',
  description:
    'Pulls the RU PETKIT supply contract (SKUs, stock, in-transit, unrecognized inbound, purchase plan, shipments and planning parameters) into the ru_sync snapshot projection.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'ru_petkit',
  icon: 'download',
  package: '@app/ru_sync',
  version: '0.1.0',
  author: 'App Team',
  license: 'MIT',
  tags: ['ru', 'petkit', 'supply', 'data_sync', 'snapshot'],
  credentials: {
    fields: [
      {
        key: 'baseUrl',
        label: 'RU API base URL',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.ru',
        helpText: 'The base URL the contract calls {BASE}: the version prefix /api/v1 is added by the adapter.',
      },
      {
        key: 'token',
        label: 'Bearer token',
        type: 'secret',
        required: true,
        helpText: 'Issued by the RU side. Stored encrypted; never shown again, never logged.',
      },
      {
        key: 'allowPrivate',
        label: 'Allow a private host',
        type: 'boolean',
        required: false,
        helpText:
          'Only for a local mock server. Leave off for the real endpoint — the outbound URL guard refuses private hosts by default.',
      },
    ],
  },
  healthCheck: { service: 'ruPetkitHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export default integration
