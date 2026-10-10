import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, badRequest } from '@open-mercato/shared/lib/crud/errors'
import { AMOUNT_SCALE, toAmountString } from '../../trade_docs/lib/money'
import { ensureScope } from '../lib/scope'
import { matchKey } from '../lib/skuNormalize'

/**
 * 缺口 → 采购单草稿.
 *
 * The plan rows say what to order; `purchasing` owns what a purchase order is. This command reads
 * the RU plan snapshot and its own SKU map, then dispatches `purchasing.purchase-orders.create` with
 * the mapped product ids — one draft, never placed, never auto-approved.
 *
 * Two refusals are deliberate:
 *
 * - a SKU with no `mapped` decision fails the **whole** request with 422 and a list of the offending
 *   codes (nothing is created): a PO that silently skips a line is a PO someone will receive short;
 * - the RU unit cost is only copied when its currency equals the PO's currency. Anything else would
 *   need a rate and a date, so the draft carries a 0 price and the RU amount in the line note
 *   instead of an invented number.
 */

export const draftPosSchema = z.object({
  supplierId: z.string().uuid(),
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
    .transform((value) => value.toUpperCase()),
  businessNumber: z.string().trim().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(120),
        /** Overrides the plan's recommendation; the plan value is used when absent. */
        quantity: z
          .union([z.string(), z.number()])
          .optional()
          .transform((value) => (value === undefined ? undefined : String(value)))
          .refine((value) => value === undefined || /^\d+(\.\d+)?$/.test(value), {
            message: 'quantity must be a positive decimal',
          }),
      }),
    )
    .min(1)
    .max(200),
})

export type DraftPosInput = z.infer<typeof draftPosSchema>

type PlanSnapshotRow = { payload: Record<string, unknown> }
type SkuDecisionRow = { ru_sku: string; status: string; product_id: string | null }

type PeerCommandBus = {
  execute: (
    id: string,
    options: { input: unknown; ctx: CommandRuntimeContext },
  ) => Promise<{ result?: unknown } | unknown>
}

/**
 * Peer commands are dispatched over the DI command bus so `purchasing` keeps ownership of its own
 * invariants (numbering, line math, the draft lifecycle). A rejected peer command aborts this one:
 * reporting a draft the system did not create would be worse than failing.
 */
async function dispatchPeerCommand(
  ctx: CommandRuntimeContext,
  commandId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const commandBus = ctx.container.resolve('commandBus') as PeerCommandBus
  let outcome: { result?: unknown } | unknown
  try {
    outcome = await commandBus.execute(commandId, { input, ctx: { ...ctx, request: undefined } })
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new CrudHttpError(422, { error: `Peer command ${commandId} failed: ${message}` })
  }
  const envelope = outcome as { result?: unknown }
  return (envelope && typeof envelope === 'object' && 'result' in envelope ? envelope.result : outcome) as Record<string, unknown>
}

const draftPosCommand: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'ru_sync.plan.draft-pos',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = draftPosSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const planSnapshot = await loadLatestPlan(em, scope)
    if (!planSnapshot) {
      throw new CrudHttpError(409, {
        error: 'No RU purchase plan has been pulled yet, so there is nothing to draft from',
      })
    }

    const decisions = await loadSkuDecisions(em, scope)
    const planRows = new Map<string, Record<string, unknown>>()
    for (const row of planSnapshot.rows) {
      const sku = typeof row.sku === 'string' ? row.sku : null
      if (sku) planRows.set(sku, row)
    }

    const { lines, unmapped } = buildDraftPosLines({
      requested: parsed.lines,
      decisions,
      planRows,
      currencyCode: parsed.currencyCode,
    })

    if (unmapped.length > 0) {
      throw new CrudHttpError(422, {
        error: 'Some selected SKUs cannot be ordered yet',
        unmapped,
      })
    }
    if (lines.length === 0) throw badRequest('No line could be built from the selected SKUs')

    const order = await dispatchPeerCommand(ctx, 'purchasing.purchase-orders.create', {
      supplierId: parsed.supplierId,
      currencyCode: parsed.currencyCode,
      businessNumber: parsed.businessNumber ?? null,
      notes: parsed.notes ?? `RU plan ${planSnapshot.asOf}`,
      lines,
    })

    return {
      purchaseOrderId: typeof order.id === 'string' ? order.id : null,
      number: typeof order.number === 'string' ? order.number : null,
      status: typeof order.status === 'string' ? order.status : 'draft',
      lines: lines.length,
      planAsOf: planSnapshot.asOf,
    }
  },
  captureAfter: (_input, result) => ({ id: String((result as { purchaseOrderId?: string }).purchaseOrderId ?? '') }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Draft a purchase order from the RU plan',
    resourceKind: 'ru_sync.plan',
    resourceId: String((result as { purchaseOrderId?: string }).purchaseOrderId ?? ''),
    tenantId: '',
    organizationId: '',
    snapshotAfter: {
      purchaseOrderId: (result as { purchaseOrderId?: string }).purchaseOrderId ?? null,
      lines: (result as { lines?: number }).lines ?? 0,
    },
  }),
}

export type DraftPosLineInput = { sku: string; quantity?: string }
export type DraftPosPlanRowLookup = Map<string, Record<string, unknown>>

/**
 * The purchase-order lines a plan selection produces, and the codes that cannot be ordered yet.
 *
 * Pure on purpose: the peer contract is the part that breaks silently. `purchasing`'s line schema
 * takes the product as **`catalogProductId`** (a product *is* the catalog product since the
 * single-store cutover; the old `productId` key is refused with 400 "each line needs a product
 * reference"), and this was the one caller still sending the old key — no spec covered it, so the
 * cockpit's only write path would have failed at runtime. Exporting the builder keeps that key
 * pinned by a unit test instead of by luck.
 */
export function buildDraftPosLines(input: {
  requested: DraftPosLineInput[]
  decisions: Map<string, SkuDecisionRow>
  planRows: DraftPosPlanRowLookup
  currencyCode: string
}): { lines: Array<Record<string, unknown>>; unmapped: Array<{ sku: string; reason: string }> } {
  const { requested, decisions, planRows, currencyCode } = input
  const unmapped: Array<{ sku: string; reason: string }> = []
  const lines: Array<Record<string, unknown>> = []

  for (const row of requested) {
    const decision = decisions.get(row.sku)
    if (!decision || decision.status !== 'mapped' || !decision.product_id) {
      unmapped.push({
        sku: row.sku,
        reason: decision ? `sku map status is ${decision.status}` : 'the code has no mapping decision',
      })
      continue
    }
    const planRow = planRows.get(row.sku)
    if (!planRow) {
      unmapped.push({ sku: row.sku, reason: 'the RU plan has no row for this code' })
      continue
    }
    const quantity = row.quantity ?? readDecimal(planRow.recommended_qty) ?? '0'
    if (!quantity || Number(quantity) <= 0) {
      unmapped.push({ sku: row.sku, reason: 'the RU plan recommends no quantity' })
      continue
    }

    const ruCost = readAmount(planRow.unit_cost)
    const sameCurrency = ruCost !== null && ruCost.currency === currencyCode
    lines.push({
      catalogProductId: decision.product_id,
      quantity,
      unitPrice: sameCurrency ? ruCost.amount : '0',
      priceIncludesTax: true,
      note: sameCurrency
        ? `RU plan ${row.sku}`
        : `RU plan ${row.sku}; RU unit cost ${ruCost ? `${ruCost.amount} ${ruCost.currency}` : 'not provided'} — set the price before placing`,
    })
  }

  return { lines, unmapped }
}

async function loadLatestPlan(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<{ asOf: string; rows: Array<Record<string, unknown>> } | null> {
  const rows = (await em.fork().getConnection().execute<Array<{ as_of: string; payload: Record<string, unknown> }>>(
    `select to_char(as_of, 'YYYY-MM-DD') as as_of, payload
       from ru_sync_snapshots
      where tenant_id = ? and organization_id = ? and endpoint = ?
      order by as_of desc`,
    [scope.tenantId, scope.organizationId, 'plan'],
  )) as Array<{ as_of: string; payload: Record<string, unknown> }>
  if (rows.length === 0) return null
  const asOf = rows[0].as_of
  return { asOf, rows: rows.filter((row) => row.as_of === asOf).map((row) => row.payload) }
}

async function loadSkuDecisions(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<Map<string, SkuDecisionRow>> {
  const rows = (await em.fork().getConnection().execute<SkuDecisionRow[]>(
    `select ru_sku, status, product_id from ru_sync_sku_map
      where tenant_id = ? and organization_id = ?`,
    [scope.tenantId, scope.organizationId],
  )) as SkuDecisionRow[]
  const byKey = new Map<string, SkuDecisionRow>()
  for (const row of rows) {
    byKey.set(String(row.ru_sku), row)
    // A plan row is matched by its canonical comparison key too, so `pk44` in a snapshot finds the
    // decision recorded for `PK44` without a second mapping table.
    const key = matchKey(String(row.ru_sku))
    if (!byKey.has(key)) byKey.set(key, row)
  }
  return byKey
}

function readDecimal(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return value
  return null
}

function readAmount(value: unknown): { amount: string; currency: string } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { amount?: unknown; currency?: unknown }
  if (typeof record.amount !== 'string' || typeof record.currency !== 'string') return null
  const parsed = parseExactDecimal(record.amount)
  if (!parsed) return null
  return { amount: toAmountString(parsed, AMOUNT_SCALE), currency: record.currency }
}

registerCommand(draftPosCommand)

export { draftPosCommand }
