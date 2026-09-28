import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { productCodeSequencesQuerySchema } from '../../data/validators'
import { listIssuedScopes } from '../../lib/issuance'
import { resolveRequestScope } from '../../lib/requestScope'

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
