import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { probeRuHealth, ruSupplyAdapter } from './lib/adapter'
import { readRuCredentials } from './lib/credentials'

/**
 * Two registrations:
 *
 * - the `DataSyncAdapter` itself, under the provider key the integration declares, so the
 *   `data_sync` run UI and workers find it;
 * - the health check the integrations hub calls for this provider, which probes the RU
 *   `/api/v1/health` endpoint through the same SSRF-guarded client.
 */
export function register(container: AppContainer): void {
  registerDataSyncAdapter(ruSupplyAdapter)

  container.register({
    ruPetkitHealthCheck: asValue(async (credentials: Record<string, unknown>) => probeRuHealth(readRuCredentials(credentials))),
  })
}
