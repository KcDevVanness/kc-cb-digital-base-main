import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTradeTypeChannelIds } from '../internal_sales/lib/tradeTypeChannelIds'
import { CompanyOrder, CompanyOrderLink } from './data/entities'
import {
  createCompanyOrderFromRef,
  linkKey,
  loadCompanyOrderRefs,
  persistCompanyOrderLink,
  type CompanyOrderLinkKind,
} from './lib/companyOrder'
import type { CompanyOrderScope } from './lib/companyOrderNumber'

/**
 * Historical backfill: one company order per channel-marked sales order, plus the purchase orders
 * anchored to them.
 *
 * Owner decision Q-002 (`.ai/specs/2026-10-09-company-order-root.md`): every sales order that
 * already carries a trade-type channel becomes a 1:1 company order so the workbench is not empty and
 * old URLs resolve. The create + snapshot functions are the **same** ones `order_hub.orders.link-child`
 * uses, so the caliber (numbering, frozen snapshot, kind mapping) has a single implementation.
 *
 * Dry-run by default: re-keying history is the operator's call (`--apply`). Apply is idempotent —
 * a sales order that is already linked is skipped, so a second run reports `created=0`; purchase
 * orders already attached are skipped too.
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

type SalesReadTables = {
  sales_orders: {
    id: string
    order_number: string | null
    status: string | null
    channel_id: string | null
    created_at: unknown
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  purchasing_purchase_orders: {
    id: string
    number: string | null
    source_sales_order_id: string | null
    source_sales_order_kind: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  order_hub_company_order_links: {
    kind: string
    ref_id: string
    tenant_id: string
    organization_id: string
  }
}

const readDb = (em: EntityManager): Kysely<SalesReadTables> =>
  em.fork().getKysely() as unknown as Kysely<SalesReadTables>

type SalesOrderRow = {
  id: string
  order_number: string | null
  status: string | null
  channel_id: string | null
  created_at: unknown
}

/** The channel marker decides the sales kind; unknown channels are not trade-type documents. */
function salesKindFor(
  channelId: string | null,
  channels: { internal: string | null; external: string | null },
): CompanyOrderLinkKind | null {
  if (channelId && channels.internal && channelId === channels.internal) return 'internal_sales_order'
  if (channelId && channels.external && channelId === channels.external) return 'external_sales_order'
  return null
}

/** Sales status → company-order status: draft stays draft, a cancelled/canceled sale is cancelled. */
function companyStatusForSalesStatus(status: string | null): string {
  const normalized = (status ?? '').toLowerCase()
  if (normalized === 'draft') return 'draft'
  if (normalized === 'canceled' || normalized === 'cancelled') return 'cancelled'
  return 'in_progress'
}

function toDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? new Date() : date
}

async function discoverScopes(
  em: EntityManager,
  filters: { tenantId?: string; organizationId?: string },
): Promise<CompanyOrderScope[]> {
  const db = readDb(em)
  let query = db
    .selectFrom('sales_orders')
    .select(['tenant_id', 'organization_id'])
    .where('deleted_at', 'is', null)
  if (filters.tenantId) query = query.where('tenant_id', '=', filters.tenantId)
  if (filters.organizationId) query = query.where('organization_id', '=', filters.organizationId)
  const rows = (await query.execute()) as Array<{ tenant_id: string; organization_id: string }>
  const scopes = new Map<string, CompanyOrderScope>()
  for (const row of rows) {
    scopes.set(`${row.tenant_id}:${row.organization_id}`, {
      tenantId: String(row.tenant_id),
      organizationId: String(row.organization_id),
    })
  }
  return [...scopes.values()]
}

async function loadExistingLinkKeys(em: EntityManager, scope: CompanyOrderScope): Promise<Set<string>> {
  const rows = (await readDb(em)
    .selectFrom('order_hub_company_order_links')
    .select(['kind', 'ref_id'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()) as Array<{ kind: string; ref_id: string }>
  const keys = new Set<string>()
  for (const row of rows) keys.add(linkKey(String(row.kind), String(row.ref_id)))
  return keys
}

const backfillCommand: ModuleCli = {
  command: 'backfill-company-orders',
  async run(rest) {
    const args = parseArgs(rest)
    const apply = args.apply === true
    const tenantId = typeof args.tenant === 'string' ? args.tenant : typeof args.tenantId === 'string' ? args.tenantId : ''
    const organizationId = typeof args.organization === 'string'
      ? args.organization
      : typeof args.org === 'string'
        ? args.org
        : typeof args.organizationId === 'string'
          ? args.organizationId
          : ''

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const scopes = await discoverScopes(em, {
      tenantId: tenantId || undefined,
      organizationId: organizationId || undefined,
    })

    console.log(`[order_hub] backfill-company-orders ${apply ? '(APPLY)' : '(dry-run)'} — ${scopes.length} scope(s)`)

    let totalScanned = 0
    let totalCreated = 0
    let totalSkipped = 0
    let totalPurchasesLinked = 0
    let totalPurchasesSkipped = 0

    for (const scope of scopes) {
      const channels = await resolveTradeTypeChannelIds(em, scope)
      const channelIds = [channels.internal, channels.external].filter((id): id is string => Boolean(id))
      if (channelIds.length === 0) {
        console.log(`  ${scope.tenantId}/${scope.organizationId}: no trade-type channels — skipped`)
        continue
      }

      const salesRows = (await readDb(em)
        .selectFrom('sales_orders')
        .select(['id', 'order_number', 'status', 'channel_id', 'created_at'])
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('deleted_at', 'is', null)
        .where('channel_id', 'in', channelIds)
        .execute()) as SalesOrderRow[]

      const linkKeys = await loadExistingLinkKeys(em, scope)
      let created = 0
      let skipped = 0
      const examples: string[] = []

      for (const row of salesRows) {
        totalScanned += 1
        const kind = salesKindFor(row.channel_id, channels)
        if (!kind) {
          skipped += 1
          continue
        }
        if (linkKeys.has(linkKey(kind, String(row.id)))) {
          skipped += 1
          continue
        }
        const examplesLabel = row.order_number ?? String(row.id)
        if (!apply) {
          if (examples.length < 5) examples.push(`${kind} ${examplesLabel}`)
          created += 1
          continue
        }

        const refs = await loadCompanyOrderRefs(em, scope, [{ kind, refId: String(row.id) }])
        const ref = refs.get(linkKey(kind, String(row.id)))
        if (!ref) {
          skipped += 1
          continue
        }
        const companyOrder = await createCompanyOrderFromRef(em, scope, ref, {
          orderDate: toDate(row.created_at),
          status: companyStatusForSalesStatus(row.status),
        })
        persistCompanyOrderLink(em, scope, companyOrder, ref)
        await em.flush()
        linkKeys.add(linkKey(kind, String(row.id)))
        created += 1
        if (examples.length < 5) examples.push(`${kind} ${examplesLabel} → ${companyOrder.number}`)
      }

      // Purchase orders that carry a source anchor move to the company order holding that source.
      const anchoredPurchases = (await readDb(em)
        .selectFrom('purchasing_purchase_orders')
        .select(['id', 'number', 'source_sales_order_id', 'source_sales_order_kind'])
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('deleted_at', 'is', null)
        .where('source_sales_order_id', 'is not', null)
        .execute()) as Array<{
        id: string
        number: string | null
        source_sales_order_id: string | null
        source_sales_order_kind: string | null
      }>
      let purchasesLinked = 0
      let purchasesSkipped = 0
      for (const purchase of anchoredPurchases) {
        const sourceKind = purchase.source_sales_order_kind
        if (sourceKind !== 'internal_sales_order' && sourceKind !== 'external_sales_order') {
          purchasesSkipped += 1
          continue
        }
        const targetCompanyOrder = await findCompanyOrderForSource(em, scope, sourceKind, String(purchase.source_sales_order_id))
        if (!targetCompanyOrder) {
          purchasesSkipped += 1
          continue
        }
        if (linkKeys.has(linkKey('purchase_order', String(purchase.id)))) {
          purchasesSkipped += 1
          continue
        }
        if (!apply) {
          purchasesLinked += 1
          continue
        }
        const refs = await loadCompanyOrderRefs(em, scope, [{ kind: 'purchase_order', refId: String(purchase.id) }])
        const ref = refs.get(linkKey('purchase_order', String(purchase.id)))
        if (!ref) {
          purchasesSkipped += 1
          continue
        }
        persistCompanyOrderLink(em, { tenantId: scope.tenantId, organizationId: scope.organizationId }, targetCompanyOrder, ref)
        await em.flush()
        linkKeys.add(linkKey('purchase_order', String(purchase.id)))
        purchasesLinked += 1
      }

      totalCreated += created
      totalSkipped += skipped
      totalPurchasesLinked += purchasesLinked
      totalPurchasesSkipped += purchasesSkipped
      console.log(
        `  ${scope.tenantId}/${scope.organizationId}: scanned=${salesRows.length} ${apply ? 'created' : 'would-create'}=${created} skipped=${skipped} purchases-linked=${purchasesLinked} purchases-skipped=${purchasesSkipped}`,
      )
      for (const example of examples) console.log(`    · ${example}`)
    }

    console.log(
      `  totals: scanned=${totalScanned} ${apply ? 'created' : 'would-create'}=${totalCreated} skipped=${totalSkipped} purchases-linked=${totalPurchasesLinked} purchases-skipped=${totalPurchasesSkipped}`,
    )
    if (!apply) console.log('  re-run with --apply to write these company orders (owner approval required)')
  },
}

async function findCompanyOrderForSource(
  em: EntityManager,
  scope: CompanyOrderScope,
  sourceKind: CompanyOrderLinkKind,
  sourceSalesOrderId: string,
): Promise<CompanyOrder | null> {
  const link = await em.fork().findOne(CompanyOrderLink, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind: sourceKind,
    refId: sourceSalesOrderId,
  })
  return link ? link.companyOrder : null
}

const commands: ModuleCli[] = [backfillCommand]

export default commands
