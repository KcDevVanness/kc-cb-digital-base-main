import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { SourcingQuoteLine } from '../../../data/entities'
import { loadQuoteForSource } from '../../../lib/quoteSource'
import { serializeQuote } from '../../../commands/quotes'
import { sourcingErrorSchema, sourcingTag } from '../../openapi'

/**
 * One quotation with the counters the review console needs.
 *
 * The list route already accepts `?id=`, but the review console and the smoke checks address a
 * quotation by path, and a detail read is the natural place to compute the line/promotion split
 * without a second request per line.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
}

export async function GET(request: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id ?? ''
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid quotation id' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  const em = container.resolve('em') as EntityManager
  const quote = await loadQuoteForSource(em, { tenantId: auth.tenantId, organizationId }, id)
  if (!quote) return NextResponse.json({ error: 'Supplier quotation not found' }, { status: 404 })

  const scoped = em.fork()
  const [lineCount, promotedCount] = await Promise.all([
    scoped.count(SourcingQuoteLine, { quote: id }),
    scoped.count(SourcingQuoteLine, { quote: id, rowStatus: 'promoted' }),
  ])
  return NextResponse.json({ item: { ...serializeQuote(quote), lineCount, promotedCount } })
}

const quoteSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable(),
    status: z.string(),
    currencyCode: z.string(),
    supplierId: z.string().uuid().nullable(),
    sourceAttachmentId: z.string().uuid().nullable(),
    sourceSheetName: z.string().nullable(),
    headerRowIndex: z.number().nullable(),
    lineCount: z.number(),
    promotedCount: z.number(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Supplier quotation detail',
  methods: {
    GET: {
      summary: 'Supplier quotation detail',
      description: 'Returns one quotation in the caller’s organization scope together with its line and promotion counters.',
      responses: [{ status: 200, description: 'The quotation', schema: z.object({ item: quoteSchema }) }],
      errors: [
        { status: 400, description: 'Invalid id or missing organization scope', schema: sourcingErrorSchema },
        { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
        { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
        { status: 404, description: 'Not found in this organization', schema: sourcingErrorSchema },
      ],
    },
  },
}
