/**
 * The app-side product store.
 *
 * The single source of truth for "what is a product" is the installed `catalog` module: the app
 * owns no product tables. This module is the one place that knows how the app's own field
 * vocabulary maps onto catalog:
 *
 * - **native columns** where catalog has them (`title`, `sku`, `default_unit`, `is_active`,
 *   `hs_code`, `cn_code`, `country_of_origin_code`, `weight_value`, `dimensions`), and
 * - **custom fields** (declared in `../ce.ts`, installed by `yarn mercato entities install`) for
 *   the business fields catalog does not model: English name, brand/series/model, spec summary,
 *   packing figures, certifications, notes, battery data, distribution provenance.
 *
 * Writes always go through the official commands (`catalog.products.*`, `catalog.variants.*`,
 * `catalog.prices.*`, `catalog.priceKinds.*`) so the platform's events, audit trail, custom-field
 * storage and query-index side effects keep firing; reads are scoped Kysely projections, the same
 * read-only pattern every other app module uses for a peer's tables.
 *
 * Identity: the catalog product id **is** the app's product id, and the catalog variant id is the
 * stock unit. Nothing in the app invents a second identity.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely } from 'kysely'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PRODUCT_ERP_FIELDSET } from '../ce'
import { PRODUCT_PRICE_TIERS, type ProductPriceTier } from './tiers'

export type StoreScope = { tenantId: string; organizationId: string }

export const PRODUCT_ENTITY_ID = 'catalog:catalog_product'
export const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'

/** The three price tiers are the business's own vocabulary (`lib/tiers.ts`), shared with contracts. */
export const PRICE_TIERS = PRODUCT_PRICE_TIERS
export type PriceTier = ProductPriceTier

const TIER_TITLES: Record<PriceTier, string> = {
  purchase: 'Purchase price',
  internal: 'Internal settlement price',
  export: 'Export price',
}

export type StoreVariant = {
  id: string
  sku: string
  name: string | null
  barcode: string | null
  isDefault: boolean
  isActive: boolean
  updatedAt: string | null
}

export type StoreVariantInput = {
  /** Present when the row already exists in catalog (update in place). */
  id?: string | null
  sku: string
  name?: string | null
  barcode?: string | null
  isDefault?: boolean
  isActive?: boolean
}

export type StorePrice = {
  id: string
  tier: PriceTier
  currencyCode: string
  minQuantity: number
  unitPrice: string
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
}

export type StorePriceInput = {
  tier: PriceTier
  currencyCode: string
  minQuantity?: number
  unitPrice: string
  startsAt?: string | null
  endsAt?: string | null
  isActive?: boolean
}

export type StoreDimensions = {
  length: number | null
  width: number | null
  height: number | null
  unit: string | null
}

export type StoreProduct = {
  id: string
  sku: string
  name: string
  nameEn: string | null
  brand: string
  series: string | null
  manufacturerModel: string | null
  specSummary: string | null
  barcode: string | null
  unit: string
  hsCode: string | null
  cnCode: string | null
  countryOfOriginCode: string | null
  netWeight: string | null
  grossWeight: string | null
  volume: string | null
  dimensions: StoreDimensions | null
  cartonQuantity: number | null
  batteryCapacityMah: number | null
  batteryWh: string | null
  containsLithiumBattery: boolean
  certifications: string[] | null
  status: 'active' | 'inactive'
  notes: string | null
  sourceProductId: string | null
  updatedAt: string | null
  variants: StoreVariant[]
}

export type StoreProductInput = {
  sku: string
  name: string
  nameEn?: string | null
  brand?: string | null
  series?: string | null
  manufacturerModel?: string | null
  specSummary?: string | null
  barcode?: string | null
  unit?: string
  hsCode?: string | null
  cnCode?: string | null
  countryOfOriginCode?: string | null
  netWeight?: string | null
  grossWeight?: string | null
  volume?: string | null
  dimensions?: StoreDimensions | null
  cartonQuantity?: number | null
  batteryCapacityMah?: number | null
  batteryWh?: string | null
  containsLithiumBattery?: boolean
  certifications?: string[] | null
  status?: 'active' | 'inactive'
  notes?: string | null
  sourceProductId?: string | null
}

/** App field name → custom field key declared in `ce.ts`. */
const CUSTOM_FIELD_KEYS = {
  nameEn: 'name_en',
  brand: 'brand',
  series: 'series',
  manufacturerModel: 'manufacturer_model',
  specSummary: 'spec_summary',
  barcode: 'barcode',
  cartonQuantity: 'carton_quantity',
  netWeight: 'unit_net_weight',
  grossWeight: 'unit_gross_weight',
  volume: 'unit_volume',
  certifications: 'certifications',
  batteryCapacityMah: 'battery_capacity_mah',
  batteryWh: 'battery_wh',
  notes: 'notes',
  sourceProductId: 'source_product_id',
} as const

// ---------------------------------------------------------------------------------------------
// Scoped read model (Kysely tables this store touches)
// ---------------------------------------------------------------------------------------------

type ProductRow = {
  id: string
  tenant_id: string
  organization_id: string
  title: string
  sku: string | null
  default_unit: string | null
  hs_code: string | null
  cn_code: string | null
  country_of_origin_code: string | null
  weight_value: string | null
  dimensions: Record<string, unknown> | null
  contains_lithium_battery: boolean
  is_active: boolean
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

type VariantRow = {
  id: string
  tenant_id: string
  organization_id: string
  product_id: string
  name: string | null
  sku: string | null
  barcode: string | null
  is_default: boolean
  is_active: boolean
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

type PriceRow = {
  id: string
  tenant_id: string
  organization_id: string
  product_id: string | null
  price_kind_id: string
  currency_code: string
  min_quantity: number
  unit_price_net: string | null
  starts_at: Date | null
  ends_at: Date | null
  created_at: Date
  updated_at: Date
}

type PriceKindRow = {
  id: string
  tenant_id: string
  organization_id: string | null
  code: string
  title: string
  deleted_at: Date | null
}

type CustomValueRow = {
  entity_id: string
  record_id: string
  organization_id: string | null
  tenant_id: string | null
  field_key: string
  value_text: string | null
  value_multiline: string | null
  value_int: number | null
  value_float: number | null
  value_bool: boolean | null
  deleted_at: Date | null
}

type AliasRow = {
  tenant_id: string
  organization_id: string
  alias_code: string
  target_kind: string
  target_id: string
}

type StoreDb = {
  catalog_products: ProductRow
  catalog_product_variants: VariantRow
  catalog_product_variant_prices: PriceRow
  catalog_price_kinds: PriceKindRow
  custom_field_values: CustomValueRow
  product_codes_aliases: AliasRow
}

/** `em.getKysely()` is untyped at the platform boundary; the store's own row types supply the shape. */
function storeDb(em: EntityManager): Kysely<StoreDb> {
  return em.fork().getKysely() as unknown as Kysely<StoreDb>
}

// ---------------------------------------------------------------------------------------------
// Command bus plumbing
// ---------------------------------------------------------------------------------------------

type CommandBusLike = {
  execute<TInput = Record<string, unknown>, TResult = unknown>(
    commandId: string,
    options: { input: TInput; ctx: CommandRuntimeContext },
  ): Promise<{ result: TResult }>
}

/**
 * The catalog commands read the optimistic-lock header from the request; the caller's request
 * belongs to a different form, so it must not be forwarded to the peer write.
 */
async function runPeer<TResult = unknown>(
  ctx: CommandRuntimeContext,
  commandId: string,
  input: Record<string, unknown>,
  origin: string,
): Promise<TResult> {
  const bus = ctx.container.resolve('commandBus') as CommandBusLike
  try {
    const outcome = await bus.execute<Record<string, unknown>, TResult>(commandId, {
      input,
      ctx: { ...ctx, request: undefined, syncOrigin: origin },
    })
    return outcome.result
  } catch (error) {
    if (error instanceof CrudHttpError) {
      // Catalog resolves `default_unit` through its own dictionary and answers a bare
      // `uom.unit_not_found`; that string is a code, not a sentence, and the operator's repair
      // ("add the unit under Dictionaries", or pick one the list carries) is not inferable from it.
      const body = error.body as { error?: unknown } | null | undefined
      if (body?.error === 'uom.unit_not_found') {
        const unit = typeof input.defaultUnit === 'string' ? input.defaultUnit : ''
        throw new CrudHttpError(422, {
          error: unit
            ? `The unit "${unit}" is not in this organization's catalog unit list; add it under Dictionaries or pick a listed code`
            : 'The unit is not in this organization\'s catalog unit list; add it under Dictionaries or pick a listed code',
          code: 'unit_not_in_catalog_dictionary',
        })
      }
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new CrudHttpError(422, { error: summarizePeerFailure(message), code: 'catalog_write_failed' })
  }
}

/**
 * Turns a peer command's zod failure into a sentence an operator can act on.
 *
 * A catalog command validates its own input; when it refuses, the bus raises an error whose
 * `message` is the **stringified issues array** (`[{"expected":"string","path":["barcode"],…}]`), and
 * forwarding that verbatim puts a JSON blob in the form's error banner. The summary keeps the field
 * paths and messages, capped so a whole-payload failure cannot fill the screen, and leaves anything
 * that is not an issues array untouched — a domain error's message is already written for a human.
 */
function summarizePeerFailure(message: string): string {
  const trimmed = message.trim()
  if (!trimmed.startsWith('[')) return message
  let issues: unknown
  try {
    issues = JSON.parse(trimmed)
  } catch {
    return message
  }
  if (!Array.isArray(issues) || issues.length === 0) return message
  const parts = issues
    .slice(0, 3)
    .map((issue) => {
      const record = issue as { path?: unknown; message?: unknown }
      const path = Array.isArray(record?.path) ? record.path.join('.') : ''
      const text = typeof record?.message === 'string' ? record.message : ''
      return path && text ? `${path}: ${text}` : text || path
    })
    .filter((part) => part.length > 0)
  if (parts.length === 0) return message
  const rest = issues.length > parts.length ? ` (+${issues.length - parts.length} more)` : ''
  return `catalog rejected the write — ${parts.join('; ')}${rest}`
}

// ---------------------------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------------------------

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

function decimalOrNull(value: unknown): string | null {
  const text = nullableText(value)
  if (text === null) return null
  return Number.isFinite(Number(text)) ? text : null
}

function toDimensions(value: Record<string, unknown> | null): StoreDimensions | null {
  if (!value) return null
  const readNumber = (key: string): number | null => {
    const raw = value[key]
    if (raw === null || raw === undefined || raw === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    // The app's "length" is catalog's `depth`: the same measurement under a different axis name;
    // `nativeDimensions` applies the inverse mapping on the way in.
    length: readNumber('depth') ?? readNumber('length'),
    width: readNumber('width'),
    height: readNumber('height'),
    unit: typeof value.unit === 'string' && value.unit.length > 0 ? value.unit : null,
  }
}

function nativeDimensions(dimensions: StoreDimensions | null | undefined): Record<string, unknown> | null {
  if (!dimensions) return null
  const native: Record<string, unknown> = {}
  if (dimensions.length !== null && dimensions.length !== undefined) native.depth = dimensions.length
  if (dimensions.width !== null && dimensions.width !== undefined) native.width = dimensions.width
  if (dimensions.height !== null && dimensions.height !== undefined) native.height = dimensions.height
  if (dimensions.unit) native.unit = dimensions.unit
  return Object.keys(native).length > 0 ? native : null
}

function splitCertifications(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value.map((entry) => String(entry)) : nullableText(value)?.split(',') ?? []
  const list = raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  return list.length > 0 ? list : null
}

/**
 * The `cf_*` payload half of a product write.
 *
 * Absent (`undefined`) means "leave the field alone"; an explicit `null` means "clear it" — the
 * platform's custom-field writer stores nulls as removals, so the distinction is what lets an
 * operator blank a note or a barcode again.
 */
export function customFieldPayload(input: Partial<StoreProductInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const put = (key: string, value: unknown) => {
    if (value === undefined) return
    payload[`cf_${key}`] = value
  }
  const text = (value: string | null | undefined) => (value === undefined ? undefined : nullableText(value))
  const number = <T extends number | string | null | undefined>(value: T) =>
    value === undefined ? undefined : (value === null || value === '' ? null : value)
  put(CUSTOM_FIELD_KEYS.nameEn, text(input.nameEn))
  put(CUSTOM_FIELD_KEYS.brand, text(input.brand))
  put(CUSTOM_FIELD_KEYS.series, text(input.series))
  put(CUSTOM_FIELD_KEYS.manufacturerModel, text(input.manufacturerModel))
  put(CUSTOM_FIELD_KEYS.specSummary, text(input.specSummary))
  put(CUSTOM_FIELD_KEYS.barcode, text(input.barcode))
  put(CUSTOM_FIELD_KEYS.cartonQuantity, number(input.cartonQuantity))
  put(CUSTOM_FIELD_KEYS.netWeight, number(decimalOrNull(input.netWeight)))
  put(CUSTOM_FIELD_KEYS.grossWeight, number(decimalOrNull(input.grossWeight)))
  put(CUSTOM_FIELD_KEYS.volume, number(decimalOrNull(input.volume)))
  put(
    CUSTOM_FIELD_KEYS.certifications,
    input.certifications === undefined ? undefined : input.certifications ? input.certifications.join(', ') : null,
  )
  put(CUSTOM_FIELD_KEYS.batteryCapacityMah, number(input.batteryCapacityMah))
  put(CUSTOM_FIELD_KEYS.batteryWh, number(decimalOrNull(input.batteryWh)))
  put(CUSTOM_FIELD_KEYS.notes, text(input.notes))
  put(CUSTOM_FIELD_KEYS.sourceProductId, text(input.sourceProductId))
  return payload
}

/**
 * The catalog-native half of a product write.
 *
 * Only the keys the caller actually provided are emitted: a create fills every default in its
 * validator (unit `PCS`, status `active`, lithium `false`), while a partial update must not reset a
 * column it never mentioned — `undefined` means "leave it alone" here, exactly like the custom-field
 * half.
 */
export function nativeProductPayload(input: Partial<StoreProductInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = { customFieldsetCode: PRODUCT_ERP_FIELDSET }
  if (input.name !== undefined) payload.title = input.name
  if (input.sku !== undefined) payload.sku = input.sku
  if (input.unit !== undefined) payload.defaultUnit = input.unit
  if (input.status !== undefined) payload.isActive = input.status === 'active'
  if (input.hsCode !== undefined) payload.hsCode = nullableText(input.hsCode)
  if (input.cnCode !== undefined) payload.cnCode = nullableText(input.cnCode)
  if (input.countryOfOriginCode !== undefined) payload.countryOfOriginCode = nullableText(input.countryOfOriginCode)
  if (input.netWeight !== undefined) {
    const hasWeight = input.netWeight !== null && input.netWeight !== ''
    payload.weightValue = hasWeight ? Number(input.netWeight) : null
    payload.weightUnit = hasWeight ? 'kg' : null
  }
  if (input.dimensions !== undefined) payload.dimensions = nativeDimensions(input.dimensions ?? null)
  if (input.containsLithiumBattery !== undefined) payload.containsLithiumBattery = input.containsLithiumBattery
  return payload
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

type CustomValueColumns = Pick<
  CustomValueRow,
  'value_text' | 'value_multiline' | 'value_int' | 'value_float' | 'value_bool'
>

function customValueOf(row: CustomValueColumns): unknown {
  if (row.value_text !== null && row.value_text !== undefined) return row.value_text
  if (row.value_multiline !== null && row.value_multiline !== undefined) return row.value_multiline
  if (row.value_int !== null && row.value_int !== undefined) return row.value_int
  if (row.value_float !== null && row.value_float !== undefined) return row.value_float
  if (row.value_bool !== null && row.value_bool !== undefined) return row.value_bool
  return null
}

function mapProduct(row: ProductRow, customFields: Map<string, unknown>, variants: StoreVariant[]): StoreProduct {
  const customText = (key: string): string | null => {
    const value = customFields.get(key)
    return value === null || value === undefined ? null : String(value)
  }
  const customNumber = (key: string): number | null => {
    const value = customFields.get(key)
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    id: String(row.id),
    sku: String(row.sku ?? ''),
    name: String(row.title ?? ''),
    nameEn: customText(CUSTOM_FIELD_KEYS.nameEn),
    brand: customText(CUSTOM_FIELD_KEYS.brand) ?? '',
    series: customText(CUSTOM_FIELD_KEYS.series),
    manufacturerModel: customText(CUSTOM_FIELD_KEYS.manufacturerModel),
    specSummary: customText(CUSTOM_FIELD_KEYS.specSummary),
    barcode: customText(CUSTOM_FIELD_KEYS.barcode),
    unit: String(row.default_unit ?? 'PCS'),
    hsCode: row.hs_code ?? null,
    cnCode: row.cn_code ?? null,
    countryOfOriginCode: row.country_of_origin_code ?? null,
    netWeight: decimalOrNull(row.weight_value),
    grossWeight: decimalOrNull(customText(CUSTOM_FIELD_KEYS.grossWeight)),
    volume: decimalOrNull(customText(CUSTOM_FIELD_KEYS.volume)),
    dimensions: row.dimensions ? toDimensions(row.dimensions) : null,
    cartonQuantity: customNumber(CUSTOM_FIELD_KEYS.cartonQuantity),
    batteryCapacityMah: customNumber(CUSTOM_FIELD_KEYS.batteryCapacityMah),
    batteryWh: decimalOrNull(customText(CUSTOM_FIELD_KEYS.batteryWh)),
    containsLithiumBattery: Boolean(row.contains_lithium_battery),
    certifications: splitCertifications(customFields.get(CUSTOM_FIELD_KEYS.certifications)),
    status: row.is_active ? 'active' : 'inactive',
    notes: customText(CUSTOM_FIELD_KEYS.notes),
    sourceProductId: customText(CUSTOM_FIELD_KEYS.sourceProductId),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    variants,
  }
}

async function loadCustomFields(
  em: EntityManager,
  scope: StoreScope,
  entityId: string,
  recordIds: string[],
): Promise<Map<string, Map<string, unknown>>> {
  const byRecord = new Map<string, Map<string, unknown>>()
  if (recordIds.length === 0) return byRecord
  const rows = await storeDb(em)
    .selectFrom('custom_field_values')
    .select(['record_id', 'field_key', 'value_text', 'value_multiline', 'value_int', 'value_float', 'value_bool'])
    .where('entity_id', '=', entityId)
    .where('record_id', 'in', recordIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .execute()
  for (const row of rows) {
    const bucket = byRecord.get(String(row.record_id)) ?? new Map<string, unknown>()
    bucket.set(String(row.field_key), customValueOf(row))
    byRecord.set(String(row.record_id), bucket)
  }
  return byRecord
}

async function loadVariantsByProduct(
  em: EntityManager,
  scope: StoreScope,
  productIds: string[],
): Promise<Map<string, StoreVariant[]>> {
  const byProduct = new Map<string, StoreVariant[]>()
  if (productIds.length === 0) return byProduct
  const rows = await storeDb(em)
    .selectFrom('catalog_product_variants')
    .select(['id', 'product_id', 'name', 'sku', 'barcode', 'is_default', 'is_active', 'updated_at'])
    .where('product_id', 'in', productIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .orderBy('is_default', 'desc')
    .orderBy('created_at', 'asc')
    .execute()
  for (const row of rows) {
    const key = String(row.product_id)
    const list = byProduct.get(key) ?? []
    list.push({
      id: String(row.id),
      sku: String(row.sku ?? ''),
      name: row.name ?? null,
      barcode: row.barcode ?? null,
      isDefault: Boolean(row.is_default),
      isActive: Boolean(row.is_active),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    })
    byProduct.set(key, list)
  }
  return byProduct
}

export type ListProductsInput = {
  em: EntityManager
  scope: StoreScope
  ids?: string[]
  skus?: string[]
  search?: string | null
  status?: 'active' | 'inactive' | 'all'
  page?: number
  pageSize?: number
}

/**
 * List products of one organization, searchable by SKU, name or a legacy alias.
 *
 * The alias half reads `product_codes_aliases` (kind `product`) so an old code printed on a paper
 * document still finds its product — the alias store outlived the code-issuance retirement.
 */
export async function listStoreProducts(input: ListProductsInput): Promise<{ items: StoreProduct[]; total: number }> {
  const { em, scope } = input
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50))

  let base = storeDb(em)
    .selectFrom('catalog_products')
    .select(['id', 'title', 'sku', 'default_unit', 'hs_code', 'cn_code', 'country_of_origin_code', 'weight_value', 'dimensions', 'contains_lithium_battery', 'is_active', 'created_at', 'updated_at'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)

  if (input.ids && input.ids.length > 0) base = base.where('id', 'in', input.ids)
  if (input.skus && input.skus.length > 0) base = base.where('sku', 'in', input.skus)
  if (input.status === 'active') base = base.where('is_active', '=', true)
  if (input.status === 'inactive') base = base.where('is_active', '=', false)

  const term = typeof input.search === 'string' ? input.search.trim() : ''
  if (term.length > 0) {
    const pattern = `%${term.replace(/[%_\\]/g, (match) => `\\${match}`)}%`
    const aliasRows = await storeDb(em)
      .selectFrom('product_codes_aliases')
      .select(['target_id'])
      .where('alias_code', 'ilike', pattern)
      .where('target_kind', '=', 'product')
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .execute()
    const aliasIds = aliasRows.map((row) => String(row.target_id)).filter((id) => id.length > 0)
    base = base.where(
      aliasIds.length > 0
        ? sql<boolean>`(sku ilike ${pattern} or title ilike ${pattern} or id in (${sql.join(aliasIds)}))`
        : sql<boolean>`(sku ilike ${pattern} or title ilike ${pattern})`,
    )
  }

  const countRow = await base
    .clearSelect()
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirst()
  const total = Number(countRow?.count ?? 0)

  const rows = await base
    .clearSelect()
    .select(['id', 'title', 'sku', 'default_unit', 'hs_code', 'cn_code', 'country_of_origin_code', 'weight_value', 'dimensions', 'contains_lithium_battery', 'is_active', 'created_at', 'updated_at'])
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute()

  const ids = rows.map((row) => String(row.id))
  const [customByRecord, variantsByProduct] = await Promise.all([
    loadCustomFields(em, scope, PRODUCT_ENTITY_ID, ids),
    loadVariantsByProduct(em, scope, ids),
  ])

  return {
    items: rows.map((row) =>
      mapProduct(row as ProductRow, customByRecord.get(String(row.id)) ?? new Map(), variantsByProduct.get(String(row.id)) ?? []),
    ),
    total,
  }
}

async function loadProductRow(
  em: EntityManager,
  scope: StoreScope,
  where: { id?: string; sku?: string },
): Promise<ProductRow | null> {
  let query = storeDb(em)
    .selectFrom('catalog_products')
    .select(['id', 'title', 'sku', 'default_unit', 'hs_code', 'cn_code', 'country_of_origin_code', 'weight_value', 'dimensions', 'contains_lithium_battery', 'is_active', 'created_at', 'updated_at'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
  if (where.id) query = query.where('id', '=', where.id)
  if (where.sku) query = query.where('sku', '=', where.sku)
  const row = await query.executeTakeFirst()
  return (row as ProductRow | undefined) ?? null
}

export async function getStoreProduct(input: {
  em: EntityManager
  scope: StoreScope
  id: string
}): Promise<StoreProduct | null> {
  const row = await loadProductRow(input.em, input.scope, { id: input.id })
  if (!row) return null
  const [customByRecord, variantsByProduct] = await Promise.all([
    loadCustomFields(input.em, input.scope, PRODUCT_ENTITY_ID, [input.id]),
    loadVariantsByProduct(input.em, input.scope, [input.id]),
  ])
  return mapProduct(row, customByRecord.get(input.id) ?? new Map(), variantsByProduct.get(input.id) ?? [])
}

export async function findStoreProductBySku(input: {
  em: EntityManager
  scope: StoreScope
  sku: string
}): Promise<StoreProduct | null> {
  const row = await loadProductRow(input.em, input.scope, { sku: input.sku })
  if (!row) return null
  return getStoreProduct({ em: input.em, scope: input.scope, id: String(row.id) })
}

// ---------------------------------------------------------------------------------------------
// Price kinds
// ---------------------------------------------------------------------------------------------

async function ensurePriceKind(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: StoreScope
  tier: PriceTier
}): Promise<string> {
  const { em, ctx, scope, tier } = input
  const existing = await storeDb(em)
    .selectFrom('catalog_price_kinds')
    .select(['id'])
    .where('code', '=', tier)
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  if (existing) return String(existing.id)
  const result = await runPeer<{ priceKindId?: string; id?: string }>(
    ctx,
    'catalog.priceKinds.create',
    { tenantId: scope.tenantId, code: tier, title: TIER_TITLES[tier] },
    'products:ensure-price-kind',
  )
  const id = result?.priceKindId ?? result?.id
  if (!id) throw new CrudHttpError(500, { error: `Price kind ${tier} could not be created`, code: 'price_kind_missing' })
  return String(id)
}

export async function listStorePrices(input: {
  em: EntityManager
  scope: StoreScope
  productId: string
}): Promise<StorePrice[]> {
  const rows = await storeDb(input.em)
    .selectFrom('catalog_product_variant_prices as p')
    .leftJoin('catalog_price_kinds as k', 'k.id', 'p.price_kind_id')
    .select([
      'p.id as id',
      'p.currency_code as currency_code',
      'p.min_quantity as min_quantity',
      'p.unit_price_net as unit_price_net',
      'p.starts_at as starts_at',
      'p.ends_at as ends_at',
      'k.code as kind_code',
    ])
    .where('p.product_id', '=', input.productId)
    .where('p.tenant_id', '=', input.scope.tenantId)
    .where('p.organization_id', '=', input.scope.organizationId)
    .orderBy('p.min_quantity', 'asc')
    .execute()
  const now = Date.now()
  return rows
    .filter((row) => (PRICE_TIERS as readonly string[]).includes(String(row.kind_code)))
    .map((row) => ({
      id: String(row.id),
      tier: String(row.kind_code) as PriceTier,
      currencyCode: String(row.currency_code),
      minQuantity: Number(row.min_quantity ?? 1),
      unitPrice: decimalOrNull(row.unit_price_net) ?? '0',
      startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
      endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
      isActive: !row.ends_at || new Date(row.ends_at).getTime() > now,
    }))
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export type CreateStoreProductInput = {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: StoreScope
  input: StoreProductInput
  variants?: StoreVariantInput[]
  prices?: StorePriceInput[]
  origin?: string
}

/** One action: catalog product + its variants (+ prices). Returns the catalog product id. */
export async function createStoreProduct(args: CreateStoreProductInput): Promise<{ id: string; variantIds: string[] }> {
  const { em, ctx, scope, input } = args
  const origin = args.origin ?? 'products:store-create'
  const created = await runPeer<{ id?: string; productId?: string }>(
    ctx,
    'catalog.products.create',
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...nativeProductPayload(input),
      ...customFieldPayload(input),
    },
    origin,
  )
  const productId = String(created?.id ?? created?.productId ?? '')
  if (!productId) throw new CrudHttpError(500, { error: 'catalog.products.create returned no id', code: 'store_create_failed' })

  const variants = args.variants && args.variants.length > 0 ? args.variants : [{ sku: input.sku, name: input.name, isDefault: true }]
  const variantIds: string[] = []
  for (const variant of variants) {
    variantIds.push(await createStoreVariant({ em, ctx, scope, productId, variant, origin }))
  }
  if (args.prices && args.prices.length > 0) {
    await replaceStorePrices({ em, ctx, scope, productId, rows: args.prices, origin })
  }
  return { id: productId, variantIds }
}

export async function createStoreVariant(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: StoreScope
  productId: string
  variant: StoreVariantInput
  origin?: string
}): Promise<string> {
  const { ctx, scope, productId, variant } = input
  const result = await runPeer<{ id?: string; variantId?: string }>(
    ctx,
    'catalog.variants.create',
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      productId,
      sku: variant.sku,
      ...variantTextPayload(variant),
      isDefault: variant.isDefault ?? false,
      isActive: variant.isActive ?? true,
      customFieldsetCode: PRODUCT_ERP_FIELDSET,
    },
    input.origin ?? 'products:store-variant-create',
  )
  const id = String(result?.id ?? result?.variantId ?? '')
  if (!id) throw new CrudHttpError(500, { error: 'catalog.variants.create returned no id', code: 'store_variant_create_failed' })
  return id
}

/**
 * The two variant fields catalog accepts as **optional strings only**.
 *
 * `catalog/data/validators.ts` declares `name`/`barcode` as `z.string().optional()` on both create and
 * update, and its GTIN refinement rejects a *present but blank* barcode — so `null` is an
 * `invalid_type` error and `''` is a validation error. Only the keys with a value are sent: a blank
 * submission means "leave the stored value alone", which is the only behavior the platform contract
 * leaves open (measured 2026-10-10: `barcode: null` on a variant create answered
 * `422 catalog_write_failed` with `path: ['barcode']`, and it broke every product fixture in the
 * integration suite).
 */
function variantTextPayload(variant: StoreVariantInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const name = variant.name?.trim()
  if (name) payload.name = name
  const barcode = variant.barcode?.trim()
  if (barcode) payload.barcode = barcode
  return payload
}

export type UpdateStoreProductInput = {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: StoreScope
  id: string
  /**
   * A **partial** product: absent keys are left alone by the catalog write, and that is load-bearing
   * rather than convenient — `products.items.update` drops `sku` when the operator did not change it,
   * because catalog's schema re-validates the charset and a legacy SKU (written by a migration, e.g.
   * one carrying a space) would otherwise refuse the whole update.
   */
  input: Partial<StoreProductInput>
  variants?: StoreVariantInput[]
  prices?: StorePriceInput[]
  origin?: string
}

export async function updateStoreProduct(args: UpdateStoreProductInput): Promise<void> {
  const { em, ctx, scope, id, input } = args
  const origin = args.origin ?? 'products:store-update'
  await runPeer(
    ctx,
    'catalog.products.update',
    {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...nativeProductPayload(input),
      ...customFieldPayload(input),
    },
    origin,
  )

  if (args.variants) {
    const variants = args.variants
    const existing = await loadVariantsByProduct(em, scope, [id])
    const current = existing.get(id) ?? []
    const keep = new Set(variants.map((variant) => variant.id).filter((value): value is string => Boolean(value)))
    for (const row of current) {
      if (keep.has(row.id)) continue
      await runPeer(
        ctx,
        'catalog.variants.delete',
        { id: row.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
        `${origin}:variant-delete`,
      )
    }
    for (const variant of variants) {
      if (variant.id) {
        await runPeer(
          ctx,
          'catalog.variants.update',
          {
            id: variant.id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            sku: variant.sku,
            ...variantTextPayload(variant),
            isDefault: variant.isDefault ?? false,
            isActive: variant.isActive ?? true,
          },
          `${origin}:variant-update`,
        )
      } else {
        await createStoreVariant({ em, ctx, scope, productId: id, variant, origin: `${origin}:variant-create` })
      }
    }
  }

  if (args.prices) {
    await replaceStorePrices({ em, ctx, scope, productId: id, rows: args.prices, origin: `${origin}:prices` })
  }
}

export async function deleteStoreProduct(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: StoreScope
  id: string
}): Promise<void> {
  await runPeer(
    input.ctx,
    'catalog.products.delete',
    { id: input.id, tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
    'products:store-delete',
  )
}

/**
 * Replace a product's whole price set for the three business tiers.
 *
 * A row that disappears from the payload is **closed**, not deleted: the catalog price table has
 * no soft-delete column, so its `ends_at` is set to now — the row survives for anyone explaining a
 * document it once fed, and it stops being an active price. Rows of other kinds (platform
 * promotions and the like) are untouched.
 */
/**
 * The variant a product's price rows hang on: its default one, else the first active variant.
 *
 * A product without any variant cannot carry a price set the platform can update — the write is
 * refused with a message that names the repair instead of leaving a half-written set behind.
 */
async function resolvePriceVariantId(
  em: EntityManager,
  scope: StoreScope,
  productId: string,
): Promise<string> {
  const byProduct = await loadVariantsByProduct(em, scope, [productId])
  const rows = byProduct.get(productId) ?? []
  const target =
    rows.find((variant) => variant.isDefault && variant.isActive) ??
    rows.find((variant) => variant.isDefault) ??
    rows.find((variant) => variant.isActive) ??
    rows[0]
  if (!target) {
    throw new CrudHttpError(422, {
      error:
        'This product has no variant, so its price set cannot be stored; add a sellable unit (variants) on the product first',
      code: 'product_has_no_variant',
    })
  }
  return target.id
}

export async function replaceStorePrices(input: {
  em: EntityManager
  ctx: CommandRuntimeContext
  scope: StoreScope
  productId: string
  rows: StorePriceInput[]
  origin?: string
}): Promise<void> {
  const { em, ctx, scope, productId } = input
  const origin = input.origin ?? 'products:store-prices'
  const existing = await listStorePrices({ em, scope, productId })
  /**
   * Every row is written against the product's **default variant**.
   *
   * Catalog accepts a variant-less price row on create (it keeps `product_id`), but the platform's
   * `catalog.prices.update` guard resolves a row's scope **through its variant**: with none, the
   * organization it checks is empty and the command answers `403 Forbidden` (measured 2026-10-10 —
   * which is why "a tier disappears → the row is closed" silently never worked, and a narrowing
   * submission left a half-written set behind). The demo/installed data attaches prices to variants
   * for the same reason, and stock receipt is variant-level anyway, so the price set belongs there.
   */
  const variantId = await resolvePriceVariantId(em, scope, productId)

  const kindIds = new Map<PriceTier, string>()
  const kindId = async (tier: PriceTier) => {
    const cached = kindIds.get(tier)
    if (cached) return cached
    const resolved = await ensurePriceKind({ em, ctx, scope, tier })
    kindIds.set(tier, resolved)
    return resolved
  }

  const seen = new Set<string>()
  for (const row of input.rows) {
    const minQuantity = row.minQuantity && row.minQuantity >= 1 ? Math.round(row.minQuantity) : 1
    const key = `${row.tier}|${row.currencyCode}|${minQuantity}`
    seen.add(key)
    const priceKindId = await kindId(row.tier)
    const payload = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      productId,
      variantId,
      currencyCode: row.currencyCode,
      priceKindId,
      minQuantity,
      unitPriceNet: Number(row.unitPrice),
      startsAt: row.startsAt ? new Date(row.startsAt) : undefined,
      endsAt: row.endsAt ? new Date(row.endsAt) : undefined,
    }
    const match = existing.find(
      (price) => price.tier === row.tier && price.currencyCode === row.currencyCode && price.minQuantity === minQuantity,
    )
    if (match) {
      await runPeer(ctx, 'catalog.prices.update', { id: match.id, ...payload }, origin)
    } else {
      await runPeer(ctx, 'catalog.prices.create', payload, origin)
    }
  }

  const now = new Date()
  for (const price of existing) {
    if (!price.isActive) continue
    if (seen.has(`${price.tier}|${price.currencyCode}|${price.minQuantity}`)) continue
    await runPeer(
      ctx,
      'catalog.prices.update',
      {
        id: price.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        productId,
        variantId,
        endsAt: now,
      },
      `${origin}:close`,
    )
  }
}
