import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { XLSX_CONTENT_TYPE } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { TradeDocsDocument } from '../../../../data/entities'
import { tradeDocsErrorSchema, tradeDocsTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['trade_docs.documents.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Streams the generated PI/CI document.
 *
 * The route resolves the **document** first (feature gate + organization scope), then reads the
 * attachment row inside that same scope, then reads the bytes through the platform's storage
 * driver. It does not redirect to `/api/attachments/file/...`: that route answers with
 * `application/octet-stream` for a spreadsheet, while a document download must arrive as
 * `XLSX_CONTENT_TYPE` so the client can verify what it saved. Access is therefore checked twice —
 * the document must be visible to the caller and the attachment must belong to the document's own
 * organization.
 */
export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })

  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationIds = scope.filterIds && scope.filterIds.length > 0
    ? scope.filterIds
    : scope.selectedId
      ? [scope.selectedId]
      : []
  if (organizationIds.length === 0) {
    return NextResponse.json({ error: 'Select an organization to access this resource' }, { status: 400 })
  }

  const document = await em.fork().findOne(TradeDocsDocument, {
    id: parse.data.id,
    tenantId,
    organizationId: { $in: organizationIds },
    deletedAt: null,
  })
  if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const attachmentId = document.generatedAttachmentId
  if (!attachmentId) {
    return NextResponse.json({ error: 'No document has been generated for this document yet' }, { status: 404 })
  }

  const attachment = await em.fork().findOne(Attachment, {
    id: attachmentId,
    tenantId: document.tenantId,
    organizationId: document.organizationId,
  })
  if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const partition = await em.fork().findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) return NextResponse.json({ error: 'Partition misconfigured' }, { status: 500 })

  const driver = await new StorageDriverFactory(em).resolveForPartition(attachment.partitionCode, {
    tenantId: document.tenantId,
    organizationId: document.organizationId,
  })

  let buffer: Buffer
  try {
    const result = await driver.read(attachment.partitionCode, attachment.storagePath)
    buffer = result.buffer
  } catch {
    return NextResponse.json({ error: 'File not available' }, { status: 404 })
  }

  const fileName = attachment.fileName || `${document.number ?? 'document'}.xlsx`
  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=60',
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${fileName.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
  }
  if (attachment.fileSize > 0) headers['Content-Length'] = String(attachment.fileSize)

  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

export const openApi: OpenApiRouteDoc = {
  tag: tradeDocsTag,
  summary: 'Download the generated PI/CI document',
  methods: {
    GET: {
      summary: 'Download document file',
      description:
        'Streams the XLSX document generated for a PI/CI. The document must be visible to the caller, and the file must have been generated first.',
      responses: [
        {
          status: 200,
          description: 'XLSX document',
          schema: z.any().describe('Binary XLSX content'),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid document id or no organization selected', schema: tradeDocsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tradeDocsErrorSchema },
        { status: 404, description: 'Document not found, or no document generated yet', schema: tradeDocsErrorSchema },
      ],
    },
  },
}
