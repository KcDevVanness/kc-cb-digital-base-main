import { describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CompanyOrder, CompanyOrderLink } from '../../data/entities'
import {
  createCompanyOrderCommand,
  deleteCompanyOrderCommand,
  linkChildCommand,
  replaceCompanyOrderLinksCommand,
  updateCompanyOrderCommand,
} from '../companyOrders'
import {
  linkChild,
  loadCompanyOrderRefs,
  persistCompanyOrderLink,
  type CompanyOrderRef,
} from '../../lib/companyOrder'
import { eventsConfig } from '../../events'
import { invalidateCompanyOrderLinkCaches } from '../../lib/cacheInvalidation'

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => Promise<void> | void>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('../../lib/cacheInvalidation', () => ({
  invalidateCompanyOrderCaches: jest.fn(async () => undefined),
  invalidateCompanyOrderLinkCaches: jest.fn(async () => undefined),
}))

jest.mock('../../events', () => ({
  eventsConfig: { emit: jest.fn(async () => undefined) },
}))

jest.mock('../../lib/companyOrder', () => {
  const actual = jest.requireActual<Record<string, unknown>>('../../lib/companyOrder')
  return {
    ...actual,
    loadCompanyOrderRefs: jest.fn(),
    persistCompanyOrderLink: jest.fn(),
    linkChild: jest.fn(),
    loadCompanyOrder: jest.fn(),
  }
})

jest.mock('../../lib/companyOrderNumber', () => {
  const actual = jest.requireActual<Record<string, unknown>>('../../lib/companyOrderNumber')
  let sequence = 0
  return {
    ...actual,
    nextCompanyOrderNumber: jest.fn(async () => {
      sequence += 1
      return `CO-2026-${String(sequence).padStart(4, '0')}`
    }),
  }
})

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const REF_A = '22222222-2222-4222-8222-222222222222'
const REF_B = '33333333-3333-4333-8333-333333333333'

type OrderRow = {
  id: string
  tenantId: string
  organizationId: string
  number: string
  title: string | null
  orderDate: Date
  etaDate: Date | null
  status: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type OrderSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  number: string
  title: string | null
  orderDate: string
  etaDate: string | null
  status: string
  notes: string | null
}

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    number: 'CO-2026-0001',
    title: 'Order A',
    orderDate: new Date('2026-01-01T00:00:00.000Z'),
    etaDate: null,
    status: 'draft',
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: ORDER_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    number: 'CO-2026-0001',
    title: 'Order A',
    orderDate: '2026-01-01',
    etaDate: null,
    status: 'draft',
    notes: null,
    ...overrides,
  }
}

function makeRef(refId: string, kind: CompanyOrderRef['kind'] = 'purchase_order'): CompanyOrderRef {
  return {
    kind,
    id: refId,
    number: 'PO-9',
    counterparty: 'Supplier',
    status: 'draft',
    createdAt: null,
    currencyCode: 'CNY',
    totalGross: '10.00',
  }
}

type ScopedEmMocks = {
  create: jest.Mock<(...args: unknown[]) => Record<string, unknown>>
  persist: jest.Mock<(...args: unknown[]) => unknown>
  flush: jest.Mock<() => Promise<void>>
  findOne: jest.Mock<(...args: unknown[]) => Promise<OrderRow | null>>
  nativeDelete: jest.Mock<(...args: unknown[]) => Promise<number>>
}

type EmMocks = {
  fork: jest.Mock<() => ScopedEmMocks>
  create: jest.Mock<(...args: unknown[]) => Record<string, unknown>>
  persist: jest.Mock<(...args: unknown[]) => unknown>
  flush: jest.Mock<() => Promise<void>>
  findOne: jest.Mock<(...args: unknown[]) => Promise<OrderRow | null>>
  nativeDelete: jest.Mock<(...args: unknown[]) => Promise<number>>
}

type DeMocks = {
  markOrmEntityChange: jest.Mock<(...args: unknown[]) => void>
  createOrmEntity: jest.Mock<(...args: unknown[]) => Promise<OrderRow>>
  // The command passes `{ entity, where, apply }`; the index signature keeps that literal assignable.
  updateOrmEntity: jest.Mock<(args: { apply: (entity: OrderRow) => void; [key: string]: unknown }) => Promise<OrderRow>>
  deleteOrmEntity: jest.Mock<(...args: unknown[]) => Promise<unknown>>
}

function createHarness() {
  const scoped: ScopedEmMocks = {
    create: jest.fn((...args: unknown[]) => {
      const data = args[1]
      return { ...(data && typeof data === 'object' ? data : {}), id: ORDER_ID }
    }),
    persist: jest.fn(() => scoped),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => 0),
  }

  const em: EmMocks = {
    fork: jest.fn(() => scoped),
    create: jest.fn((...args: unknown[]) => {
      const data = args[1]
      return { ...(data && typeof data === 'object' ? data : {}), id: ORDER_ID }
    }),
    persist: jest.fn(() => em),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => 0),
  }

  const de: DeMocks = {
    markOrmEntityChange: jest.fn(),
    createOrmEntity: jest.fn(async () => makeOrder()),
    updateOrmEntity: jest.fn(async () => makeOrder()),
    deleteOrmEntity: jest.fn(async () => makeOrder()),
  }

  const container = {
    resolve: (key: string) => (key === 'dataEngine' ? de : em),
  }
  const ctx = {
    auth: { tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
    container,
    request: null,
  } as unknown as CommandRuntimeContext

  return { ctx, em, scoped, de }
}

describe('order_hub company order commands', () => {
  it('create resolves the mocked number sequence and its undo soft-deletes the row', async () => {
    const { ctx, de } = createHarness()

    const order = await createCompanyOrderCommand.execute({ title: 'Deal' }, ctx)
    expect(order.number).toBe('CO-2026-0001')

    de.deleteOrmEntity.mockResolvedValue(order)
    await createCompanyOrderCommand.undo?.({
      input: { title: 'Deal' },
      ctx,
      logEntry: { snapshotAfter: makeSnapshot() },
    })

    expect(de.deleteOrmEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: CompanyOrder,
        soft: true,
        softDeleteField: 'deletedAt',
      }),
    )
  })

  it('update rejects a stale version with 409 and applies a matching one', async () => {
    const { ctx, scoped, de } = createHarness()
    scoped.findOne.mockResolvedValue(makeOrder())

    await expect(
      updateCompanyOrderCommand.execute(
        { id: ORDER_ID, updatedAt: '2026-09-01T00:00:00.000Z', title: 'New' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 409 })

    de.updateOrmEntity.mockImplementation(async (args: { apply: (entity: OrderRow) => void }) => {
      const entity = makeOrder()
      args.apply(entity)
      return entity
    })
    const updated = await updateCompanyOrderCommand.execute(
      { id: ORDER_ID, updatedAt: '2026-10-01T00:00:00.000Z', title: 'New' },
      ctx,
    )
    expect(updated.title).toBe('New')
  })

  it('update undo restores the before-snapshot fields through updateOrmEntity apply', async () => {
    const { ctx, de } = createHarness()
    const applied = makeOrder({ title: 'New', status: 'completed', etaDate: new Date('2026-05-01T00:00:00.000Z') })
    de.updateOrmEntity.mockImplementation(async (args: { apply: (entity: OrderRow) => void }) => {
      args.apply(applied)
      return applied
    })

    await updateCompanyOrderCommand.undo?.({
      input: { id: ORDER_ID },
      ctx,
      logEntry: { snapshotBefore: makeSnapshot({ title: 'Old', status: 'draft', etaDate: null }) },
    })

    expect(applied.title).toBe('Old')
    expect(applied.status).toBe('draft')
    expect(applied.etaDate).toBeNull()
  })

  it('delete undo clears deletedAt on the surviving row and restores the header', async () => {
    const { ctx, em } = createHarness()
    const surviving = makeOrder({ deletedAt: new Date(), title: 'Deleted', status: 'cancelled' })
    em.findOne.mockResolvedValue(surviving)

    await deleteCompanyOrderCommand.undo?.({
      input: { body: { id: ORDER_ID } },
      ctx,
      logEntry: { snapshotBefore: makeSnapshot({ title: 'Kept', status: 'draft' }) },
    })

    expect(surviving.deletedAt).toBeNull()
    expect(surviving.title).toBe('Kept')
    expect(surviving.status).toBe('draft')
    expect(em.persist).toHaveBeenCalledWith(surviving)
    expect(em.flush).toHaveBeenCalled()
  })

  it('links.replace rejects duplicate refIds with 422', async () => {
    const { ctx, scoped } = createHarness()
    scoped.findOne.mockResolvedValue(makeOrder())

    await expect(
      replaceCompanyOrderLinksCommand.execute(
        { companyOrderId: ORDER_ID, kind: 'purchase_order', refs: [{ refId: REF_A }, { refId: REF_A }] },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('links.replace rejects a ref outside the resolved scope with 422', async () => {
    const { ctx, scoped } = createHarness()
    scoped.findOne.mockResolvedValue(makeOrder())
    jest.mocked(loadCompanyOrderRefs).mockResolvedValue(new Map())

    await expect(
      replaceCompanyOrderLinksCommand.execute(
        { companyOrderId: ORDER_ID, kind: 'purchase_order', refs: [{ refId: REF_A }] },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('links.replace rewrites the set and returns the refIds with a count', async () => {
    const { ctx, scoped, em } = createHarness()
    scoped.findOne.mockResolvedValue(makeOrder())
    jest.mocked(loadCompanyOrderRefs).mockResolvedValue(
      new Map([
        [`purchase_order:${REF_A}`, makeRef(REF_A)],
        [`purchase_order:${REF_B}`, makeRef(REF_B)],
      ]),
    )

    const result = await replaceCompanyOrderLinksCommand.execute(
      { companyOrderId: ORDER_ID, kind: 'purchase_order', refs: [{ refId: REF_A }, { refId: REF_B }] },
      ctx,
    )

    expect(result.refIds).toEqual([REF_A, REF_B])
    expect(result.refIds).toHaveLength(2)
    expect(result.kind).toBe('purchase_order')
    expect(em.nativeDelete).toHaveBeenCalledWith(CompanyOrderLink, expect.objectContaining({ kind: 'purchase_order' }))
    expect(jest.mocked(persistCompanyOrderLink)).toHaveBeenCalledTimes(2)
    expect(jest.mocked(eventsConfig.emit)).toHaveBeenCalledWith(
      'order_hub.company_order.links.updated',
      expect.objectContaining({ count: 2, kind: 'purchase_order' }),
    )
    expect(jest.mocked(invalidateCompanyOrderLinkCaches)).toHaveBeenCalled()
  })

  it('link-child returns the resolved outcome from the injected linkChild', async () => {
    const { ctx } = createHarness()
    const outcome = { companyOrderId: ORDER_ID, linked: true, created: true }
    jest.mocked(linkChild).mockResolvedValue(outcome)

    const result = await linkChildCommand.execute({ kind: 'purchase_order', refId: REF_A }, ctx)

    expect(result).toEqual(outcome)
    expect(jest.mocked(linkChild)).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      { kind: 'purchase_order', refId: REF_A },
    )
  })
})
