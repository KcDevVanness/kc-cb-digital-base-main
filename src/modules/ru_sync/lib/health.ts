import type { EntityManager } from '@mikro-orm/postgresql'
import type { ReadScope } from './readScope'
import { SUPPLY_ENDPOINTS, SUPPLY_ENDPOINT_PATHS, type SupplyEndpoint } from './endpoints/supply'

/**
 * 同步健康 — per endpoint: the snapshot date the projections actually carry, the watermark the next
 * pull resumes from, when that watermark last moved, and what the latest run did.
 *
 * `stale` is deliberately about the **watermark's age**, not about the run's: a pull that runs every
 * hour and never advances the watermark is not healthy either, but the number that decides whether
 * the cockpit may be trusted is how old the data is. The run status only distinguishes `failing`
 * (the last attempt errored) from everything else.
 */

const STALE_AFTER_HOURS = 24

export type RuEndpointStatus = 'ok' | 'stale' | 'failing' | 'never'

export type RuEndpointHealth = {
  endpoint: SupplyEndpoint
  path: string
  lastAsOf: string | null
  cursor: string | null
  lastAdvancedAt: string | null
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  status: RuEndpointStatus
  ageHours: number | null
}

export type RuHealthResult = {
  staleAfterHours: number
  checkedAt: string
  endpoints: RuEndpointHealth[]
  /** True when any endpoint is stale or failing — the cockpit banner keys off this. */
  stale: boolean
}

type HealthDatabase = {
  ru_sync_snapshots: {
    tenant_id: string
    organization_id: string
    endpoint: string
    as_of: Date | string
  }
  ru_sync_cursors: {
    tenant_id: string
    endpoint: string
    cursor: string | null
    updated_at: Date
  }
  sync_runs: {
    id: string
    integration_id: string
    entity_type: string
    status: string
    last_error: string | null
    created_at: Date
    updated_at: Date
    tenant_id: string
    organization_id: string
  }
}

function readDb(em: EntityManager) {
  return em.fork().getKysely<HealthDatabase>()
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  const iso = toIso(value)
  return iso === null ? null : iso.slice(0, 10)
}

function hoursSince(iso: string | null, now: Date): number | null {
  if (iso === null) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.round(((now.getTime() - then) / 3_600_000) * 10) / 10)
}

export async function loadRuHealth(
  em: EntityManager,
  scope: ReadScope,
  providerKey: string,
  options: { now?: Date } = {},
): Promise<RuHealthResult> {
  const now = options.now ?? new Date()
  const db = readDb(em)

  const [snapshots, cursors, runs] = await Promise.all([
    db
      .selectFrom('ru_sync_snapshots')
      .select(['endpoint', 'as_of'])
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', scope.organizationIds)
      .execute(),
    db
      .selectFrom('ru_sync_cursors')
      .select(['endpoint', 'cursor', 'updated_at'])
      .where('tenant_id', '=', scope.tenantId)
      .execute(),
    db
      .selectFrom('sync_runs')
      .select(['entity_type', 'status', 'last_error', 'created_at', 'updated_at'])
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', 'in', scope.organizationIds)
      .where('integration_id', 'like', `${providerKey}%`)
      .orderBy('created_at', 'desc')
      .execute(),
  ])

  const lastAsOf = new Map<string, string>()
  for (const snapshot of snapshots) {
    const date = toIsoDate(snapshot.as_of)
    const endpoint = String(snapshot.endpoint)
    if (!date) continue
    const current = lastAsOf.get(endpoint)
    if (!current || date > current) lastAsOf.set(endpoint, date)
  }

  const cursorByEndpoint = new Map(cursors.map((row) => [String(row.endpoint), row]))
  const latestRunByEndpoint = new Map<string, (typeof runs)[number]>()
  for (const run of runs) {
    const endpoint = String(run.entity_type)
    if (!latestRunByEndpoint.has(endpoint)) latestRunByEndpoint.set(endpoint, run)
  }

  const endpoints: RuEndpointHealth[] = SUPPLY_ENDPOINTS.map((endpoint) => {
    const cursorRow = cursorByEndpoint.get(endpoint)
    const run = latestRunByEndpoint.get(endpoint)
    const lastAdvancedAt = cursorRow ? toIso(cursorRow.updated_at) : null
    const lastRunAt = run ? toIso(run.updated_at ?? run.created_at) : null
    const lastRunStatus = run ? String(run.status) : null
    const ageHours = hoursSince(lastAdvancedAt ?? lastRunAt, now)
    const status: RuEndpointStatus =
      lastRunStatus === 'failed'
        ? 'failing'
        : ageHours === null
          ? 'never'
          : ageHours > STALE_AFTER_HOURS
            ? 'stale'
            : 'ok'
    return {
      endpoint,
      path: SUPPLY_ENDPOINT_PATHS[endpoint],
      lastAsOf: lastAsOf.get(endpoint) ?? null,
      cursor: cursorRow?.cursor ?? null,
      lastAdvancedAt,
      lastRunAt,
      lastRunStatus,
      lastRunError: run?.last_error ?? null,
      status,
      ageHours,
    }
  })

  return {
    staleAfterHours: STALE_AFTER_HOURS,
    checkedAt: now.toISOString(),
    endpoints,
    stale: endpoints.some((entry) => entry.status === 'stale' || entry.status === 'failing'),
  }
}
