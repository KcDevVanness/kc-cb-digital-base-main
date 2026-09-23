import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { badRequest, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { SourcingQuote, SourcingQuoteLine, SourcingSupplierProduct } from '../data/entities'
import type { BuiltQuoteLine } from '../lib/quoteLines'
import { QUOTE_ATTACHMENT_ENTITY_ID, loadQuoteForSource } from '../lib/quoteSource'

/**
 * Scope, filters and small shared helpers for the sourcing commands.
 *
 * The entity ids match the platform's `<module>:<snake_case class>` convention
 * (`SourcingQuote` → `sourcing:sourcing_quote`); writing them by hand keeps the command and
 * route in lockstep with what the query index registers.
 */
export const QUOTE_ENTITY_ID = 'sourcing:sourcing_quote' as const
export const QUOTE_LINE_ENTITY_ID = 'sourcing:sourcing_quote_line' as const
export const PROFILE_ENTITY_ID = 'sourcing:sourcing_import_profile' as const
export const SUPPLIER_PRODUCT_ENTITY_ID = 'sourcing:sourcing_supplier_product' as const

export const QUOTE_RESOURCE_KIND = 'sourcing.quote' as const
export const QUOTE_LINE_RESOURCE_KIND = 'sourcing.quote_line' as const
export const PROFILE_RESOURCE_KIND = 'sourcing.import_profile' as const
export const SUPPLIER_PRODUCT_RESOURCE_KIND = 'sourcing.supplier_product' as const

export type SourcingScope = { tenantId: string; organizationId: string }

/**
 * Trusted scope only: tenant and organization come from the command context, never from the
 * payload, and a missing organization fails closed instead of defaulting to something wider.
 */
export function ensureScope(ctx: CommandRuntimeContext): SourcingScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw badRequest('Tenant context is required')
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}

export function quoteFilter(scope: SourcingScope, id: string): FilterQuery<SourcingQuote> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<SourcingQuote>
}

export function lineFilter(scope: SourcingScope, id: string): FilterQuery<SourcingQuoteLine> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as FilterQuery<SourcingQuoteLine>
}

export async function loadQuote(em: EntityManager, scope: SourcingScope, id: string): Promise<SourcingQuote> {
  const quote = await loadQuoteForSource(em, scope, id)
  if (!quote) throw notFound('Supplier quotation not found')
  return quote
}

export { QUOTE_ATTACHMENT_ENTITY_ID }

export async function loadQuoteLine(
  em: EntityManager,
  scope: SourcingScope,
  id: string,
): Promise<SourcingQuoteLine | null> {
  return em.fork().findOne(SourcingQuoteLine, lineFilter(scope, id))
}

export async function countPromotedLines(em: EntityManager, quoteId: string): Promise<number> {
  return em.fork().count(SourcingQuoteLine, { quote: quoteId, rowStatus: 'promoted' } as FilterQuery<SourcingQuoteLine>)
}

/**
 * Per-organization quotation number, assigned at `approve`. The unique constraint on
 * (tenant, organization, number) is the real guarantee — this only picks the next value, so two
 * concurrent approvals can collide and the loser retries with a fresh number.
 */
export async function nextQuoteNumber(em: EntityManager, scope: SourcingScope): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `SQ-${year}-`
  const rows = await (em.fork().getKysely<any>())
    .selectFrom('sourcing_quotes')
    .select('number')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('number', 'like', `${prefix}%`)
    .orderBy('number', 'desc')
    .limit(1)
    .execute()
  const last = (rows as Array<{ number: string }>)[0]?.number ?? null
  const lastSequence = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'UniqueConstraintViolationException'
}

/** Numeric form of a decimal column, used to compare a quoted price with the stored one. */
export function decimalToNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const quoteCrudEvents: CrudEventsConfig<SourcingQuote> = {
  module: 'sourcing',
  entity: 'quote',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<SourcingQuote>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    number: ctx.entity?.number ?? null,
    status: ctx.entity?.status ?? null,
  }),
}

export const quoteCrudIndexer: CrudIndexerConfig<SourcingQuote> = {
  entityType: QUOTE_ENTITY_ID,
}

export const quoteLineCrudEvents: CrudEventsConfig<SourcingQuoteLine> = {
  module: 'sourcing',
  entity: 'quote_line',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<SourcingQuoteLine>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    rowStatus: ctx.entity?.rowStatus ?? null,
  }),
}

export const quoteLineCrudIndexer: CrudIndexerConfig<SourcingQuoteLine> = {
  entityType: QUOTE_LINE_ENTITY_ID,
}

export function supplierProductFilter(
  scope: SourcingScope,
  id: string,
): FilterQuery<SourcingSupplierProduct> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<SourcingSupplierProduct>
}

export async function loadSupplierProduct(
  em: EntityManager,
  scope: SourcingScope,
  id: string,
): Promise<SourcingSupplierProduct> {
  const row = await em.fork().findOne(SourcingSupplierProduct, supplierProductFilter(scope, id))
  if (!row) throw notFound('Supplier product not found')
  return row
}

/**
 * A supplier code is unique per supplier **including soft-deleted rows**, so every duplicate check
 * has to see them: without this the unique index answers with a 500 instead of a readable 409.
 */
export async function findSupplierProductBySku(
  em: EntityManager,
  scope: SourcingScope,
  supplierId: string,
  supplierSku: string,
): Promise<SourcingSupplierProduct | null> {
  return em.fork().findOne(SourcingSupplierProduct, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    supplierId,
    supplierSku,
  } as FilterQuery<SourcingSupplierProduct>)
}

export const supplierProductCrudEvents: CrudEventsConfig<SourcingSupplierProduct> = {
  module: 'sourcing',
  entity: 'supplier_product',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<SourcingSupplierProduct>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    supplierId: ctx.entity?.supplierId ?? null,
    supplierSku: ctx.entity?.supplierSku ?? null,
    status: ctx.entity?.status ?? null,
  }),
}

export const supplierProductCrudIndexer: CrudIndexerConfig<SourcingSupplierProduct> = {
  entityType: SUPPLIER_PRODUCT_ENTITY_ID,
}

/**
 * The entity columns a built line fills. Typed (rather than `Record<string, unknown>`) because the
 * parse/remap commands spread it straight into `em.create`, where an untyped spread would erase
 * the field types of the whole payload.
 */
export type QuoteLineColumns = {
  lineNumber: number
  sourceRowNumber: number | null
  sectionLabel: string | null
  itemNo: string | null
  productName: string | null
  variantLabel: string | null
  derivedSku: string | null
  hsCode: string | null
  description: string | null
  unit: string
  unitCost: string | null
  currencyCode: string | null
  suggestedRsp: string | null
  moqRaw: string | null
  moqQuantity: number | null
  cartonQuantity: number | null
  cartons: number | null
  unitNetWeight: string | null
  cartonGrossWeight: string | null
  cartonNetWeight: string | null
  innerPacking: Record<string, unknown> | null
  outerPacking: Record<string, unknown> | null
  cartonVolume: string | null
  raw: Record<string, unknown> | null
  warnings: string[]
  rowStatus: string
  selected: boolean
}

/** Maps a built line onto the entity column set, so parse and remap cannot drift apart. */
export function toLineColumns(line: BuiltQuoteLine): QuoteLineColumns {
  return {
    lineNumber: line.lineNumber,
    sourceRowNumber: line.sourceRowNumber,
    sectionLabel: line.sectionLabel,
    itemNo: line.itemNo,
    productName: line.productName,
    variantLabel: line.variantLabel,
    derivedSku: line.derivedSku,
    hsCode: line.hsCode,
    description: line.description,
    unit: line.unit,
    unitCost: line.unitCost,
    currencyCode: line.currencyCode,
    suggestedRsp: line.suggestedRsp,
    moqRaw: line.moqRaw,
    moqQuantity: line.moqQuantity,
    cartonQuantity: line.cartonQuantity,
    cartons: line.cartons,
    unitNetWeight: line.unitNetWeight,
    cartonGrossWeight: line.cartonGrossWeight,
    cartonNetWeight: line.cartonNetWeight,
    innerPacking: line.innerPacking,
    outerPacking: line.outerPacking,
    cartonVolume: line.cartonVolume,
    raw: line.raw,
    warnings: line.warnings,
    rowStatus: line.rowStatus,
    selected: line.selected,
  }
}

/** Resolves the command bus the promotion path uses to call the products module's commands. */
export function resolveCommandBus(ctx: CommandRuntimeContext): CommandBus {
  return ctx.container.resolve('commandBus') as CommandBus
}

/**
 * Only a draft quotation may change its lines, mapping or header. `approved` is the point where
 * the operator signed off on the numbers, so a later edit would silently invalidate that.
 */
export function assertQuoteEditable(status: string): void {
  if (status !== 'draft') {
    throw new CrudHttpError(422, {
      error: 'Only a draft quotation can be changed',
      code: 'quote_not_editable',
    })
  }
}
