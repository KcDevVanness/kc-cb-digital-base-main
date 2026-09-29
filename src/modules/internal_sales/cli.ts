import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { ensureTradeTypeChannels } from './setup'
import {
  SALES_TRADE_TYPES,
  TRADE_TYPE_CHANNEL_CODES,
  tradeTypeFromSnapshot,
  type SalesTradeType,
} from './lib/tradeType'

/**
 * Backfill of the trade-type marker for documents written before it existed.
 *
 * The classification is the same rule the UI reads: a document whose buyer is a related
 * organization was an internal sale, one whose buyer is an app-owned party was external. Documents
 * without either link cannot be classified and are reported, never guessed.
 *
 * Dry-run by default: writing the marker changes which filtered list a document appears in, so the
 * operator approves the list first (`--apply`). Running it twice is a no-op — a document that
 * already carries a channel is skipped.
 */

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=')
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue
      continue
    }
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
      continue
    }
    parsed[key] = true
  }
  return parsed
}

type DocumentRow = {
  kind: 'order' | 'quote'
  id: string
  number: string | null
  tenant_id: string
  organization_id: string
  channel_id: string | null
  customer_snapshot: unknown
}

type Classification = {
  row: DocumentRow
  tradeType: SalesTradeType | null
  reason: 'already-marked' | 'classified' | 'no-snapshot-link'
}

export function classifyDocument(row: DocumentRow): Classification {
  if (row.channel_id) return { row, tradeType: null, reason: 'already-marked' }
  const tradeType = tradeTypeFromSnapshot(row.customer_snapshot)
  if (!tradeType) return { row, tradeType: null, reason: 'no-snapshot-link' }
  return { row, tradeType, reason: 'classified' }
}

/**
 * Scopes that hold documents, so the reads can go through the installed entities *with* their
 * decryption helper: `customer_snapshot` (and the whole metadata family) is encrypted at rest for
 * `sales:sales_order` / `sales:sales_quote`, so a raw Kysely read would classify ciphertext.
 */
async function discoverScopes(
  em: EntityManager,
  filters: { tenantId?: string; organizationId?: string },
): Promise<Array<{ tenantId: string; organizationId: string }>> {
  const kysely = em.fork().getKysely<any>()
  const scopes = new Map<string, { tenantId: string; organizationId: string }>()
  for (const table of ['sales_orders', 'sales_quotes'] as const) {
    let query = kysely.selectFrom(table).select(['tenant_id', 'organization_id']).where('deleted_at', 'is', null)
    if (filters.tenantId) query = query.where('tenant_id', '=', filters.tenantId)
    if (filters.organizationId) query = query.where('organization_id', '=', filters.organizationId)
    const rows = (await query.execute()) as Array<{ tenant_id: string; organization_id: string }>
    for (const row of rows) {
      scopes.set(`${row.tenant_id}:${row.organization_id}`, { tenantId: row.tenant_id, organizationId: row.organization_id })
    }
  }
  return [...scopes.values()]
}

async function loadDocuments(
  em: EntityManager,
  filters: { tenantId?: string; organizationId?: string },
): Promise<DocumentRow[]> {
  const scopes = await discoverScopes(em, filters)
  const rows: DocumentRow[] = []
  for (const scope of scopes) {
    const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const [orders, quotes] = await Promise.all([
      findWithDecryption(
        em.fork(),
        SalesOrder,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        {},
        decryptionScope,
      ),
      findWithDecryption(
        em.fork(),
        SalesQuote,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        {},
        decryptionScope,
      ),
    ])
    for (const order of orders) {
      rows.push({
        kind: 'order',
        id: String(order.id),
        number: order.orderNumber ?? null,
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        channel_id: order.channel?.id ? String(order.channel.id) : null,
        customer_snapshot: order.customerSnapshot ?? null,
      })
    }
    for (const quote of quotes) {
      rows.push({
        kind: 'quote',
        id: String(quote.id),
        number: quote.quoteNumber ?? null,
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        channel_id: quote.channel?.id ? String(quote.channel.id) : null,
        customer_snapshot: quote.customerSnapshot ?? null,
      })
    }
  }
  return rows
}

const backfillCommand: ModuleCli = {
  command: 'backfill-trade-type',
  async run(rest) {
    const args = parseArgs(rest)
    const apply = args.apply === true
    const tenantId = typeof args.tenant === 'string' ? args.tenant : typeof args.tenantId === 'string' ? args.tenantId : ''
    const organizationId = typeof args.org === 'string' ? args.org : typeof args.organizationId === 'string' ? args.organizationId : ''

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const documents = await loadDocuments(em, {
      tenantId: tenantId || undefined,
      organizationId: organizationId || undefined,
    })

    const classifications = documents.map(classifyDocument)
    const byType: Record<SalesTradeType, number> = { internal: 0, external: 0 }
    const skipped: Record<Exclude<Classification['reason'], 'classified'>, number> = {
      'already-marked': 0,
      'no-snapshot-link': 0,
    }
    for (const entry of classifications) {
      if (entry.reason === 'classified' && entry.tradeType) byType[entry.tradeType] += 1
      else if (entry.reason !== 'classified') skipped[entry.reason] += 1
    }

    console.log(
      `[internal_sales] trade-type backfill ${apply ? '(APPLY)' : '(dry-run)'} — ${documents.length} document(s) scanned`,
    )
    console.log(`  internal: ${byType.internal} · external: ${byType.external}`)
    console.log(`  skipped: ${skipped['already-marked']} already marked · ${skipped['no-snapshot-link']} without a buyer link`)

    const pending = classifications.filter((entry) => entry.reason === 'classified')
    if (!apply) {
      for (const entry of pending) {
        console.log(`  would mark ${entry.row.kind} ${entry.row.number ?? entry.row.id} as ${entry.tradeType}`)
      }
      console.log('  re-run with --apply to write these markers (owner approval required)')
      return
    }

    // Channels must exist before any marker is written; the seeder is idempotent per organization.
    const organizations = new Map<string, { tenantId: string; organizationId: string }>()
    for (const entry of pending) {
      organizations.set(`${entry.row.tenant_id}:${entry.row.organization_id}`, {
        tenantId: entry.row.tenant_id,
        organizationId: entry.row.organization_id,
      })
    }
    const channelIds = new Map<string, Record<SalesTradeType, string>>()
    for (const [key, scope] of organizations) {
      channelIds.set(key, await ensureTradeTypeChannels(em, scope))
    }

    let written = 0
    const failures: string[] = []
    for (const entry of pending) {
      if (!entry.tradeType) continue
      const key = `${entry.row.tenant_id}:${entry.row.organization_id}`
      const target = channelIds.get(key)?.[entry.tradeType]
      if (!target) {
        failures.push(`${entry.row.kind} ${entry.row.number ?? entry.row.id}: no channel for ${entry.tradeType}`)
        continue
      }
      try {
        const table = entry.row.kind === 'order' ? 'sales_orders' : 'sales_quotes'
        const result = await em.fork().getKysely<any>()
          .updateTable(table)
          .set({ channel_id: target })
          .where('id', '=', entry.row.id)
          .where('tenant_id', '=', entry.row.tenant_id)
          .where('channel_id', 'is', null)
          .executeTakeFirst()
        if (Number(result?.numUpdatedRows ?? 0) > 0) written += 1
      } catch (error) {
        failures.push(`${entry.row.kind} ${entry.row.number ?? entry.row.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    console.log(`  ✅ marked ${written} document(s)`)
    for (const failure of failures) console.log(`  ⚠️  ${failure}`)
    const targetCodes = SALES_TRADE_TYPES.map((type) => `${type}=${TRADE_TYPE_CHANNEL_CODES[type]}`).join(', ')
    console.log(`  channels used: ${targetCodes}`)
  },
}

const commands: ModuleCli[] = [backfillCommand]

export default commands
