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
  loadCustomerPartyOptions,
  loadPurchaseOrderCandidates,
  loadSalesOrderCandidates,
  loadSupplierOptions,
  resolveCustomerPartyLabel,
  resolveSupplierLabel,
} from './companyOrderOptions'
import { buildCompanyOrderLinks } from '@/lib/orders/companyOrderLinkPayload'

/**
 * The create/edit surface for a **company order** (`order_hub_company_orders`) — the root record the
 * workbench lists and `/backend/orders/<id>` opens as a hub.
 *
 * The form owns the root's own fields (title / dates / status / notes), its optional default
 * customer/supplier (the buyer/supplier the child forms prefill from) and — on create only — the
 * "link an existing document" multi-selects that attach sales/purchase orders while the root is
 * created, in one call. Dates are date-only (`YYYY-MM-DD`): the command writes them as UTC midnight
 * and the hub reads them back in that frame, so a `date` field is the only input that cannot shift a
 * calendar day across time zones.
 *
 * The write contract matches the module's CRUD route: create sends `{title,orderDate,etaDate,status,
 * notes,customerPartyId,supplierId,links?}` and lands on the new hub; edit sends `{id,updatedAt,…}`
 * (plus the platform's version header, threaded through `initialValues.updatedAt`) so a stale save
 * surfaces the conflict bar. On edit an empty customer/supplier clears the pair (explicit `null`).
 */

export const ORDERS_API_PATH = 'order_hub/orders'
export const ORDERS_LIST_HREF = '/backend/orders'

export const COMPANY_ORDER_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'] as const

export type CompanyOrderFormValues = {
  id?: string
  title: string | null
  orderDate: string | null
  etaDate: string | null
  status: string
  notes: string | null
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
 * The root's own fields plus the two default-counterparty ids. The kept snake→camel contract is the
 * command's; an empty id is sent as `null` so an update clears the stored pair and a create leaves
 * it unset (both nullable).
 */
export function buildCompanyOrderPayload(values: CompanyOrderFormValues): Record<string, unknown> {
  // A date-only field hands back `''`/`undefined` when empty; the command rejects an empty string.
  // `orderDate` is not nullable, so empty omits it (create defaults to today); `etaDate`/`title`/
  // `notes` are nullable, so an empty field clears them explicitly rather than being omitted.
  const title = typeof values.title === 'string' && values.title.trim().length > 0 ? values.title : null
  const notes = typeof values.notes === 'string' && values.notes.trim().length > 0 ? values.notes : null
  const orderDate = typeof values.orderDate === 'string' && values.orderDate.trim().length > 0
    ? values.orderDate.trim()
    : undefined
  const etaDate = typeof values.etaDate === 'string' && values.etaDate.trim().length > 0
    ? values.etaDate.trim()
    : null
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  return {
    title,
    orderDate,
    etaDate,
    status: values.status,
    notes,
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

function useCompanyOrderFields(t: TranslateFn, withLinks: boolean): CrudField[] {
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
      id: 'title',
      label: t('order_hub.companyOrders.form.title'),
      type: 'text',
      layout: 'full',
    },
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
      options: COMPANY_ORDER_STATUSES.map((status) => ({
        value: status,
        label: t(`order_hub.companyOrders.status.${status}`),
      })),
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
  ], [purchaseLoadOptions, salesLoadOptions, t, withLinks])
}

const EMPTY_LINK_REF_ARRAYS: Pick<CompanyOrderFormValues, 'salesLinkRefs' | 'purchaseLinkRefs'> = {
  salesLinkRefs: [],
  purchaseLinkRefs: [],
}

function CompanyOrderCreateForm() {
  const t = useT()
  const router = useRouter()
  const fields = useCompanyOrderFields(t, true)
  const initialValues = React.useMemo<CompanyOrderFormValues>(() => ({
    title: '',
    orderDate: '',
    etaDate: '',
    status: 'draft',
    notes: '',
    customerPartyId: '',
    supplierId: '',
    ...EMPTY_LINK_REF_ARRAYS,
  }), [])

  const handleSubmit = React.useCallback(async (values: CompanyOrderFormValues) => {
    try {
      const links = buildCompanyOrderLinks(values)
      const payload = buildCompanyOrderPayload(values)
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
  }, [router, t])

  return (
    <CrudForm<CompanyOrderFormValues>
      title={t('order_hub.companyOrders.create.title')}
      titleHeadingLevel={1}
      backHref={ORDERS_LIST_HREF}
      fields={fields}
      initialValues={initialValues}
      submitLabel={t('order_hub.companyOrders.form.save')}
      cancelHref={ORDERS_LIST_HREF}
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
  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    title: readProjectedText(item, 'title'),
    orderDate: readProjectedText(item, 'orderDate'),
    etaDate: readProjectedText(item, 'etaDate'),
    status: readProjectedText(item, 'status') || 'draft',
    notes: readProjectedText(item, 'notes'),
    customerPartyId: readProjectedText(item, 'customerPartyId'),
    supplierId: readProjectedText(item, 'supplierId'),
    ...EMPTY_LINK_REF_ARRAYS,
    updatedAt: typeof updatedAtRaw === 'string' ? updatedAtRaw : null,
  }
}

function CompanyOrderEditForm({ id }: { id: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<CompanyOrderFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const fields = useCompanyOrderFields(t, false)

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
    status: 'draft',
    notes: '',
    customerPartyId: '',
    supplierId: '',
    ...EMPTY_LINK_REF_ARRAYS,
    updatedAt: null,
  }), [id])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('order_hub.companyOrders.form.notFound')}
        backHref={ORDERS_LIST_HREF}
      />
    )
  }

  if (loadError) return <ErrorMessage label={loadError} />

  const handleSubmit = async (values: CompanyOrderFormValues) => {
    await updateCrud(ORDERS_API_PATH, {
      id,
      updatedAt: values.updatedAt ?? initial?.updatedAt ?? undefined,
      ...buildCompanyOrderPayload(values),
    })
  }

  return (
    <CrudForm<CompanyOrderFormValues>
      title={t('order_hub.companyOrders.edit.title')}
      titleHeadingLevel={1}
      backHref={ORDERS_LIST_HREF}
      fields={fields}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('order_hub.companyOrders.form.save')}
      cancelHref={ORDERS_LIST_HREF}
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
