import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

/**
 * One status transition write against a sales document, shared by the list and the order hub.
 *
 * The engine takes a dictionary **entry id** (`statusEntryId`), resolves the value itself, keeps the
 * change trail and emits `sales.order.confirmed` / `sales.order.cancelled` for the two order
 * transitions. The row's `updatedAt` rides along as the optimistic lock, so a document somebody else
 * touched in the meantime answers 409 instead of being overwritten.
 *
 * Extracted rather than re-implemented in the hub: two write paths would eventually disagree about
 * the lock header, the payload shape or the response field, and a status write that silently skipped
 * the lock is the kind of divergence nobody notices until two operators confirm the same order.
 *
 * What stays with the caller: which transitions are allowed (`lib/salesStatus.ts`), the dialogs, and
 * the re-read that proves the engine actually persisted what was asked for — the engine may ignore a
 * status, so a hopeful success message is not evidence.
 */
export type SalesStatusWriteInput = {
  /** `sales/orders` or `sales/quotes` — the API path the list already uses for this kind. */
  apiPath: string
  documentId: string
  statusEntryId: string
  /** The document's current version; omitted → no lock header (a document never read back). */
  updatedAt: string | null
  errorMessage: string
}

/** Returns the document's new `updatedAt` when the write reported one. */
export async function writeSalesStatus(input: SalesStatusWriteInput): Promise<string | null> {
  const result = await readApiResultOrThrow<{ updatedAt?: string }>(
    `/api/${input.apiPath}`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(input.updatedAt ? buildOptimisticLockHeader(input.updatedAt) : {}),
      },
      body: JSON.stringify({
        id: input.documentId,
        statusEntryId: input.statusEntryId,
        updatedAt: input.updatedAt ?? null,
      }),
    },
    { errorMessage: input.errorMessage },
  )
  return typeof result?.updatedAt === 'string' ? result.updatedAt : null
}
