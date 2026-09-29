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

/**
 * Generates (or regenerates) the PI/CI document.
 *
 * The command owns the render and the attachment write; this handler only resolves the caller's
 * scope and hands the command its runtime context, exactly like the transitions route does through
 * the CRUD factory. Access is checked twice: the document must be visible to the caller, and the
 * command re-resolves it inside the caller's organization before rendering.
 */
export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })

  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    const { result } = await commandBus.execute<Record<string, unknown>, { attachmentId: string; fileName: string }>(
      'trade_docs.documents.generate-document',
      {
        input: { id: parse.data.id },
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
    return NextResponse.json({ attachmentId: result.attachmentId, fileName: result.fileName })
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 400
    // A parent-organization user sees its subsidiaries' documents in the list but acts only in the
    // organization it selected. Without this check the answer would be a bare "Document not found",
    // which reads like the document vanished; say what actually has to change.
    if (status === 404) {
      const visibleElsewhere = await (container.resolve('em') as EntityManager).fork().findOne(TradeDocsDocument, {
        id: parse.data.id,
        tenantId,
        organizationId: { $in: organizationIds.filter((id) => id !== organizationId) },
        deletedAt: null,
      })
      if (visibleElsewhere) {
        return NextResponse.json(
          {
            error: 'This document belongs to another organization; switch to that organization to generate its document',
            code: 'document_in_another_organization',
          },
          { status: 403 },
        )
      }
    }
    const body = (error as { body?: unknown }).body ?? (error as { message?: string }).message ?? 'Could not generate the document'
    return NextResponse.json(body as Record<string, unknown>, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: tradeDocsTag,
  summary: 'Generate the PI/CI document',
  methods: {
    POST: {
      summary: 'Generate the document',
      description:
        'Renders the PI/CI document to XLSX, stores it as an attachment on the document and points the document at it. A draft or voided document cannot produce a document.',
      responses: [
        {
          status: 200,
          description: 'Generated document reference',
          schema: z.object({ attachmentId: z.string().uuid(), fileName: z.string() }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid document id or no organization selected', schema: tradeDocsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tradeDocsErrorSchema },
        { status: 404, description: 'Document not found', schema: tradeDocsErrorSchema },
        { status: 409, description: 'The document version is stale', schema: tradeDocsErrorSchema },
        { status: 422, description: 'The document is a draft or was voided', schema: tradeDocsErrorSchema },
      ],
    },
  },
}
