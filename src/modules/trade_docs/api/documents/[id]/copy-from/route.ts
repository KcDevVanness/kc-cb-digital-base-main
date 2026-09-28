import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { TradeDocsDocument } from '../../../../data/entities'
import { tradeDocsErrorSchema, tradeDocsTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({ sourceDocumentId: z.string().uuid() })

/**
 * Copies another document's head + lines into this draft document (PI → CI, or PI → PI).
 *
 * The command owns the read of the source document and the line replacement; this handler only
 * resolves the caller's scope and hands the command its runtime context, exactly like the
 * aggregate-lines route. Access is checked twice: the document must be visible to the caller, and
 * the command re-resolves both the target (and refuses a non-draft) and the source inside the
 * caller's organization. The copy is one-shot — it never becomes a live sync.
 */
export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })

  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown = {}
  try {
    rawBody = await req.json()
  } catch {
    rawBody = {}
  }
  const body = bodySchema.safeParse(rawBody ?? {})
  if (!body.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationIds = scope.filterIds && scope.filterIds.length > 0
    ? scope.filterIds
    : scope.selectedId
      ? [scope.selectedId]
      : []
  const organizationId = scope.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { id: string; lineCount: number }>(
      'trade_docs.documents.copy-from',
      {
        input: { id: parse.data.id, sourceDocumentId: body.data.sourceDocumentId },
        ctx: {
          container,
          auth,
          organizationScope: scope,
          selectedOrganizationId: organizationId,
          organizationIds: scope.filterIds ?? (auth.orgId ? [auth.orgId] : null),
          request: req,
        },
      },
    )
    return NextResponse.json({ ok: true, lineCount: result.lineCount })
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 400
    // A parent-organization user sees its subsidiaries' documents in the list but acts only in the
    // organization it selected; say what has to change rather than a bare "Document not found".
    if (status === 404) {
      const visibleElsewhere = await (container.resolve('em') as EntityManager).fork().findOne(TradeDocsDocument, {
        id: { $in: [parse.data.id, body.data.sourceDocumentId] },
        tenantId,
        organizationId: { $in: organizationIds.filter((id) => id !== organizationId) },
        deletedAt: null,
      })
      if (visibleElsewhere) {
        return NextResponse.json(
          {
            error: 'This document belongs to another organization; switch to that organization to copy it',
            code: 'document_in_another_organization',
          },
          { status: 403 },
        )
      }
    }
    const errorBody = (error as { body?: unknown }).body ?? (error as { message?: string }).message ?? 'Could not copy the document'
    return NextResponse.json(errorBody as Record<string, unknown>, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: tradeDocsTag,
  summary: 'Copy a trade document from another document',
  methods: {
    POST: {
      summary: 'Copy head and lines from the source document',
      description:
        'Replaces a draft document’s head fields and lines with the source document’s, keeping a source snapshot on every line and on the head. The source may be in any status; the copy is one-shot and never turns into a live sync. An issued or voided target cannot be edited.',
      responses: [
        {
          status: 200,
          description: 'The number of lines written',
          schema: z.object({ ok: z.literal(true), lineCount: z.number().int().nonnegative() }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid document id, body or source not found', schema: tradeDocsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tradeDocsErrorSchema },
        { status: 404, description: 'Document or source document not found', schema: tradeDocsErrorSchema },
        { status: 409, description: 'Only a draft document can be edited', schema: tradeDocsErrorSchema },
      ],
    },
  },
}
