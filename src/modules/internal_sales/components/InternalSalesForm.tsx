"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudCustomFieldRenderProps,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import {
  useOrganizationScopeDetail,
  useOrganizationScopeVersion,
} from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadProductOption, loadProductOptions, type ProductOption } from '../../products/components/formOptions'
import {
  parseOrganizationSwitcherScope,
} from '../../dictionaries/lib/dictionariesLibraryApi'
import {
  findOrganizationName,
  relatedOrganizationEntries,
  type RelatedOrganizationNode,
} from '@/lib/orgs/organizationOptions'
import {
  EXTERNAL_BUYER_ROLES,
  buildPartyOptionsUrl,
  buildBuyerSnapshot,
  decodeBuyerRef,
  encodeBuyerRef,
  isUuid,
} from '../lib/buyer'
import { useTradeTypeChannels } from '../lib/tradeTypeChannels'
import { SALES_TRADE_TYPES, channelIdForTradeType, isSalesTradeType, tradeTypeFromPathname, type SalesTradeType } from '../lib/tradeType'
import {
  EMPTY_LINE,
  EMPTY_VALUES,
  buildDocumentMetadata,
  toInternalSalesFormValues,
  toInternalSalesLineValues,
  type InternalSalesFormValues,
  type InternalSalesLineValues,
} from '../lib/documentValues'
import QuoteLoadPanel from './QuoteLoadPanel'

/**
 * App-owned create/edit surface for the internal-sales documents (quote, order).
 *
 * The documents themselves stay where they belong — the installed `sales` chain owns numbering,
 * statuses, totals, shipments and invoices, and this module drives that chain through its public
 * API (`POST /api/sales/{quotes,orders}`) instead of reimplementing it. What this module owns is the
 * **flow and the pickers**: lines reference the app-owned product master
 * (`products_products.id`, see .ai/specs/2026-09-22-products-and-trade-docs.md), so the operator
 * chooses from the products the business actually maintains instead of the installed catalog.
 *
 * The **buyer** is the second picker this module owns. An internal sale goes from the group's main
 * entity to a branch — both are organizations in the platform's organization tree
 * (广州凯翠国际贸易有限公司 → 俄罗斯 AB 有限公司), while a branch selling externally addresses an
 * app-owned `parties` record. The picker therefore offers one list with two labelled sources
 * (`.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`): related organizations from the same
 * payload as the top-bar switcher (visible organizations minus the current one — a branch account
 * has no upward/lateral visibility, so it simply gets no internal options) and external customers
 * from `/api/parties/options?roles=buyer` (external customers only — a group branch is addressed
 * as the organization it is, not through its printable-party record). The chosen buyer is frozen
 * onto the document as a snapshot (`lib/buyer.ts`), never as `customerEntityId` — that column is
 * `customer_entities.id` in the installed contract.
 *
 * Lines also carry the product's catalog **variant** when the product is linked to one: the sales
 * chain books fulfilment per variant and the warehouse receives per variant, so the bridge is
 * written here, once, and the operator never sees a variant picker.
 */

export type InternalSalesKind = 'quote' | 'order'

const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'
const CATALOG_VARIANTS_URL = '/api/catalog/variants'
/**
 * The top-bar switcher's own payload — the organizations the caller may work with, with names and
 * the `selectable` flag. Reused as the buyer picker's internal source so "总部 → 分公司" follows the
 * same visibility rule the switcher already enforces (a branch account sees only itself).
 */
const ORGANIZATION_SWITCHER_URL = '/api/directory/organization-switcher'
const ORGANIZATION_QUERY_KEY = 'internal-sales-related-organizations'
/**
 * This module's own list routes.
 *
 * The installed lists (`/backend/sales/quotes`, `/backend/sales/orders`) are `navHidden` in
 * `src/modules.ts`: they leave the sidebar but their URLs stay resolvable, and they remain the
 * platform's view of the same documents. These app-owned routes are where the operator creates and
 * edits them.
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
 * This module's own edit page for a document — the **only** per-document page it ships.
 *
 * The list row, its row action and the post-create redirect all land here; keeping them inside the
 * app-owned surface is a design choice, not a workaround (the installed sales viewer
 * `/backend/sales/{quotes,orders}/[id]` stays resolvable, it is simply not part of this flow).
 *
 * Because this *is* the document's page, it can never be the back/cancel target of itself: that
 * link points at the page the operator is already on and nothing happens on click. Back/cancel go
 * to `listHrefFor(kind)`.
 */
export function documentEditHref(kind: InternalSalesKind, documentId: string): string {
  return `${listHrefFor(kind)}/${documentId}/edit`
}

/**
 * The edit page an entry owns: `/backend/external-sales/**` for an external document, the internal
 * pair otherwise. Used wherever the module navigates by the document's own trade type rather than by
 * the entry the operator happens to be standing in.
 */
export function documentEditHrefForTradeType(kind: InternalSalesKind, documentId: string, tradeType: SalesTradeType): string {
  const base = tradeType === 'external' ? listHrefFor(kind).replace('/internal-sales/', '/external-sales/') : listHrefFor(kind)
  return `${base}/${documentId}/edit`
}

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
    ...(isUuid(line.key) ? { id: line.key } : {}),
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

/** Quantity and unit price live in `numeric(18,4)` columns; a finer value is refused, not rounded. */
const LINE_DECIMAL_PATTERN = /^\d+(?:\.\d{1,4})?$/

/**
 * The first submitted line whose quantity or unit price is not a plain decimal with at most four
 * decimals — `null` when every line is within the caliber. The installed sales engine coerces an
 * unvalidated number and the column rounds it silently, so the app's entry point refuses instead:
 * the operator sees the offending line rather than discovering a changed figure later.
 */
export function lineScaleViolation(
  lines: readonly InternalSalesLineValues[],
): { line: number; field: 'quantity' | 'unitPriceNet' } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!LINE_DECIMAL_PATTERN.test(line.quantity.trim() || '0')) return { line: index + 1, field: 'quantity' }
    if (!LINE_DECIMAL_PATTERN.test(line.unitPriceNet.trim() || '0')) return { line: index + 1, field: 'unitPriceNet' }
  }
  return null
}

/**
 * Scalar head payload, shared by create and update.
 *
 * `customerSnapshot` is the buyer: the printed name plus the `internalSales.organizationId` /
 * `internalSales.partyId` link (`lib/buyer.ts`). On update an emptied buyer must clear the stored
 * snapshot — `null` is the installed schema's explicit clear, while omitting the key would leave a
 * buyer the operator just removed on the document.
 */
function toHeadPayload(
  values: InternalSalesFormValues,
  options?: {
    clearing?: boolean
    channelIds?: Partial<Record<SalesTradeType, string | null | undefined>>
  },
): Record<string, unknown> {
  const snapshot = buildBuyerSnapshot({ name: values.customerName, ref: values.buyerRef })
  const channelId = channelIdForTradeType(values.tradeType, options?.channelIds ?? {})
  return {
    // The trade type travels on the engine's channel; callers resolve the map and block the save
    // when the organization has not been seeded, so a document is never written unmarked.
    ...(channelId ? { channelId } : {}),
    currencyCode: values.currencyCode.trim().toUpperCase(),
    customerSnapshot: snapshot ?? (options?.clearing ? null : undefined),
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
  channelIds: Partial<Record<SalesTradeType, string | null | undefined>> = {},
): Record<string, unknown> {
  return {
    ...toHeadPayload(values, { channelIds }),
    // Provenance only, and only on create: the engine's update path leaves `metadata` untouched
    // when the payload omits it, so the edit form never rewrites the stored value.
    ...(values.sourceQuote ? { metadata: buildDocumentMetadata(values.sourceQuote) } : {}),
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
  channelIds: Partial<Record<SalesTradeType, string | null | undefined>> = {},
): Promise<void> {
  await withScopedApiRequestHeaders(buildOptimisticLockHeader(values.updatedAt ?? null), () =>
    updateCrud(apiPathFor(kind), {
      id: documentId,
      ...toHeadPayload(values, { clearing: true, channelIds }),
      updatedAt: values.updatedAt ?? null,
    }),
  )

  const submitted = usableLines(values)
  const keptIds = new Set<string>()
  for (const line of submitted) {
    await updateCrud(linesApiPathFor(kind), toLinePayload(kind, documentId, values, line))
    if (isUuid(line.key)) keptIds.add(line.key)
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

const ORGANIZATION_QUERY_STALE_MS = 60_000

/**
 * The related organizations — the same payload the top-bar switcher renders
 * (`parseOrganizationSwitcherScope`, the app's shared reader of it). The refetch key carries the
 * scope version, so switching organizations in the top bar refreshes the option list like every
 * other scope-dependent read on this page.
 *
 * Kept as the **tree** (not flattened): `relatedOrganizationEntries` walks it once, and a
 * flattened copy would walk every child twice.
 */
async function fetchOrganizationMenu(): Promise<RelatedOrganizationNode[]> {
  const call = await apiCall<Record<string, unknown>>(ORGANIZATION_SWITCHER_URL)
  if (!call.ok) throw new Error(`organization_switcher_failed:${call.status}`)
  return parseOrganizationSwitcherScope(call.result).organizations
}

function useRelatedOrganizations(): {
  organizations: RelatedOrganizationNode[]
  failed: boolean
  scopeVersion: number
} {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: [ORGANIZATION_QUERY_KEY, scopeVersion],
    staleTime: ORGANIZATION_QUERY_STALE_MS,
    queryFn: fetchOrganizationMenu,
  })
  return { organizations: query.data ?? [], failed: query.isError, scopeVersion }
}

/**
 * One party's code and name, for the picker label and the name auto-fill.
 *
 * The option source carries `code — name` in its label only; printing the code into the document's
 * buyer name would be wrong, so the raw name (and the code for label parity) comes from the party
 * read the module's other surfaces use as well. `null` on failure — the caller degrades instead of
 * inventing a name.
 */
async function fetchPartyDetail(partyId: string): Promise<{ code: string; name: string } | null> {
  try {
    const call = await apiCall<{ item?: { code?: string; name?: string } }>(
      `/api/parties/${encodeURIComponent(partyId)}`,
    )
    if (!call.ok) return null
    const item = call.result?.item
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!name) return null
    return { code: typeof item?.code === 'string' ? item.code.trim() : '', name }
  } catch {
    return null
  }
}

/**
 * The buyer picker: related organizations and external customers in one searchable list, each
 * option labelled with its source up front (`.ai/lessons/merged-picker-source-belongs-in-the-label.md`).
 *
 * Picking a linked option auto-fills the printed buyer name through `setFormValue`; the separate
 * name field below stays editable, so a buyer with no master record is still a first-class case.
 * The two sources fail independently: a broken organization payload or a denied party read shows a
 * hint and leaves the other half usable, rather than rendering an empty list that reads as
 * "no buyers exist" (`.ai/lessons/option-loaders-must-respect-page-size-caps.md`).
 */
function BuyerPickerField({
  value,
  setValue,
  setFormValue,
  disabled,
  values,
  t,
}: CrudCustomFieldRenderProps & { t: TranslateFn }) {
  const { organizationId } = useOrganizationScopeDetail()
  const { organizations, failed: organizationsFailed, scopeVersion } = useRelatedOrganizations()
  const queryClient = useQueryClient()
  const [partiesFailed, setPartiesFailed] = React.useState(false)
  const currentValue = typeof value === 'string' ? value : ''
  /**
   * The trade type decides which sources exist at all: an internal sale buys from a group company,
   * an external one from a local customer. Reading it from the sibling field here is why the picker
   * is a custom field rather than a `CrudField` (an option loader gets no sibling values).
   */
  const rawTradeType = values?.tradeType
  const tradeType: SalesTradeType = isSalesTradeType(rawTradeType) ? rawTradeType : 'internal'
  /**
   * Switching the trade type changes which namespace the buyer belongs to, so the picked value
   * cannot carry over (an organization id is not a customer). The first render is skipped so an
   * edit page keeps the stored buyer.
   */
  const previousTradeType = React.useRef(tradeType)
  React.useEffect(() => {
    if (previousTradeType.current === tradeType) return
    previousTradeType.current = tradeType
    setValue('')
    setFormValue?.('customerName', '')
  }, [setFormValue, setValue, tradeType])
  /**
   * Labels the operator has seen for a value. `ComboboxInput` renders the selected value as its
   * option label and, on focus, asks the source to search for the input's text — this map lets the
   * loader recognize that text as "no query" instead of searching the sources for a buyer's own
   * name (a search that matches nothing and would look like "no buyers exist"). Dynamic
   * value → label pairs, so a Map, not a record.
   */
  const labelByValue = React.useRef(new Map<string, string>())

  const organizationEntries = React.useMemo(
    () => relatedOrganizationEntries(organizations, organizationId),
    [organizations, organizationId],
  )
  // Dynamic id → name lookup over runtime rows (a Map, not a static table).
  const organizationNameById = React.useMemo(
    () => new Map(organizationEntries.map((entry) => [entry.id, entry.name])),
    [organizationEntries],
  )

  const relatedOrgPrefix = t('internal_sales.form.buyer.relatedOrgPrefix', 'Related organization: ')
  const externalPrefix = t('internal_sales.form.buyer.externalPrefix', 'External customer: ')
  const partyLoadFailed = t('internal_sales.form.buyer.partyLoadFailed', 'Could not load external customers')

  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const queryText = typeof query === 'string' ? query.trim() : ''
      // Focusing a field that shows its selected option asks the source to search for that label;
      // treat it as "no query" so the fetched list is the full one (the input's own local filter
      // still narrows the rendered list until the operator types).
      const selectedLabel = labelByValue.current.get(currentValue)
      const term = selectedLabel && queryText === selectedLabel ? '' : queryText
      const normalized = term.toLowerCase()
      const organizationOptions = tradeType === 'internal'
        ? organizationEntries
            .filter((entry) => (normalized.length === 0 ? true : entry.name.toLowerCase().includes(normalized)))
            .map((entry) => ({
              value: encodeBuyerRef({ kind: 'organization', id: entry.id }),
              label: `${relatedOrgPrefix}${entry.name}`,
            }))
        : []

      let partyOptions: ComboboxOption[] = []
      if (tradeType === 'external') {
        try {
          const payload = await readApiResultOrThrow<{ items?: Array<{ value?: string; label?: string }> }>(
            buildPartyOptionsUrl({ query: term, organizationId, roles: EXTERNAL_BUYER_ROLES }),
            undefined,
            { errorMessage: partyLoadFailed },
          )
          partyOptions = (payload.items ?? [])
            .map((item) => {
              const id = String(item.value ?? '')
              if (!id) return null
              return {
                value: encodeBuyerRef({ kind: 'party', id }),
                label: `${externalPrefix}${String(item.label ?? '')}`,
              }
            })
            .filter((option): option is ComboboxOption => option !== null)
          setPartiesFailed(false)
        } catch {
          // The hint under the field explains the empty list; the rest of the form stays usable.
          setPartiesFailed(true)
        }
      } else {
        setPartiesFailed(false)
      }
      const options = [...organizationOptions, ...partyOptions]
      for (const option of options) labelByValue.current.set(option.value, option.label)
      return options
    },
    [currentValue, externalPrefix, organizationEntries, organizationId, partyLoadFailed, relatedOrgPrefix, tradeType],
  )

  const resolveLabel = React.useCallback(
    async (rawValue: string): Promise<string> => {
      const ref = decodeBuyerRef(rawValue)
      if (ref.kind === 'organization') {
        // A cold label (edit page opened right after load) must not paint the raw `org:<uuid>`:
        // resolve through the shared query cache, which also serves the suggestion list.
        let name = organizationNameById.get(ref.id) ?? ''
        if (!name) {
          try {
            const menu = await queryClient.fetchQuery({
              queryKey: [ORGANIZATION_QUERY_KEY, scopeVersion],
              queryFn: fetchOrganizationMenu,
              staleTime: ORGANIZATION_QUERY_STALE_MS,
            })
            name = findOrganizationName(menu, ref.id)
          } catch {
            return ''
          }
        }
        if (!name) return ''
        const label = `${relatedOrgPrefix}${name}`
        labelByValue.current.set(rawValue, label)
        return label
      }
      if (ref.kind === 'party') {
        const detail = await fetchPartyDetail(ref.id)
        if (!detail) return ''
        const label = `${externalPrefix}${detail.code ? `${detail.code} — ` : ''}${detail.name}`
        labelByValue.current.set(rawValue, label)
        return label
      }
      return ''
    },
    [externalPrefix, organizationNameById, queryClient, relatedOrgPrefix, scopeVersion],
  )

  const handleChange = React.useCallback(
    (next: string) => {
      setValue(next)
      const ref = decodeBuyerRef(next)
      if (ref.kind === 'organization') {
        const name = organizationNameById.get(ref.id)
        if (name) setFormValue?.('customerName', name)
        return
      }
      if (ref.kind === 'party') {
        // The label carries a code prefix, so the printed name comes from the party read; a failed
        // read leaves whatever the operator has in the name field untouched.
        void fetchPartyDetail(ref.id).then((detail) => {
          if (detail) setFormValue?.('customerName', detail.name)
        })
      }
    },
    [organizationNameById, setFormValue, setValue],
  )

  return (
    <div className="space-y-1.5">
      <ComboboxInput
        value={currentValue}
        onChange={handleChange}
        placeholder={t(
          tradeType === 'internal'
            ? 'internal_sales.form.buyer.selectInternalPlaceholder'
            : 'internal_sales.form.buyer.selectExternalPlaceholder',
          tradeType === 'internal' ? 'Search a related organization…' : 'Search an external customer…',
        )}
        loadSuggestions={loadSuggestions}
        resolveLabel={resolveLabel}
        allowCustomValues={false}
        clearable
        disabled={disabled}
      />
      {organizationsFailed ? (
        <p className="text-xs text-status-error-text">
          {t('internal_sales.form.buyer.orgLoadFailed', 'Could not load related organizations')}
        </p>
      ) : null}
      {partiesFailed ? <p className="text-xs text-status-error-text">{partyLoadFailed}</p> : null}
    </div>
  )
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
      // The picker re-fires `onChange` with the same value once it resolves the selected label
      // (suggestions reload). Clearing the row first would drop the already-resolved variant and
      // label, and a save landing in that window would persist the document without the variant —
      // which fulfilment (shipment / overseas-warehouse receipt) needs. Only a *different* product
      // clears the stale label/variant; re-picking the same one re-resolves in place.
      if (linesRef.current[index]?.productId !== productId) {
        updateLine(index, { productId, productLabel: '', productVariantId: '' })
      }
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
                resolveLabel={async (value) => {
                  // A loaded line normally carries its label; this covers the row whose snapshot is
                  // empty, where the picker would otherwise paint the raw product uuid.
                  const option = await loadProductOption(value, t('internal_sales.form.productLoadFailed'), organizationId)
                  return option?.label ?? ''
                }}
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

/**
 * `fixedTradeType` locks the control to one value: the external menu (`/backend/external-sales/**`)
 * is the entry for trade with local customers, so that surface must not be able to write an internal
 * document (and the other way round the internal entry stays editable for legacy reasons only when
 * the route says internal — see `tradeTypeFromPathname`).
 */
function useFields(t: TranslateFn, fixedTradeType: SalesTradeType | null = null): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'tradeType',
      label: t('internal_sales.form.field.tradeType'),
      type: 'select',
      required: true,
      layout: 'half',
      description: fixedTradeType
        ? t('internal_sales.form.field.tradeTypeFixed', 'This entry is fixed to the trade type it names.')
        : t('internal_sales.form.field.tradeTypeHelp'),
      options: SALES_TRADE_TYPES
        .filter((type) => (fixedTradeType ? type === fixedTradeType : true))
        .map((type) => ({
          value: type,
          label: t(`internal_sales.form.tradeType.${type}`),
        })),
    },
    {
      id: 'buyerRef',
      label: t('internal_sales.form.field.customer'),
      type: 'custom',
      layout: 'half',
      component: (props) => <BuyerPickerField {...props} t={t} />,
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
  ], [fixedTradeType, t])
}

/**
 * `withQuoteLoad` adds the order's reference-loading panel above the header. It is off for quotes:
 * there is nothing upstream of a quote to load from, and the panel's read-only half only makes
 * sense where a document can carry a source quote.
 */
function useGroups(
  t: TranslateFn,
  { withQuoteLoad = false, mode = 'create' as 'create' | 'edit', autoLoadFrom = null }: {
    withQuoteLoad?: boolean
    mode?: 'create' | 'edit'
    autoLoadFrom?: string | null
  } = {},
): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    ...(withQuoteLoad
      ? [{
          id: 'quote-load',
          column: 1 as const,
          bare: true,
          component: (context: CrudFormGroupComponentProps) => (
            <QuoteLoadPanel
              values={context.values}
              setValue={context.setValue}
              mode={mode}
              autoLoadFrom={autoLoadFrom}
              quoteEditHref={(quoteId) => documentEditHref('quote', quoteId)}
            />
          ),
        }]
      : []),
    { id: 'header', column: 1, fields: ['tradeType', 'buyerRef', 'customerName', 'currencyCode', 'customerReference', 'comments'] },
    {
      id: 'lines',
      column: 1,
      bare: true,
      component: (context) => <InternalSalesLinesEditor {...context} t={t} />,
    },
  ], [autoLoadFrom, mode, t, withQuoteLoad])
}

/**
 * The trade type this route is dedicated to, or `null` when the entry is the generic internal one.
 * `/backend/external-sales/**` is the external surface; the internal pages keep the switch so a
 * legacy internal operator can still fix a mis-typed document before the backfill runs.
 */
function useFixedTradeType(): SalesTradeType | null {
  const pathname = usePathname()
  return tradeTypeFromPathname(pathname) === 'external' ? 'external' : null
}

function CreateForm({ kind }: { kind: InternalSalesKind }) {
  const t = useT()
  const router = useRouter()
  const fixedTradeType = useFixedTradeType()
  const fields = useFields(t, fixedTradeType)
  const { channels, hasAll: hasAllChannels, missingMessage: missingChannelMessage } = useTradeTypeChannels(kind)
  // The quote list's row action arrives here; the panel loads that quote once on mount.
  const fromQuote = useSearchParams().get('fromQuote')
  const groups = useGroups(t, { withQuoteLoad: kind === 'order', mode: 'create', autoLoadFrom: fromQuote })

  const handleSubmit = React.useCallback(async (values: InternalSalesFormValues) => {
    if (!hasAllChannels) {
      flash(missingChannelMessage, 'error')
      throw new Error(missingChannelMessage)
    }
    const payload = buildInternalSalesPayload(kind, values, channels)
    const lines = payload.lines as unknown[]
    if (lines.length === 0) {
      flash(t('internal_sales.form.linesRequired'), 'error')
      throw new Error(t('internal_sales.form.linesRequired'))
    }
    const violation = lineScaleViolation(usableLines(values))
    if (violation) {
      const message = t(
        'internal_sales.form.linePrecision',
        'Line {line}: quantity and unit price accept at most 4 decimal places',
        { line: violation.line },
      )
      flash(message, 'error')
      throw new Error(message)
    }
    // The snapshot carries both the printed name and the organization/party link, so its presence
    // is exactly "a buyer was given" — no separate id field to check any more.
    if (!payload.customerSnapshot) {
      flash(t('internal_sales.form.customerRequired'), 'error')
      throw new Error(t('internal_sales.form.customerRequired'))
    }
    try {
      const created = await createCrud<{ id?: string }>(apiPathFor(kind), payload)
      const id = typeof created.result?.id === 'string' ? created.result.id : null
      pushWithFlash(
        router,
        id ? documentEditHrefForTradeType(kind, id, values.tradeType) : listHrefFor(kind),
        t('internal_sales.form.saved'),
        'success',
      )
    } catch (error) {
      flash(t('internal_sales.form.saveFailed'), 'error')
      throw error
    }
  }, [channels, hasAllChannels, kind, missingChannelMessage, router, t])

  return (
    <CrudForm<InternalSalesFormValues>
      title={t(
        fixedTradeType === 'external'
          ? (kind === 'quote' ? 'internal_sales.form.externalQuote.createTitle' : 'internal_sales.form.externalOrder.createTitle')
          : (kind === 'quote' ? 'internal_sales.form.quote.createTitle' : 'internal_sales.form.order.createTitle'),
      )}
      titleHeadingLevel={1}
      backHref={listHrefFor(kind)}
      fields={fields}
      groups={groups}
      initialValues={{
        ...EMPTY_VALUES,
        tradeType: fixedTradeType ?? EMPTY_VALUES.tradeType,
        lines: [{ ...EMPTY_LINE }],
      }}
      submitLabel={t('internal_sales.form.save')}
      cancelHref={listHrefFor(kind)}
      onSubmit={handleSubmit}
    />
  )
}

function EditForm({ kind, documentId }: { kind: InternalSalesKind; documentId: string }) {
  const t = useT()
  const router = useRouter()
  const fixedTradeType = useFixedTradeType()
  const fields = useFields(t, fixedTradeType)
  const { channels, hasAll: hasAllChannels, missingMessage: missingChannelMessage } = useTradeTypeChannels(kind)
  const groups = useGroups(t, { withQuoteLoad: kind === 'order', mode: 'edit' })
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
        // `id` (singular) is the installed single-document read: the same route answers it with the
        // **full** projection — `ids` returns the trimmed grid one, which drops `metadata`, and the
        // order's source quote lives exactly there.
        const payload = await fetchCrudList<Record<string, unknown>>(apiPathFor(kind), { id: documentId, pageSize: 1 })
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
          const loaded = toInternalSalesFormValues(item, lines, channels)
          setInitial(fixedTradeType ? { ...loaded, tradeType: fixedTradeType } : loaded)
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
  }, [channels, documentId, fixedTradeType, kind, reloadToken, t])

  const fallback = React.useMemo<InternalSalesFormValues>(
    () => ({
      ...EMPTY_VALUES,
      tradeType: fixedTradeType ?? EMPTY_VALUES.tradeType,
      id: documentId,
      lines: [{ ...EMPTY_LINE }],
      updatedAt: null,
    }),
    [documentId, fixedTradeType],
  )

  const handleSubmit = React.useCallback(async (values: InternalSalesFormValues) => {
    if (!hasAllChannels) {
      flash(missingChannelMessage, 'error')
      throw new Error(missingChannelMessage)
    }
    if (usableLines(values).length === 0) {
      flash(t('internal_sales.form.linesRequired'), 'error')
      throw new Error(t('internal_sales.form.linesRequired'))
    }
    const violation = lineScaleViolation(usableLines(values))
    if (violation) {
      const message = t(
        'internal_sales.form.linePrecision',
        'Line {line}: quantity and unit price accept at most 4 decimal places',
        { line: violation.line },
      )
      flash(message, 'error')
      throw new Error(message)
    }
    try {
      await saveInternalSalesDocument(kind, initial?.id || documentId, values, loadedLineIds, channels)
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
  }, [channels, documentId, hasAllChannels, initial, kind, loadedLineIds, missingChannelMessage, t])

  if (isNotFound) {
    return <RecordNotFoundState label={t('internal_sales.form.notFound')} backHref={listHrefFor(kind)} />
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<InternalSalesFormValues>
      title={t(
        (fixedTradeType ?? initial?.tradeType) === 'external'
          ? (kind === 'quote' ? 'internal_sales.form.externalQuote.editTitle' : 'internal_sales.form.externalOrder.editTitle')
          : (kind === 'quote' ? 'internal_sales.form.quote.editTitle' : 'internal_sales.form.order.editTitle'),
      )}
      titleHeadingLevel={1}
      // This module has no per-document detail view — the edit page *is* the document's page.
      // Back/cancel must therefore leave for the list; built from `documentEditHref` they
      // addressed the page the operator was already on and clicking them did nothing.
      backHref={listHrefFor(kind)}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallback}
      // Locking is owned by the writes themselves here: the head PUT carries the document's
      // version and every line call carries the row's, so the form must not attach one globally.
      disableOptimisticLock
      submitLabel={t('internal_sales.form.save')}
      cancelHref={listHrefFor(kind)}
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
