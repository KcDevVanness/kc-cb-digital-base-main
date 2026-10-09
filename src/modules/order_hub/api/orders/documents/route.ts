import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CompanyOrderDocument } from '../../../data/entities'
import {
  COMPANY_ORDER_DOCUMENT_SLOTS,
  companyOrderDocumentAttachSchema,
  companyOrderDocumentDeleteSchema,
  companyOrderDocumentsListSchema,
} from '../../../data/validators'
import { isCompanyOrderVisibleToScope } from '../../../lib/companyOrderAttachments'
import { resolveOrderHubRequestScope } from '../../../lib/requestScope'
import { COMPANY_ORDER_DOCUMENT_ENTITY_ID } from '../../../commands/companyOrderDocuments'
import { orderHubTag } from '../../openapi'

/**
 * The document slots of one company order (REQ-021).
 *
 * A hand-written guarded route (the `fields` read route / `link-child` action route style): the list
 * joins the module's own slot rows to the installed `attachments` metadata (which the CRUD factory
 * cannot project), and the two writes are owner-only commands with no CRUD table semantics of their
 * own.
 *
 * - `GET ?companyOrderId=` — the slot rows of one root, authorized by the root's **visibility**
 *   (owner organization or a listed collaborator). A `fileSize`/`mimeType` is read live from the
 *   attachment; when the attachment row is gone the frozen `fileName` still names the file and the
 *   row is flagged `missing`. An invisible or unknown root answers an empty list — never a 404 that
 *   would confirm a foreign id exists.
 * - `POST` — registers one stored attachment into a slot (`order_hub.orders.documents.attach`).
 *   Owner-only; 422 for a foreign/unrelated attachment; 409 for a duplicate registration.
 * - `DELETE ?id=` — detaches one slot row (`order_hub.orders.documents.detach`). Owner-only; the
 *   caller deletes the stored bytes separately through the installed attachments route.
 */

const logger = createLogger('order_hub').child({ component: 'documents-route' })

const documentItemSchema = z.object({
  id: z.string().uuid(),
  companyOrderId: z.string().uuid(),
  slot: z.enum(COMPANY_ORDER_DOCUMENT_SLOTS),
  attachmentId: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative().nullable(),
  mimeType: z.string().nullable(),
  createdAt: z.string().nullable(),
  missing: z.boolean(),
})

const documentsResponseSchema = z.object({
  items: z.array(documentItemSchema),
})

const attachResponseSchema = z.object({
  ok: z.literal(true),
  item: documentItemSchema,
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
  POST: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
}

type DocumentRow = {
  id: string
  companyOrderId: string
  slot: string
  attachmentId: string
  fileName: string
  createdAt: string | null
}

/**
 * Joins the module's slot rows to the live attachment metadata. `fileName` always comes from the
 * frozen column so the row still names the file after the attachment is gone (`missing: true`).
 */
async function projectDocuments(
  em: EntityManager,
  tenantId: string,
  companyOrderId: string,
): Promise<z.infer<typeof documentItemSchema>[]> {
  const rows = await em.fork().find(
    CompanyOrderDocument,
    { tenantId, companyOrder: { id: companyOrderId } } as FilterQuery<CompanyOrderDocument>,
    { orderBy: { createdAt: 'asc' } },
  )
  if (rows.length === 0) return []

  const attachmentIds = rows.map((row) => String(row.attachmentId))
  const attachments = await em.fork().find(Attachment, {
    tenantId,
    id: { $in: attachmentIds },
  } as FilterQuery<Attachment>)
  const byId = new Map(attachments.map((attachment) => [String(attachment.id), attachment]))

  return rows.map((row) => {
    const attachment = byId.get(String(row.attachmentId))
    const snapshot: DocumentRow = {
      id: String(row.id),
      companyOrderId: String(row.companyOrder.id),
      slot: row.slot,
      attachmentId: String(row.attachmentId),
      fileName: row.fileName,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    }
    return {
      id: snapshot.id,
      companyOrderId: snapshot.companyOrderId,
      slot: snapshot.slot as (typeof COMPANY_ORDER_DOCUMENT_SLOTS)[number],
      attachmentId: snapshot.attachmentId,
      fileName: snapshot.fileName,
      fileSize: attachment ? Number(attachment.fileSize) : null,
      mimeType: attachment ? attachment.mimeType ?? null : null,
      createdAt: snapshot.createdAt,
      missing: !attachment,
    }
  })
}

export async function GET(request: Request) {
  const scope = await resolveOrderHubRequestScope(request)
  if (!scope.ok) return scope.response

  const url = new URL(request.url)
  const parsed = companyOrderDocumentsListSchema.safeParse({
    companyOrderId: url.searchParams.get('companyOrderId') ?? '',
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'The companyOrderId parameter is required' }, { status: 400 })
  }

  try {
    const visible = await isCompanyOrderVisibleToScope(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      parsed.data.companyOrderId,
    )
    // An invisible root is an empty list, not a 404: the response must not confirm a foreign id.
    if (!visible) return NextResponse.json({ items: [] })
    const items = await projectDocuments(scope.em, scope.tenantId, parsed.data.companyOrderId)
    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Failed to list the company order documents', { err: error })
    return NextResponse.json({ error: 'Failed to list the company order documents' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  try {
    const body = (await request.json()) as Record<string, unknown>
    const parsed = companyOrderDocumentAttachSchema.parse(body)

    const guards = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      },
      input: {
        resourceKind: 'order_hub.company_order.document',
        resourceId: parsed.companyOrderId,
        operation: 'create',
        mutationPayload: parsed as unknown as Record<string, unknown>,
      },
    })
    if (!guards.ok) return guards.response

    const input = { ...(parsed as unknown as Record<string, unknown>), ...(guards.modifiedPayload ?? {}) }
    const commandBus = container.resolve('commandBus') as {
      execute: (id: string, options: { input: unknown; ctx: unknown }) => Promise<{ result?: unknown }>
    }
    const envelope = await commandBus.execute('order_hub.orders.documents.attach', {
      input,
      ctx: { container, auth, request, selectedOrganizationId: auth.orgId ?? null },
    })
    const created = envelope.result as CompanyOrderDocument | undefined
    if (!created) return NextResponse.json({ error: 'Registration failed' }, { status: 500 })

    await guards.runAfterSuccess()
    return NextResponse.json(
      {
        ok: true,
        item: {
          id: String(created.id),
          companyOrderId: String(created.companyOrder.id),
          slot: created.slot as (typeof COMPANY_ORDER_DOCUMENT_SLOTS)[number],
          attachmentId: String(created.attachmentId),
          fileName: created.fileName,
          fileSize: null,
          mimeType: null,
          createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : null,
          missing: false,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    return handleWriteError(error, 'Failed to register the company order document')
  }
}

export async function DELETE(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  try {
    const url = new URL(request.url)
    const parsed = companyOrderDocumentDeleteSchema.parse({ id: url.searchParams.get('id') ?? '' })

    const guards = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      },
      input: {
        resourceKind: 'order_hub.company_order.document',
        resourceId: parsed.id,
        operation: 'delete',
        mutationPayload: parsed as unknown as Record<string, unknown>,
      },
    })
    if (!guards.ok) return guards.response

    const commandBus = container.resolve('commandBus') as {
      execute: (id: string, options: { input: unknown; ctx: unknown }) => Promise<{ result?: unknown }>
    }
    await commandBus.execute('order_hub.orders.documents.detach', {
      input: parsed,
      ctx: { container, auth, request, selectedOrganizationId: auth.orgId ?? null },
    })

    await guards.runAfterSuccess()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleWriteError(error, 'Failed to detach the company order document')
  }
}

function handleWriteError(error: unknown, fallback: string): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
  }
  if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    const status = error.status as number
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status })
    }
  }
  logger.error(fallback, { err: error })
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export const openApi: OpenApiRouteDoc = {
  tag: orderHubTag,
  summary: 'Company order document slots',
  methods: {
    GET: {
      summary: 'List the document slots of a company order',
      description:
        'Returns the slot rows of one company order (each naming which 35-column document field the stored attachment belongs to). Authorization follows the root: the owner organization and any collaborating organization may read; a root outside that scope answers an empty list. A slot whose attachment row is gone keeps its frozen `fileName` and is flagged `missing: true`.',
      query: companyOrderDocumentsListSchema,
      responses: [
        { status: 200, description: 'The document slot rows, or an empty list when the root is not visible', schema: documentsResponseSchema },
        { status: 400, description: 'Missing or malformed companyOrderId' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.view' },
      ],
    },
    POST: {
      summary: 'Register a stored attachment into a document slot',
      description:
        'Registers one attachment — uploaded through the installed route with `entityId=order_hub:company_order_document` and `recordId=<id>` — into the named slot of a company order. Owner-organization only; a collaborator answers `company_order_owner_required`, an invisible root 404, a foreign/unrelated attachment 422 and a duplicate registration 409.',
      requestBody: { schema: companyOrderDocumentAttachSchema },
      responses: [
        { status: 201, description: 'The registered slot row', schema: attachResponseSchema },
        { status: 400, description: 'Invalid input' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.manage, or the caller is a collaborator' },
        { status: 404, description: 'Unknown or invisible company order' },
        { status: 409, description: 'The attachment is already registered for this slot' },
        { status: 422, description: 'The attachment is not a document slot file of this tenant' },
      ],
    },
    DELETE: {
      summary: 'Detach a document slot row',
      description:
        'Hard-deletes one slot row by its id. Owner-organization only; an unknown, invisible or collaborator-owned row answers 404 / 403 accordingly. The stored bytes are deleted separately through the installed attachments route.',
      query: companyOrderDocumentDeleteSchema,
      responses: [
        { status: 200, description: 'The row was detached', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Missing or malformed id' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.manage, or the caller is a collaborator' },
        { status: 404, description: 'Unknown or invisible document row' },
      ],
    },
  },
}
