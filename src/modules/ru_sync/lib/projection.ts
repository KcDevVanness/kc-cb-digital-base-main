import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { RuSyncCursor, RuSyncSkuMap, RuSyncSnapshot } from '../data/entities'
import { matchKey, suggestProduct } from './skuNormalize'
import { ADS_ENDPOINTS } from './endpoints/ads'
import { SUPPLY_ENDPOINTS } from './endpoints/supply'

/** Every endpoint the pull projects, supply and ads. */
export type RuEndpoint = (typeof SUPPLY_ENDPOINTS)[number] | (typeof ADS_ENDPOINTS)[number]

/**
 * The store behind the pull: the per-endpoint watermark, the snapshot projection and the SKU map
 * refresh. The adapter is written against this interface, so a test can drive the whole pull against
 * an in-memory implementation while production uses the ORM one below.
 *
 * Writes are **idempotent per snapshot key** `(endpoint, natural key, as_of)`: replaying the same
 * day's page rewrites the same rows instead of duplicating them, which is what makes the contract's
 * at-least-once delivery and this module's retry-on-next-day behaviour safe.
 */

const logger = createLogger('ru_sync').child({ component: 'projection' })

export type RuSyncScope = { tenantId: string; organizationId: string }

export type SnapshotRowInput = {
  endpoint: RuEndpoint
  naturalKey: string
  payload: Record<string, unknown>
}

/**
 * `actions` is aligned with the input rows: index `i` is what happened to row `i`. The engine's run
 * history reports the item actions it receives, so without this an operator would see every replayed
 * row as "created" and would have no way to tell a first pull from a no-op replay.
 */
export type SnapshotAction = 'create' | 'update' | 'skip'
export type SnapshotWriteResult = {
  created: number
  updated: number
  unchanged: number
  actions: SnapshotAction[]
}

export type SkuMapResult = { codes: number; mapped: number; unmapped: number; ignored: number }

export interface RuSyncStore {
  loadCursor(tenantId: string, endpoint: RuEndpoint): Promise<string | null>
  saveCursor(tenantId: string, endpoint: RuEndpoint, cursor: string | null): Promise<void>
  writeSnapshots(
    scope: RuSyncScope,
    endpoint: RuEndpoint,
    asOf: string,
    rows: readonly SnapshotRowInput[],
  ): Promise<SnapshotWriteResult>
  syncSkuCodes(scope: RuSyncScope, codes: readonly string[]): Promise<SkuMapResult>
}

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function samePayload(left: Record<string, unknown> | null | undefined, right: Record<string, unknown>): boolean {
  if (!left) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createOrmRuSyncStore(em: EntityManager): RuSyncStore {
  return {
    async loadCursor(tenantId, endpoint) {
      const row = await em.fork().findOne(RuSyncCursor, { tenantId, endpoint } as FilterQuery<RuSyncCursor>)
      return row?.cursor ?? null
    },

    async saveCursor(tenantId, endpoint, cursor) {
      const scoped = em.fork()
      const existing = await scoped.findOne(RuSyncCursor, { tenantId, endpoint } as FilterQuery<RuSyncCursor>)
      if (existing) {
        existing.cursor = cursor
        existing.updatedAt = new Date()
      } else {
        scoped.persist(scoped.create(RuSyncCursor, { tenantId, endpoint, cursor, updatedAt: new Date() }))
      }
      await scoped.flush()
    },

    async writeSnapshots(scope, endpoint, asOf, rows) {
      const result: SnapshotWriteResult = { created: 0, updated: 0, unchanged: 0, actions: [] }
      if (rows.length === 0) return result
      const scoped = em.fork()
      const snapshotDate = asDate(asOf)
      for (const row of rows) {
        const existing = await scoped.findOne(RuSyncSnapshot, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          endpoint,
          naturalKey: row.naturalKey,
          asOf: snapshotDate,
        } as FilterQuery<RuSyncSnapshot>)
        if (!existing) {
          scoped.persist(
            scoped.create(RuSyncSnapshot, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              endpoint,
              naturalKey: row.naturalKey,
              payload: row.payload,
              asOf: snapshotDate,
              updatedAt: new Date(),
            }),
          )
          result.created += 1
          result.actions.push('create')
          continue
        }
        if (samePayload(existing.payload, row.payload)) {
          result.unchanged += 1
          result.actions.push('skip')
          continue
        }
        existing.payload = row.payload
        existing.updatedAt = new Date()
        result.updated += 1
        result.actions.push('update')
      }
      await scoped.flush()
      return result
    },

    /**
     * Registers every RU code the pull has seen and, for the ones without a decision yet, binds the
     * product when exactly one candidate matches {@link matchKey}. A code that was mapped by hand or
     * deliberately ignored is never overwritten by this pass.
     */
    async syncSkuCodes(scope, codes) {
      const unique = [...new Set(codes.filter((code) => code.trim().length > 0))]
      const result: SkuMapResult = { codes: unique.length, mapped: 0, unmapped: 0, ignored: 0 }
      if (unique.length === 0) return result

      const scoped = em.fork()
      const products = (await scoped.getConnection().execute<Array<{ id: string; sku: string }>>(
        `select id, sku from catalog_products
          where tenant_id = ? and organization_id = ? and deleted_at is null`,
        [scope.tenantId, scope.organizationId],
      )) as Array<{ id: string; sku: string }>

      const existing = await scoped.find(RuSyncSkuMap, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ruSku: { $in: unique },
      } as FilterQuery<RuSyncSkuMap>)
      const byCode = new Map(existing.map((row) => [row.ruSku, row]))

      for (const code of unique) {
        const row = byCode.get(code)
        if (row && row.status !== 'unmapped') {
          if (row.status === 'ignored') result.ignored += 1
          else result.mapped += 1
          continue
        }

        const suggestion = suggestProduct(code, products, (product) => product.sku)
        if (!suggestion) {
          if (!row) {
            scoped.persist(
              scoped.create(RuSyncSkuMap, {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                ruSku: code,
                productId: null,
                status: 'unmapped',
                note: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            )
          }
          result.unmapped += 1
          continue
        }

        if (row) {
          row.productId = suggestion.id
          row.status = 'mapped'
          row.note = `auto: ${suggestion.sku}`
          row.updatedAt = new Date()
        } else {
          scoped.persist(
            scoped.create(RuSyncSkuMap, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              ruSku: code,
              productId: suggestion.id,
              status: 'mapped',
              note: `auto: ${suggestion.sku}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          )
        }
        result.mapped += 1
      }

      await scoped.flush()
      logger.info('RU SKU codes registered', { ...result })
      return result
    },
  }
}

/** Codes a pulled row contributes to the RU-code registry, per endpoint. */
export function ruCodesFromRows(endpoint: RuEndpoint, rows: readonly SnapshotRowInput[]): string[] {
  if (endpoint === 'sku_mappings') {
    return rows.map((row) => row.payload.ru_code).filter((value): value is string => typeof value === 'string')
  }
  // Every other endpoint that names a SKU contributes it: the supply rows carry `sku`, the ads rows
  // carry `sku` too (§11–§13, §17–§18), which is how a code first seen only in an ads snapshot still
  // reaches the mapping list.
  return rows.map((row) => row.payload.sku).filter((value): value is string => typeof value === 'string')
}

/** The comparison key of a RU code, exposed for the UI's "why did this not match" hint. */
export function ruMatchKey(code: string): string {
  return matchKey(code)
}
