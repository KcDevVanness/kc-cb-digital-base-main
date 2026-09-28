import { NextResponse } from 'next/server'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ProductCodeLedgerEntry, ProductCodeRule } from '../../data/entities'
import { productCodeParseSchema } from '../../data/validators'
import { loadCodeDictionaries } from '../../lib/dictionaryValues'
import { parseCode, type ParseRule } from '../../lib/parse'
import { resolveRequestScope } from '../../lib/requestScope'

const logger = createLogger('product_codes')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['product_codes.rules.view'] },
}

/**
 * Explain one code — the reverse parse.
 *
 * Read-only and never failing on the code's content: a legacy PetKit code comes back as `none`
 * (沿用旧码), which is a normal answer, not an error. The ledger lookup comes first because only it can
 * say whether the system issued the code, and its row carries the values the code was built from.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = productCodeParseSchema.safeParse({ code: url.searchParams.get('code') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: 'A code between 1 and 120 characters is required' }, { status: 400 })
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
    const scope = scopeResult.scope

    const ledgerHit = await em.fork().findOne(ProductCodeLedgerEntry, {
      code: parsed.data.code,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<ProductCodeLedgerEntry>)

    const rules = await em.fork().find(
      ProductCodeRule,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<ProductCodeRule>,
      { orderBy: { createdAt: 'asc' } },
    )
    const { values, labels } = await loadCodeDictionaries(em, scope)

    const result = parseCode({
      code: parsed.data.code,
      ledgerHit: ledgerHit
        ? {
            ruleId: ledgerHit.ruleId,
            brandValue: ledgerHit.brandValue,
            categoryValue: ledgerHit.categoryValue ?? null,
            serial: ledgerHit.serial,
          }
        : null,
      rules: rules.map<ParseRule>((rule) => ({
        id: String(rule.id),
        name: rule.name,
        segments: rule.segments,
        separator: rule.separator,
        serialLength: rule.serialLength,
        isActive: rule.isActive === true,
      })),
      values,
      labels,
    })

    return NextResponse.json(result)
  } catch (err) {
    logger.error('Failed to parse a product code', { err })
    return NextResponse.json({ error: 'Could not read the code' }, { status: 500 })
  }
}
