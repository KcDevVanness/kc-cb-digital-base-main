import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ExportFinanceCollection } from '../../data/entities'
import { collectionSaveSchema, EXPORT_FINANCE_COLLECTION_STATUSES } from '../../data/validators'
import { resolveRequestScope } from '../../lib/requestScope'
import { createExportFinanceCrudOpenApi, exportFinanceCreatedSchema } from '../openapi'

const ENTITY_ID = 'export_finance:export_finance_collection' as const

const logger = createLogger('export_finance').child({ component: 'collections-route' })

const collectionReadSchema = z.object({
  purchaseOrderId: z.string().uuid(),
})

const collectionItemSchema = z
  .object({
    id: z.string().uuid(),
    purchaseOrderId: z.string().uuid(),
    purchaseOrderNumber: z.string().nullable().optional(),
    currencyCode: z.string(),
    collectionStatus: z.enum(EXPORT_FINANCE_COLLECTION_STATUSES),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

function toIsoTimestamp(value: Date | null | undefined): string | null {
  if (!value) return null
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function toCollectionItem(collection: ExportFinanceCollection) {
  return {
    id: String(collection.id),
    purchaseOrderId: String(collection.purchaseOrderId),
    purchaseOrderNumber: collection.purchaseOrderNumber ?? null,
    currencyCode: collection.currencyCode,
    collectionStatus: collection.collectionStatus,
    createdAt: toIsoTimestamp(collection.createdAt),
    updatedAt: toIsoTimestamp(collection.updatedAt),
  }
}

/**
 * One order's 收汇档案, or `null` when it has none — `null` is the honest answer for "nobody has
 * answered 是否已收款 yet", so the page never renders a missing record as "not received".
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = collectionReadSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const collection = await scope.em.findOne(ExportFinanceCollection, {
      tenantId: scope.tenantId,
      organizationId: { $in: scope.organizationIds },
      purchaseOrderId: query.purchaseOrderId,
      deletedAt: null,
    } as FilterQuery<ExportFinanceCollection>)
    return NextResponse.json({ item: collection ? toCollectionItem(collection) : null })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to load the collection record', { err: error })
    return NextResponse.json({ error: 'Failed to load the collection record' }, { status: 500 })
  }
}

/**
 * The save action reuses the CRUD factory so auth, feature gating, mutation guards and audit
 * logging share one path with every other module; the command owns the upsert and the
 * optimistic lock. The route's own list surface is not part of the UI contract (the anchors are
 * read through this GET and through the order-file projection), it exists because the factory
 * binds scope through an ORM entity.
 */
export const { PUT } = makeCrudRoute({
  metadata: {
    PUT: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
  },
  orm: {
    entity: ExportFinanceCollection,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: collectionReadSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'purchase_order_id', 'collection_status', 'tenant_id', 'organization_id'],
  },
  actions: {
    update: {
      commandId: 'export_finance.collections.save',
      schema: collectionSaveSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
    },
  },
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['export_finance.orders.view'] },
  PUT: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
}

export const openApi = createExportFinanceCrudOpenApi({
  resourceName: 'Collection Record',
  pluralName: 'Collection Records',
  querySchema: collectionReadSchema,
  listResponseSchema: z.object({ item: collectionItemSchema.nullable() }),
  update: {
    schema: collectionSaveSchema,
    responseSchema: exportFinanceCreatedSchema,
    description:
      'Upserts the 收汇档案 of one purchase order; the record is created on first save and updated afterwards.',
  },
})
