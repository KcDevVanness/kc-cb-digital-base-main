import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { loadRateRows, resolveCnyRate } from '../lib/rateLookup'

/**
 * The CNY equivalent of an installed surface's money amount, computed server-side.
 *
 * Why an enricher and not a client-side component: the installed `sales` tables expose injected columns
 * as **headless declarations** whose cell receives only `getValue()` — no row — so a column widget cannot
 * see an amount and a currency at once. The enricher computes the pair server-side, the column renders
 * the one value it can read (`.ai/guides/extensions.md` → Response Enrichers + Widget Injection).
 *
 * The output is deliberately **structured**, not a formatted string: `{ amount, rate, date, source }`
 * lets the column render the amount with the shared client formatter and print the rate line, and keeps
 * the server free of locale decisions.
 *
 * `cacheableOnListHit` stays at its fail-closed default: a rate changes independently of the order
 * record, so the enriched value must not be baked into the list cache entry.
 */

/**
 * The amount the business reads on a sales order — the gross total.
 *
 * Field names are the **transformed** ones: a CRUD route runs its `afterList` hook and `transformItem`
 * before enrichers (`shared/lib/crud/factory.ts`: "enrichers targeting this entity run after afterList
 * hook"), so the record an enricher receives is the camelCase item the list already renders — not the
 * raw snake_case row.
 */
const AMOUNT_FIELD = 'grandTotalGrossAmount'
const CURRENCY_FIELD = 'currencyCode'

export type CnyEquivalentValue = {
  /** The converted amount, as a decimal string (display only — never written back). */
  amount: string
  /** The order's own currency, so the column can name what was converted. */
  currencyCode: string
  /** CNY per one unit of `currencyCode`. */
  rate: string
  /** When the rate was published. */
  date: string
  source: string
}

type OrderRecord = Record<string, unknown> & { id: string }
type EnrichedOrder = OrderRecord & { _currency_policy: { cnyEquivalent: CnyEquivalentValue | null } }

function readAmount(record: OrderRecord): { currencyCode: string; amount: number } | null {
  const currencyCode = typeof record[CURRENCY_FIELD] === 'string' ? String(record[CURRENCY_FIELD]).trim().toUpperCase() : ''
  const rawAmount = record[AMOUNT_FIELD]
  const amount = typeof rawAmount === 'number' ? rawAmount : Number.parseFloat(String(rawAmount ?? ''))
  if (currencyCode.length !== 3 || !Number.isFinite(amount)) return null
  return { currencyCode, amount }
}

const enricher: ResponseEnricher<OrderRecord, { _currency_policy: { cnyEquivalent: CnyEquivalentValue | null } }> = {
  id: 'currency_policy.cny-equivalent:sales:sales_order',
  // The installed documents route publishes an enricher host for orders only
  // (`enrichers: binding.kind === 'order' ? … : undefined`), which is why this targets the order entity.
  targetEntity: 'sales:sales_order',
  features: ['currencies.view'],
  timeout: 1500,
  critical: false,
  /**
   * The detail path: one record, same rule as the list — the enriched field is present (`null` when the
   * currency has no stored rate), so a detail render never has to tell "absent" from "not converted".
   */
  async enrichOne(record, context: EnricherContext) {
    const [enriched] = await this.enrichMany!([record], context)
    return enriched
  },
  async enrichMany(records, context: EnricherContext): Promise<EnrichedOrder[]> {
    if (records.length === 0) return []

    const em = context.em as EntityManager
    const pairs = records.map((record) => readAmount(record))
    const codes = pairs
      .map((pair) => pair?.currencyCode)
      .filter((code): code is string => typeof code === 'string' && code.length > 0)

    // One scoped query for the whole page, then one direction decision per row. A page whose rows carry
    // no usable currency skips the read entirely and enriches to `null`.
    const rows = codes.length > 0
      ? await loadRateRows(
          em,
          { tenantId: context.tenantId, organizationId: context.organizationId },
          [...new Set(codes)],
        )
      : []

    return records.map((record, index) => {
      const pair = pairs[index]
      const rate = pair ? resolveCnyRate(pair.currencyCode, rows) : null
      return Object.assign(record, {
        _currency_policy: {
          cnyEquivalent: pair && rate
            ? {
                // Six decimals, the scale the app's money columns carry (`unit_price`/`numeric(18,6)`) —
                // a raw float product would put `672.2643879999999` on the wire.
                amount: (pair.amount * Number.parseFloat(rate.rate)).toFixed(6),
                currencyCode: pair.currencyCode,
                rate: rate.rate,
                date: rate.date.toISOString(),
                source: rate.source,
              }
            : null,
        },
      })
    })
  },
}

export const enrichers: ResponseEnricher[] = [enricher]

export default enrichers
