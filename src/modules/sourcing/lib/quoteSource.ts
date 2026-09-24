import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { SourcingImportProfile } from '../data/entities'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SourcingQuote } from '../data/entities'
import { WorkbookReadError, readWorkbook, type ParsedWorkbook } from './workbook'

/**
 * Loading a quotation and its stored workbook.
 *
 * Shared by the parse/remap commands and the read-only AI mapping route, so the "which file, whose
 * file" rules live in exactly one place: the attachment must be bound to *this* quotation record,
 * which is what `expectedOwner` enforces, and the bytes are read through the attachments contract
 * rather than from the storage path.
 */
export const QUOTE_ATTACHMENT_ENTITY_ID = 'sourcing:sourcing_quote' as const

export type QuoteSourceScope = { tenantId: string; organizationId: string }

export async function loadQuoteForSource(
  em: EntityManager,
  scope: QuoteSourceScope,
  quoteId: string,
): Promise<SourcingQuote | null> {
  return em.fork().findOne(SourcingQuote, {
    id: quoteId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<SourcingQuote>)
}

export async function readWorkbookForQuote(input: {
  container: { resolve: (token: string) => unknown }
  auth: unknown
  quote: SourcingQuote
  attachmentId: string
}): Promise<ParsedWorkbook> {
  const service = input.container.resolve('attachmentService') as AttachmentService
  let buffer: Buffer
  try {
    const file = await service.readScoped({
      attachmentId: input.attachmentId,
      auth: input.auth as NonNullable<Parameters<AttachmentService['readScoped']>[0]['auth']>,
      expectedOwner: { entityId: QUOTE_ATTACHMENT_ENTITY_ID, recordId: String(input.quote.id) },
    })
    buffer = file.buffer
  } catch {
    throw new CrudHttpError(422, {
      error: 'The uploaded workbook could not be read back from storage',
      code: 'attachment_unreadable',
    })
  }
  try {
    return readWorkbook(buffer)
  } catch (error) {
    if (error instanceof WorkbookReadError) {
      const code =
        error.reason === 'sheet_too_large'
          ? 'sheet_too_large'
          : error.reason === 'too_many_sheets'
            ? 'too_many_sheets'
            : 'unreadable_workbook'
      throw new CrudHttpError(422, { error: error.message, code })
    }
    throw error
  }
}

/** Display name of a mapping profile, so the wizard can label a profile hit without an id. */
export async function loadProfileName(
  em: EntityManager,
  scope: QuoteSourceScope,
  profileId: string | null | undefined,
): Promise<string | null> {
  if (!profileId) return null
  const profile = await em.fork().findOne(SourcingImportProfile, {
    id: profileId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as FilterQuery<SourcingImportProfile>)
  return profile?.name ?? null
}
