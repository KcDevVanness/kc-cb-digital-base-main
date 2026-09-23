"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadProductOption, loadProductOptions, type ProductOption } from '../../products/components/formOptions'

/**
 * App-owned create/edit surface for the internal-sales documents (quote, order).
 *
 * The documents themselves stay where they belong — the installed `sales` chain owns numbering,
 * statuses, totals, shipments and invoices, and this module drives that chain through its public
 * API (`POST /api/sales/{quotes,orders}`) instead of reimplementing it. What this module owns is the
 * **flow and the picker**: lines reference the app-owned product master
 * (`products_products.id`, see .ai/specs/2026-09-22-products-and-trade-docs.md), so the operator
 * chooses from the products the business actually maintains instead of the installed catalog.
 *
 * Lines also carry the product's catalog **variant** when the product is linked to one: the sales
 * chain books fulfilment per variant and the warehouse receives per variant, so the bridge is
 * written here, once, and the operator never sees a variant picker.
 */

export type InternalSalesKind = 'quote' | 'order'

const CUSTOMERS_API_PATH = 'customers/companies'
const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'
const CATALOG_VARIANTS_URL = '/api/catalog/variants'
/**
 * This module's own list routes.
 *
 * The installed lists (`/backend/sales/quotes`, `/backend/sales/orders`) stay visible in their own
 * navigation group as the platform's view of the same documents; these are where the operator
 * creates and edits them.
 */
const QUOTES_HREF = '/backend/internal-sales/quotes'
/** Bound of the installed sales line collections; a larger `pageSize` is answered with a 400. */
const LINES_PAGE_SIZE = 100
const ORDERS_HREF = '/backend/internal-sales/orders'

function apiPathFor(kind: InternalSalesKind): string {
  return kind === 'quote' ? 'sales/quotes' : 'sales/orders'
}

/**
 * The installed line collection of a document.
 *
 * The document's own list projection carries only the head; lines live in their own collection
 * route, keyed by the kind's foreign key (`quoteId` / `orderId`).
 */
function linesApiPathFor(kind: InternalSalesKind): string {
  return kind === 'quote' ? 'sales/quote-lines' : 'sales/order-lines'
}

function linesFilterFor(kind: InternalSalesKind, documentId: string): Record<string, string> {
  return kind === 'quote' ? { quoteId: documentId } : { orderId: documentId }
}

/** The installed list a document belongs to (where the operator goes after cancelling). */
export function listHrefFor(kind: InternalSalesKind): string {
  return kind === 'quote' ? QUOTES_HREF : ORDERS_HREF
}

/**
 * This module's own edit page for a document.
 *
 * Deliberately not the installed viewer: the installed dynamic sales pages (`/backend/sales/
 * documents/[id]`, `quotes/[id]`, `orders/[id]`) answer 404 in this deployment while their list
 * pages render, so pointing an operator there would strand them right after a save. Keeping the
 * destination inside the app-owned surface also means list → edit → save never leaves it.
 */
export function documentDetailHref(kind: InternalSalesKind, documentId: string): string {
  return `${listHrefFor(kind)}/${documentId}/edit`
}

export type InternalSalesLineValues = {
  key: string
  productId: string
  /** Display label only; never submitted. */
  productLabel: string
  /** Resolved from the product's catalog link; the fulfilment half needs it. */
  productVariantId: string
  name: string
  spec: string
  sku: string
  quantity: string
  unitPriceNet: string
  note: string
}

export type InternalSalesFormValues = {
  id?: string
  /**
   * Optional link to a customer company record.
   *
   * Optional on purpose: in this deployment a branch is an organization, not a customer record, so
   * the buyer is often typed by name only. The installed line schema treats the id as optional too,
   * and `customerSnapshot` carries whatever the document must print.
   */
  customerEntityId: string
  customerName: string
  currencyCode: string
  customerReference: string
  comments: string
  lines: InternalSalesLineValues[]
  updatedAt?: string | null
}

const EMPTY_LINE: InternalSalesLineValues = {
  key: 'line-1',
  productId: '',
  productLabel: '',
  productVariantId: '',
  name: '',
  spec: '',
  sku: '',
  quantity: '1',
  unitPriceNet: '0',
  note: '',
}

const EMPTY_VALUES: InternalSalesFormValues = {
  customerEntityId: '',
  customerName: '',
  currencyCode: '',
  customerReference: '',
  comments: '',
  lines: [{ ...EMPTY_LINE }],
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function snapshotValue(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

export function toInternalSalesFormValues(
  item: Record<string, unknown>,
  lines: InternalSalesLineValues[] = [],
): InternalSalesFormValues {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    customerEntityId: readText(item, 'customerEntityId', 'customer_entity_id'),
    customerName: snapshotValue(item.customerSnapshot ?? item.customer_snapshot, 'name'),
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    customerReference: readText(item, 'customerReference', 'customer_reference'),
    comments: readText(item, 'comments'),
    lines: lines.length > 0 ? lines : [{ ...EMPTY_LINE }],
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

export function toInternalSalesLineValues(item: Record<string, unknown>): InternalSalesLineValues {
  return {
    key: String(item.id ?? `line-${item.lineNumber ?? Math.random()}`),
    productId: readText(item, 'productId', 'product_id'),
    productLabel: readText(item, 'name'),
    productVariantId: readText(item, 'productVariantId', 'product_variant_id'),
    name: readText(item, 'name'),
    spec: snapshotValue(item.catalogSnapshot ?? item.catalog_snapshot, 'spec'),
    sku: snapshotValue(item.catalogSnapshot ?? item.catalog_snapshot, 'sku'),
    quantity: readText(item, 'quantity') || '0',
    unitPriceNet: readText(item, 'unitPriceNet', 'unit_price_net') || '0',
    note: readText(item, 'comment'),
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toLinePayload(
  kind: InternalSalesKind,
  documentId: string,
  values: InternalSalesFormValues,
  line: InternalSalesLineValues,
): Record<string, unknown> {
  const currencyCode = values.currencyCode.trim().toUpperCase()
  return {
    // A row that came from the server keeps its line id, which is what makes the upsert an update
    // instead of a second row.
    ...(UUID_PATTERN.test(line.key) ? { id: line.key } : {}),
    // The parent key belongs on the collection payload only; the document create command injects it.
    ...(documentId ? { [kind === 'quote' ? 'quoteId' : 'orderId']: documentId } : {}),
    kind: 'product',
    productId: line.productId.trim() ? line.productId.trim() : undefined,
    productVariantId: line.productVariantId.trim() ? line.productVariantId.trim() : undefined,
    name: line.name.trim() || undefined,
    description: line.spec.trim() || undefined,
    comment: line.note.trim() || undefined,
    currencyCode,
    quantity: line.quantity.trim() ? line.quantity.trim() : '0',
    unitPriceNet: line.unitPriceNet.trim() ? line.unitPriceNet.trim() : '0',
    catalogSnapshot: {
      sku: line.sku.trim() || null,
      name: line.name.trim() || null,
      spec: line.spec.trim() || null,
    },
  }
}

function usableLines(values: InternalSalesFormValues): InternalSalesLineValues[] {
  return values.lines.filter((line) => line.productId.trim().length > 0 || line.name.trim().length > 0)
}

function toHeadPayload(values: InternalSalesFormValues): Record<string, unknown> {
  const customerName = values.customerName.trim()
  return {
    currencyCode: values.currencyCode.trim().toUpperCase(),
    customerEntityId: values.customerEntityId.trim() ? values.customerEntityId.trim() : undefined,
    // The snapshot is what the document prints, so a buyer that has no customer record still lands
    // on the quote/order instead of forcing a master-data detour before the first sale.
    customerSnapshot: customerName ? { name: customerName } : undefined,
    customerReference: values.customerReference.trim() ? values.customerReference.trim() : undefined,
    comments: values.comments.trim() ? values.comments.trim() : undefined,
  }
}

/**
 * Payload for `POST /api/sales/{quotes,orders}`.
 *
 * The create command takes the head **and** the lines in one call. `currencyCode` is required per
 * line as well as per document, and the totals block is deliberately omitted: the installed sales
 * engine computes it from the lines, so sending our own would only give it a second opinion.
 */
export function buildInternalSalesPayload(
  kind: InternalSalesKind,
  values: InternalSalesFormValues,
): Record<string, unknown> {
  return {
    ...toHeadPayload(values),
    lines: usableLines(values).map((line) => toLinePayload(kind, '', values, line)),
  }
}

/**
 * The **edit** path, which is not the create path.
 *
 * Two platform behaviours shape it, both verified in the installed code:
 *
 * - `sales.quotes.update` / `sales.orders.update` apply **scalar head fields only**; they never
 *   replace lines. Lines are owned by their own collection endpoint, whose create and update verbs
 *   both hit one `…lines.upsert` command.
 * - Every sales command, lines included, locks the **parent document's** version
 *   (`enforceSalesDocumentOptimisticLock`), and a line write bumps it by recalculating the totals.
 *   So exactly one write may carry the version the operator loaded: the head patch. After it, the
 *   line writes are guarded by the aggregate the head patch just re-checked — which is the split
 *   `CrudForm` documents for a form whose locking is owned elsewhere.
 *
 * Order therefore matters: head first (locked), then reconcile lines. A concurrent editor loses at
 * the head patch with a 409 and is asked to reload, which is the safety property that matters.
 */
export async function saveInternalSalesDocument(
  kind: InternalSalesKind,
  documentId: string,
  values: InternalSalesFormValues,
  loadedLineIds: readonly string[],
): Promise<void> {
  await withScopedApiRequestHeaders(buildOptimisticLockHeader(values.updatedAt ?? null), () =>
    updateCrud(apiPathFor(kind), {
      id: documentId,
      ...toHeadPayload(values),
      updatedAt: values.updatedAt ?? null,
    }),
  )

  const submitted = usableLines(values)
  const keptIds = new Set<string>()
  for (const line of submitted) {
    await updateCrud(linesApiPathFor(kind), toLinePayload(kind, documentId, values, line))
    if (UUID_PATTERN.test(line.key)) keptIds.add(line.key)
  }
  for (const loadedId of loadedLineIds) {
    if (keptIds.has(loadedId)) continue
    await deleteCrud(linesApiPathFor(kind), { id: loadedId, ...linesFilterFor(kind, documentId) })
  }
}

async function loadCurrencyOptions(errorMessage: string) {
  const payload = await readApiResultOrThrow<{ entries?: Array<{ value?: string; label?: string }> }>(
    CURRENCY_DICTIONARY_URL,
    undefined,
    { errorMessage },
  )
  return (payload.entries ?? [])
    .map((entry) => {
      const value = typeof entry.value === 'string' ? entry.value.trim().toUpperCase() : ''
      if (!value) return null
      const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : value
      return { value, label: `${value} — ${label}` }
    })
    .filter((option): option is { value: string; label: string } => option !== null)
    .sort((left, right) => left.value.localeCompare(right.value))
}

/** The buyer: an existing customer company (a branch is a company record in this deployment). */
async function loadCustomerOptions(errorMessage: string, organizationId?: string | null) {
  const payload = await fetchCrudList<Record<string, unknown>>(CUSTOMERS_API_PATH, {
    pageSize: 200,
    sortField: 'name',
    sortDir: 'asc',
    ...(organizationId ? { organizationId } : {}),
  })
  return (payload.items ?? []).map((item) => {
    const id = String(item.id ?? '')
    const name = readText(item, 'name', 'displayName', 'display_name') || id
    return { value: id, label: name }
  })
}

/**
 * The default active variant of a catalog product.
 *
 * Resolved lazily, only for a product whose option carries the link, and only to fill the line's
 * variant reference. A failure (no link, no variant, catalog API unreachable) leaves the line
 * without a variant rather than blocking the document: the document is valid, and the fulfilment
 * step is the one that reports a missing variant.
 */
async function resolveVariantId(catalogProductId: string): Promise<string> {
  if (!catalogProductId) return ''
  try {
    const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `${CATALOG_VARIANTS_URL}?productId=${encodeURIComponent(catalogProductId)}&pageSize=50`,
      undefined,
      { fallback: { items: [] }, errorMessage: '' },
    )
    // The catalog list answers in snake_case (`is_default`/`is_active`); both spellings are read so
    // a future casing change cannot silently drop the variant bridge.
    const variants = (payload.items ?? []).filter((variant) => {
      const active = variant.isActive ?? variant.is_active
      return active !== false
    })
    const preferred =
      variants.find((variant) => (variant.isDefault ?? variant.is_default) === true) ?? variants[0]
    return preferred ? String(preferred.id ?? '') : ''
  } catch {
    return ''
  }
}

function InternalSalesLinesEditor(
  { values, setValue, t }: CrudFormGroupComponentProps & { t: TranslateFn },
) {
  const { organizationId } = useOrganizationScopeDetail()
  const lines = React.useMemo(() => {
    const raw = values.lines
    return Array.isArray(raw) ? (raw as InternalSalesLineValues[]) : []
  }, [values.lines])
  const productCache = React.useRef(new Map<string, ProductOption>())
  /**
   * Latest rows, for reads that happen after an `await`.
   *
   * `setValue` has no functional form, so an async continuation would otherwise write from the rows
   * captured at render time and silently drop an edit made while it was in flight — the row would
   * come back without the product it had just been given.
   */
  const linesRef = React.useRef(lines)
  linesRef.current = lines

  const updateLine = React.useCallback(
    (index: number, patch: Partial<InternalSalesLineValues>) => {
      setValue('lines', lines.map((line, position) => (position === index ? { ...line, ...patch } : line)))
    },
    [lines, setValue],
  )

  const addLine = React.useCallback(() => {
    setValue('lines', [...lines, { ...EMPTY_LINE, key: `line-${Date.now()}` }])
  }, [lines, setValue])

  const removeLine = React.useCallback(
    (index: number) => {
      const next = lines.filter((_, position) => position !== index)
      setValue('lines', next.length > 0 ? next : [{ ...EMPTY_LINE }])
    },
    [lines, setValue],
  )

  /**
   * Selecting a product fills the printed line and resolves its variant bridge.
   *
   * Every await happens **before** the single state write: the row is patched once, with the full
   * line, so a slow lookup can never land a second, stale-array write behind it. If the operator
   * changed the row's product while the lookup was running, the patch is dropped instead of
   * overwriting their newer choice.
   */
  const handleProductChange = React.useCallback(
    async (index: number, productId: string) => {
      if (!productId) {
        updateLine(index, { productId: '', productVariantId: '', productLabel: '' })
        return
      }
      updateLine(index, { productId, productLabel: '', productVariantId: '' })
      const option =
        productCache.current.get(productId) ??
        (await loadProductOption(productId, t('internal_sales.form.productLoadFailed'), organizationId))
      if (!option) return
      productCache.current.set(option.value, option)
      const variantId = await resolveVariantId(option.catalogProductId)
      if (linesRef.current[index]?.productId !== productId) return
      updateLine(index, {
        productId: option.value,
        productLabel: option.label,
        name: option.name,
        spec: option.spec,
        sku: option.sku,
        productVariantId: variantId,
      })
    },
    [organizationId, t, updateLine],
  )

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('internal_sales.form.lines.empty')}</p>
      ) : null}
      {lines.map((line, index) => (
        <div key={line.key} className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`internal-sales-product-${index}`} required>
                {t('internal_sales.form.lines.product')}
              </FieldLabel>
              <ComboboxInput
                value={line.productId}
                onChange={(next) => void handleProductChange(index, next)}
                placeholder={t('internal_sales.form.lines.selectProduct')}
                seedOptions={line.productId && line.productLabel ? [{ value: line.productId, label: line.productLabel }] : undefined}
                loadSuggestions={async (query) => {
                  const options = await loadProductOptions(
                    t('internal_sales.form.productLoadFailed'),
                    query,
                    organizationId,
                  )
                  for (const option of options) productCache.current.set(option.value, option)
                  return options.map<ComboboxOption>((option) => ({ value: option.value, label: option.label }))
                }}
                allowCustomValues={false}
                clearable
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`internal-sales-quantity-${index}`} required>
                {t('internal_sales.form.lines.quantity')}
              </FieldLabel>
              <Input
                id={`internal-sales-quantity-${index}`}
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`internal-sales-price-${index}`} required>
                {t('internal_sales.form.lines.unitPriceNet')}
              </FieldLabel>
              <Input
                id={`internal-sales-price-${index}`}
                inputMode="decimal"
                value={line.unitPriceNet}
                onChange={(event) => updateLine(index, { unitPriceNet: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3 flex items-end justify-end">
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('internal_sales.form.lines.remove')}
                onClick={() => removeLine(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`internal-sales-spec-${index}`}>{t('internal_sales.form.lines.spec')}</FieldLabel>
              <Input
                id={`internal-sales-spec-${index}`}
                value={line.spec}
                onChange={(event) => updateLine(index, { spec: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`internal-sales-sku-${index}`}>{t('internal_sales.form.lines.sku')}</FieldLabel>
              <Input
                id={`internal-sales-sku-${index}`}
                value={line.sku}
                onChange={(event) => updateLine(index, { sku: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-4">
              <FieldLabel htmlFor={`internal-sales-note-${index}`}>{t('internal_sales.form.lines.note')}</FieldLabel>
              <Input
                id={`internal-sales-note-${index}`}
                value={line.note}
                onChange={(event) => updateLine(index, { note: event.target.value })}
              />
            </div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addLine}>
        <Plus className="size-4" aria-hidden="true" />
        {t('internal_sales.form.lines.add')}
      </Button>
    </div>
  )
}

function useFields(t: TranslateFn): CrudField[] {
  const { organizationId } = useOrganizationScopeDetail()
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'customerEntityId',
      label: t('internal_sales.form.field.customer'),
      type: 'select',
      layout: 'half',
      loadOptions: () => loadCustomerOptions(t('internal_sales.form.customerLoadFailed'), organizationId),
    },
    { id: 'customerName', label: t('internal_sales.form.field.customerName'), type: 'text', layout: 'half' },
    {
      id: 'currencyCode',
      label: t('internal_sales.form.field.currency'),
      type: 'select',
      required: true,
      layout: 'half',
      loadOptions: () => loadCurrencyOptions(t('internal_sales.form.currencyLoadFailed')),
    },
    { id: 'customerReference', label: t('internal_sales.form.field.customerReference'), type: 'text', layout: 'half' },
    { id: 'comments', label: t('internal_sales.form.field.comments'), type: 'textarea', layout: 'half' },
  ], [organizationId, t])
}

function useGroups(t: TranslateFn): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'header', column: 1, fields: ['customerEntityId', 'customerName', 'currencyCode', 'customerReference', 'comments'] },
    {
      id: 'lines',
      column: 1,
      bare: true,
      component: (context) => <InternalSalesLinesEditor {...context} t={t} />,
    },
  ], [t])
}

function CreateForm({ kind }: { kind: InternalSalesKind }) {
  const t = useT()
  const router = useRouter()
  const fields = useFields(t)
  const groups = useGroups(t)

  const handleSubmit = React.useCallback(async (values: InternalSalesFormValues) => {
    const payload = buildInternalSalesPayload(kind, values)
    const lines = payload.lines as unknown[]
    if (lines.length === 0) {
      flash(t('internal_sales.form.linesRequired'), 'error')
      throw new Error(t('internal_sales.form.linesRequired'))
    }
    if (!payload.customerEntityId && !payload.customerSnapshot) {
      flash(t('internal_sales.form.customerRequired'), 'error')
      throw new Error(t('internal_sales.form.customerRequired'))
    }
    try {
      const created = await createCrud<{ id?: string }>(apiPathFor(kind), payload)
      const id = typeof created.result?.id === 'string' ? created.result.id : null
      pushWithFlash(
        router,
        id ? documentDetailHref(kind, id) : listHrefFor(kind),
        t('internal_sales.form.saved'),
        'success',
      )
    } catch (error) {
      flash(t('internal_sales.form.saveFailed'), 'error')
      throw error
    }
  }, [kind, router, t])

  return (
    <CrudForm<InternalSalesFormValues>
      title={t(kind === 'quote' ? 'internal_sales.form.quote.createTitle' : 'internal_sales.form.order.createTitle')}
      titleHeadingLevel={1}
      backHref={listHrefFor(kind)}
      fields={fields}
      groups={groups}
      initialValues={{ ...EMPTY_VALUES, lines: [{ ...EMPTY_LINE }] }}
      submitLabel={t('internal_sales.form.save')}
      cancelHref={listHrefFor(kind)}
      onSubmit={handleSubmit}
    />
  )
}

function EditForm({ kind, documentId }: { kind: InternalSalesKind; documentId: string }) {
  const t = useT()
  const router = useRouter()
  const fields = useFields(t)
  const groups = useGroups(t)
  const [initial, setInitial] = React.useState<InternalSalesFormValues | null>(null)
  const [loadedLineIds, setLoadedLineIds] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  /**
   * Bumped after every successful save to re-read the document.
   *
   * The head carries an optimistic-lock version, and the platform's sales update rejects a stale
   * one with a 409, so a form that keeps its first-loaded version would refuse the operator's
   * *second* edit. Reloading also brings the recalculated totals and the stored line ids back.
   */
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(apiPathFor(kind), { ids: documentId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        // Lines come from their own collection: the document projection is head-only.
        const linePayload = await fetchCrudList<Record<string, unknown>>(linesApiPathFor(kind), {
          ...linesFilterFor(kind, documentId),
          // The installed line collection caps `pageSize` at 100 (a larger value is a 400), and a
          // document with more than 100 lines is beyond what this form is meant to edit by hand.
          pageSize: LINES_PAGE_SIZE,
        })
        const lineRecords = linePayload.items ?? []
        const lines = lineRecords.map(toInternalSalesLineValues)
        if (!cancelled) {
          setInitial(toInternalSalesFormValues(item, lines))
          // Remembered so the save can delete the rows the operator removed.
          setLoadedLineIds(lineRecords.map((record) => String(record.id ?? '')).filter((id) => id.length > 0))
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) setIsNotFound(true)
          else setError(t('internal_sales.form.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [documentId, kind, reloadToken, t])

  const fallback = React.useMemo<InternalSalesFormValues>(
    () => ({ ...EMPTY_VALUES, id: documentId, lines: [{ ...EMPTY_LINE }], updatedAt: null }),
    [documentId],
  )

  const handleSubmit = React.useCallback(async (values: InternalSalesFormValues) => {
    if (usableLines(values).length === 0) {
      flash(t('internal_sales.form.linesRequired'), 'error')
      throw new Error(t('internal_sales.form.linesRequired'))
    }
    try {
      await saveInternalSalesDocument(kind, initial?.id || documentId, values, loadedLineIds)
      flash(t('internal_sales.form.saved'), 'success')
      setReloadToken((token) => token + 1)
    } catch (updateError) {
      if (surfaceRecordConflict(updateError, t)) {
        setReloadToken((token) => token + 1)
        return
      }
      flash(t('internal_sales.form.saveFailed'), 'error')
      throw updateError
    }
  }, [documentId, initial, kind, loadedLineIds, t])

  if (isNotFound) {
    return <RecordNotFoundState label={t('internal_sales.form.notFound')} backHref={listHrefFor(kind)} />
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<InternalSalesFormValues>
      title={t(kind === 'quote' ? 'internal_sales.form.quote.editTitle' : 'internal_sales.form.order.editTitle')}
      titleHeadingLevel={1}
      backHref={documentDetailHref(kind, documentId)}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallback}
      // Locking is owned by the writes themselves here: the head PUT carries the document's
      // version and every line call carries the row's, so the form must not attach one globally.
      disableOptimisticLock
      submitLabel={t('internal_sales.form.save')}
      cancelHref={documentDetailHref(kind, documentId)}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function InternalSalesForm({
  kind,
  mode,
  documentId,
}: {
  kind: InternalSalesKind
  mode: 'create' | 'edit'
  documentId?: string
}) {
  if (mode === 'edit') {
    if (!documentId) return null
    return <EditForm kind={kind} documentId={documentId} />
  }
  return <CreateForm kind={kind} />
}
