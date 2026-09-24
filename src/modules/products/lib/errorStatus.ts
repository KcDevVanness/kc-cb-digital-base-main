import type { CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

/**
 * The HTTP status behind a rejected CRUD call, or `undefined` when the rejection carries none.
 *
 * `updateCrud`/`deleteCrud`/`createCrud` reject with the platform's `CrudFormError` — the `Error`
 * that `raiseCrudError` builds with the response status as an own property — so callers can tell a
 * missing row (404) from a stale version (409) without re-parsing the message.
 */
export function readErrorStatus(error: unknown): CrudFormError['status'] {
  if (!(error instanceof Error)) return undefined
  if (!('status' in error)) return undefined
  const status: unknown = error.status
  return typeof status === 'number' ? status : undefined
}
