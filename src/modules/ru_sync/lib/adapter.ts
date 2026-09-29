import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { safeOutboundFetch } from '@open-mercato/shared/lib/url-safety'
import type { DataMapping, DataSyncAdapter, ImportBatch, ImportItem, ValidationResult } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { createRuClient, type RuClient } from './client'
import { readRuCredentials, type RuCredentials } from './credentials'
import { advanceCursorAfterSuccess, encodeCursor, maxUpdatedAt, parseCursor, type RuCursorState } from './cursor'
import {
  SUPPLY_ENDPOINTS,
  SUPPLY_ENDPOINT_PATHS,
  supplyNaturalKey,
  supplyPageSchema,
  supplyRowUpdatedAt,
  type SupplyEndpoint,
} from './endpoints/supply'
import { adsNaturalKey, adsPageSchema, type AdsEndpoint } from './endpoints/ads'
import { RU_ENDPOINTS, RU_ENDPOINT_PATHS, isRuEndpoint, type RuEndpoint } from './endpoints/paths'
import { ADS_WRITE_THROUGH, importSettlements, ingestOrderLines, type PeerCommandRunner } from './adsIngest'
import { emitAlertsForEndpoint } from './alerts'
import {
  createOrmRuSyncStore,
  ruCodesFromRows,
  type RuSyncScope,
  type RuSyncStore,
  type SnapshotRowInput,
} from './projection'
import { eventsConfig } from '../events'

/**
 * The RU PETKIT supply adapter: one entity per contract endpoint, each walked page by page and
 * written into the snapshot projection.
 *
 * The rules this file exists to enforce:
 *
 * 1. **A page without `as_of` is refused.** The envelope schema requires it, so a malformed response
 *    fails the run instead of being stored under a guessed date (a wrong `as_of` silently rewrites
 *    yesterday's snapshot).
 * 2. **The watermark advances only after the whole walk.** Snapshots are written per page (they are
 *    idempotent), but `ru_sync_cursors` is updated after the final page's batch has been handed back
 *    — and the engine commits a batch before asking the generator for the next one, so this code
 *    runs after that commit. A walk that throws keeps the old watermark and the next run re-pulls
 *    exactly the same window.
 * 3. **The signal is honoured above every `yield`.** Returning instead of yielding means an
 *    abandoned page is never reported as applied.
 */

const logger = createLogger('ru_sync').child({ component: 'adapter' })

export const RU_PROVIDER_KEY = 'ru_petkit'

export { RU_ENDPOINTS, RU_ENDPOINT_PATHS }
export type { AdsEndpoint, RuEndpoint, SupplyEndpoint }

/**
 * Background ingestion has no person behind it. Commands are attributed to the nil uuid rather than
 * to a real user, so nothing in the audit trail pretends a human did this; the provenance is the
 * `data_sync` run each batch belongs to.
 */
export const RU_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

function isAdsEndpoint(value: string): value is AdsEndpoint {
  return value.startsWith('ads_')
}

function endpointPageSchema(endpoint: RuEndpoint) {
  return isAdsEndpoint(endpoint) ? adsPageSchema(endpoint) : supplyPageSchema(endpoint)
}

function endpointNaturalKey(endpoint: RuEndpoint, row: Record<string, unknown>): string {
  return isAdsEndpoint(endpoint) ? adsNaturalKey(endpoint, row) : supplyNaturalKey(endpoint, row)
}

export type RuSyncAdapterDeps = {
  /** Test seam: the whole store. Default: the ORM store resolved from a fresh request container. */
  store?: RuSyncStore
  /** Test seam: the whole HTTP client for one credential set. */
  clientFactory?: (credentials: RuCredentials) => RuClient
  /** Test seam: the EntityManager the write-through paths read channels through. */
  em?: EntityManager
  /** Test seam: the peer command runner the write-through paths dispatch over. */
  runCommand?: PeerCommandRunner
  scope?: RuSyncScope
}


async function resolveStore(deps: RuSyncAdapterDeps): Promise<RuSyncStore> {
  if (deps.store) return deps.store
  const container = await createRequestContainer()
  return createOrmRuSyncStore(container.resolve('em') as EntityManager)
}

type RuSyncRuntime = { em: EntityManager; runCommand: PeerCommandRunner }

/**
 * The pieces the write-through paths need: an EntityManager to resolve a `platform_ops` channel and
 * the command bus the peer writes go over. Both come from a fresh container in production (the
 * adapter runs inside the `data_sync` worker, which has no request context) and from the deps in a
 * test.
 */
async function resolveRuntime(deps: RuSyncAdapterDeps, scope: RuSyncScope): Promise<RuSyncRuntime> {
  if (deps.em && deps.runCommand) return { em: deps.em, runCommand: deps.runCommand }
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as {
    execute: (id: string, options: { input: unknown; ctx: unknown }) => Promise<{ result?: unknown }>
  }
  return {
    em: deps.em ?? (container.resolve('em') as EntityManager),
    runCommand:
      deps.runCommand ??
      (async (commandId, input) => {
        const envelope = await commandBus.execute(commandId, {
          input,
          ctx: {
            container,
            // A background ingestion has no person behind it: the nil uuid keeps the audit honest
            // and keeps every uuid column the commands write a valid value.
            auth: { sub: RU_SYSTEM_ACTOR_ID, tenantId: scope.tenantId, orgId: scope.organizationId },
            selectedOrganizationId: scope.organizationId,
            request: undefined,
          },
        })
        return (envelope.result ?? {}) as Record<string, unknown>
      }),
  }
}

function resolveClient(deps: RuSyncAdapterDeps, credentials: RuCredentials): RuClient {
  if (deps.clientFactory) return deps.clientFactory(credentials)
  return createRuClient({
    baseUrl: credentials.baseUrl,
    token: credentials.token,
    allowPrivate: credentials.allowPrivate,
  })
}

/**
 * Probe used by the integration's health check: `GET {BASE}/api/v1/health` (§0.8) answers
 * `{ ok, as_of }`. A non-2xx is reported with its status; the token never leaves this frame.
 */
export async function probeRuHealth(credentials: RuCredentials): Promise<ValidationResult> {
  try {
    const url = new URL('/api/v1/health', credentials.baseUrl.endsWith('/') ? credentials.baseUrl : `${credentials.baseUrl}/`)
    const response = await safeOutboundFetch(
      url.toString(),
      { method: 'GET', headers: { authorization: `Bearer ${credentials.token}`, accept: 'application/json' } },
      { subject: 'RU API URL', allowPrivate: credentials.allowPrivate },
    )
    if (!response.ok) return { ok: false, message: `RU health endpoint responded ${response.status}` }
    const body = (await response.json().catch(() => null)) as { ok?: unknown; as_of?: unknown } | null
    if (!body || body.ok !== true) return { ok: false, message: 'RU health endpoint did not report ok' }
    return { ok: true, message: typeof body.as_of === 'string' ? `RU snapshot as_of ${body.as_of}` : 'RU reachable' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'RU health check failed' }
  }
}

export function createRuSupplyAdapter(deps: RuSyncAdapterDeps = {}): DataSyncAdapter {
  return {
    providerKey: RU_PROVIDER_KEY,
    direction: 'import',
    supportedEntities: [...RU_ENDPOINTS],

    /**
     * The projection stores raw payloads, so there are no field mappings to resolve; the shape the
     * contract expects still has to be answered, and `externalId` is the match strategy because
     * every endpoint has a natural key (`sku`, `ru_code`, `number`, `version`).
     */
    async getMapping(input): Promise<DataMapping> {
      if (!isRuEndpoint(input.entityType)) throw new Error(`Unsupported RU entity type: ${input.entityType}`)
      return { entityType: input.entityType, fields: [], matchStrategy: 'externalId' }
    },

    /**
     * The durable watermark lives in `ru_sync_cursors` and advances only after a complete walk, so
     * the engine's per-batch shared cursor would be a *weaker* record of the same thing if anything
     * read it. The run row keeps its own cursor either way, which is what a resume within one run
     * needs.
     */
    persistsSharedCursor() {
      return false
    },

    async getInitialCursor(input) {
      const store = await resolveStore(deps)
      const watermark = await store.loadCursor(input.scope.tenantId, assertEndpoint(input.entityType))
      return watermark === null ? null : encodeCursor({ page: 1, updatedSince: watermark, asOf: null })
    },

    async validateConnection(input): Promise<ValidationResult> {
      try {
        return await probeRuHealth(readRuCredentials(input.credentials))
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'RU validation failed' }
      }
    },

    async *streamImport(input): AsyncIterable<ImportBatch> {
      const endpoint = assertEndpoint(input.entityType)
      try {
        yield* walkEndpoint(input, endpoint, deps)
      } catch (error) {
        // A failed pull must reach a human: the cockpit would otherwise keep presenting the last
        // good snapshot as today's. The event carries no token and no payload — just which endpoint
        // broke and why.
        await eventsConfig
          .emit('ru_sync.pull.failed', {
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId,
            endpoint,
            message: error instanceof Error ? error.message : 'Unknown pull failure',
          })
          .catch(() => undefined)
        throw error
      }
    },
  }
}

async function* walkEndpoint(
  input: Parameters<NonNullable<DataSyncAdapter['streamImport']>>[0],
  endpoint: RuEndpoint,
  deps: RuSyncAdapterDeps,
): AsyncIterable<ImportBatch> {
  const scope: RuSyncScope = {
    tenantId: input.scope.tenantId,
    organizationId: deps.scope?.organizationId ?? input.scope.organizationId,
  }
  const store = await resolveStore(deps)
  const credentials = readRuCredentials(input.credentials)
  // Only the two write-through endpoints need the peer runtime (an EntityManager and the command
  // bus); a snapshot-only endpoint never pays for constructing them.
  const writeThrough = isAdsEndpoint(endpoint) ? ADS_WRITE_THROUGH[endpoint] : 'snapshot'
  const runtime = writeThrough === 'snapshot' ? null : await resolveRuntime(deps, scope)
  const client = resolveClient(deps, credentials)
  const pageSchema = endpointPageSchema(endpoint)

  let state: RuCursorState = parseCursor(input.cursor)
  const seenUpdatedAt: string[] = []
  const ruCodes: string[] = []
  const pageSize = Math.min(Math.max(input.batchSize, 1), 500)
  let batchIndex = 0

  for (;;) {
    // Above the yield: an abandoned page never reaches the engine, so its rows and its cursor are
    // never treated as applied.
    if (input.signal?.aborted) return

    const raw = await client.fetchJson({
      endpoint,
      page: state.page,
      pageSize,
      updatedSince: state.updatedSince,
    })
    const parsed = pageSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(
        `RU ${endpoint} page ${state.page} does not match the contract: ${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`.trim(),
      )
    }
    const page = parsed.data as {
      as_of: string
      page: number
      page_size: number
      total: number
      items: Record<string, unknown>[]
    }

    const rows: SnapshotRowInput[] = page.items.map((item) => ({
      endpoint,
      naturalKey: endpointNaturalKey(endpoint, item),
      payload: item,
    }))
    for (const item of page.items) {
      const updatedAt = supplyRowUpdatedAt(item)
      if (updatedAt) seenUpdatedAt.push(updatedAt)
    }
    ruCodes.push(...ruCodesFromRows(endpoint, rows))

    // The two ads endpoints that write through to a peer command do it per page, after the snapshot
    // of that page is durable: the snapshot is the evidence of what arrived, the peer write is the
    // effect, and a peer failure is reported per item instead of dropping the page.
    let peerItems: ImportItem[] = []
    if (runtime && writeThrough === 'orders') {
      peerItems = await ingestOrderLines(runtime.em, scope, page.items, runtime.runCommand)
    } else if (runtime && writeThrough === 'settlements') {
      peerItems = await importSettlements(runtime.em, scope, page.items, runtime.runCommand)
    }

    const written = await store.writeSnapshots(scope, endpoint, page.as_of, rows)
    const items: ImportItem[] = rows.map((row, index) => ({
      externalId: row.naturalKey,
      // The real per-row outcome: a replayed page reports `skip`, so the run history distinguishes a
      // first pull from a no-op replay instead of claiming everything was created.
      action: written.actions[index] ?? 'create',
      data: { endpoint, asOf: page.as_of },
    }))
    items.push(...peerItems)

    const lastPage = rows.length < pageSize || (page.total > 0 && page.page * page.page_size >= page.total)
    state = { page: state.page + 1, updatedSince: state.updatedSince, asOf: page.as_of }
    logger.info('RU page stored', {
      endpoint,
      page: page.page,
      rows: rows.length,
      created: written.created,
      updated: written.updated,
      unchanged: written.unchanged,
      asOf: page.as_of,
    })

    yield {
      items,
      cursor: encodeCursor(state),
      hasMore: !lastPage,
      totalEstimate: page.total,
      processedCount: rows.length,
      batchIndex,
    }
    batchIndex += 1

    if (!lastPage) continue

    // The engine committed this batch before asking for the next value, so everything below runs
    // after the last page's data is durable — which is what "cursor advances only after a complete
    // walk" means in practice.
    const nextWatermark = advanceCursorAfterSuccess(state.updatedSince, seenUpdatedAt)
    await store.saveCursor(scope.tenantId, endpoint, nextWatermark)
    const codes = ruCodes.filter((code) => code.trim().length > 0)
    if (codes.length > 0) {
      await store.syncSkuCodes(scope, codes)
    }
    logger.info('RU endpoint walk completed', {
      endpoint,
      pages: batchIndex,
      asOf: state.asOf,
      watermark: nextWatermark,
      lastSeenUpdatedAt: maxUpdatedAt(seenUpdatedAt),
    })

    // 四预警: the four threshold checks run after the endpoint whose data they read — and after the
    // cursor moved, so an alert is never raised against data the walk did not finish committing.
    if (runtime) {
      await emitAlertsForEndpoint(runtime.em, scope, endpoint).catch((error) => {
        logger.warn('Alert evaluation failed', { endpoint, err: error })
      })
    } else {
      const alertRuntime = await resolveRuntime(deps, scope).catch(() => null)
      if (alertRuntime) {
        await emitAlertsForEndpoint(alertRuntime.em, scope, endpoint).catch((error) => {
          logger.warn('Alert evaluation failed', { endpoint, err: error })
        })
      }
    }
    return
  }
}

function assertEndpoint(entityType: string): RuEndpoint {
  if (isRuEndpoint(entityType)) return entityType
  throw new Error(`Unsupported RU entity type: ${entityType}`)
}

/** Exposed for the mock run and the health page: the paths this adapter pulls. */
export const RU_SUPPLY_ENDPOINT_PATHS = SUPPLY_ENDPOINT_PATHS

export const ruSupplyAdapter: DataSyncAdapter = createRuSupplyAdapter()
