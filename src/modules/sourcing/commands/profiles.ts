import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { requireId } from '@open-mercato/shared/lib/commands/helpers'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { SourcingImportProfile } from '../data/entities'
import { ensureScope } from './shared'

/**
 * Mapping profiles are pure convenience: deleting one only means the next workbook with that
 * layout is mapped by the alias dictionary (or by hand) again. Nothing else references a profile,
 * so this is a hard delete.
 */
const deleteImportProfileCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'sourcing.import-profiles.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    // The CRUD factory hands the delete command `{ body, query }` rather than a parsed schema.
    const id = requireId(rawInput, 'Mapping profile id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const scoped = em.fork()
    const existing = await scoped.findOne(SourcingImportProfile, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<SourcingImportProfile>)
    if (!existing) throw notFound('Mapping profile not found')
    await scoped.remove(existing).flush()
    return { id: String(existing.id) }
  },
}

registerCommand(deleteImportProfileCommand)

export { deleteImportProfileCommand }
