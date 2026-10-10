import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { supplierProductCreateSchema } from '../data/validators'
import {
  describeImportRowIssues,
  pickLibraryValues,
  supplierProductExcelImportSchema,
  type SupplierProductExcelImportInput,
  MAX_FAILURE_REASON_LENGTH,
} from '../lib/supplierProductExcelImport/rows'
import type { CommandBusLike } from '../lib/supplierProductPromotion'
import { ensureScope, loadSupplierName } from './shared'

/**
 * `purchasing.supplier-products.import-excel` — create one library row per uploaded spreadsheet row.
 *
 * The import is not a second write path: every row is validated by `supplierProductCreateSchema` and
 * then created by `purchasing.supplier-products.create` itself, so the duplicate-code check, the brand
 * resolution, the CRUD events and the query index stay in exactly one place. What this command adds is
 * the batch contract every importer in this app shares — per-row isolation. A row that names no code, a
 * code already owned by another row of the same supplier and a value the contract refuses all fail
 * alone with the row number they came from; the rows around them are written.
 *
 * The cost of reusing the create command is one audit entry per written row. That is the same trail a
 * row-by-row import through the form would leave, and it is what makes a 500-row import reviewable.
 */

/** One row's failure: the spreadsheet row it came from and why the library refused it. */
export type SupplierProductExcelImportFailure = { row: number; reason: string }

export type SupplierProductExcelImportResult = {
  created: number
  failed: SupplierProductExcelImportFailure[]
}

function truncateReason(reason: string): string {
  const trimmed = reason.trim()
  return trimmed.length > MAX_FAILURE_REASON_LENGTH ? `${trimmed.slice(0, MAX_FAILURE_REASON_LENGTH - 1)}…` : trimmed
}

/** Why the create command refused the row: its own readable body, a contract message, or its last word. */
function failureReason(error: unknown): string {
  if (error instanceof CrudHttpError) {
    const body: unknown = error.body
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : error.message
    return truncateReason(message)
  }
  if (error instanceof z.ZodError) return describeImportRowIssues(error)
  if (error instanceof Error && error.message) return truncateReason(error.message)
  return 'the row could not be created'
}

const importSupplierProductsExcelCommand: CommandHandler<
  Record<string, unknown>,
  SupplierProductExcelImportResult
> = {
  id: 'purchasing.supplier-products.import-excel',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed: SupplierProductExcelImportInput = supplierProductExcelImportSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    // Checked once, before the loop: a supplier outside this scope would otherwise answer with one
    // identical failure per row, which reads like a data problem instead of a wrong supplier id.
    const supplierName = await loadSupplierName(em, scope, parsed.supplierId)
    if (!supplierName) throw badRequest(`Supplier not found in this organization: ${parsed.supplierId}`)

    const commandBus = ctx.container.resolve('commandBus') as CommandBusLike
    const result: SupplierProductExcelImportResult = { created: 0, failed: [] }

    for (const row of parsed.rows) {
      const candidate = supplierProductCreateSchema.safeParse({
        supplierId: parsed.supplierId,
        ...pickLibraryValues(row.values),
      })
      if (!candidate.success) {
        // Refused before the bus is touched: a row that cannot pass the contract must not leave an audit
        // entry behind either.
        result.failed.push({ row: row.row, reason: describeImportRowIssues(candidate.error) })
        continue
      }
      try {
        await commandBus.execute('purchasing.supplier-products.create', { input: candidate.data, ctx })
        result.created += 1
      } catch (error) {
        result.failed.push({ row: row.row, reason: failureReason(error) })
      }
    }

    return result
  },
}

registerCommand(importSupplierProductsExcelCommand)

export { importSupplierProductsExcelCommand }
