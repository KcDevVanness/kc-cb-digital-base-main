import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadCompanyOrderAttachments } from '../../../lib/companyOrderAttachments'
import { resolveOrderHubRequestScope } from '../../../lib/requestScope'
import { orderHubTag } from '../../openapi'

/**
 * The files of one company order (REQ-018).
 *
 * A hand-written guarded read route: the installed `attachments` list scopes by the caller's own
 * organization, so a collaborating organization reads nothing. This route keeps the tenant scope and
 * authorizes on the **root** (owner or collaborator), so the hub's files block works for both. An
 * unknown or invisible root answers an empty list — never a 404 that would confirm a foreign id.
 */

const logger = createLogger('order_hub').child({ component: 'attachments-route' })

const attachmentItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  createdAt: z.string(),
})

const attachmentsResponseSchema = z.object({
  items: z.array(attachmentItemSchema),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
}

const attachmentsQuerySchema = z.object({
  companyOrderId: z.string().uuid(),
})

export async function GET(request: Request) {
  const scope = await resolveOrderHubRequestScope(request)
  if (!scope.ok) return scope.response

  const url = new URL(request.url)
  const parsed = attachmentsQuerySchema.safeParse({
    companyOrderId: url.searchParams.get('companyOrderId') ?? '',
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'The companyOrderId parameter is required' }, { status: 400 })
  }

  try {
    const items = await loadCompanyOrderAttachments(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      parsed.data.companyOrderId,
    )
    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Failed to list the company order files', { err: error })
    return NextResponse.json({ error: 'Failed to list the company order files' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orderHubTag,
  summary: 'Company order files',
  methods: {
    GET: {
      summary: 'List the files of a company order',
      description:
        'Returns the files filed under one company order (`entityId=order_hub:company_order`, `recordId=<companyOrderId>`), newest first. Authorization follows the root: the owner organization and any collaborating organization may read; a root outside that scope answers an empty list.',
      query: attachmentsQuerySchema,
      responses: [
        { status: 200, description: 'The company order files, or an empty list when the root is not visible', schema: attachmentsResponseSchema },
        { status: 400, description: 'Missing or malformed companyOrderId' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.view' },
      ],
    },
  },
}
