import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import type { DataSyncAdapter, ImportBatch } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { createRuSupplyAdapter } from '../adapter'
import { createRuClient } from '../client'
import { SUPPLY_ENDPOINTS, SUPPLY_ENDPOINT_PATHS, type SupplyEndpoint } from '../endpoints/supply'
import type { RuEndpoint } from '../projection'
import type { RuSyncScope, RuSyncStore, SkuMapResult, SnapshotRowInput, SnapshotWriteResult } from '../projection'


/**
 * The whole pull, driven end to end against a mock contract server: the fixtures are the contract's
 * own payloads, the store is an in-memory implementation of the projection interface, and the client
 * is the real one (its transport pointed at the local server).
 *
 * What this proves and what it does not: the walk, the envelope and `as_of` validation, the
 * idempotent projection, the cursor's commit-after-success rule and the RU-code registration are all
 * real code paths against real HTTP. The ORM store and the engine's run/progress plumbing are not
 * exercised here — the module README records that boundary and the app run covers it.
 */

const FIXTURE_FILES: Record<SupplyEndpoint, string> = {
  skus: 'skus.json',
  sku_mappings: 'sku-mappings.json',
  stock: 'stock.json',
  in_transit: 'in-transit.json',
  unrecognized_inbound: 'unrecognized-inbound.json',
  plan: 'plan.json',
  shipments: 'shipments.json',
  params: 'params.json',
}

type FixturePage = { items: Array<Record<string, unknown>>; as_of: string; total: number }

function fixture(endpoint: SupplyEndpoint): FixturePage {
  const path = join(__dirname, '..', '..', '__tests__', 'fixtures', 'supply', FIXTURE_FILES[endpoint])
  return JSON.parse(readFileSync(path, 'utf8')) as FixturePage
}

type MemoryStore = RuSyncStore & {
  snapshots: SnapshotRowInput[]
  cursors: Map<string, string | null>
  skuCodes: string[]
}

function createMemoryStore(): MemoryStore {
  const snapshots: SnapshotRowInput[] = []
  const cursors = new Map<string, string | null>()
  const skuCodes: string[] = []
  const key = (endpoint: RuEndpoint, naturalKey: string, asOf: string) => `${endpoint}::${naturalKey}::${asOf}`

  return {
    snapshots,
    cursors,
    skuCodes,
    async loadCursor(tenantId, endpoint) {
      return cursors.get(`${tenantId}:${endpoint}`) ?? null
    },
    async saveCursor(tenantId, endpoint, cursor) {
      cursors.set(`${tenantId}:${endpoint}`, cursor)
    },
    async writeSnapshots(_scope, endpoint, asOf, rows): Promise<SnapshotWriteResult> {
      const result: SnapshotWriteResult = { created: 0, updated: 0, unchanged: 0, actions: [] }
      const byKey = new Map(snapshots.map((row) => [key(row.endpoint, row.naturalKey, String(row.payload.__asOf)), row]))
      for (const row of rows) {
        const payload = { ...row.payload, __asOf: asOf }
        const existing = byKey.get(key(endpoint, row.naturalKey, asOf))
        if (!existing) {
          const created = { ...row, payload }
          snapshots.push(created)
          byKey.set(key(endpoint, row.naturalKey, asOf), created)
          result.created += 1
          result.actions.push('create')
          continue
        }
        if (JSON.stringify(existing.payload) === JSON.stringify(payload)) {
          result.unchanged += 1
          result.actions.push('skip')
          continue
        }
        existing.payload = payload
        result.updated += 1
        result.actions.push('update')
      }
      return result
    },
    async syncSkuCodes(_scope, codes): Promise<SkuMapResult> {
      skuCodes.push(...codes)
      return { codes: codes.length, mapped: 0, unmapped: codes.length, ignored: 0 }
    },
  }
}

type MockServer = {
  server: Server
  baseUrl: string
  /** Make the next requests for one endpoint answer 500 (a transient contract failure). */
  setFailing: (endpoint: SupplyEndpoint | null) => void
  /** Drop `as_of` from the envelope, the one thing that must never be stored around. */
  setBrokenEnvelope: (broken: boolean) => void
  requests: Array<{ endpoint: SupplyEndpoint; page: number; updatedSince: string | null }>
}

async function startMockServer(): Promise<MockServer> {
  let failing: SupplyEndpoint | null = null
  let brokenEnvelope = false
  const requests: MockServer['requests'] = []

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const endpoint = (Object.keys(SUPPLY_ENDPOINT_PATHS) as SupplyEndpoint[]).find(
      (candidate) => SUPPLY_ENDPOINT_PATHS[candidate] === url.pathname,
    )
    if (!endpoint) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'invalid_param', message: `unknown path ${url.pathname}` } }))
      return
    }
    const page = Number(url.searchParams.get('page') ?? '1')
    requests.push({ endpoint, page, updatedSince: url.searchParams.get('updated_since') })
    if (failing === endpoint) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'internal', message: 'boom' } }))
      return
    }
    const body = fixture(endpoint)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ...(brokenEnvelope ? {} : { as_of: body.as_of }),
        page,
        page_size: 100,
        total: body.total,
        items: page === 1 ? body.items : [],
      }),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    server,
    baseUrl,
    requests,
    setFailing: (endpoint) => {
      failing = endpoint
    },
    setBrokenEnvelope: (broken) => {
      brokenEnvelope = broken
    },
  }
}

function buildAdapter(store: RuSyncStore, baseUrl: string) {
  return createRuSupplyAdapter({
    store,
    clientFactory: (credentials) =>
      createRuClient({
        baseUrl,
        token: credentials.token,
        allowPrivate: true,
        maxRetries: 0,
      }),
  })
}

async function drain(
  adapter: DataSyncAdapter,
  endpoint: SupplyEndpoint,
  scope: RuSyncScope,
  baseUrl: string,
  cursor?: string | null,
): Promise<ImportBatch[]> {
  const stream = adapter.streamImport?.({
    entityType: endpoint,
    batchSize: 100,
    ...(cursor ? { cursor } : {}),
    credentials: { baseUrl, token: 'test-token', allowPrivate: true },
    mapping: { entityType: endpoint, fields: [], matchStrategy: 'externalId' },
    scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
  })
  if (!stream) throw new Error('adapter has no streamImport')
  const batches: ImportBatch[] = []
  for await (const batch of stream) batches.push(batch)
  return batches
}

const SCOPE: RuSyncScope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('RU supply pull', () => {
  let mock: MockServer

  beforeAll(async () => {
    mock = await startMockServer()
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => mock.server.close(() => resolve()))
  })

  it('projects every fixture row once and advances each endpoint cursor after the last page', async () => {
    const store = createMemoryStore()
    const adapter = buildAdapter(store, mock.baseUrl)

    for (const endpoint of SUPPLY_ENDPOINTS) {
      const batches = await drain(adapter, endpoint, SCOPE, mock.baseUrl)
      const expected = fixture(endpoint).items.length
      expect([endpoint, batches.length > 0]).toEqual([endpoint, true])
      expect([endpoint, store.snapshots.filter((row) => row.endpoint === endpoint).length]).toEqual([endpoint, expected])
      expect(batches[batches.length - 1].hasMore).toBe(false)
      // The newest `updated_at` in the fixtures is the skus row at 10:05, every other endpoint's max
      // is 10:00 — the watermark is per endpoint, not one global value.
      const expectedWatermark = endpoint === 'skus' ? '2026-09-27T10:05:00+03:00' : '2026-09-27T10:00:00+03:00'
      expect([endpoint, store.cursors.get(`${SCOPE.tenantId}:${endpoint}`)]).toEqual([endpoint, expectedWatermark])
    }
  })

  it('replays the same snapshot day without creating a second row', async () => {
    const store = createMemoryStore()
    const adapter = buildAdapter(store, mock.baseUrl)

    await drain(adapter, 'stock', SCOPE, mock.baseUrl)
    const afterFirst = store.snapshots.filter((row) => row.endpoint === 'stock').length
    await drain(adapter, 'stock', SCOPE, mock.baseUrl)
    const afterReplay = store.snapshots.filter((row) => row.endpoint === 'stock').length

    expect(afterFirst).toBe(fixture('stock').items.length)
    expect(afterReplay).toBe(afterFirst)
  })

  it('keeps the previous watermark when a page fails, so the window is re-pulled', async () => {
    const store = createMemoryStore()
    const adapter = buildAdapter(store, mock.baseUrl)

    await drain(adapter, 'stock', SCOPE, mock.baseUrl)
    const watermark = store.cursors.get(`${SCOPE.tenantId}:stock`)

    mock.setFailing('plan')
    await expect(drain(adapter, 'plan', SCOPE, mock.baseUrl)).rejects.toThrow(/RU plan/)
    mock.setFailing(null)

    expect(store.cursors.has(`${SCOPE.tenantId}:plan`)).toBe(false)
    expect(store.snapshots.filter((row) => row.endpoint === 'plan')).toHaveLength(0)
    expect(store.cursors.get(`${SCOPE.tenantId}:stock`)).toBe(watermark)
  })

  it('registers every RU code it saw, including the ones nothing matches', async () => {
    const store = createMemoryStore()
    const adapter = buildAdapter(store, mock.baseUrl)

    await drain(adapter, 'skus', SCOPE, mock.baseUrl)
    expect(new Set(store.skuCodes)).toEqual(new Set(['PK44', 'PK39_2', 'UNKNOWN-CODE-1']))
  })

  it('refuses a page whose envelope has no as_of instead of storing it', async () => {
    const store = createMemoryStore()
    const adapter = buildAdapter(store, mock.baseUrl)

    mock.setBrokenEnvelope(true)
    await expect(drain(adapter, 'params', SCOPE, mock.baseUrl)).rejects.toThrow(/does not match the contract/)
    mock.setBrokenEnvelope(false)

    expect(store.snapshots).toHaveLength(0)
    expect(store.cursors.size).toBe(0)
  })

  it('resumes from the stored watermark, which the engine asks for through getInitialCursor', async () => {
    const store = createMemoryStore()
    const adapter = buildAdapter(store, mock.baseUrl)
    await drain(adapter, 'stock', SCOPE, mock.baseUrl)

    const resume = await adapter.getInitialCursor?.({
      entityType: 'stock',
      scope: { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId },
    })
    expect(resume).not.toBeNull()

    const before = mock.requests.length
    await drain(adapter, 'stock', SCOPE, mock.baseUrl, resume)
    const incremental = mock.requests.slice(before).filter((request) => request.endpoint === 'stock')
    // The watermark the previous walk ended on is exactly what the next one sends.
    expect(incremental.every((request) => request.updatedSince === '2026-09-27T10:00:00+03:00')).toBe(true)
  })
})
