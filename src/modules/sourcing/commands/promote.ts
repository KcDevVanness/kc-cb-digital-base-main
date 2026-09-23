import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { promoteSchema } from '../data/validators'
import { promoteQuoteLines, type PromotionResult } from '../lib/promotion'
import eventsConfig from '../events'
import { ensureScope, loadQuote } from './shared'

/**
 * `sourcing.quotes.promote` — the business outcome of the module.
 *
 * The quotation must be approved first: approval is where the operator signed off on the numbers,
 * and promotion is the write into the product master that the whole review exists to justify.
 * There is deliberately no optimistic lock on the quotation here — the operation is additive and
 * idempotent (already-promoted lines are skipped), and the review grid saves line edits through
 * its own version-checked command before this runs.
 */
const promoteQuoteCommand: CommandHandler<Record<string, unknown>, PromotionResult> = {
  id: 'sourcing.quotes.promote',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = promoteSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const quote = await loadQuote(em, scope, parsed.quoteId)
    if (quote.status !== 'approved') {
      throw new CrudHttpError(422, {
        error: 'Approve the quotation before promoting its lines',
        code: 'quote_not_approved',
      })
    }

    const result = await promoteQuoteLines({
      ctx,
      scope,
      quote,
      lineIds: parsed.lineIds,
      force: parsed.force,
    })

    await eventsConfig.emit('sourcing.quote.promoted', {
      id: String(quote.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed.length,
    })
    return result
  },
}

registerCommand(promoteQuoteCommand)

export { promoteQuoteCommand }
