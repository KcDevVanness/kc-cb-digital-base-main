import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * The historical backfill (`src/modules/order_hub/cli.ts`, `backfill-company-orders`).
 *
 * Owner decision Q-002 of `.ai/specs/2026-10-09-company-order-root.md`: every sales order that
 * already carries a trade-type channel becomes a 1:1 company order so the workbench is not empty and
 * old URLs resolve. The command is dry-run by default; `--apply` writes; a second `--apply` is
 * idempotent and reports `created=0`.
 *
 * ASSUMPTION — the CLI is invoked through `yarn mercato` from the repository root, mirroring the
 * repo's existing integration CLI pattern (`src/modules/storage_ops/__integration__/helpers.ts`
 * `runStorageOps`): `execFileSync('yarn', ['mercato', 'order_hub', 'backfill-company-orders', ...])`
 * with `cwd: process.cwd()` and `env: process.env` inherited from Playwright (the ephemeral harness
 * exports `DATABASE_URL` to the test process, so the child boots against the same database the API
 * server uses). The command prints human-readable log lines, so assertions parse the `totals:` line.
 */

const ORDERS_URL = '/api/order_hub/orders'
const LINKS_URL = '/api/order_hub/orders/links'
const NUMBER_PATTERN = /^CO-\d{4}-\d{4}$/
const CLI_TIMEOUT_MS = 180_000

type IdPayload = { id?: string }
type ListPayload<T> = { items?: T[] }
type LinkRow = { companyOrderId: string; kind: string; refId: string }
type CompanyOrderRow = { id: string; number: string; status?: string | null }
type ChannelPayload = { channels?: { internal?: string | null; external?: string | null } }
type CliRun = { stdout: string; status: number }

const runBackfill = (args: string[]): CliRun => {
  try {
    const stdout = execFileSync('yarn', ['mercato', 'order_hub', 'backfill-company-orders', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLI_TIMEOUT_MS,
    })
    return { stdout, status: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, status: failure.status ?? 1 }
  }
}

/** The `totals:` line is the last summary line; `label` selects its `would-create=`/`created=` field. */
const readTotals = (stdout: string, label: 'created' | 'would-create'): number => {
  const line = stdout.split('\n').find((entry) => entry.includes('totals:')) ?? ''
  const match = line.match(new RegExp(`${label}=(\\d+)`))
  return match ? Number(match[1]) : Number.NaN
}

test.describe.serial('order_hub — company order backfill', () => {
  let api: APIRequestContext
  let rootToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let salesOrderId = ''
  const createdCompanyOrderIds: string[] = []

  const stamp = Date.now().toString(36)

  const scoped = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: rootToken, selectedOrgId: hqOrgId, data })

  const listLinks = async (query: string): Promise<LinkRow[]> => {
    const response = await scoped('GET', `${LINKS_URL}?${query}`)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<LinkRow>>(response))?.items ?? []
  }

  const readCompanyOrder = async (id: string): Promise<CompanyOrderRow | null> => {
    const response = await scoped('GET', `${ORDERS_URL}?id=${encodeURIComponent(id)}`)
    expect(response.status(), await response.text()).toBe(200)
    return (await readJsonSafe<ListPayload<CompanyOrderRow>>(response))?.items?.[0] ?? null
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const context = getTokenContext(rootToken)
    tenantId = context.tenantId
    hqOrgId = context.organizationId

    const channels = await scoped('GET', '/api/internal_sales/trade-type-channels/orders')
    const internalChannelId = String((await readJsonSafe<ChannelPayload>(channels))?.channels?.internal ?? '')
    expect(internalChannelId, 'the internal trade-type channel is seeded for this organization').toBeTruthy()

    const salesOrder = await scoped('POST', '/api/sales/orders', {
      currencyCode: 'CNY',
      channelId: internalChannelId,
      customerSnapshot: { name: `Backfill buyer ${stamp}`, internalSales: { organizationId: hqOrgId } },
      lines: [{ kind: 'product', name: `Backfill line ${stamp}`, currencyCode: 'CNY', quantity: 2, unitPriceNet: 15 }],
    })
    expect(salesOrder.status(), await salesOrder.text()).toBe(201)
    salesOrderId = String((await readJsonSafe<IdPayload>(salesOrder))?.id ?? '')
    expect(salesOrderId, 'the channel-marked sales order fixture resolved an id').toBeTruthy()

    // The marker must actually be on the row: the backfill selects channel-marked orders, so a
    // fixture whose channel silently failed to persist would make every assertion below vacuous.
    const verify = await scoped('GET', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`)
    const verifyRow = (await readJsonSafe<ListPayload<{ id: string; channelId?: string | null }>>(verify))?.items?.[0] ?? null
    expect(verifyRow?.channelId, 'the fixture row carries the trade-type channel marker').toBe(internalChannelId)
  })

  test.afterAll(async () => {
    for (const id of createdCompanyOrderIds) {
      await scoped('DELETE', `${ORDERS_URL}?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    if (salesOrderId) {
      await scoped('DELETE', `/api/sales/orders?id=${encodeURIComponent(salesOrderId)}`).catch(() => undefined)
    }
    await api.dispose()
  })

  test('a dry run reports the work and writes nothing', async () => {
    expect(await listLinks(`refId=${encodeURIComponent(salesOrderId)}`), 'no root is linked yet').toHaveLength(0)

    const run = runBackfill(['--tenant', tenantId, '--organization', hqOrgId])
    expect(run.status, run.stdout).toBe(0)
    expect(run.stdout, 'the dry run labels its count as would-create').toContain('would-create=')
    expect(readTotals(run.stdout, 'would-create'), 'the channel-marked fixture is reported').toBeGreaterThanOrEqual(1)

    expect(
      await listLinks(`refId=${encodeURIComponent(salesOrderId)}`),
      'a dry run must not write a link',
    ).toHaveLength(0)
  })

  test('--apply creates a 1:1 root for a channel-marked sales order', async () => {
    const run = runBackfill(['--tenant', tenantId, '--organization', hqOrgId, '--apply'])
    expect(run.status, run.stdout).toBe(0)

    const rows = await listLinks(`refId=${encodeURIComponent(salesOrderId)}`)
    expect(rows, `the channel-marked sales order now has exactly one root\n${run.stdout}`).toHaveLength(1)
    expect(rows[0]?.kind).toBe('internal_sales_order')
    const ownerId = rows[0]?.companyOrderId ?? ''
    expect(ownerId).toBeTruthy()
    createdCompanyOrderIds.push(ownerId)

    const root = await readCompanyOrder(ownerId)
    expect(root, 'the created root is readable back').toBeTruthy()
    expect(root?.number, 'the root carries a CO-<year>-<seq> number').toMatch(NUMBER_PATTERN)

    const ownerLinks = await listLinks(`companyOrderId=${encodeURIComponent(ownerId)}`)
    expect(ownerLinks, 'the root holds exactly the one source order').toHaveLength(1)
    expect(ownerLinks[0]?.refId).toBe(salesOrderId)
  })

  test('a second --apply is idempotent and reports created=0', async () => {
    const run = runBackfill(['--tenant', tenantId, '--organization', hqOrgId, '--apply'])
    expect(run.status, run.stdout).toBe(0)
    expect(readTotals(run.stdout, 'created'), 'nothing new is created on the second run').toBe(0)

    const rows = await listLinks(`refId=${encodeURIComponent(salesOrderId)}`)
    expect(rows, 'the source order still resolves to exactly one root').toHaveLength(1)
  })
})
