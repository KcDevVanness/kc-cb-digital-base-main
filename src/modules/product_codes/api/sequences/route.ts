import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { productCodeSequencesQuerySchema } from '../../data/validators'
import { listIssuedScopes } from '../../lib/issuance'
import { resolveRequestScope } from '../../lib/requestScope'
import { productCodesTag } from '../openapi'

const logger = createLogger('product_codes')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['product_codes.rules.view'] },
}

/**
 * How far a rule's counters have run, per scope.
 *
 * The panel exists because issuance is irreversible: an operator looking at `下一个 013` next to
 * `已发 12` can see the gap a preview-then-abandoned issuance left, instead of wondering whether a
 * number was lost.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = productCodeSequencesQuerySchema.safeParse({ ruleId: url.searchParams.get('ruleId') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: 'A rule id is required' }, { status: 400 })
  }

  const scopeResult = await resolveRequestScope(request)
  if (!scopeResult.ok) {
    return NextResponse.json(
      scopeResult.code ? { error: scopeResult.error, code: scopeResult.code } : { error: scopeResult.error },
      { status: scopeResult.status },
    )
  }

  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const scopes = await listIssuedScopes(em, scopeResult.scope, parsed.data.ruleId)
    return NextResponse.json({ scopes })
  } catch (err) {
    logger.error('Failed to read code sequences', { err })
    return NextResponse.json({ error: 'Could not read the sequences' }, { status: 500 })
  }
}

const issuedScopeSchema = z.object({
  brandValue: z.string(),
  categoryValue: z.string().nullable(),
  issued: z.number(),
  nextSerial: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: productCodesTag,
  summary: 'Issued code sequences',
  methods: {
    GET: {
      summary: 'How far a rule\'s counters have run, per scope',
      description:
        'Read-only. One row per (brand, category) scope the rule has issued into: `issued` is the count and `nextSerial` the serial the next issuance would take. The gap between them is what a preview-then-abandoned issuance leaves behind — the panel exists so an operator can see that instead of wondering whether a number was lost.',
      tags: [productCodesTag],
      responses: [
        { status: 200, description: 'The scopes of one rule', schema: z.object({ scopes: z.array(issuedScopeSchema) }) },
        { status: 400, description: 'Missing `ruleId`', schema: z.object({ error: z.string() }).passthrough() },
        { status: 401, description: 'Not authenticated', schema: z.object({ error: z.string() }).passthrough() },
        { status: 403, description: 'Missing product_codes.rules.view', schema: z.object({ error: z.string() }).passthrough() },
        { status: 500, description: 'The read failed', schema: z.object({ error: z.string() }).passthrough() },
      ],
    },
  },
}
