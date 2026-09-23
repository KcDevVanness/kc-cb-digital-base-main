import type { EntityManager } from '@mikro-orm/postgresql'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { PurchasingSupplierProduct } from '../data/entities'
import { supplierProductCrudEvents, supplierProductCrudIndexer, loadSupplierName, type PurchasingScope } from '../commands/shared'
import { loadQuoteLines, type QuoteLineRef, type QuoteRef } from './quoteLineReads'

/**
 * Feeding quotation lines into the supplier's product library.
 *
 * The quotation is `sourcing`'s document and this module only *reads* it (a scoped projection, see
 * `quoteLineReads.ts`); every write below lands on the library, which this module owns. A quotation
 * is a document, not a transaction: one line whose code is unusable (missing, or already owned by a
 * deleted row) must not stop the other 80 from landing. Every rule below keeps the library's
 * meaning stable across repeated imports:
 *
 * 1. **Per-line isolation** — a failure is recorded with its line number and the run continues.
 * 2. **Idempotency** — a line whose values are already stored reports `skipped`, so importing the
 *    same quotation twice changes nothing.
 * 3. **Non-destructive updates** — a blank source cell never clears a stored value; only non-empty
 *    values that actually differ are written.
 * 4. **The code stays owned** — `supplier_sku` is unique per supplier *including* soft-deleted rows,
 *    so a code held by a deleted row is an explicit failure, never a silent duplicate.
 */

export type SupplierProductImportFailure = { lineId: string; lineNumber: number; message: string }

export type SupplierProductImportResult = {
  created: number
  updated: number
  skipped: number
  failed: SupplierProductImportFailure[]
}

export type SupplierProductUpsertAction = 'created' | 'updated' | 'skipped'

/** The library columns a quotation line can contribute. */
type LibraryValues = {
  itemNo: string | null
  name: string | null
  description: string | null
  unit: string | null
  hsCode: string | null
  moqQuantity: number | null
  cartonQuantity: number | null
  unitNetWeight: string | null
  innerPacking: Record<string, unknown> | null
}

const TEXT_FIELDS = ['itemNo', 'name', 'description', 'unit', 'hsCode'] as const
const INTEGER_FIELDS = ['moqQuantity', 'cartonQuantity'] as const
const DECIMAL_FIELDS = ['unitNetWeight'] as const
const PACKING_FIELDS = ['innerPacking'] as const

function trimmedOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function normalizePacking(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  const entries = Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/** The supplier code a line claims in the library: the derived SKU when it has one, else the item no. */
export function supplierSkuFromLine(line: QuoteLineRef): string {
  return trimmedOrNull(line.derivedSku) ?? trimmedOrNull(line.itemNo) ?? ''
}

export function supplierProductValuesFromLine(line: QuoteLineRef): LibraryValues {
  return {
    itemNo: trimmedOrNull(line.itemNo),
    name: trimmedOrNull(line.productName),
    description: trimmedOrNull(line.description),
    unit: trimmedOrNull(line.unit),
    hsCode: trimmedOrNull(line.hsCode),
    moqQuantity: line.moqQuantity ?? null,
    cartonQuantity: line.cartonQuantity ?? null,
    unitNetWeight: line.unitNetWeight ?? null,
    innerPacking: normalizePacking(line.innerPacking),
  }
}

/**
 * The subset of `values` that differs from what the row already stores.
 *
 * A `null` in `values` means "the source had nothing here" and is skipped outright: the point is
 * that a supplier sheet with a half-filled column cannot erase what the buyer typed.
 */
export function changedLibraryFields(
  current: PurchasingSupplierProduct,
  values: LibraryValues,
): Record<string, unknown> {
  const stored = current as unknown as Record<string, unknown>
  const payload: Record<string, unknown> = {}
  for (const field of TEXT_FIELDS) {
    const next = values[field]
    if (next && next !== stored[field]) payload[field] = next
  }
  for (const field of INTEGER_FIELDS) {
    const next = values[field]
    if (next !== null && next !== undefined && next !== stored[field]) payload[field] = next
  }
  for (const field of DECIMAL_FIELDS) {
    const next = values[field]
    if (next === null || next === undefined) continue
    if (Number(next) !== Number(stored[field] ?? Number.NaN)) payload[field] = next
  }
  for (const field of PACKING_FIELDS) {
    const next = normalizePacking(values[field])
    if (!next) continue
    if (JSON.stringify(next) !== JSON.stringify(normalizePacking(stored[field] as Record<string, unknown> | null))) {
      payload[field] = next
    }
  }
  return payload
}

/**
 * Creates or refreshes one library row from one quotation line.
 *
 * The single write path for both entry points — the console's on-demand import and the quotation
 * promotion — so the two cannot diverge: whichever runs first produces the same row and the second
 * merely reports `skipped`. The master link comes from the line's own `promoted_product_id`, so a
 * line promoted in the same request backfills `product_id` without the caller passing anything.
 */
export async function upsertSupplierProductRow(input: {
  em: EntityManager
  de: DataEngine
  scope: PurchasingScope
  quote: QuoteRef
  line: QuoteLineRef
  supplierNameSnapshot: string | null
}): Promise<{ id: string; action: SupplierProductUpsertAction }> {
  const supplierId = input.quote.supplierId
  if (!supplierId) {
    throw new CrudHttpError(422, {
      error: 'Select the supplier on the quotation before adding its lines to the supplier library',
      code: 'quote_supplier_required',
    })
  }
  const supplierSku = supplierSkuFromLine(input.line)
  if (supplierSku.length === 0) {
    throw new CrudHttpError(422, { error: 'Line has no item number', code: 'line_has_no_item_number' })
  }

  const existing = await input.em.fork().findOne(PurchasingSupplierProduct, {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    supplierId,
    supplierSku,
  })
  if (existing?.deletedAt) {
    throw new CrudHttpError(409, {
      error: `Code ${supplierSku} belongs to a deleted supplier product; restore it or change the line's item number`,
      code: 'supplier_product_sku_deleted',
    })
  }

  const values = supplierProductValuesFromLine(input.line)

  if (!existing) {
    const created = await input.de.createOrmEntity({
      entity: PurchasingSupplierProduct,
      data: {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        supplierId,
        supplierNameSnapshot: input.supplierNameSnapshot,
        supplierSku,
        itemNo: values.itemNo ?? null,
        // A library row always has a name: the line's own name when it has one, else the code, so
        // the list is never a column of blanks the operator has to open each row to identify.
        name: values.name ?? supplierSku,
        description: values.description ?? null,
        unit: values.unit ?? 'PCS',
        hsCode: values.hsCode ?? null,
        moqQuantity: values.moqQuantity ?? null,
        cartonQuantity: values.cartonQuantity ?? null,
        unitNetWeight: values.unitNetWeight ?? null,
        innerPacking: values.innerPacking ?? null,
        productId: input.line.promotedProductId ?? null,
        status: 'active',
        source: 'quote',
        lastQuoteId: input.quote.id,
        lastQuoteLineId: input.line.id,
      },
    })
    await emitCrudSideEffects({
      dataEngine: input.de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
      events: supplierProductCrudEvents,
      indexer: supplierProductCrudIndexer,
    })
    return { id: String(created.id), action: 'created' }
  }

  const payload: Record<string, unknown> = {
    ...changedLibraryFields(existing, values),
    source: 'quote',
    lastQuoteId: input.quote.id,
    lastQuoteLineId: input.line.id,
  }
  if (input.line.promotedProductId && input.line.promotedProductId !== existing.productId) {
    payload.productId = input.line.promotedProductId
  }
  if (!existing.supplierNameSnapshot && input.supplierNameSnapshot) {
    payload.supplierNameSnapshot = input.supplierNameSnapshot
  }

  const stored = existing as unknown as Record<string, unknown>
  const dirty = Object.entries(payload).some(([key, value]) => stored[key] !== value)
  if (!dirty) return { id: String(existing.id), action: 'skipped' }

  const updated = await input.de.updateOrmEntity({
    entity: PurchasingSupplierProduct,
    where: {
      id: String(existing.id),
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    },
    apply: (entity) => {
      const target = entity as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(payload)) target[key] = value
    },
  })
  if (!updated) throw notFound('Supplier product not found')
  await emitCrudSideEffects({
    dataEngine: input.de,
    action: 'updated',
    entity: updated,
    identifiers: { id: String(updated.id), tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
    events: supplierProductCrudEvents,
    indexer: supplierProductCrudIndexer,
  })
  return { id: String(updated.id), action: 'updated' }
}

/**
 * Imports the given quotation lines into their supplier's library, one line at a time.
 *
 * Returns counts instead of throwing, so the console can report "80 added, 3 failed" and the
 * operator fixes three rows instead of re-running the whole import. Lines that are not on this
 * quotation (or not in the caller's scope) are reported as failures, one per requested id.
 */
export async function importQuoteLinesIntoLibraries(input: {
  em: EntityManager
  de: DataEngine
  scope: PurchasingScope
  quote: QuoteRef
  requestedLineIds: readonly string[]
}): Promise<SupplierProductImportResult> {
  const result: SupplierProductImportResult = { created: 0, updated: 0, skipped: 0, failed: [] }
  if (!input.quote.supplierId) {
    throw new CrudHttpError(422, {
      error: 'Select the supplier on the quotation before adding its lines to the supplier library',
      code: 'quote_supplier_required',
    })
  }

  const lines = await loadQuoteLines(input.em, input.scope, input.quote.id, input.requestedLineIds)
  const found = new Set(lines.map((line) => line.id))
  for (const lineId of input.requestedLineIds) {
    if (!found.has(lineId)) {
      result.failed.push({ lineId, lineNumber: 0, message: 'Line is not part of this quotation' })
    }
  }

  // The supplier's display name for the row snapshot; a missing supplier simply leaves it null.
  const supplierNameSnapshot = await loadSupplierName(input.em, input.scope, input.quote.supplierId)

  for (const line of lines) {
    try {
      const outcome = await upsertSupplierProductRow({
        em: input.em,
        de: input.de,
        scope: input.scope,
        quote: input.quote,
        line,
        supplierNameSnapshot,
      })
      result[outcome.action] += 1
    } catch (error) {
      result.failed.push({
        lineId: line.id,
        lineNumber: line.lineNumber,
        message: error instanceof Error ? error.message : 'Import failed',
      })
    }
  }

  return result
}
