import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { analyzeSheet } from '../../../lib/quoteAnalysis'
import { loadQuoteForSource, readWorkbookForQuote } from '../../../lib/quoteSource'
import { SourcingAiNotConfiguredError, SourcingAiUnavailableError, suggestMappingWithAi } from '../../../lib/aiMapping'
import { sourcingErrorSchema, sourcingTag } from '../../openapi'

/**
 * Read-only AI assist for column mapping.
 *
 * It re-reads the quotation's stored workbook, detects its structure, and asks the configured model
 * to map the columns; the suggestion is returned to the wizard, which the operator applies through
 * the ordinary `remap` command. Nothing is written here, and the request carries only the header
 * row plus at most three sample rows.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sourcing.import.run'] },
}

const requestSchema = z.object({
  quoteId: z.string().uuid(),
  sheetName: z.string().max(120).optional(),
  headerRowIndex: z.coerce.number().int().min(0).max(5000).optional(),
  includeSampleRows: z.boolean().default(true),
})

const responseSchema = z.object({
  columns: z.array(z.unknown()),
  notes: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  sent: z.object({ headers: z.number(), sampleRows: z.number() }),
})

export async function POST(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return Response.json({ error: 'Select an organization to access this resource', code: 'organization_scope_required' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid AI mapping request' }, { status: 400 })
  }

  const em = container.resolve('em') as EntityManager
  const scope = { tenantId: auth.tenantId, organizationId }
  const quote = await loadQuoteForSource(em, scope, parsed.data.quoteId)
  if (!quote) return Response.json({ error: 'Supplier quotation not found' }, { status: 404 })
  if (!quote.sourceAttachmentId) {
    return Response.json({ error: 'Upload a workbook before asking for a mapping', code: 'attachment_missing' }, { status: 422 })
  }

  try {
    const workbook = await readWorkbookForQuote({
      container,
      auth,
      quote,
      attachmentId: quote.sourceAttachmentId,
    })
    const analysisResult = analyzeSheet({
      workbook,
      sheetName: parsed.data.sheetName ?? quote.sourceSheetName ?? undefined,
      headerRowIndex: parsed.data.headerRowIndex ?? quote.headerRowIndex ?? undefined,
    })
    if (!analysisResult.ok) {
      return Response.json({ error: 'No header row could be detected in this worksheet', code: analysisResult.reason }, { status: 422 })
    }
    const analysis = analysisResult.analysis
    const suggestion = await suggestMappingWithAi({
      container: container as unknown as AwilixContainer,
      headers: analysis.headerCells,
      sampleRows: parsed.data.includeSampleRows ? analysis.sampleRows : [],
    })
    return Response.json({
      columns: suggestion.columns,
      notes: suggestion.notes,
      provider: suggestion.provider,
      model: suggestion.model,
      sent: { headers: analysis.headerCells.length, sampleRows: parsed.data.includeSampleRows ? analysis.sampleRows.length : 0 },
    })
  } catch (error) {
    if (error instanceof SourcingAiNotConfiguredError) {
      return Response.json(
        { error: 'AI mapping is not configured: set OPENAI_API_KEY (or another OM_AI_PROVIDER credential) to enable it', code: 'ai_not_configured' },
        { status: 503 },
      )
    }
    if (error instanceof SourcingAiUnavailableError) {
      return Response.json({ error: error.message, code: 'ai_failed' }, { status: 502 })
    }
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Suggest a column mapping with AI',
  methods: {
    POST: {
      summary: 'Suggest a column mapping with AI',
      description:
        'Sends the header row (and optionally the first three data rows) of the quotation’s stored workbook to the configured model and returns a proposed mapping. Read-only: the suggestion is applied by the operator through the remap endpoint. Returns 503 when no model provider is configured.',
      requestBody: { schema: requestSchema },
      responses: [{ status: 200, description: 'Suggestion', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: sourcingErrorSchema },
        { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
        { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
        { status: 404, description: 'Quotation not found', schema: sourcingErrorSchema },
        { status: 422, description: 'No workbook or no detectable header row', schema: sourcingErrorSchema },
        { status: 502, description: 'The model call failed', schema: sourcingErrorSchema },
        { status: 503, description: 'No model provider configured', schema: sourcingErrorSchema },
      ],
    },
  },
}
