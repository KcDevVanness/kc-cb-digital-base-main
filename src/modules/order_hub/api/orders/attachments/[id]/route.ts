import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import {
  buildAttachmentContentDisposition,
  canRenderInlineAttachment,
} from '@open-mercato/core/modules/attachments/lib/security'
import {
  COMPANY_ORDER_ATTACHMENT_ENTITY_ID,
  isCompanyOrderVisibleToScope,
} from '../../../../lib/companyOrderAttachments'
import { resolveOrderHubRequestScope } from '../../../../lib/requestScope'
import { orderHubTag } from '../../../openapi'

/**
 * Bytes of one company-order file (REQ-018).
 *
 * The installed `/api/attachments/file/[id]` route scopes its row by the caller's own organization,
 * so a collaborating organization cannot download the owner's files. This proxy instead resolves the
 * attachment inside the **tenant** only, refuses anything that is not filed under this module's root
 * entity, and then authorizes on the **root** (owner or collaborator). Unknown id, foreign entity or
 * an invisible root all answer 404 — the route never leaks that a foreign attachment exists.
 *
 * The bytes and headers come from the same platform pieces the installed route uses (the storage
 * driver factory and the shared content-disposition/inline helpers), so a file downloads identically
 * whichever route served it.
 */

const logger = createLogger('order_hub').child({ component: 'attachment-file-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(request: Request, context: { params?: { id?: string } }) {
  const scope = await resolveOrderHubRequestScope(request)
  if (!scope.ok) return scope.response

  const parsed = paramsSchema.safeParse({ id: context.params?.id ?? '' })
  if (!parsed.success) return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })

  try {
    const em = scope.em
    const attachment = await em.findOne(Attachment, {
      id: parsed.data.id,
      tenantId: scope.tenantId,
    })
    if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

    // This proxy serves exactly one entity: a wrong entity is indistinguishable from an unknown id.
    if (attachment.entityId !== COMPANY_ORDER_ATTACHMENT_ENTITY_ID) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    const visible = await isCompanyOrderVisibleToScope(
      em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      String(attachment.recordId),
    )
    if (!visible) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

    const partition = await em.findOne(AttachmentPartition, { code: attachment.partitionCode })
    if (!partition) return NextResponse.json({ error: 'Partition misconfigured' }, { status: 500 })

    const driver = await new StorageDriverFactory(em).resolveForPartition(attachment.partitionCode, {
      tenantId: attachment.tenantId ?? '',
      organizationId: attachment.organizationId ?? '',
    })
    let buffer: Buffer
    try {
      buffer = (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer
    } catch {
      return NextResponse.json({ error: 'File not available' }, { status: 404 })
    }

    const url = new URL(request.url)
    const forceDownload = url.searchParams.get('download') === '1'
    const renderInline = !forceDownload && canRenderInlineAttachment(attachment.mimeType)
    const headers: Record<string, string> = {
      'Cache-Control': partition.isPublic ? 'public, max-age=86400' : 'private, max-age=60',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': renderInline
        ? attachment.mimeType || 'application/octet-stream'
        : 'application/octet-stream',
      'Content-Disposition': buildAttachmentContentDisposition(
        attachment.fileName,
        renderInline ? 'inline' : 'attachment',
      ),
      'X-Content-Type-Options': 'nosniff',
    }
    if (attachment.fileSize > 0) headers['Content-Length'] = String(attachment.fileSize)

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
  } catch (error) {
    logger.error('Failed to stream the company order file', { err: error })
    return NextResponse.json({ error: 'Failed to stream the company order file' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orderHubTag,
  summary: 'Company order file bytes',
  methods: {
    GET: {
      summary: 'Stream one company-order file',
      description:
        'Returns the raw bytes of a file filed under a company order, authorized by the root’s visibility (owner or collaborating organization). `?download=1` forces an attachment disposition. An unknown id, a non-company-order attachment or an invisible root all answer 404.',
      responses: [
        { status: 200, description: 'File content with the platform’s attachment headers', schema: z.any().describe('Binary file content') },
        { status: 400, description: 'Missing or malformed attachment id' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.view' },
        { status: 404, description: 'Unknown attachment, wrong entity, or invisible root' },
      ],
    },
  },
}
