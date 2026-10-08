import { toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'

/**
 * Helpers for seeding an in-place quick-edit dialog from one related row.
 *
 * A row reaches the dialog in whatever shape the owning module's list route projects: those routes
 * expose the camelCase keys their tables render (`businessNumber`, `signedAt`, …), while a row taken
 * from a raw query still carries the snake_case column, so every read tries both. Dates go through
 * `toUtcDateInputValue` so a date-only column and an ISO timestamp both come back as the
 * `YYYY-MM-DD` a date input edits (reading the instant locally would name the previous day west of
 * UTC).
 *
 * `quickEditValues` drops the fields it is handed when they are empty. A quick edit is a partial
 * update: leaving a key out means "keep what is stored", and the modules' validators would reject
 * the alternative — a date must be `YYYY-MM-DD` and an invoice kind must be one of its members, so
 * an empty string is not a value any of these headers may receive.
 */
export function readRowText(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

export function readRowDate(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    const day = toUtcDateInputValue(typeof value === 'string' || value instanceof Date ? value : null)
    if (day) return day
  }
  return ''
}

export function quickEditValues(entries: Record<string, string>): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entries)) {
    if (value.length > 0) values[key] = value
  }
  return values
}
