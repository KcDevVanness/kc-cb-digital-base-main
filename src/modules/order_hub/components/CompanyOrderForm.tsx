'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { TagsInput, type TagsInputOption } from '@open-mercato/ui/backend/inputs'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  findOptionSnapshot,
  loadCustomerPartyOptions,
  loadOwnerOptions,
  loadPurchaseOrderCandidates,
  loadSalesOrderCandidates,
  loadSupplierOptions,
  resolveCustomerPartyLabel,
  resolveSupplierLabel,
} from './companyOrderOptions'
import { buildCompanyOrderLinks } from '@/lib/orders/companyOrderLinkPayload'
import { useBackHref } from '@/lib/navigation/returnTo'
import { loadCodeListOptions } from '@/lib/dictionaries/codeListOptions'
import { COMPANY_ORDER_PAYMENT_STATUSES, companyOrderStatusOptions } from '../data/validators'

/**
 * The create/edit surface for a **company order** (`order_hub_company_orders`) — the root record the
 * workbench lists and `/backend/orders/<id>` opens as a hub.
 *
 * The form owns the root's own fields (dates / status / notes), its optional customer/supplier (the
 * buyer/supplier the child forms prefill from) and — on create only — the
 * "link an existing document" multi-selects that attach sales/purchase orders while the root is
 * created, in one call. `title` is not part of the form (owner 2026-10-09): the column stays for
 * backfilled roots and the hub still prints it under the number, but nobody fills one in.
 *
 * Dates are date-only (`YYYY-MM-DD`): the command writes them as UTC midnight
 * and the hub reads them back in that frame, so a `date` field is the only input that cannot shift a
 * calendar day across time zones.
 *
 * The write contract matches the module's CRUD route: create sends `{title,orderDate,etaDate,status,
 * paymentStatus,notes,customerPartyId,supplierId,links?}` and lands on the new hub; edit sends
 * `{id,updatedAt,…}` (plus the platform's version header, threaded through `initialValues.updatedAt`)
 * so a stale save surfaces the conflict bar. On edit an empty customer/supplier clears the pair
 * (explicit `null`); the 是否已收款 select does the same for its own marker.
 */

export const ORDERS_API_PATH = 'order_hub/orders'
export const ORDERS_LIST_HREF = '/backend/orders'

export type CompanyOrderFormValues = {
  id?: string
  orderDate: string | null
  etaDate: string | null
  status: string
  paymentStatus: string
  notes: string | null
  /** 订单描述 — the `product_category` dictionary code; empty clears it (sent as `null`). */
  productCategory: string
  /** 采购负责人 — a user id; empty clears both halves (the snapshot included). */
  ownerUserId: string
  /** The `{name,email}` frozen with the pick, carried so an unchanged pick keeps its stored value. */
  ownerSnapshot: Record<string, unknown> | null
  customerPartyId: string | null
  supplierId: string | null
  /** Create only: sales-order link picker values (`${kind}:${refId}`). */
  salesLinkRefs: string[]
  /** Create only: purchase-order link picker values (bare refIds). */
  purchaseLinkRefs: string[]
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the expected-version
   * header from `initialValues.updatedAt` for update AND delete. The update body repeats it because
   * the command reads the version from there first.
   */
  updatedAt?: string | null
}

/**
 * The root's own fields plus the two counterparty ids. The kept snake→camel contract is the
 * command's; an empty id is sent as `null` so an update clears the stored pair and a create leaves
 * it unset (both nullable).
 *
 * `title` is deliberately not sent: the create/edit form no longer asks for one (owner 2026-10-09),
 * and the update command leaves an absent field alone — a save therefore never clears the title a
 * backfilled root already carries (the hub still shows it as the header subtitle).
 */
export function buildCompanyOrderPayload(values: CompanyOrderFormValues): Record<string, unknown> {
  // A date-only field hands back `''`/`undefined` when empty; the command rejects an empty string.
  // `orderDate` is not nullable, so empty omits it (create defaults to today); `etaDate`/`notes`
  // are nullable, so an empty field clears them explicitly rather than being omitted.
  const notes = typeof values.notes === 'string' && values.notes.trim().length > 0 ? values.notes : null
  const orderDate = typeof values.orderDate === 'string' && values.orderDate.trim().length > 0
    ? values.orderDate.trim()
    : undefined
  const etaDate = typeof values.etaDate === 'string' && values.etaDate.trim().length > 0
    ? values.etaDate.trim()
    : null
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  const ownerUserId = text(values.ownerUserId)
  return {
    orderDate,
    etaDate,
    status: values.status,
    // An empty select is sent as an explicit `null`: the marker reads “—” rather than an invented
    // answer. The fresh-order default (未收款) comes from the create form's initial value; the
    // command applies it only when the field is omitted entirely.
    paymentStatus:
      typeof values.paymentStatus === 'string' && values.paymentStatus.trim().length > 0
        ? values.paymentStatus
        : null,
    notes,
    // 订单描述 / 采购负责人: root-held, three-state via the update command — an empty pick sends an
    // explicit `null` (clears the field / the owner pair), and a pick sends the frozen snapshot
    // beside the id so the root owns the name it was filed under.
    productCategory: text(values.productCategory),
    ownerUserId,
    ...(ownerUserId ? { ownerSnapshot: values.ownerSnapshot ?? null } : {}),
    customerPartyId: text(values.customerPartyId),
    supplierId: text(values.supplierId),
  }
}

/** The picked children as the command's `links`; empty selections are omitted entirely. */
export { buildCompanyOrderLinks, type CompanyOrderLinkKind } from '@/lib/orders/companyOrderLinkPayload'

/** A search multi-select backed by `TagsInput`, with the value→label map kept for preselected ids. */
function LinkPickerField({
  value,
  setValue,
  disabled,
  t,
  placeholder,
  loadOptions,
}: CrudCustomFieldRenderProps & {
  t: TranslateFn
  placeholder: string
  loadOptions: (query?: string) => Promise<CrudFieldOption[]>
}) {
  const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  const labelByValue = React.useRef(new Map<string, string>())
  const resolveLabel = React.useCallback((raw: string): string => labelByValue.current.get(raw) ?? raw, [])
  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<TagsInputOption[]> => {
      const options = await loadOptions(query)
      for (const option of options) labelByValue.current.set(option.value, option.label)
      return options
    },
    [loadOptions],
  )
  return (
    <TagsInput
      value={selected}
      onChange={(next) => setValue(next)}
      loadSuggestions={loadSuggestions}
      resolveLabel={resolveLabel}
      allowCustomValues={false}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}

/**
 * Runs a picker loader and remembers its page, so the submit handler can resolve a chosen owner's
 * snapshot without a second request. A picker only ever holds the first page of its source, so the
 * remembered map is what `findOptionSnapshot` reads.
 */
async function rememberPickerOptions(
  ref: React.MutableRefObject<Record<string, CrudFieldOption[]>>,
  key: string,
  loader: () => Promise<CrudFieldOption[]>,
): Promise<CrudFieldOption[]> {
  const options = await loader()
  ref.current[key] = options
  return options
}

function useCompanyOrderFields(
  t: TranslateFn,
  withLinks: boolean,
  currentStatus: string | null | undefined,
  pickerOptionsRef: React.MutableRefObject<Record<string, CrudFieldOption[]>>,
): CrudField[] {
  const salesLoadOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const candidates = await loadSalesOrderCandidates(query)
    const internalLabel = t('order_hub.companyOrders.links.kind.internal', 'Internal sales order')
    const externalLabel = t('order_hub.companyOrders.links.kind.external', 'External sales order')
    return candidates.map((candidate) => ({
      value: `${candidate.kind}:${candidate.refId}`,
      label: `${candidate.kind === 'external_sales_order' ? externalLabel : internalLabel} · ${candidate.number ?? candidate.refId}`,
    }))
  }, [t])
  const purchaseLoadOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const candidates = await loadPurchaseOrderCandidates(query)
    return candidates.map((candidate) => ({
      value: candidate.refId,
      label: candidate.supplierName ? `${candidate.number ?? candidate.refId} — ${candidate.supplierName}` : candidate.number ?? candidate.refId,
    }))
  }, [])

  return React.useMemo<CrudField[]>(() => [
    {
      id: 'orderDate',
      label: t('order_hub.companyOrders.form.orderDate'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'etaDate',
      label: t('order_hub.companyOrders.form.etaDate'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'status',
      label: t('order_hub.companyOrders.form.status'),
      type: 'select',
      layout: 'half',
      // The current vocabulary; a row written before it landed keeps its own value selectable, so an
      // unrelated save cannot silently rewrite the status.
      options: companyOrderStatusOptions(currentStatus).map((status) => ({
        value: status,
        label: t(`order_hub.companyOrders.status.${status}`),
      })),
    },
    {
      id: 'paymentStatus',
      label: t('order_hub.companyOrders.form.paymentStatus'),
      type: 'select',
      layout: 'half',
      options: COMPANY_ORDER_PAYMENT_STATUSES.map((value) => ({
        value,
        label: t(`order_hub.companyOrders.paymentStatus.${value}`),
      })),
    },
    {
      id: 'productCategory',
      label: t('order_hub.companyOrders.form.productCategory', 'Order description'),
      type: 'select',
      layout: 'half',
      // The shared `product_category` dictionary (the 字典库「Product categories」 list `product_codes`
      // seeds); the root stores the code and the header/list resolve its label.
      loadOptions: () => loadCodeListOptions('product_category'),
    },
    {
      id: 'ownerUserId',
      label: t('order_hub.companyOrders.form.owner', 'Purchaser'),
      type: 'select',
      layout: 'half',
      // 采购负责人: the platform user list, scoped to the caller's active organization; the chosen
      // option's `{name,email}` snapshot is frozen onto the root at submit time.
      loadOptions: (query) =>
        rememberPickerOptions(pickerOptionsRef, 'ownerUserId', () =>
          loadOwnerOptions(t('order_hub.companyOrders.form.optionsLoadFailed', 'Could not load the options'), query)),
    },
    {
      id: 'customerPartyId',
      label: t('order_hub.companyOrders.form.customer', 'Customer'),
      type: 'combobox',
      layout: 'half',
      allowCustomValues: false,
      loadOptions: (query) => loadCustomerPartyOptions(query),
      resolveLabel: (value) => resolveCustomerPartyLabel(value),
    },
    {
      id: 'supplierId',
      label: t('order_hub.companyOrders.form.supplier', 'Supplier'),
      type: 'combobox',
      layout: 'half',
      allowCustomValues: false,
      loadOptions: (query) => loadSupplierOptions(query),
      resolveLabel: (value) => resolveSupplierLabel(value),
    },
    ...(withLinks
      ? [
          {
            id: 'salesLinkRefs',
            label: t('order_hub.companyOrders.form.salesLinks', 'Link existing sales orders'),
            type: 'custom' as const,
            layout: 'full' as const,
            component: (props: CrudCustomFieldRenderProps) => (
              <LinkPickerField
                {...props}
                t={t}
                placeholder={t('order_hub.companyOrders.form.linksPlaceholder', 'Search by document number')}
                loadOptions={salesLoadOptions}
              />
            ),
          },
          {
            id: 'purchaseLinkRefs',
            label: t('order_hub.companyOrders.form.purchaseLinks', 'Link existing purchase orders'),
            type: 'custom' as const,
            layout: 'full' as const,
            component: (props: CrudCustomFieldRenderProps) => (
              <LinkPickerField
                {...props}
                t={t}
                placeholder={t('order_hub.companyOrders.form.linksPlaceholder', 'Search by document number')}
                loadOptions={purchaseLoadOptions}
              />
            ),
          },
        ]
      : []),
    {
      id: 'notes',
      label: t('order_hub.companyOrders.form.notes'),
      type: 'textarea',
      layout: 'full',
    },
  ], [currentStatus, pickerOptionsRef, purchaseLoadOptions, salesLoadOptions, t, withLinks])
}

const EMPTY_LINK_REF_ARRAYS: Pick<CompanyOrderFormValues, 'salesLinkRefs' | 'purchaseLinkRefs'> = {
  salesLinkRefs: [],
  purchaseLinkRefs: [],
}

function CompanyOrderCreateForm() {
  const t = useT()
  const router = useRouter()
  const backHref = useBackHref(ORDERS_LIST_HREF)
  const pickerOptionsRef = React.useRef<Record<string, CrudFieldOption[]>>({})
  const fields = useCompanyOrderFields(t, true, undefined, pickerOptionsRef)
  const initialValues = React.useMemo<CompanyOrderFormValues>(() => ({
    title: '',
    orderDate: '',
    etaDate: '',
    status: 'placed',
    paymentStatus: 'unpaid',
    notes: '',
    productCategory: '',
    ownerUserId: '',
    ownerSnapshot: null,
    customerPartyId: '',
    supplierId: '',
    ...EMPTY_LINK_REF_ARRAYS,
  }), [])

  const handleSubmit = React.useCallback(async (values: CompanyOrderFormValues) => {
    try {
      const links = buildCompanyOrderLinks(values)
      // Freeze the chosen owner's `{name,email}` from the page it was picked off (an id off the
      // loaded page contributes no snapshot, leaving the root's pair honestly empty on that half).
      const ownerSnapshot = findOptionSnapshot(pickerOptionsRef.current.ownerUserId ?? [], values.ownerUserId)
      const payload = buildCompanyOrderPayload({ ...values, ownerSnapshot })
      if (links.length > 0) payload.links = links
      const result = await createCrud<{ id?: string }>(ORDERS_API_PATH, payload)
      const createdId = typeof result.result?.id === 'string' ? result.result.id : null
      // A new company order lands on its hub (`/backend/orders/<id>`), the one filling surface; a
      // response without an id still confirms the save and falls back to the workbench.
      pushWithFlash(
        router,
        createdId ? `${ORDERS_LIST_HREF}/${encodeURIComponent(createdId)}` : ORDERS_LIST_HREF,
        t('order_hub.companyOrders.form.saved'),
        'success',
      )
    } catch (error) {
      flash(t('order_hub.companyOrders.form.saveFailed'), 'error')
      throw error
    }
  }, [pickerOptionsRef, router, t])

  return (
    <CrudForm<CompanyOrderFormValues>
      title={t('order_hub.companyOrders.create.title')}
      titleHeadingLevel={1}
      backHref={backHref}
      fields={fields}
      initialValues={initialValues}
      submitLabel={t('order_hub.companyOrders.form.save')}
      cancelHref={backHref}
      onSubmit={handleSubmit}
    />
  )
}

/** The list projection may omit a field; a missing/non-string one reads as empty. */
function readProjectedText(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function toCompanyOrderFormValues(item: Record<string, unknown>): CompanyOrderFormValues {
  const updatedAtRaw = item.updatedAt ?? item.updated_at
  const ownerSnapshot = item.ownerSnapshot
  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    orderDate: readProjectedText(item, 'orderDate'),
    etaDate: readProjectedText(item, 'etaDate'),
    status: readProjectedText(item, 'status') || 'placed',
    // `null` (a row written before the column existed) reads as “”, which the select shows as unset.
    paymentStatus: readProjectedText(item, 'paymentStatus'),
    notes: readProjectedText(item, 'notes'),
    // Root-held 订单描述 / 采购负责人 read as select values; the frozen snapshot is carried through so
    // an untouched pick keeps the name the root was filed with instead of blanking it on save.
    productCategory: readProjectedText(item, 'productCategory'),
    ownerUserId: readProjectedText(item, 'ownerUserId'),
    ownerSnapshot:
      ownerSnapshot && typeof ownerSnapshot === 'object' && !Array.isArray(ownerSnapshot)
        ? (ownerSnapshot as Record<string, unknown>)
        : null,
    customerPartyId: readProjectedText(item, 'customerPartyId'),
    supplierId: readProjectedText(item, 'supplierId'),
    ...EMPTY_LINK_REF_ARRAYS,
    updatedAt: typeof updatedAtRaw === 'string' ? updatedAtRaw : null,
  }
}

function CompanyOrderEditForm({ id }: { id: string }) {
  const t = useT()
  const backHref = useBackHref(ORDERS_LIST_HREF)
  const [initial, setInitial] = React.useState<CompanyOrderFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const pickerOptionsRef = React.useRef<Record<string, CrudFieldOption[]>>({})
  const fields = useCompanyOrderFields(t, false, initial?.status ?? null, pickerOptionsRef)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      setIsNotFound(false)
      try {
        const data = await fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, { id, pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toCompanyOrderFormValues(item))
      } catch (error: unknown) {
        if (cancelled) return
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
        if (status === 404) {
          setIsNotFound(true)
        } else {
          setLoadError(error instanceof Error && error.message ? error.message : t('order_hub.companyOrders.form.notFound'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  const fallbackInitialValues = React.useMemo<CompanyOrderFormValues>(() => ({
    id,
    title: '',
    orderDate: '',
    etaDate: '',
    status: 'placed',
    paymentStatus: '',
    notes: '',
    productCategory: '',
    ownerUserId: '',
    ownerSnapshot: null,
    customerPartyId: '',
    supplierId: '',
    ...EMPTY_LINK_REF_ARRAYS,
    updatedAt: null,
  }), [id])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('order_hub.companyOrders.form.notFound')}
        backHref={backHref}
      />
    )
  }

  if (loadError) return <ErrorMessage label={loadError} />

  const handleSubmit = async (values: CompanyOrderFormValues) => {
    // An untouched owner pick keeps the snapshot the root was filed with — the chosen user may not be
    // on the loaded page any more, and a save must never blank the frozen name. A changed pick
    // resolves against the options it was chosen from.
    const ownerSnapshot =
      values.ownerUserId === (initial?.ownerUserId ?? '')
        ? (initial?.ownerSnapshot ?? null)
        : findOptionSnapshot(pickerOptionsRef.current.ownerUserId ?? [], values.ownerUserId)
    await updateCrud(ORDERS_API_PATH, {
      id,
      updatedAt: values.updatedAt ?? initial?.updatedAt ?? undefined,
      ...buildCompanyOrderPayload({ ...values, ownerSnapshot }),
    })
  }

  return (
    <CrudForm<CompanyOrderFormValues>
      title={t('order_hub.companyOrders.edit.title')}
      titleHeadingLevel={1}
      backHref={backHref}
      fields={fields}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('order_hub.companyOrders.form.save')}
      cancelHref={backHref}
      successRedirect={`${ORDERS_LIST_HREF}/${encodeURIComponent(id)}`}
      deleteRedirect={ORDERS_LIST_HREF}
      isLoading={loading}
      onSubmit={handleSubmit}
      onDelete={async () => { await deleteCrud(ORDERS_API_PATH, id) }}
    />
  )
}

export default function CompanyOrderForm({ mode, id }: { mode: 'create' | 'edit'; id?: string }) {
  if (mode === 'edit') {
    if (!id) return null
    return <CompanyOrderEditForm id={id} />
  }
  return <CompanyOrderCreateForm />
}
